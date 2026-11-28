import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import agent_wait
import alert_notify
import job_failures
import job_results
from auth import CurrentUser, require_permission, require_user_permission
from dependencies import get_db, not_found, verify_api_key
from json_columns import decode_json

logger = logging.getLogger(__name__)

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


@router.get("/jobs", dependencies=[Depends(require_user_permission("jobs:read"))])
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
            "target_name": r["target_name"] or (str(r["target_id"])[:8] if r["target_id"] else "-"),
        } for r in rows], "total": total, "counts": dict(count_row), "command_types": command_types}


@router.get("/jobs/failures", dependencies=[Depends(require_user_permission("jobs:read"))])
async def list_job_failures(since_hours: int = Query(168, ge=1, le=job_failures.MAX_WINDOW_HOURS),
                            include_resolved: bool = False,
                            limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0),
                            db: asyncpg.Pool = Depends(get_db)):
    """Failed job runs of the last `since_hours`, one entry per node and job type (and job name for
    commands, scripts and packages), newest failure first.

    Each entry counts the failures, names the last failed job and why it failed, and is
    `resolved` when a later run of the same kind succeeded on that node. Resolved entries are left
    out unless `include_resolved`. `total` (open) and `resolved` count all entries, not only the page.
    """
    async with db.acquire() as conn:
        return await job_failures.list_failures(conn, since_hours, include_resolved, limit, offset)


@router.get("/jobs/{job_id}", dependencies=[Depends(require_user_permission("jobs:read"))])
async def get_job(job_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        job = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
        if not job: raise not_found("Job", job_id)
        instances = await conn.fetch("SELECT * FROM job_instances WHERE job_id = $1 ORDER BY queued_at", job_id)
        res = dict(job)
        # the object itself, not JSON text inside the JSON response
        res["command_data"] = decode_json(res.get("command_data"))
        res["instances"] = [dict(i) for i in instances]
        return res

JOB_TARGET_TYPES = ("device", "group", "tag", "all")


def job_time(data: Dict[str, Any], key: str) -> Optional[datetime]:
    """An optional ISO 8601 time from the request (UTC when it has no offset); 400 when invalid."""
    value = data.get(key)
    if value in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{key}: an ISO 8601 date and time")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def job_int(data: Dict[str, Any], key: str, default: int, minimum: int) -> int:
    """An optional whole number from the request; 400 when it is not one or below MINIMUM."""
    value = data.get(key)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise HTTPException(status_code=400, detail=f"{key}: a whole number of at least {minimum}")
    return value


@router.post("/jobs")
async def create_job(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db),
                     _user: CurrentUser = Depends(require_user_permission("jobs:create"))):
    """Create a job and its instances.

    `targetType`: device (`targetId`: node UUID), group (`targetId`: group UUID), tag (`targetTag`:
    tag name) or all. Optional: `priority` (lower runs first, default 5), `scheduledAt` (not before),
    `expiresAt` (not after; ISO 8601) and `timeoutSeconds` (default 300).
    """
    target_id = data.get("targetId")
    target_type = data.get("targetType", "device")
    target_tag = data.get("targetTag")
    if target_type not in JOB_TARGET_TYPES:
        raise HTTPException(status_code=400, detail=f"targetType: one of {', '.join(JOB_TARGET_TYPES)}")
    if target_type == "tag" and not target_tag:
        raise HTTPException(status_code=400, detail="targetTag required for targetType=tag")
    priority = job_int(data, "priority", 5, 0)
    timeout_seconds = job_int(data, "timeoutSeconds", 300, 1)
    scheduled_at, expires_at = job_time(data, "scheduledAt"), job_time(data, "expiresAt")
    async with db.acquire() as conn:
        job_uuid = uuid.uuid4()
        await conn.execute("""
            INSERT INTO jobs (id, name, description, target_type, target_id, target_tag, command_type, command_data,
                              priority, scheduled_at, expires_at, timeout_seconds, created_by)
            VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
        """, job_uuid, data.get("name"), data.get("description"), target_type, target_id,
            target_tag if target_type == "tag" else None, data.get("commandType"), json.dumps(data.get("commandData")),
            priority, scheduled_at, expires_at, timeout_seconds, "api")

        # Create job_instances for target nodes
        node_ids = []
        if target_type == "device" and target_id:
            node_ids = [target_id]
        elif target_type == "group" and target_id:
            # the members the groups API manages (device_groups); the legacy group_members table is
            # written by nothing - a job for a group reached no node
            # with the members of its sub-groups (app/db/group_tree.py)
            rows = await conn.fetch("SELECT node_id FROM group_node_ids($1::uuid)", target_id)
            node_ids = [str(r["node_id"]) for r in rows]
        elif target_type == "tag":
            rows = await conn.fetch("""
                SELECT DISTINCT dt.node_id FROM device_tags dt JOIN tags t ON t.id = dt.tag_id WHERE t.name = $1
            """, target_tag)
            node_ids = [str(r["node_id"]) for r in rows]
        elif target_type == "all":
            rows = await conn.fetch("SELECT id FROM nodes")
            node_ids = [str(r["id"]) for r in rows]

        for nid in node_ids:
            await conn.execute("""
                INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
                VALUES (gen_random_uuid(), $1, $2::uuid, 'pending', NOW())
            """, job_uuid, nid)
        agent_wait.notify(node_ids, "jobs")

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

