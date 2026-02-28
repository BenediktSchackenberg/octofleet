"""
Octofleet Provisioning API Router - ISO Management Extension
Handles ISO scanning, mounting, and automatic image registration
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import subprocess
import json
import os
import re

iso_router = APIRouter(prefix="/api/v1/provisioning/iso", tags=["provisioning-iso"])

# Path to the iso-manager script
ISO_MANAGER_SCRIPT = "/home/benedikt/.openclaw/workspace/octofleet-work/provisioning/scripts/iso-manager.sh"

# Default ISO directory
DEFAULT_ISO_PATH = "/mnt/isos"

# Mount point base directory
MOUNT_BASE = "/mnt"

# ============================================
# Models
# ============================================

class ISOInfo(BaseModel):
    path: str
    name: str
    size: int
    size_human: str
    detected_os: Optional[str] = None
    mounted: bool = False
    mount_target: Optional[str] = None

class ISOScanResponse(BaseModel):
    iso_path: str
    isos: List[ISOInfo]

class ISOMountRequest(BaseModel):
    iso_path: str
    mount_target: Optional[str] = None  # Auto-generated if not provided

class ISOMountResponse(BaseModel):
    status: str
    iso_path: str
    mount_target: str
    loop_device: Optional[str] = None

class WIMImage(BaseModel):
    index: int
    name: str
    description: Optional[str] = None

class WIMInfoResponse(BaseModel):
    wim_path: str
    images: List[WIMImage]

class AutoRegisterRequest(BaseModel):
    iso_path: str
    os_type: str  # windows-server, windows, linux
    edition: Optional[str] = None
    wim_index: Optional[int] = None  # For Windows

# ============================================
# Helper Functions
# ============================================

def run_iso_manager(command: List[str]) -> dict:
    """Run iso-manager.sh and return JSON result"""
    try:
        # For commands that need root, we use sudo
        full_cmd = ["sudo", ISO_MANAGER_SCRIPT] + command
        result = subprocess.run(full_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return {"error": result.stderr or f"Command failed with code {result.returncode}"}
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out"}
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON response: {e}"}
    except Exception as e:
        return {"error": str(e)}

def human_size(size: int) -> str:
    """Convert bytes to human readable"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"

def detect_os_from_filename(filename: str) -> Optional[str]:
    """Guess OS type from ISO filename"""
    name_lower = filename.lower()
    if 'windows' in name_lower and 'server' in name_lower:
        return 'windows-server'
    elif 'windows' in name_lower:
        return 'windows'
    elif 'ubuntu' in name_lower or 'debian' in name_lower:
        return 'linux-ubuntu'
    elif 'rhel' in name_lower or 'centos' in name_lower or 'rocky' in name_lower:
        return 'linux-rhel'
    elif 'virtio' in name_lower:
        return 'drivers'
    return None

def get_current_mounts() -> Dict[str, str]:
    """Get dict of iso_path -> mount_target for current mounts"""
    try:
        result = subprocess.run(['mount'], capture_output=True, text=True)
        mounts = {}
        
        for line in result.stdout.split('\n'):
            # Match ISO mounts (iso9660, udf) - the source is the ISO file path
            if 'iso9660' in line or ('udf' in line and '.iso' in line.lower()):
                parts = line.split()
                if len(parts) >= 3:
                    iso_path = parts[0]  # Direct ISO path for loop mounts
                    target = parts[2]
                    # Only add if it looks like an ISO file
                    if '.iso' in iso_path.lower():
                        mounts[iso_path] = target
        
        return mounts
    except:
        return {}

# ============================================
# API Endpoints
# ============================================

@iso_router.get("/scan", response_model=ISOScanResponse)
async def scan_isos(path: str = DEFAULT_ISO_PATH):
    """Scan a directory for ISO files"""
    if not os.path.isdir(path):
        raise HTTPException(
            status_code=400,
            detail=f"Directory not found: {path}. If running in Docker, make sure the "
                   f"host path is bind-mounted into the container (e.g. volumes: "
                   f"- /mnt/isos:/mnt/isos:ro in docker-compose.yml)."
        )
    
    # Get current mounts
    current_mounts = get_current_mounts()
    
    # Scan for ISOs
    isos = []
    for filename in os.listdir(path):
        if filename.lower().endswith('.iso'):
            full_path = os.path.join(path, filename)
            try:
                size = os.path.getsize(full_path)
            except:
                size = 0
            
            mounted = full_path in current_mounts
            mount_target = current_mounts.get(full_path)
            
            isos.append(ISOInfo(
                path=full_path,
                name=filename,
                size=size,
                size_human=human_size(size),
                detected_os=detect_os_from_filename(filename),
                mounted=mounted,
                mount_target=mount_target
            ))
    
    return ISOScanResponse(iso_path=path, isos=isos)


