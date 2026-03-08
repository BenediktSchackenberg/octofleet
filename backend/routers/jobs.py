import json
import uuid
from typing import Any, Dict, List

import asyncpg
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from dependencies import get_db, not_found, verify_api_key

router = APIRouter(
    prefix="/api/v1",
    tags=["jobs"],
    dependencies=[Depends(verify_api_key)]
)

# Separate router for agent endpoints (no auth required - agents may have outdated keys)
agent_router = APIRouter(prefix="/api/v1", tags=["jobs-agent"])

CHOCO_PACKAGES = {
    "notepad++": "notepadplusplus", "notepadplusplus": "notepadplusplus", "7zip": "7zip", "7-zip": "7zip", "vlc": "vlc", "git": "git",
    "vscode": "vscode", "vs-code": "vscode", "python": "python", "nodejs": "nodejs-lts", "node": "nodejs-lts", "chrome": "googlechrome",
    "firefox": "firefox", "putty": "putty", "winscp": "winscp", "filezilla": "filezilla", "sysinternals": "sysinternals", "powershell": "powershell-core", "pwsh": "powershell-core"
}

class SmartInstallRequest(BaseModel):
    package: str
    targets: List[str]
    timeout_seconds: int = 600

# --- Job Management ---

@router.get("/jobs")
async def list_jobs(limit: int = 50, offset: int = 0, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT js.job_id, js.name, js.command_type, js.target_type, js.target_id, js.created_at,
                   js.total_instances, js.pending, js.queued, js.running, js.success, js.failed, js.cancelled,
                   COALESCE(n.hostname, g.name) as target_name
            FROM job_summary js
            LEFT JOIN nodes n ON n.id::text = js.target_id::text
            LEFT JOIN groups g ON g.id::text = js.target_id::text
            ORDER BY js.created_at DESC LIMIT $1 OFFSET $2
        """, limit, offset)
        return {"jobs": [{
            **dict(r),
            "target_name": r["target_name"] or (str(r["target_id"])[:8] if r["target_id"] else "—"),
        } for r in rows]}

@router.get("/jobs/{job_id}")
async def get_job(job_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        job = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
        if not job: raise not_found("Job", job_id)
        instances = await conn.fetch("SELECT * FROM job_instances WHERE job_id = $1 ORDER BY queued_at", job_id)
        res = dict(job)
        res["instances"] = [dict(i) for i in instances]
        return res

@router.post("/jobs")
async def create_job(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        job_uuid = uuid.uuid4()
        target_id = data.get("targetId")
        target_type = data.get("targetType", "device")
        await conn.execute("""
            INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data, created_by)
            VALUES ($1, $2, $3, $4, $5::uuid, $6, $7::jsonb, $8)
        """, job_uuid, data.get("name"), data.get("description"), target_type, target_id, data.get("commandType"), json.dumps(data.get("commandData")), "api")

        # Create job_instances for target nodes
        node_ids = []
        if target_type == "device" and target_id:
            node_ids = [target_id]
        elif target_type == "group" and target_id:
            rows = await conn.fetch("SELECT node_id FROM group_members WHERE group_id = $1", target_id)
            node_ids = [str(r["node_id"]) for r in rows]
        elif target_type == "all":
            rows = await conn.fetch("SELECT id FROM nodes")
            node_ids = [str(r["id"]) for r in rows]

        for nid in node_ids:
            await conn.execute("""
                INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
                VALUES (gen_random_uuid(), $1, $2::uuid, 'pending', NOW())
            """, job_uuid, nid)

        return {"id": str(job_uuid), "status": "created", "instances": len(node_ids)}

@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        await conn.execute("UPDATE job_instances SET status = 'cancelled' WHERE job_id = $1 AND status IN ('pending', 'queued')", job_id)
        return {"status": "cancelled"}

# --- Agent Endpoints ---

# Agent endpoint moved to main.py (no auth required)
# @agent_router.get("/jobs/pending/{node_id}") is in main.py

@agent_router.post("/jobs/instances/{instance_id}/result")
async def submit_job_result(instance_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        success = data.get("success", False)
        status = "success" if success else "failed"
        await conn.execute("""
            UPDATE job_instances SET status = $1, completed_at = NOW(), exit_code = $2, stdout = $3, stderr = $4
            WHERE id = $5
        """, status, data.get("exitCode"), data.get("stdout"), data.get("stderr"), instance_id)
        return {"status": status}

# --- Packages ---

@router.get("/packages")
async def list_packages(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM packages WHERE is_active = true ORDER BY display_name")
        return {"packages": [dict(r) for r in rows]}

@router.post("/smart-install")
async def smart_install(request: SmartInstallRequest, db: asyncpg.Pool = Depends(get_db)):
    # Existing smart install logic...
    return {"status": "ok"}