# Agent endpoint in main.py (needs jobs:poll)
# @agent_router.get("/jobs/pending/{node_id}") is in main.py

@agent_router.post("/jobs/instances/{instance_id}/result", dependencies=[Depends(require_permission("jobs:poll"))])
async def submit_job_result(instance_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Agent endpoint: the result of a job instance.

    Stores status, exit code, output (cut to 50,000 characters each), `errorMessage` and the
    duration (`durationMs`, else the time since the instance started), logs it in job_logs, sends
    the job_failed alert on failure and processes VM creation and patch deployment results
    (job_results.py). A failed instance is not retried automatically. 404 for an unknown instance.
    """
    try:
        uuid.UUID(instance_id)
    except ValueError:
        raise not_found("Job instance", instance_id)
    success = job_result_succeeded(data)
    status = "success" if success else "failed"
    exit_code = data.get("exitCode")
    stdout = (data.get("stdout") or "")[:job_results.MAX_OUTPUT] or None
    stderr = (data.get("stderr") or "")[:job_results.MAX_OUTPUT] or None
    error_message = data.get("errorMessage") or None
    duration_ms = data.get("durationMs") if isinstance(data.get("durationMs"), int) else None

    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE job_instances
            SET status = $1, completed_at = NOW(), updated_at = NOW(), exit_code = $2, stdout = $3, stderr = $4,
                error_message = $5,
                duration_ms = COALESCE($6::int, (EXTRACT(EPOCH FROM NOW() - started_at) * 1000)::int)
            WHERE id = $7::uuid
            RETURNING job_id, node_id
        """, status, exit_code, stdout, stderr, error_message, duration_ms, instance_id)
        if not row:
            logger.warning("Result for unknown job instance %s", instance_id)
            raise not_found("Job instance", instance_id)
        (logger.info if success else logger.warning)(
            "Job instance %s on node %s: %s, exit code %s%s", instance_id, row["node_id"], status, exit_code,
            f", {duration_ms} ms" if duration_ms is not None else "")
        await conn.execute("INSERT INTO job_logs (instance_id, level, message) VALUES ($1::uuid, $2, $3)",
                           instance_id, "info" if success else "error", f"Job completed: exit_code={exit_code}")
        job = await conn.fetchrow("SELECT name, command_type, command_data FROM jobs WHERE id = $1", row["job_id"])
        try:
            if success and job and (job["name"] or "").startswith("Create VM:"):
                await job_results.apply_vm_creation(conn, row["job_id"], stdout)
            if job and job["command_type"] == "patch_install":
                await job_results.apply_patch_install(conn, job["command_data"], row["node_id"], success, stdout)
        except Exception:  # the result itself is stored; the agent does not send it again
            logger.exception("Processing the result of job instance %s failed", instance_id)
        if not success and job:
            hostname = await conn.fetchval(
                "SELECT hostname FROM nodes WHERE id::text = $1 OR node_id = $1 LIMIT 1", row["node_id"])
            _alert_job_failed(db, job["name"], hostname or row["node_id"], exit_code,
                              error_message or (stderr or "")[:500] or "Unknown error")

    return {"status": status, "instanceId": instance_id}


