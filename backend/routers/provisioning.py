"""
Octofleet Provisioning API Router
E19: PXE Zero-Touch Provisioning
"""

from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime
import asyncpg
import uuid
import re
import os

from dependencies import get_db

router = APIRouter(prefix="/api/v1/provisioning", tags=["provisioning"])
pxe_router = APIRouter(prefix="/api/v1/pxe", tags=["pxe"])

# ============================================
# Models
# ============================================

class ProvisioningImageOut(BaseModel):
    id: str
    name: str
    display_name: str
    wim_path: str
    wim_index: int
    os_type: Optional[str]
    os_version: Optional[str]
    edition: Optional[str]
    architecture: str
    size_bytes: Optional[int]
    is_active: bool

class ProvisioningTemplateOut(BaseModel):
    platform: str
    display_name: str
    ipxe_template: str
    drivers: List[str]
    notes: Optional[str]
    is_active: bool

class ProvisioningTaskCreate(BaseModel):
    mac_address: str = Field(..., description="MAC address in format XX:XX:XX:XX:XX:XX")
    hostname: Optional[str] = Field(None, max_length=63)
    platform: str = Field(..., description="Platform type: hyperv-gen2, kvm-libvirt, baremetal-uefi")
    image_name: str = Field(..., description="Image name from provisioning_images")
    
    @validator('mac_address')
    def validate_mac(cls, v):
        v = v.upper().replace('-', ':')
        if not re.match(r'^([0-9A-F]{2}:){5}[0-9A-F]{2}$', v):
            raise ValueError('Invalid MAC address format')
        return v

class ProvisioningTaskOut(BaseModel):
    id: str
    mac_address: str
    hostname: Optional[str]
    platform: str
    image_name: Optional[str]
    image_display_name: Optional[str]
    status: str
    status_message: Optional[str]
    progress_percent: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

# ============================================
# API Endpoints
# ============================================

@router.get("/images", response_model=List[ProvisioningImageOut])
async def list_images(active_only: bool = True, db: asyncpg.Pool = Depends(get_db)):
    """List available OS images for provisioning"""
    query = "SELECT * FROM provisioning_images"
    if active_only:
        query += " WHERE is_active = true"
    query += " ORDER BY display_name"
    
    rows = await db.fetch(query)
    return [{
        "id": str(row["id"]),
        "name": row["name"],
        "display_name": row["display_name"],
        "wim_path": row["wim_path"],
        "wim_index": row["wim_index"],
        "os_type": row.get("os_type"),
        "os_version": row.get("os_version"),
        "edition": row.get("edition"),
        "architecture": row["architecture"],
        "size_bytes": row.get("size_bytes"),
        "is_active": row["is_active"],
    } for row in rows]

@router.get("/templates", response_model=List[ProvisioningTemplateOut])
async def list_templates(db: asyncpg.Pool = Depends(get_db)):
    """List available platform templates"""
    import json
    rows = await db.fetch("""
        SELECT platform, display_name, ipxe_template, drivers, notes, is_active
        FROM provisioning_templates
        WHERE is_active = true
        ORDER BY display_name
    """)
    return [{
        "platform": str(row["platform"]),
        "display_name": row["display_name"],
        "ipxe_template": row["ipxe_template"],
        "drivers": json.loads(row["drivers"]) if row["drivers"] else [],
        "notes": row.get("notes"),
        "is_active": row["is_active"],
    } for row in rows]