@iso_router.post("/mount", response_model=ISOMountResponse)
async def mount_iso(request: ISOMountRequest):
    """Mount an ISO file to a loop device"""
    if not os.path.isfile(request.iso_path):
        raise HTTPException(status_code=400, detail=f"ISO not found: {request.iso_path}")
    
    # Generate mount target if not provided
    if request.mount_target:
        mount_target = request.mount_target
    else:
        # Auto-generate from filename
        basename = os.path.basename(request.iso_path).lower()
        if 'windows' in basename:
            mount_target = "/mnt/winiso"
        elif 'ubuntu' in basename:
            version = re.search(r'(\d+\.\d+)', basename)
            ver = version.group(1) if version else "latest"
            mount_target = f"/mnt/ubuntu-{ver}"
        elif 'virtio' in basename:
            mount_target = "/mnt/virtio"
        else:
            mount_target = f"/mnt/iso-{os.path.basename(request.iso_path)[:20]}"
    
    result = run_iso_manager(["mount", request.iso_path, mount_target])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ISOMountResponse(
        status=result.get("status", "unknown"),
        iso_path=request.iso_path,
        mount_target=mount_target,
        loop_device=result.get("loop")
    )


@iso_router.post("/unmount")
async def unmount_iso(target: str):
    """Unmount an ISO"""
    result = run_iso_manager(["unmount", target])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return result


@iso_router.get("/mounts")
async def list_mounts():
    """List current ISO mounts"""
    result = run_iso_manager(["list"])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return result


@iso_router.get("/wim-info", response_model=WIMInfoResponse)
async def get_wim_info(wim_path: str):
    """Get WIM image information (indices and editions)"""
    if not os.path.isfile(wim_path):
        raise HTTPException(status_code=400, detail=f"WIM not found: {wim_path}")
    
    result = run_iso_manager(["wim-info", wim_path])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return WIMInfoResponse(
        wim_path=wim_path,
        images=[WIMImage(**img) for img in result.get("images", [])]
    )


@iso_router.post("/extract-kernel")
async def extract_linux_kernel(iso_mount: str, target_dir: str):
    """Extract vmlinuz and initrd from mounted Linux ISO"""
    if not os.path.isdir(iso_mount):
        raise HTTPException(status_code=400, detail=f"Mount point not found: {iso_mount}")
    
    result = run_iso_manager(["extract-kernel", iso_mount, target_dir])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return result