# Alerts run in the background: a slow webhook must not hold up the agent's request
_alert_tasks: set = set()


def _alert_job_failed(db, job_name, hostname, exit_code, error) -> None:
    async def send():
        try:
            await alert_notify.trigger_alert(db, "job_failed", {
                "message": f"Job '{job_name}' failed on {hostname}",
                "job_name": job_name, "hostname": hostname, "exit_code": exit_code, "error": error,
            })
        except Exception:
            logger.exception("job_failed alert")
    task = asyncio.create_task(send())
    _alert_tasks.add(task)
    task.add_done_callback(_alert_tasks.discard)


# GET /api/v1/packages (with version count, latest version, filters) is in routers/packages_mgmt.py.

# Chocolatey package names: letters, digits and . _ + - (the name goes into a PowerShell command)
CHOCO_PACKAGE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$")


def smart_install_command(choco_package: str) -> str:
    """PowerShell: install Chocolatey if it is missing, then the package."""
    return (
        '$c="C:\\ProgramData\\chocolatey\\bin\\choco.exe";'
        'if(!(Test-Path $c))'
        '{Set-ExecutionPolicy Bypass -Scope Process -Force;'
        '[Net.ServicePointManager]::SecurityProtocol='
        '[Net.ServicePointManager]::SecurityProtocol -bor 3072;'
        "iex((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))}"
        f';& $c install {choco_package} -y --no-progress'
    )


@router.post("/smart-install")
async def smart_install(request: SmartInstallRequest, db: asyncpg.Pool = Depends(get_db),
                        user: CurrentUser = Depends(require_user_permission("jobs:create"))):
    """Install a package on Windows nodes with Chocolatey, installing Chocolatey first where it is missing.

    `package` is an alias from GET /smart-install/packages or a Chocolatey package name; `targets`
    are node IDs, UUIDs or hostnames. One job per node found; unknown nodes are listed in `results`.
    """
    choco_package = CHOCO_PACKAGES.get(request.package.lower().strip(), request.package.strip())
    if not CHOCO_PACKAGE_NAME.match(choco_package):
        raise HTTPException(status_code=400, detail="package: letters, digits and . _ + - only")
    command = smart_install_command(choco_package)
    results = []
    async with db.acquire() as conn:
        for target in request.targets:
            node = await conn.fetchrow("""
                SELECT id, node_id, hostname FROM nodes
                WHERE node_id = $1 OR id::text = $1 OR UPPER(hostname) = UPPER($1) LIMIT 1
            """, target)
            if not node:
                results.append({"target": target, "status": "error", "error": f"Node not found: {target}"})
                continue
            job_id = uuid.uuid4()
            await conn.execute("""
                INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data,
                                  timeout_seconds, created_by)
                VALUES ($1, $2, $3, 'device', $4, 'run', $5::jsonb, $6, $7)
            """, job_id, f"Smart-Install {request.package}",
                f"Auto-install {choco_package} via Chocolatey (with bootstrap)", node["id"],
                json.dumps({"command": command}), request.timeout_seconds, user.username)
            # job_instances.node_id: the node's UUID, as POST /jobs
            await conn.execute("INSERT INTO job_instances (job_id, node_id, status) VALUES ($1, $2, 'pending')",
                               job_id, str(node["id"]))
            agent_wait.notify([str(node["id"]), node["node_id"]], "jobs")
            results.append({"target": target, "hostname": node["hostname"], "status": "created",
                            "jobId": str(job_id), "package": choco_package})
    return {
        "package": request.package,
        "chocoPackage": choco_package,
        "results": results,
        "totalTargets": len(request.targets),
        "jobsCreated": sum(1 for r in results if r["status"] == "created"),
    }
