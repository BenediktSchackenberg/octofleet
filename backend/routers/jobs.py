import json
import uuid
from typing import Any, Dict, List, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import CurrentUser, require_permission, require_user_permission
from dependencies import get_db, not_found, verify_api_key

router = APIRouter(
    prefix="/api/v1",
    tags=["jobs"],
    dependencies=[Depends(verify_api_key)]
)

# Separate router for agent endpoints; each endpoint declares its permission.
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

def job_result_succeeded(data: Dict[str, Any]) -> bool:
    """Whether an agent reported success: the Windows agent sends `success`,
    the Linux agent `status` ("success"/"failed")."""
    if "success" in data:
        return bool(data["success"])
    return data.get("status") == "success"

# --- Job Management ---

# Job states for the status filter, as conditions on job_summary (instance counts per job)
JOB_STATUS_CONDITIONS = {
    "failed": "js.failed > 0",
    "running": "(js.running + js.queued) > 0",
    "pending": "js.pending > 0",
    "success": "js.total_instances > 0 AND js.success = js.total_instances",
    "cancelled": "js.cancelled > 0",
}

# The time of a job's last failure (status=failed with since_hours counts failures, not creation)
FAILED_SINCE = ("js.job_id IN (SELECT job_id FROM job_instances WHERE status = 'failed' "
                "AND COALESCE(completed_at, updated_at) >= NOW() - make_interval(hours => {p}))")