@iso_router.post("/auto-setup")
async def auto_setup_iso(iso_path: str):
    """
    Automatically mount ISO and detect/register images.
    For Windows: reads WIM, copies it, and creates DB entries for each edition.
    For Linux: extracts kernel and creates single DB entry.
    """
    from dependencies import db_pool
    
    if not os.path.isfile(iso_path):
        raise HTTPException(status_code=400, detail=f"ISO not found: {iso_path}")
    
    filename = os.path.basename(iso_path)
    os_type = detect_os_from_filename(filename)
    
    if os_type == 'drivers':
        # Just mount virtio drivers
        mount_result = run_iso_manager(["mount", iso_path, "/mnt/virtio"])
        return {"status": "mounted", "type": "drivers", "mount": "/mnt/virtio"}
    
    if os_type and os_type.startswith('windows'):
        # Mount and read WIM info
        mount_result = run_iso_manager(["mount", iso_path, "/mnt/winiso"])
        if "error" in mount_result:
            raise HTTPException(status_code=500, detail=mount_result["error"])
        
        wim_path = "/mnt/winiso/sources/install.wim"
        if not os.path.exists(wim_path):
            return {"status": "error", "message": "install.wim not found in ISO"}
        
        # Get WIM info for editions
        wim_info = run_iso_manager(["wim-info", wim_path])
        editions = wim_info.get("images", [])
        
        # Detect Windows version from filename
        version_match = re.search(r'windows[_\s]*server[_\s]*(\d{4})', filename.lower())
        win_version = version_match.group(1) if version_match else "2025"
        
        # Copy WIM to provisioning folder (this can take a while for 7GB files)
        target_dir = f"/home/benedikt/.openclaw/workspace/octofleet-work/provisioning/images/win{win_version}"
        target_wim = f"{target_dir}/install.wim"
        os.makedirs(target_dir, exist_ok=True)
        
        # Check if WIM already exists
        wim_copied = os.path.exists(target_wim)
        if not wim_copied:
            # Copy in background - this is a big file
            import shutil
            try:
                shutil.copy2(wim_path, target_wim)
                wim_copied = True
            except Exception as e:
                return {"status": "error", "message": f"Failed to copy WIM: {e}"}
        
        # Register all editions in DB
        registered = []
        async with db_pool.acquire() as conn:
            for edition in editions:
                idx = edition.get("index", 1)
                name = edition.get("name", f"Windows Server {win_version}")
                
                # Generate slug from name
                slug = name.lower().replace(" ", "-").replace("(", "").replace(")", "")
                slug = f"win{win_version}-{slug}"
                
                # Determine edition type
                if "datacenter" in name.lower():
                    ed_type = "datacenter"
                elif "standard" in name.lower():
                    ed_type = "standard"
                else:
                    ed_type = "unknown"
                
                # Check if desktop experience
                if "desktop" in name.lower() or "experience" in name.lower():
                    ed_type += "-desktop"
                else:
                    ed_type += "-core"
                
                # Check if already exists
                existing = await conn.fetchrow(
                    "SELECT id FROM provisioning_images WHERE name = $1", slug
                )
                if existing:
                    registered.append({"name": slug, "status": "exists"})
                    continue
                
                # Insert new image
                await conn.execute("""
                    INSERT INTO provisioning_images 
                    (name, display_name, wim_path, wim_index, os_type, os_version, edition, architecture, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """, slug, name, f"/images/win{win_version}/install.wim", idx,
                    "windows-server", win_version, ed_type, "amd64", True)
                
                registered.append({"name": slug, "index": idx, "status": "created"})
        
        return {
            "status": "complete",
            "type": "windows",
            "mount": "/mnt/winiso",
            "wim_path": target_wim,
            "wim_copied": wim_copied,
            "editions": editions,
            "registered": registered
        }
    
    elif os_type and os_type.startswith('linux'):
        # Mount and extract kernel
        version = re.search(r'(\d+\.\d+)', filename)
        ver = version.group(1) if version else "latest"
        mount_target = f"/mnt/ubuntu-{ver}"
        
        mount_result = run_iso_manager(["mount", iso_path, mount_target])
        if "error" in mount_result:
            raise HTTPException(status_code=500, detail=mount_result["error"])
        
        # Extract kernel
        target_dir = f"/home/benedikt/.openclaw/workspace/octofleet-work/provisioning/images/ubuntu/{ver}"
        extract_result = run_iso_manager(["extract-kernel", mount_target, target_dir])
        
        if extract_result.get("status") == "extracted":
            # Register in DB
            slug = f"ubuntu-{ver}-server"
            async with db_pool.acquire() as conn:
                existing = await conn.fetchrow(
                    "SELECT id FROM provisioning_images WHERE name = $1", slug
                )
                if not existing:
                    await conn.execute("""
                        INSERT INTO provisioning_images 
                        (name, display_name, wim_path, wim_index, os_type, os_version, edition, architecture, is_active)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """, slug, f"Ubuntu {ver} LTS Server", f"/images/ubuntu/{ver}/vmlinuz", 1,
                        "linux", ver, "server", "amd64", True)
                    extract_result["db_registered"] = True
                else:
                    extract_result["db_registered"] = "exists"
        
        return {
            "status": "complete",
            "type": "linux",
            "mount": mount_target,
            "kernel_dir": target_dir,
            "extract": extract_result
        }
    
    return {"status": "unknown", "message": f"Could not detect OS type for {filename}"}


# ============================================
# NFS Share Management
# ============================================

class NFSMountRequest(BaseModel):
    server_path: str = Field(..., description="NFS server:path (e.g., 192.168.0.24:/mnt/user/isos)")
    mount_target: str = Field(..., description="Local mount point (e.g., /mnt/isos)")
    add_to_fstab: bool = Field(default=False, description="Add to /etc/fstab for persistence")

class NFSMount(BaseModel):
    server: str
    target: str
    type: str
    total: Optional[str] = None
    used: Optional[str] = None
    available: Optional[str] = None
    percent: Optional[str] = None


@iso_router.get("/nfs/list")
async def list_nfs_mounts():
    """List current NFS mounts with disk usage"""
    result = run_iso_manager(["nfs-list"])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return result


@iso_router.post("/nfs/mount")
async def mount_nfs_share(request: NFSMountRequest):
    """Mount an NFS share"""
    # Mount the share
    result = run_iso_manager(["nfs-mount", request.server_path, request.mount_target])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    # Optionally add to fstab
    if request.add_to_fstab and result.get("status") == "mounted":
        fstab_result = run_iso_manager(["nfs-add-fstab", request.server_path, request.mount_target])
        result["fstab"] = fstab_result
    
    return result


@iso_router.post("/nfs/unmount")
async def unmount_nfs_share(target: str, remove_from_fstab: bool = False):
    """Unmount an NFS share"""
    result = run_iso_manager(["nfs-unmount", target])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    # Optionally remove from fstab
    if remove_from_fstab:
        # Find server path from mount output first (if still mounted)
        # For now, user must specify server_path separately
        pass
    
    return result


@iso_router.post("/nfs/fstab/add")
async def add_nfs_to_fstab(server_path: str, mount_target: str):
    """Add NFS mount to /etc/fstab for boot persistence"""
    result = run_iso_manager(["nfs-add-fstab", server_path, mount_target])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return result


@iso_router.delete("/nfs/fstab/remove")
async def remove_nfs_from_fstab(server_path: str):
    """Remove NFS mount from /etc/fstab"""
    result = run_iso_manager(["nfs-remove-fstab", server_path])
    
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    
    return result
