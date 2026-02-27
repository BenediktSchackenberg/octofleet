from fastapi import APIRouter, Depends, HTTPException
import asyncpg
from typing import Optional, List, Dict, Any
import json
import uuid
from pydantic import BaseModel, Field
from dependencies import get_db, verify_api_key, not_found

router = APIRouter(
    prefix="/api/v1",
    tags=["jobs"],
    dependencies=[Depends(verify_api_key)]
)

@router.post("/jobs")
async def create_job(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new job targeting devices, groups, or tags"""
    async with db.acquire() as conn:
        job_uuid = uuid.uuid4()
        job_id = str(job_uuid)
        
        target_type = data.get("targetType", "device")
        command_type = data.get("commandType", "run")
        command_data = data.get("commandData", {})
        name = data.get("name", f"Job {job_id[:8]}")
        description = data.get("description", "")
        target_id_input = data.get("targetId") or data.get("targetDeviceId") or data.get("targetGroupId")
        target_tag = data.get("targetTag")
        priority = data.get("priority", 5)
        scheduled_at = data.get("scheduledAt")
        expires_at = data.get("expiresAt")
        created_by = data.get("createdBy", "api")
        timeout_seconds = data.get("timeoutSeconds", 300)
        
        target_id = None
        target_node_id = None
        if target_type == "device" and target_id_input:
            node = await conn.fetchrow("SELECT id, node_id FROM nodes WHERE node_id = $1 OR id::text = $1", target_id_input)
            if node:
                target_id = str(node["id"])
                target_node_id = node["node_id"]
            else:
                try:
                    uuid.UUID(target_id_input)
                    target_id = target_id_input
                    node = await conn.fetchrow("SELECT node_id FROM nodes WHERE id = $1::uuid", target_id_input)
                    if node: target_node_id = node["node_id"]
                except ValueError: raise HTTPException(status_code=404, detail=f"Node not found: {target_id_input}")
        elif target_id_input: target_id = target_id_input
        
        row = await conn.fetchrow("""
            INSERT INTO jobs (id, name, description, target_type, target_id, target_tag, command_type, command_data, priority, scheduled_at, expires_at, created_by, timeout_seconds)
            VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
            RETURNING id, created_at
        """, str(job_uuid), name, description, target_type, target_id, target_tag, command_type, json.dumps(command_data), priority, scheduled_at, expires_at, created_by, timeout_seconds)
        
        instances_created = 0
        if target_type == "device" and target_node_id:
            await conn.execute("INSERT INTO job_instances (job_id, node_id, status) VALUES ($1::uuid, $2, 'pending')", str(job_uuid), target_node_id)
            instances_created = 1
        elif target_type == "group" and target_id:
            nodes = await conn.fetch("SELECT n.node_id FROM device_groups dg JOIN nodes n ON n.id = dg.node_id WHERE dg.group_id = $1::uuid", target_id)
            for node in nodes:
                await conn.execute("INSERT INTO job_instances (job_id, node_id, status) VALUES ($1::uuid, $2, 'pending')", str(job_uuid), node["node_id"])
                instances_created += 1
        elif target_type == "tag" and target_tag:
            nodes = await conn.fetch("SELECT n.node_id FROM device_tags dt JOIN nodes n ON n.id = dt.node_id JOIN tags t ON t.id = dt.tag_id WHERE t.name = $1", target_tag)
            for node in nodes:
                await conn.execute("INSERT INTO job_instances (job_id, node_id, status) VALUES ($1::uuid, $2, 'pending')", str(job_uuid), node["node_id"])
                instances_created += 1
        elif target_type == "all":
            nodes = await conn.fetch("SELECT n.node_id FROM nodes n INNER JOIN system_current sc ON sc.node_id = n.id")
            for node in nodes:
                await conn.execute("INSERT INTO job_instances (job_id, node_id, status) VALUES ($1::uuid, $2, 'pending')", str(job_uuid), node["node_id"])
                instances_created += 1
        
        return {"id": job_id, "name": name, "targetType": target_type, "commandType": command_type, "instancesCreated": instances_created, "createdAt": row["created_at"].isoformat() if row["created_at"] else None}

CHOCO_PACKAGES = {
    "notepad++": "notepadplusplus", "notepadplusplus": "notepadplusplus", "7zip": "7zip", "7-zip": "7zip", "vlc": "vlc", "git": "git",
    "vscode": "vscode", "vs-code": "vscode", "python": "python", "nodejs": "nodejs-lts", "node": "nodejs-lts", "chrome": "googlechrome",
    "firefox": "firefox", "putty": "putty", "winscp": "winscp", "filezilla": "filezilla", "sysinternals": "sysinternals", "powershell": "powershell-core", "pwsh": "powershell-core"
}

class SmartInstallRequest(BaseModel):
    package: str = Field(..., description="Package name (e.g., 'notepad++', '7zip', 'git')")
    targets: List[str] = Field(..., description="List of node IDs or hostnames")
    timeout_seconds: int = Field(600, description="Timeout for installation")

@router.post("/smart-install")
async def smart_install(request: SmartInstallRequest, db: asyncpg.Pool = Depends(get_db)):
    """Smart software installation with automatic Chocolatey bootstrap"""
    package_name = request.package.lower().strip()
    choco_package = CHOCO_PACKAGES.get(package_name, package_name)
    smart_cmd = (f'$c="C:\ProgramData\chocolatey\bin\choco.exe";if(!(Test-Path $c)){{Set-ExecutionPolicy Bypass -Scope Process -Force;[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor 3072;iex((New-Object Net.WebClient).DownloadString("https://community.chocolatey.org/install.ps1"))}};& $c install {choco_package} -y --no-progress')
    
    results = []
    async with db.acquire() as conn:
        for target in request.targets:
            node = await conn.fetchrow("SELECT id, node_id, hostname FROM nodes WHERE node_id = $1 OR hostname = $1", target)
            if not node:
                results.append({"target": target, "status": "error", "error": f"Node not found: {target}"})
                continue
            
            job_uuid = uuid.uuid4()
            await conn.execute("INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data, timeout_seconds, created_by) VALUES ($1::uuid, $2, $3, 'device', $4::uuid, 'run', $5::jsonb, $6, $7)", str(job_uuid), f"Smart-Install {request.package}", f"Auto-install {choco_package} via Chocolatey", str(node["id"]), json.dumps({"command": smart_cmd}), request.timeout_seconds, "api")
            await conn.execute("INSERT INTO job_instances (job_id, node_id, status) VALUES ($1::uuid, $2, 'pending')", str(job_uuid), node["node_id"])
            results.append({"target": target, "hostname": node["hostname"], "status": "created", "jobId": str(job_uuid), "package": choco_package})
    
    return {"package": request.package, "chocoPackage": choco_package, "results": results, "totalTargets": len(request.targets), "jobsCreated": sum(1 for r in results if r["status"] == "created")}

@router.get("/smart-install/packages")
async def list_smart_install_packages():
    """List available package aliases for smart-install"""
    return {"packages": [{"alias": k, "chocoName": v, "description": f"Installs {v} via Chocolatey"} for k, v in sorted(CHOCO_PACKAGES.items())]}