@router.get("/tasks", response_model=List[ProvisioningTaskOut])
async def list_tasks(status: Optional[str] = None, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    """List provisioning tasks"""
    query = """
        SELECT t.*, i.name as image_name, i.display_name as image_display_name
        FROM provisioning_tasks t
        LEFT JOIN provisioning_images i ON t.image_id = i.id
    """
    params = []
    
    if status:
        query += " WHERE t.status = $1"
        params.append(status)
    
    query += f" ORDER BY t.created_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    rows = await db.fetch(query, *params)
    return [_task_to_dict(row) for row in rows]

@router.post("/tasks", response_model=ProvisioningTaskOut)
async def create_task(task: ProvisioningTaskCreate, db: asyncpg.Pool = Depends(get_db)):
    """Create a new provisioning task"""
    
    image = await db.fetchrow("SELECT id FROM provisioning_images WHERE name = $1", task.image_name)
    if not image:
        raise HTTPException(404, f"Image not found: {task.image_name}")
    
    template = await db.fetchrow("SELECT platform FROM provisioning_templates WHERE platform = $1", task.platform)
    if not template:
        raise HTTPException(404, f"Platform not found: {task.platform}")
    
    existing = await db.fetchrow(
        "SELECT id FROM provisioning_tasks WHERE mac_address = $1 AND status NOT IN ('completed', 'failed')",
        task.mac_address
    )
    if existing:
        raise HTTPException(409, f"Active task already exists for MAC {task.mac_address}")
    
    hostname = task.hostname or f"SRV-{task.mac_address[-8:].replace(':', '')}"
    task_id = str(uuid.uuid4())
    
    await db.execute("""
        INSERT INTO provisioning_tasks (id, mac_address, hostname, platform, image_id)
        VALUES ($1, $2, $3, $4, $5)
    """, task_id, task.mac_address, hostname, task.platform, image['id'])
    
    row = await db.fetchrow("""
        SELECT t.*, i.name as image_name, i.display_name as image_display_name
        FROM provisioning_tasks t
        LEFT JOIN provisioning_images i ON t.image_id = i.id
        WHERE t.id = $1
    """, task_id)
    
    return _task_to_dict(row)

@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a provisioning task"""
    result = await db.execute("DELETE FROM provisioning_tasks WHERE id = $1", task_id)
    if result == "DELETE 0":
        raise HTTPException(404, "Task not found")
    return {"status": "deleted"}

# ============================================
# PXE API - Dynamic iPXE Script Generation
# ============================================

@pxe_router.get("/{mac}")
async def get_pxe_script(mac: str, db: asyncpg.Pool = Depends(get_db)):
    """Generate iPXE script for a specific MAC address"""
    mac = mac.upper().replace('-', ':')
    
    task = await db.fetchrow("""
        SELECT t.*, i.wim_path, i.wim_index, p.ipxe_template
        FROM provisioning_tasks t
        JOIN provisioning_images i ON t.image_id = i.id
        JOIN provisioning_templates p ON t.platform::text = p.platform::text
        WHERE t.mac_address = $1 AND t.status = 'pending'
    """, mac)
    
    if not task:
        return Response(content="#!ipxe\necho No provisioning task for this MAC\nexit\n", media_type="text/plain")
    
    await db.execute("UPDATE provisioning_tasks SET status = 'booting', started_at = NOW() WHERE mac_address = $1", mac)
    
    pxe_server = os.environ.get('PXE_SERVER', 'http://192.168.0.5:9080')
    script = task['ipxe_template']
    script = script.replace('${PXE_SERVER}', pxe_server)
    script = script.replace('${MAC}', mac.lower().replace(':', '-'))
    script = script.replace('${IMAGE_PATH}', task['wim_path'])
    script = script.replace('${IMAGE_INDEX}', str(task['wim_index']))
    
    return Response(content=script, media_type="text/plain")

# Helper function
def _task_to_dict(row) -> dict:
    return {
        "id": str(row['id']),
        "mac_address": row['mac_address'],
        "hostname": row['hostname'],
        "platform": str(row['platform']),
        "image_name": row.get('image_name'),
        "image_display_name": row.get('image_display_name'),
        "status": str(row['status']),
        "status_message": row.get('status_message'),
        "progress_percent": row.get('progress_percent') or 0,
        "created_at": row['created_at'],
        "started_at": row.get('started_at'),
        "completed_at": row.get('completed_at'),
    }
