"""
Octofleet Provisioning API Router
E19: PXE Zero-Touch Provisioning
"""

import json
import os
import re
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, validator

router = APIRouter(prefix="/api/v1/provisioning", tags=["provisioning"])

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

class ProvisioningImageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Unique identifier (e.g., win2025-standard)")
    display_name: str = Field(..., min_length=1, max_length=255, description="Display name in UI")
    wim_path: str = Field(..., description="Path to WIM/vmlinuz (e.g., /images/win2025/install.wim)")
    wim_index: int = Field(1, ge=1, le=20, description="WIM image index (Windows only)")
    os_type: Optional[str] = Field(None, description="OS type: windows-server, windows, linux")
    os_version: Optional[str] = Field(None, description="OS version (e.g., 2025, 24.04)")
    edition: Optional[str] = Field(None, description="Edition (e.g., Standard, Datacenter)")
    architecture: str = Field("amd64", description="Architecture: amd64, arm64")
    is_active: bool = True

class ProvisioningImageUpdate(BaseModel):
    display_name: Optional[str] = None
    wim_path: Optional[str] = None
    wim_index: Optional[int] = None
    os_type: Optional[str] = None
    os_version: Optional[str] = None
    edition: Optional[str] = None
    architecture: Optional[str] = None
    is_active: Optional[bool] = None

class ProvisioningTemplateOut(BaseModel):
    platform: str
    display_name: str
    ipxe_template: str
    drivers: List[str]
    notes: Optional[str]
    is_active: bool

class ProvisioningTemplateCreate(BaseModel):
    platform: str = Field(..., min_length=1, max_length=50, description="Platform ID (e.g., hyperv-gen2)")
    display_name: str = Field(..., min_length=1, max_length=100)
    ipxe_template: str = Field(..., description="iPXE script template")
    drivers: List[str] = Field(default_factory=list, description="Required driver files")
    notes: Optional[str] = None
    is_active: bool = True

class ProvisioningTemplateUpdate(BaseModel):
    display_name: Optional[str] = None
    ipxe_template: Optional[str] = None
    drivers: Optional[List[str]] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

class ProvisioningTaskCreate(BaseModel):
    mac_address: str = Field(..., description="MAC address in format XX:XX:XX:XX:XX:XX")
    hostname: Optional[str] = Field(None, max_length=63)
    platform: str = Field(..., description="Platform type: hyperv-gen2, kvm-libvirt, baremetal-uefi")
    image_name: str = Field(..., description="Image name from provisioning_images")
    use_dhcp: bool = True
    static_ip: Optional[str] = None
    dns_servers: List[str] = ["192.168.0.8"]
    domain_name: Optional[str] = None
    domain_user: Optional[str] = None
    domain_password: Optional[str] = None
    admin_password: Optional[str] = None
    install_octofleet_agent: bool = True
    enable_rdp: bool = True
    
    @validator('mac_address')
    def validate_mac(cls, v):
        # Normalize MAC address
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
    use_dhcp: bool
    dns_servers: List[str]
    domain_name: Optional[str]
    status: str
    status_message: Optional[str]
    current_step: int
    total_steps: int
    progress_percent: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

class ProvisioningStatusUpdate(BaseModel):
    status: str
    message: Optional[str] = None
    step: Optional[int] = None
    total_steps: Optional[int] = None

# ============================================
# Dependency: Database connection
# ============================================

async def get_db():
    """Get database connection from pool"""
    from dependencies import db_pool
    if db_pool is None:
        raise RuntimeError("Database pool not initialized")
    async with db_pool.acquire() as conn:
        yield conn

# ============================================
# API Endpoints
# ============================================

@router.get("/images", response_model=List[ProvisioningImageOut])
async def list_images(active_only: bool = True, conn = Depends(get_db)):
    """List available OS images for provisioning"""
    query = """
        SELECT id::text, name, display_name, wim_path, wim_index, 
               os_type, os_version, edition, architecture, size_bytes, is_active
        FROM provisioning_images
    """
    if active_only:
        query += " WHERE is_active = true"
    query += " ORDER BY display_name"
    
    rows = await conn.fetch(query)
    return [dict(row) for row in rows]