@router.get("/jobs")
async def list_jobs(limit: int = 50, offset: int = 0, node: Optional[str] = None, target_id: Optional[str] = None,
                    status: Optional[str] = None, since_hours: Optional[int] = None,
                    command_type: Optional[str] = None, q: Optional[str] = None,
                    db: asyncpg.Pool = Depends(get_db)):
    """Jobs, newest first, with `total` (all matching jobs, not only the page).

    - `node` (node ID, UUID or hostname; `target_id` is accepted as an alias): only the jobs that run
      on that node - targeted at it, at one of its groups or at all nodes (an instance exists for it).
    - `status`: failed (a failed instance; newest failure first, with `last_failed_at` and
      `last_error`), running (running or queued instances), pending, success (all instances
      succeeded), cancelled.
    - `since_hours`: created within that many hours; with status=failed: failed within them.
    - `command_type`, `q` (part of the name).
    - `counts`: the jobs per state for the same filters except `status` - total and success by
      creation time, failed by failure time (the sidebar badge and the Tasks page count the same
      way), running regardless of the time.
    - `command_types`: all job types, for a filter list.
    """
    node = node or target_id
    if status not in (None, "") and status not in JOB_STATUS_CONDITIONS:
        raise HTTPException(status_code=400, detail=f"status: one of {', '.join(JOB_STATUS_CONDITIONS)}")
    failed_only = status == "failed"
    hours = since_hours if since_hours and since_hours > 0 else None
    async with db.acquire() as conn:
        # Filters other than status and time (they apply to the list and the counts)
        base, params = [], []
        if node:
            row = await conn.fetchrow(
                "SELECT id, node_id FROM nodes WHERE node_id = $1 OR id::text = $1 OR UPPER(hostname) = UPPER($1) LIMIT 1", node)
            if row is None:
                return {"jobs": [], "total": 0, "counts": {"total": 0, "running": 0, "success": 0, "failed": 0}, "command_types": []}
            # job_instances.node_id is text: the node's UUID (older rows may hold its node_id)
            params += [str(row["id"]), row["node_id"]]
            base.append(f"js.job_id IN (SELECT job_id FROM job_instances WHERE node_id IN (${len(params) - 1}, ${len(params)}))")
        if command_type:
            params.append(command_type)
            base.append(f"js.command_type = ${len(params)}")
        if q:
            params.append(f"%{q}%")
            base.append(f"js.name ILIKE ${len(params)}")
        hours_param = None
        if hours:
            params.append(hours)
            hours_param = f"${len(params)}"
        created_in_window = f"js.created_at >= NOW() - make_interval(hours => {hours_param})" if hours_param else "true"
        failed_in_window = FAILED_SINCE.format(p=hours_param) if hours_param else JOB_STATUS_CONDITIONS["failed"]

        conditions = list(base)
        if failed_only:
            conditions.append(failed_in_window)
        else:
            if status:
                conditions.append(JOB_STATUS_CONDITIONS[status])
            if hours_param and status != "running":
                conditions.append(created_in_window)
        where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
        total = await conn.fetchval(f"SELECT COUNT(*) FROM job_summary js{where}", *params)

        base_where = " AND ".join(base) if base else "true"
        count_row = await conn.fetchrow(f"""
            SELECT COUNT(*) FILTER (WHERE {created_in_window}) AS total,
                   COUNT(*) FILTER (WHERE {JOB_STATUS_CONDITIONS["running"]}) AS running,
                   COUNT(*) FILTER (WHERE {JOB_STATUS_CONDITIONS["success"]} AND {created_in_window}) AS success,
                   COUNT(*) FILTER (WHERE {failed_in_window}) AS failed
            FROM job_summary js WHERE {base_where}
        """, *params)
        command_types = [r["command_type"] for r in await conn.fetch(
            "SELECT DISTINCT command_type FROM jobs WHERE command_type IS NOT NULL ORDER BY command_type")]

        # The last failure of each job (its time and error) for status=failed
        last_failure = """,
                   lf.last_failed_at, lf.last_error""" if failed_only else ""
        failure_join = """
            LEFT JOIN LATERAL (
                SELECT COALESCE(ji.completed_at, ji.updated_at) AS last_failed_at,
                       LEFT(COALESCE(NULLIF(ji.error_message, ''), NULLIF(ji.stderr, ''), ji.stdout), 300) AS last_error
                FROM job_instances ji WHERE ji.job_id = js.job_id AND ji.status = 'failed'
                ORDER BY COALESCE(ji.completed_at, ji.updated_at) DESC NULLS LAST LIMIT 1
            ) lf ON true""" if failed_only else ""
        order = "lf.last_failed_at DESC NULLS LAST" if failed_only else "js.created_at DESC"
        rows = await conn.fetch(f"""
            SELECT js.job_id, js.name, js.command_type, js.target_type, js.target_id, js.created_at,
                   js.total_instances, js.pending, js.queued, js.running, js.success, js.failed, js.cancelled,
                   COALESCE(n.hostname, g.name) as target_name{last_failure}
            FROM job_summary js
            LEFT JOIN nodes n ON n.id::text = js.target_id::text
            LEFT JOIN groups g ON g.id::text = js.target_id::text{failure_join}
            {where}
            ORDER BY {order} LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
        """, *params, limit, offset)
        return {"jobs": [{
            **dict(r),
            "target_name": r["target_name"] or (str(r["target_id"])[:8] if r["target_id"] else "—"),
        } for r in rows], "total": total, "counts": dict(count_row), "command_types": command_types}


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
async def create_job(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db),
                     _user: CurrentUser = Depends(require_user_permission("jobs:create"))):
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
async def cancel_or_delete_job(job_id: str, db: asyncpg.Pool = Depends(get_db),
                               _user: CurrentUser = Depends(require_user_permission("jobs:cancel"))):
    """Cancel a job that still has open instances; delete a finished job with its instances.

    jobs has no status column - a job's state comes from its instances. Pending and queued
    instances are cancelled; running ones cannot be stopped from here and keep the job.
    """
    async with db.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM jobs WHERE id::text = $1", job_id):
                raise HTTPException(status_code=404, detail="Job not found")
            cancelled = await conn.fetch("""
                UPDATE job_instances SET status = 'cancelled', updated_at = NOW()
                WHERE job_id::text = $1 AND status IN ('pending', 'queued')
                RETURNING id
            """, job_id)
            running = await conn.fetchval(
                "SELECT COUNT(*) FROM job_instances WHERE job_id::text = $1 AND status = 'running'", job_id)
            if cancelled or running:
                return {"status": "cancelled", "instancesCancelled": len(cancelled), "instancesRunning": running}
            await conn.execute("DELETE FROM job_instances WHERE job_id::text = $1", job_id)
            await conn.execute("DELETE FROM jobs WHERE id::text = $1", job_id)
            return {"status": "deleted"}

# --- Agent Endpoints ---

# Agent endpoint moved to main.py (no auth required)
# @agent_router.get("/jobs/pending/{node_id}") is in main.py

@agent_router.post("/jobs/instances/{instance_id}/result", dependencies=[Depends(require_permission("jobs:poll"))])
async def submit_job_result(instance_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        success = job_result_succeeded(data)
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
async def smart_install(request: SmartInstallRequest, db: asyncpg.Pool = Depends(get_db),
                        _user: CurrentUser = Depends(require_user_permission("jobs:create"))):
    # Existing smart install logic...
    return {"status": "ok"}
