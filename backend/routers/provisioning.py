"""
Octofleet Provisioning API Router
E19: PXE Zero-Touch Provisioning
"""

from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Literal
from datetime import datetime
import asyncpg
import uuid
import re
import os
import json

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

class TaskEventCreate(BaseModel):
    """Status callback from provisioning client"""
    event: Literal['booted', 'downloading', 'partitioning', 'applying', 'configuring', 'firstboot', 'done', 'failed']
    message: Optional[str] = None
    progress: Optional[int] = Field(None, ge=0, le=100)
    error: Optional[str] = None

class TaskEventOut(BaseModel):
    id: str
    task_id: str
    event: str
    message: Optional[str]
    progress: Optional[int]
    created_at: datetime

# ============================================
# API Endpoints - Images & Templates
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

# ============================================
# API Endpoints - Tasks CRUD
# ============================================

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

@router.get("/tasks/{task_id}", response_model=ProvisioningTaskOut)
async def get_task(task_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a single provisioning task by ID"""
    row = await db.fetchrow("""
        SELECT t.*, i.name as image_name, i.display_name as image_display_name
        FROM provisioning_tasks t
        LEFT JOIN provisioning_images i ON t.image_id = i.id
        WHERE t.id = $1
    """, task_id)
    
    if not row:
        raise HTTPException(404, "Task not found")
    
    return _task_to_dict(row)

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
# Status Callbacks API (#71)
# ============================================

@router.post("/tasks/{task_id}/events", response_model=TaskEventOut)
async def create_task_event(task_id: str, event: TaskEventCreate, db: asyncpg.Pool = Depends(get_db)):
    """
    Receive status callback from provisioning client.
    Called by WinPE/installer scripts during deployment.
    
    Events: booted, downloading, partitioning, applying, configuring, firstboot, done, failed
    """
    # Verify task exists
    task = await db.fetchrow("SELECT id, status FROM provisioning_tasks WHERE id = $1", task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    
    # Map event to task status
    event_to_status = {
        'booted': 'booting',
        'downloading': 'installing',
        'partitioning': 'installing',
        'applying': 'installing',
        'configuring': 'installing',
        'firstboot': 'installing',
        'done': 'completed',
        'failed': 'failed',
    }
    
    # Map event to default progress
    event_to_progress = {
        'booted': 5,
        'downloading': 15,
        'partitioning': 25,
        'applying': 50,
        'configuring': 85,
        'firstboot': 95,
        'done': 100,
        'failed': None,  # Keep current progress
    }
    
    new_status = event_to_status.get(event.event, task['status'])
    progress = event.progress if event.progress is not None else event_to_progress.get(event.event)
    
    # Create event record
    event_id = str(uuid.uuid4())
    await db.execute("""
        INSERT INTO provisioning_task_events (id, task_id, event, message, progress)
        VALUES ($1, $2, $3, $4, $5)
    """, event_id, task_id, event.event, event.message or event.error, progress)
    
    # Update task status and progress
    update_parts = ["status = $2", "status_message = $3"]
    update_params = [task_id, new_status, event.message or event.error or event.event]
    
    if progress is not None:
        update_parts.append(f"progress_percent = ${len(update_params) + 1}")
        update_params.append(progress)
    
    if event.event == 'done':
        update_parts.append(f"completed_at = NOW()")
    elif event.event == 'failed':
        update_parts.append(f"completed_at = NOW()")
    elif event.event == 'booted' and task['status'] == 'pending':
        update_parts.append(f"started_at = NOW()")
    
    await db.execute(f"""
        UPDATE provisioning_tasks 
        SET {', '.join(update_parts)}
        WHERE id = $1
    """, *update_params)
    
    # Fetch created event
    row = await db.fetchrow("""
        SELECT id, task_id, event, message, progress, created_at
        FROM provisioning_task_events WHERE id = $1
    """, event_id)
    
    return {
        "id": str(row['id']),
        "task_id": str(row['task_id']),
        "event": row['event'],
        "message": row.get('message'),
        "progress": row.get('progress'),
        "created_at": row['created_at'],
    }

@router.get("/tasks/{task_id}/events", response_model=List[TaskEventOut])
async def list_task_events(task_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get all events/callbacks for a task"""
    # Verify task exists
    task = await db.fetchrow("SELECT id FROM provisioning_tasks WHERE id = $1", task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    
    rows = await db.fetch("""
        SELECT id, task_id, event, message, progress, created_at
        FROM provisioning_task_events
        WHERE task_id = $1
        ORDER BY created_at ASC
    """, task_id)
    
    return [{
        "id": str(row['id']),
        "task_id": str(row['task_id']),
        "event": row['event'],
        "message": row.get('message'),
        "progress": row.get('progress'),
        "created_at": row['created_at'],
    } for row in rows]

# ============================================
# PXE API - Dynamic iPXE Script Generation (#72)
# ============================================

@pxe_router.get("/{mac}")
async def get_pxe_script(mac: str, db: asyncpg.Pool = Depends(get_db)):
    """
    Generate iPXE script for a specific MAC address.
    Called by iPXE bootloader during PXE boot.
    
    Returns:
    - Provisioning script if task exists
    - Fallback script (inventory/rescue) if no task
    """
    mac = mac.upper().replace('-', ':').replace('.', ':')
    
    # Find pending task for this MAC
    task = await db.fetchrow("""
        SELECT t.*, i.wim_path, i.wim_index, i.os_type, p.ipxe_template
        FROM provisioning_tasks t
        JOIN provisioning_images i ON t.image_id = i.id
        JOIN provisioning_templates p ON t.platform::text = p.platform::text
        WHERE t.mac_address = $1 AND t.status = 'pending'
    """, mac)
    
    pxe_server = os.environ.get('PXE_SERVER', 'http://192.168.0.5:9080')
    api_server = os.environ.get('API_SERVER', 'http://192.168.0.5:8080')
    
    if not task:
        # No task - return fallback/info screen
        fallback_script = f"""#!ipxe
# Octofleet PXE - No provisioning task for this MAC
# MAC: {mac}

echo
echo ========================================
echo   Octofleet PXE Boot
echo ========================================
echo
echo MAC Address: {mac}
echo No provisioning task found.
echo
echo To provision this machine:
echo   1. Go to Octofleet Web UI
echo   2. Create a new provisioning task
echo   3. Enter this MAC address
echo   4. Reboot this machine
echo
echo Booting from local disk in 30 seconds...
echo Press any key to retry PXE boot.
echo
sleep 30 || chain {pxe_server}/boot.ipxe
exit
"""
        return Response(content=fallback_script, media_type="text/plain")
    
    # Mark task as booting
    await db.execute("""
        UPDATE provisioning_tasks 
        SET status = 'booting', started_at = NOW(), status_message = 'iPXE script delivered'
        WHERE mac_address = $1
    """, mac)
    
    # Get template and substitute variables
    script = task['ipxe_template']
    
    # Variable substitutions
    substitutions = {
        '${PXE_SERVER}': pxe_server,
        '${API_SERVER}': api_server,
        '${MAC}': mac.lower().replace(':', '-'),
        '${MAC_COLON}': mac,
        '${IMAGE_PATH}': task['wim_path'],
        '${IMAGE_INDEX}': str(task['wim_index']),
        '${TASK_ID}': str(task['id']),
        '${HOSTNAME}': task['hostname'] or 'localhost',
        '${OS_TYPE}': task.get('os_type') or 'windows',
    }
    
    for var, value in substitutions.items():
        script = script.replace(var, value)
    
    return Response(content=script, media_type="text/plain")

@pxe_router.get("/")
async def get_default_pxe():
    """Default iPXE script - chainload to MAC-specific script"""
    pxe_server = os.environ.get('PXE_SERVER', 'http://192.168.0.5:9080')
    api_server = os.environ.get('API_SERVER', 'http://192.168.0.5:8080')
    
    script = f"""#!ipxe
# Octofleet PXE Bootloader
# Chainloads to MAC-specific provisioning script

echo Octofleet PXE Boot
echo MAC: ${{net0/mac}}

# Fetch MAC-specific script from API
chain {api_server}/api/v1/pxe/${{net0/mac}} || goto fallback

:fallback
echo
echo Failed to fetch provisioning script.
echo Retrying in 10 seconds...
sleep 10
goto start
"""
    return Response(content=script, media_type="text/plain")

# ============================================
# Helper Functions
# ============================================

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