@router.post("/images", response_model=ProvisioningImageOut)
async def create_image(image: ProvisioningImageCreate, conn = Depends(get_db)):
    """Create a new OS image entry"""
    # Check for duplicate name
    existing = await conn.fetchrow(
        "SELECT id FROM provisioning_images WHERE name = $1", image.name
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"Image with name '{image.name}' already exists")
    
    row = await conn.fetchrow("""
        INSERT INTO provisioning_images (name, display_name, wim_path, wim_index, os_type, os_version, edition, architecture, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id::text, name, display_name, wim_path, wim_index, os_type, os_version, edition, architecture, size_bytes, is_active
    """, image.name, image.display_name, image.wim_path, image.wim_index, 
        image.os_type, image.os_version, image.edition, image.architecture, image.is_active)
    
    return dict(row)


@router.put("/images/{image_id}", response_model=ProvisioningImageOut)
async def update_image(image_id: str, image: ProvisioningImageUpdate, conn = Depends(get_db)):
    """Update an OS image entry"""
    # Build dynamic update query
    updates = []
    values = []
    param_num = 1
    
    for field, value in image.dict(exclude_unset=True).items():
        if value is not None:
            updates.append(f"{field} = ${param_num}")
            values.append(value)
            param_num += 1
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    values.append(image_id)
    query = f"""
        UPDATE provisioning_images 
        SET {', '.join(updates)}, updated_at = NOW()
        WHERE id = ${param_num}
        RETURNING id::text, name, display_name, wim_path, wim_index, os_type, os_version, edition, architecture, size_bytes, is_active
    """
    
    row = await conn.fetchrow(query, *values)
    if not row:
        raise HTTPException(status_code=404, detail="Image not found")
    
    return dict(row)


@router.delete("/images/{image_id}")
async def delete_image(image_id: str, conn = Depends(get_db)):
    """Delete an OS image entry (or deactivate if in use)"""
    # Check if image is referenced by any tasks
    in_use = await conn.fetchval(
        "SELECT COUNT(*) FROM provisioning_tasks WHERE image_name = (SELECT name FROM provisioning_images WHERE id = $1)",
        image_id
    )
    
    if in_use and in_use > 0:
        # Soft delete - just deactivate
        await conn.execute(
            "UPDATE provisioning_images SET is_active = false, updated_at = NOW() WHERE id = $1",
            image_id
        )
        return {"status": "deactivated", "message": f"Image deactivated (referenced by {in_use} tasks)"}
    
    result = await conn.execute("DELETE FROM provisioning_images WHERE id = $1", image_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Image not found")
    
    return {"status": "deleted"}


@router.get("/templates", response_model=List[ProvisioningTemplateOut])
async def list_templates(conn = Depends(get_db)):
    """List available platform templates"""
    rows = await conn.fetch("""
        SELECT platform, display_name, ipxe_template, drivers, notes, is_active
        FROM provisioning_templates
        WHERE is_active = true
        ORDER BY display_name
    """)
    result = []
    for row in rows:
        d = dict(row)
        # Parse drivers JSON string to list
        if isinstance(d.get('drivers'), str):
            try:
                d['drivers'] = json.loads(d['drivers'])
            except:
                d['drivers'] = []
        result.append(d)
    return result


@router.post("/templates", response_model=ProvisioningTemplateOut)
async def create_template(template: ProvisioningTemplateCreate, conn = Depends(get_db)):
    """Create a new platform template"""
    existing = await conn.fetchrow(
        "SELECT platform FROM provisioning_templates WHERE platform = $1", template.platform
    )
    if existing:
        raise HTTPException(status_code=400, detail=f"Template '{template.platform}' already exists")
    
    drivers_json = json.dumps(template.drivers)
    
    row = await conn.fetchrow("""
        INSERT INTO provisioning_templates (platform, display_name, ipxe_template, drivers, notes, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING platform, display_name, ipxe_template, drivers, notes, is_active
    """, template.platform, template.display_name, template.ipxe_template, 
        drivers_json, template.notes, template.is_active)
    
    d = dict(row)
    d['drivers'] = template.drivers
    return d


@router.put("/templates/{platform}", response_model=ProvisioningTemplateOut)
async def update_template(platform: str, template: ProvisioningTemplateUpdate, conn = Depends(get_db)):
    """Update a platform template"""
    updates = []
    values = []
    param_num = 1
    
    for field, value in template.dict(exclude_unset=True).items():
        if value is not None:
            if field == 'drivers':
                updates.append(f"{field} = ${param_num}")
                values.append(json.dumps(value))
            else:
                updates.append(f"{field} = ${param_num}")
                values.append(value)
            param_num += 1
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    values.append(platform)
    query = f"""
        UPDATE provisioning_templates 
        SET {', '.join(updates)}, updated_at = NOW()
        WHERE platform = ${param_num}
        RETURNING platform, display_name, ipxe_template, drivers, notes, is_active
    """
    
    row = await conn.fetchrow(query, *values)
    if not row:
        raise HTTPException(status_code=404, detail="Template not found")
    
    d = dict(row)
    if isinstance(d.get('drivers'), str):
        d['drivers'] = json.loads(d['drivers'])
    return d


@router.delete("/templates/{platform}")
async def delete_template(platform: str, conn = Depends(get_db)):
    """Delete a platform template"""
    result = await conn.execute("DELETE FROM provisioning_templates WHERE platform = $1", platform)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Template not found")
    return {"status": "deleted"}


@router.get("/tasks", response_model=List[ProvisioningTaskOut])
async def list_tasks(
    status: Optional[str] = None,
    limit: int = 50,
    conn = Depends(get_db)
):
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
    
    query += " ORDER BY t.created_at DESC LIMIT $" + str(len(params) + 1)
    params.append(limit)
    
    rows = await conn.fetch(query, *params)
    return [_task_to_dict(row) for row in rows]

@router.post("/tasks", response_model=ProvisioningTaskOut)
async def create_task(task: ProvisioningTaskCreate, conn = Depends(get_db)):
    """Create a new provisioning task"""
    
    # Get image ID
    image = await conn.fetchrow(
        "SELECT id FROM provisioning_images WHERE name = $1",
        task.image_name
    )
    if not image:
        raise HTTPException(404, f"Image not found: {task.image_name}")
    
    # Validate platform
    template = await conn.fetchrow(
        "SELECT platform FROM provisioning_templates WHERE platform = $1",
        task.platform
    )
    if not template:
        raise HTTPException(404, f"Platform not found: {task.platform}")
    
    # Check for duplicate MAC
    existing = await conn.fetchrow(
        "SELECT id FROM provisioning_tasks WHERE mac_address = $1 AND status NOT IN ('completed', 'failed')",
        task.mac_address
    )
    if existing:
        raise HTTPException(409, f"Active task already exists for MAC {task.mac_address}")
    
    # Generate hostname if not provided
    hostname = task.hostname or f"SRV-{task.mac_address[-8:].replace(':', '')}"
    
    # Create task
    task_id = str(uuid.uuid4())
    
    await conn.execute("""
        INSERT INTO provisioning_tasks (
            id, mac_address, hostname, platform, image_id,
            use_dhcp, dns_servers, domain_name, domain_user,
            install_octofleet_agent, enable_rdp
        ) VALUES ($1, $2, $3, $4::platform_type, $5, $6, $7::inet[], $8, $9, $10, $11)
    """, task_id, task.mac_address, hostname, task.platform, image['id'],
         task.use_dhcp, task.dns_servers, task.domain_name, task.domain_user,
         task.install_octofleet_agent, task.enable_rdp)
    
    # Log event
    await conn.execute("""
        INSERT INTO provisioning_events (task_id, event_type, message)
        VALUES ($1, 'created', 'Provisioning task created')
    """, task_id)
    
    # Fetch and return
    row = await conn.fetchrow("""
        SELECT t.*, i.name as image_name, i.display_name as image_display_name
        FROM provisioning_tasks t
        LEFT JOIN provisioning_images i ON t.image_id = i.id
        WHERE t.id = $1
    """, task_id)
    
    return _task_to_dict(row)

@router.get("/tasks/{task_id}", response_model=ProvisioningTaskOut)
async def get_task(task_id: str, conn = Depends(get_db)):
    """Get provisioning task details"""
    row = await conn.fetchrow("""
        SELECT t.*, i.name as image_name, i.display_name as image_display_name
        FROM provisioning_tasks t
        LEFT JOIN provisioning_images i ON t.image_id = i.id
        WHERE t.id = $1
    """, task_id)
    
    if not row:
        raise HTTPException(404, "Task not found")
    
    return _task_to_dict(row)

@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, conn = Depends(get_db)):
    """Delete a provisioning task"""
    result = await conn.execute(
        "DELETE FROM provisioning_tasks WHERE id = $1",
        task_id
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Task not found")
    return {"status": "deleted"}

@router.post("/tasks/{mac}/status")
async def update_task_status(mac: str, update: ProvisioningStatusUpdate, conn = Depends(get_db)):
    """Update provisioning task status (called by WinPE during deployment)"""
    
    # Normalize MAC
    mac = mac.upper().replace('-', ':')
    
    # Find task
    task = await conn.fetchrow(
        "SELECT id, status FROM provisioning_tasks WHERE mac_address = $1",
        mac
    )
    if not task:
        raise HTTPException(404, f"No task found for MAC {mac}")
    
    # Update status
    progress = 0
    if update.step and update.total_steps:
        progress = int((update.step / update.total_steps) * 100)
    
    now = datetime.utcnow()
    started_at = now if update.status == 'booting' else None
    completed_at = now if update.status in ('completed', 'failed') else None
    
    await conn.execute("""
        UPDATE provisioning_tasks SET
            status = $1,
            status_message = $2,
            current_step = COALESCE($3, current_step),
            total_steps = COALESCE($4, total_steps),
            progress_percent = $5,
            started_at = COALESCE($6, started_at),
            completed_at = COALESCE($7, completed_at),
            updated_at = NOW()
        WHERE mac_address = $8
    """, update.status, update.message, update.step, update.total_steps,
         progress, started_at, completed_at, mac)
    
    # Log event
    await conn.execute("""
        INSERT INTO provisioning_events (task_id, event_type, step_number, message)
        VALUES ($1, 'status_update', $2, $3)
    """, task['id'], update.step, update.message or update.status)
    
    return {"status": "updated"}

# ============================================
# PXE API - Dynamic iPXE Script Generation
# ============================================

pxe_router = APIRouter(prefix="/api/v1/pxe", tags=["pxe"])

@pxe_router.get("/{mac}")
async def get_pxe_script(mac: str, conn = Depends(get_db)):
    """
    Generate iPXE script for a specific MAC address.
    Called by boot.ipxe to get machine-specific boot config.
    """
    # Normalize MAC
    mac = mac.upper().replace('-', ':')
    
    # Find task
    task = await conn.fetchrow("""
        SELECT t.*, 
               i.wim_path, i.wim_index, i.name as image_name, i.os_type, i.os_version,
               p.ipxe_template, p.drivers
        FROM provisioning_tasks t
        JOIN provisioning_images i ON t.image_id = i.id
        JOIN provisioning_templates p ON t.platform::text = p.platform::text
        WHERE t.mac_address = $1 AND t.status IN ('pending', 'booting')
    """, mac)
    
    if not task:
        # No task - return local boot
        return Response(
            content="#!ipxe\necho No provisioning task for ${mac}\nexit\n",
            media_type="text/plain"
        )
    
    # Update status to booting
    await conn.execute("""
        UPDATE provisioning_tasks SET 
            status = 'booting', 
            started_at = NOW(),
            updated_at = NOW()
        WHERE mac_address = $1
    """, mac)
    
    pxe_server = os.environ.get('PXE_SERVER', 'http://192.168.0.5:9080')
    mac_safe = mac.lower().replace(':', '-')
    os_type = task.get('os_type', 'windows')
    
    # Check if Linux - generate different boot script
    if os_type == 'linux':
        version = task.get('os_version', '24.04')
        hostname = task.get('hostname', 'ubuntu-server')
        
        # Log event
        await conn.execute("""
            INSERT INTO provisioning_events (task_id, event_type, message)
            VALUES ($1, 'ipxe_fetch', 'iPXE script fetched - booting Ubuntu installer')
        """, task['id'])
        
        # Generate Ubuntu autoinstall iPXE script
        # Use NFS to mount live filesystem - casper handles NFS mount
        # DON'T set root= - casper handles that via overlay
        script = f"""#!ipxe
# Octofleet Ubuntu {version} Deployment via NFS
set pxe-server {pxe_server}
set nfs-server 192.168.0.5
set live-url ${{pxe-server}}/ubuntu-live/{version}

echo =============================================
echo    Octofleet Linux Deployment  
echo    Image: Ubuntu {version} LTS
echo    Hostname: {hostname}
echo =============================================
echo

echo Loading kernel...
kernel ${{live-url}}/casper/vmlinuz || goto failed

echo Loading initrd...  
initrd ${{live-url}}/casper/initrd || goto failed

echo
echo Starting Ubuntu Live with NFS root...
echo NFS: ${{nfs-server}}:/mnt/ubuntu-{version}
echo

imgargs vmlinuz initrd=initrd boot=casper netboot=nfs nfsroot=${{nfs-server}}:/mnt/ubuntu-{version},tcp,vers=3 ip=dhcp autoinstall "ds=nocloud-net;s=${{pxe-server}}/autoinstall/{mac_safe}/" ---

boot

:failed
echo Boot failed!
shell
"""
        return Response(content=script, media_type="text/plain")
    
    # Windows - use template
    # Log event
    await conn.execute("""
        INSERT INTO provisioning_events (task_id, event_type, message)
        VALUES ($1, 'ipxe_fetch', 'iPXE script fetched - booting WinPE')
    """, task['id'])
    
    # Generate iPXE script from template
    script = task['ipxe_template']
    script = script.replace('${PXE_SERVER}', pxe_server)
    script = script.replace('${MAC}', mac_safe)
    script = script.replace('${IMAGE_PATH}', task['wim_path'])
    script = script.replace('${IMAGE_INDEX}', str(task['wim_index']))
    
    return Response(content=script, media_type="text/plain")

# Helper function
def _task_to_dict(row) -> dict:
    """Convert database row to API response dict"""
    dns = row.get('dns_servers') or []
    if isinstance(dns, str):
        dns = [dns]
    
    return {
        "id": str(row['id']),
        "mac_address": row['mac_address'],
        "hostname": row['hostname'],
        "platform": str(row['platform']),
        "image_name": row.get('image_name'),
        "image_display_name": row.get('image_display_name'),
        "use_dhcp": row['use_dhcp'],
        "dns_servers": [str(d) for d in dns] if dns else [],
        "domain_name": row['domain_name'],
        "status": str(row['status']),
        "status_message": row['status_message'],
        "current_step": row['current_step'] or 0,
        "total_steps": row['total_steps'] or 7,
        "progress_percent": row['progress_percent'] or 0,
        "created_at": row['created_at'],
        "started_at": row['started_at'],
        "completed_at": row['completed_at'],
    }


# ============================================
# PXE Callback - Status Updates from WinPE
# ============================================

class PXECallbackRequest(BaseModel):
    mac: Optional[str] = None
    hostname: Optional[str] = None
    step: str  # winpe_started, image_downloaded, installing, completed, failed
    message: Optional[str] = None
    details: Optional[dict] = None

# Step to progress mapping
STEP_PROGRESS = {
    "winpe_started": 10,
    "drivers_loaded": 15,
    "network_ready": 20,
    "partitioning": 30,
    "image_downloading": 40,
    "image_downloaded": 50,
    "image_applying": 60,
    "drivers_injected": 70,
    "unattend_downloaded": 75,
    "bootloader_configured": 85,
    "rebooting": 90,
    "oobe_started": 92,
    "oobe_complete": 95,
    "agent_installed": 98,
    "completed": 100,
    "failed": -1
}

@pxe_router.post("/callback")
async def pxe_callback(request: PXECallbackRequest, conn = Depends(get_db)):
    """
    Callback endpoint for WinPE/Windows to report deployment progress.
    Called from startnet.cmd and SetupComplete.cmd
    """
    
    # Find task by MAC or hostname
    task = None
    if request.mac:
        mac = request.mac.upper().replace('-', ':')
        task = await conn.fetchrow("""
            SELECT id, hostname, status FROM provisioning_tasks 
            WHERE mac_address = $1 AND status NOT IN ('completed', 'failed')
        """, mac)
    elif request.hostname:
        task = await conn.fetchrow("""
            SELECT id, hostname, status FROM provisioning_tasks 
            WHERE hostname = $1 AND status NOT IN ('completed', 'failed')
        """, request.hostname)
    
    if not task:
        return {"status": "ignored", "message": "No active task found"}
    
    # Calculate progress
    progress = STEP_PROGRESS.get(request.step, 0)
    
    # Determine new status
    status_map = {
        "winpe_started": "installing",
        "image_applying": "installing",
        "oobe_started": "configuring",
        "oobe_complete": "configuring",
        "agent_installed": "configuring",
        "completed": "completed",
        "failed": "failed"
    }
    new_status = status_map.get(request.step, task['status'])
    
    # Update task
    if request.step == "completed":
        await conn.execute("""
            UPDATE provisioning_tasks 
            SET status = 'completed',
                progress_percent = 100,
                status_message = $2,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
        """, task['id'], request.message or "Deployment completed")
    elif request.step == "failed":
        await conn.execute("""
            UPDATE provisioning_tasks 
            SET status = 'failed',
                status_message = $2,
                updated_at = NOW()
            WHERE id = $1
        """, task['id'], request.message or "Deployment failed")
    else:
        await conn.execute("""
            UPDATE provisioning_tasks 
            SET status = $2,
                progress_percent = $3,
                status_message = $4,
                current_step = $5,
                updated_at = NOW()
            WHERE id = $1
        """, task['id'], new_status, progress if progress > 0 else task.get('progress_percent', 0), 
           request.message, STEP_PROGRESS.get(request.step, 0))
    
    # Log event
    await conn.execute("""
        INSERT INTO provisioning_events (task_id, event_type, message, details)
        VALUES ($1, $2, $3, $4)
    """, task['id'], request.step, request.message or request.step, 
       json.dumps(request.details) if request.details else None)
    
    return {
        "status": "ok",
        "task_id": str(task['id']),
        "hostname": task['hostname'],
        "new_status": new_status,
        "progress": progress
    }


@pxe_router.get("/autoinstall/{mac}/user-data")
async def get_autoinstall_userdata(mac: str, conn = Depends(get_db)):
    """
    Generate cloud-init user-data for Ubuntu autoinstall.
    """
    mac = mac.upper().replace('-', ':')
    
    task = await conn.fetchrow("""
        SELECT t.*, i.os_version
        FROM provisioning_tasks t
        JOIN provisioning_images i ON t.image_id = i.id
        WHERE t.mac_address = $1
    """, mac)
    
    if not task:
        raise HTTPException(404, "Task not found")
    
    hostname = task.get('hostname', 'ubuntu-server')
    # SHA512 hash of "octofleet"
    password_hash = "$6$2Y0REkDr5wNb9Wk6$jEDTFTSXQcc6pLRdS8BXEaZlkJu7.5vw00vO4c/3l0FEDPCW8/6SctvDFdI0tkimZdnTC3ncqoWzJeh934Uuv."
    
    # Generate autoinstall config
    userdata = f"""#cloud-config
autoinstall:
  version: 1
  locale: en_US.UTF-8
  keyboard:
    layout: de
    variant: ""
  refresh-installer:
    update: false
  identity:
    hostname: {hostname}
    username: octofleet
    password: "{password_hash}"
  ssh:
    install-server: true
    allow-pw: true
  storage:
    layout:
      name: lvm
      sizing-policy: all
  packages:
    - curl
    - wget
    - openssh-server
    - htop
    - vim
  late-commands:
    - curtin in-target --target=/target -- systemctl enable ssh
"""
    
    return Response(content=userdata, media_type="text/yaml")


@pxe_router.get("/autoinstall/{mac}/meta-data")
async def get_autoinstall_metadata(mac: str, conn = Depends(get_db)):
    """
    Generate cloud-init meta-data for Ubuntu autoinstall.
    """
    mac = mac.upper().replace('-', ':')
    
    task = await conn.fetchrow("""
        SELECT hostname FROM provisioning_tasks WHERE mac_address = $1
    """, mac)
    
    hostname = task['hostname'] if task else 'ubuntu-server'
    
    metadata = f"""instance-id: {mac.replace(':', '')}
local-hostname: {hostname}
"""
    
    return Response(content=metadata, media_type="text/yaml")
