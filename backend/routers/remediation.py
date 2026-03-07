"""
Octofleet API - Remediation Routes
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Request
from dependencies import API_KEY, db_pool, get_db, verify_api_key
from remediation import (
    RemediationPackageCreate, RemediationPackageUpdate,
    RemediationRuleCreate, RemediationRuleUpdate,
    TriggerRemediationRequest, ApproveRemediationRequest,
    RemediationEngine,
)
import asyncpg
from typing import Optional, Dict, List, Any
from starlette.responses import StreamingResponse
import uuid
import json
import asyncio
import io
import time

router = APIRouter(tags=["Remediation"])


@router.get("/api/v1/remediation/packages")
async def list_remediation_packages(
    enabled_only: bool = False,
    _: str = Depends(verify_api_key)
):
    """List all remediation packages (fix mappings)."""
    packages = await get_remediation_packages(db_pool, enabled_only)
    return {"packages": packages}


@router.get("/api/v1/remediation/packages/{package_id}")
async def get_remediation_package_by_id(
    package_id: int,
    _: str = Depends(verify_api_key)
):
    """Get a specific remediation package."""
    pkg = await get_remediation_package(db_pool, package_id)
    if not pkg:
        raise HTTPException(status_code=404, detail="Remediation package not found")
    return pkg


@router.post("/api/v1/remediation/packages", status_code=201)
async def create_remediation_package_endpoint(
    data: RemediationPackageCreate,
    _: str = Depends(verify_api_key)
):
    """Create a new remediation package (CVE → Fix mapping)."""
    try:
        pkg = await create_remediation_package(db_pool, data)
        return pkg
    except Exception as e:
        if "duplicate key" in str(e):
            raise HTTPException(status_code=409, detail="Package with this name already exists")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/api/v1/remediation/packages/{package_id}")
async def update_remediation_package_endpoint(
    package_id: int,
    data: RemediationPackageUpdate,
    _: str = Depends(verify_api_key)
):
    """Update a remediation package."""
    pkg = await update_remediation_package(db_pool, package_id, data)
    if not pkg:
        raise HTTPException(status_code=404, detail="Remediation package not found")
    return pkg


@router.delete("/api/v1/remediation/packages/{package_id}")
async def delete_remediation_package_endpoint(
    package_id: int,
    _: str = Depends(verify_api_key)
):
    """Delete a remediation package."""
    deleted = await delete_remediation_package(db_pool, package_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Remediation package not found")
    return {"status": "deleted", "id": package_id}


@router.get("/api/v1/remediation/rules")
async def list_remediation_rules(
    enabled_only: bool = False,
    _: str = Depends(verify_api_key)
):
    """List all remediation rules."""
    rules = await get_remediation_rules(db_pool, enabled_only)
    return {"rules": rules}


@router.get("/api/v1/remediation/rules/{rule_id}")
async def get_remediation_rule_by_id(
    rule_id: int,
    _: str = Depends(verify_api_key)
):
    """Get a specific remediation rule."""
    rule = await get_remediation_rule(db_pool, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Remediation rule not found")
    return rule


@router.post("/api/v1/remediation/rules", status_code=201)
async def create_remediation_rule_endpoint(
    data: RemediationRuleCreate,
    _: str = Depends(verify_api_key)
):
    """Create a new remediation rule."""
    rule = await create_remediation_rule(db_pool, data)
    return rule


@router.patch("/api/v1/remediation/rules/{rule_id}")
async def update_remediation_rule_endpoint(
    rule_id: int,
    data: RemediationRuleUpdate,
    _: str = Depends(verify_api_key)
):
    """Update a remediation rule."""
    rule = await update_remediation_rule(db_pool, rule_id, data)
    if not rule:
        raise HTTPException(status_code=404, detail="Remediation rule not found")
    return rule


@router.delete("/api/v1/remediation/rules/{rule_id}")
async def delete_remediation_rule_endpoint(
    rule_id: int,
    _: str = Depends(verify_api_key)
):
    """Delete a remediation rule."""
    deleted = await delete_remediation_rule(db_pool, rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Remediation rule not found")
    return {"status": "deleted", "id": rule_id}


@router.get("/api/v1/remediation/maintenance-windows")
async def list_maintenance_windows(_: str = Depends(verify_api_key)):
    """List all maintenance windows."""
    windows = await get_maintenance_windows(db_pool)
    return {"windows": windows}


@router.post("/api/v1/remediation/maintenance-windows", status_code=201)
async def create_maintenance_window_endpoint(
    data: MaintenanceWindowCreate,
    _: str = Depends(verify_api_key)
):
    """Create a new maintenance window."""
    window = await create_maintenance_window(db_pool, data)
    return window


@router.get("/api/v1/remediation/maintenance-windows/active")
async def check_maintenance_window(_: str = Depends(verify_api_key)):
    """Check if we're currently in a maintenance window."""
    in_window = await is_in_maintenance_window(db_pool)
    return {"in_maintenance_window": in_window}


@router.get("/api/v1/remediation/jobs")
async def list_remediation_jobs(
    status: Optional[str] = None,
    node_id: Optional[UUID] = None,
    limit: int = 100,
    _: str = Depends(verify_api_key)
):
    """List remediation jobs with filters."""
    jobs = await get_remediation_jobs(db_pool, status, node_id, limit)
    return {"jobs": jobs}


@router.get("/api/v1/remediation/jobs/{job_id}")
async def get_remediation_job_by_id(
    job_id: int,
    _: str = Depends(verify_api_key)
):
    """Get a specific remediation job."""
    job = await get_remediation_job(db_pool, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Remediation job not found")
    return job


@router.post("/api/v1/remediation/jobs/approve")
async def approve_jobs(
    data: ApproveRemediationRequest,
    _: str = Depends(verify_api_key)
):
    """Approve pending remediation jobs."""
    count = await approve_remediation_jobs(db_pool, data.job_ids, data.approved_by)
    return {"approved_count": count}


@router.patch("/api/v1/remediation/jobs/{job_id}/status")
async def update_job_status(
    job_id: int,
    status: str,
    exit_code: Optional[int] = None,
    output_log: Optional[str] = None,
    error_message: Optional[str] = None,
    _: str = Depends(verify_api_key)
):
    """Update remediation job status (called by agent after execution)."""
    job = await update_remediation_job_status(
        db_pool, job_id, status, exit_code, output_log, error_message
    )
    if not job:
        raise HTTPException(status_code=404, detail="Remediation job not found")
    return job


@router.post("/api/v1/remediation/scan")
async def trigger_remediation_scan(
    data: TriggerRemediationRequest,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key)
):
    """
    Scan vulnerabilities and create remediation jobs.
    
    This will:
    1. Find all vulnerabilities matching the filter
    2. Match them to available fix packages
    3. Apply rules to determine action
    4. Create remediation jobs (or show dry-run results)
    """
    engine = RemediationEngine(db_pool)
    results = await engine.scan_and_create_jobs(
        severity_filter=data.severity_filter,
        software_filter=data.software_filter,
        node_ids=data.node_ids,
        dry_run=data.dry_run
    )
    return results


@router.post("/api/v1/remediation/fix/{vulnerability_id}")
async def one_click_fix(
    vulnerability_id: int,
    node_id: UUID,
    _: str = Depends(verify_api_key)
):
    """
    One-click fix for a specific vulnerability on a node.
    
    Creates a remediation job immediately (no approval required).
    """
    # Get the vulnerability
    async with db_pool.acquire() as conn:
        vuln = await conn.fetchrow(
            "SELECT * FROM vulnerabilities WHERE id = $1", vulnerability_id
        )
        if not vuln:
            raise HTTPException(status_code=404, detail="Vulnerability not found")
        vuln = dict(vuln)
    
    # Find fix package
    engine = RemediationEngine(db_pool)
    fix_pkg = await engine.find_fix_for_vulnerability(vuln)
    if not fix_pkg:
        raise HTTPException(
            status_code=404, 
            detail=f"No fix package available for {vuln['software_name']}"
        )
    
    # Create job without approval requirement
    from remediation import create_remediation_job
    job = await create_remediation_job(
        db_pool,
        vulnerability_id=vulnerability_id,
        remediation_package_id=fix_pkg['id'],
        rule_id=None,  # Manual trigger, no rule
        node_id=node_id,
        software_name=vuln['software_name'],
        software_version=vuln['software_version'],
        cve_id=vuln['cve_id'],
        requires_approval=False
    )
    
    # Generate the fix command
    command = await engine.generate_fix_command(job, fix_pkg)
    
    return {
        "job": job,
        "fix_package": fix_pkg,
        "command": command,
        "message": f"Remediation job created. Execute: {command}"
    }


@router.get("/api/v1/remediation/jobs/pending/{node_id}")
async def get_pending_remediation_jobs(node_id: str):
    """
    Agent endpoint: Get pending remediation jobs for a node.
    
    The agent polls this endpoint and executes the fix commands.
    """
    # Resolve node_id to UUID
    async with db_pool.acquire() as conn:
        # Support both formats: "win-baltasa" and "BALTASA"
        lookup_id = node_id
        if node_id.startswith("win-"):
            lookup_id = node_id[4:].upper()
        
        # Find node UUID
        node_row = await conn.fetchrow("""
            SELECT id FROM nodes WHERE UPPER(hostname) = UPPER($1) OR UPPER(node_id) = UPPER($1)
        """, lookup_id)
        
        if not node_row:
            return {"jobs": [], "count": 0}
        
        node_uuid = node_row['id']
        
        # Get pending/approved remediation jobs for this node
        jobs = await conn.fetch("""
            SELECT rj.*, rp.name as package_name, rp.fix_method, rp.fix_command
            FROM remediation_jobs rj
            LEFT JOIN remediation_packages rp ON rp.id = rj.remediation_package_id
            WHERE rj.node_id = $1 
              AND rj.status IN ('pending', 'approved')
            ORDER BY rj.created_at ASC
            LIMIT 5
        """, node_uuid)
        
        result = []
        for job in jobs:
            # Mark as running
            await conn.execute("""
                UPDATE remediation_jobs 
                SET status = 'running', started_at = NOW(), updated_at = NOW()
                WHERE id = $1
            """, job['id'])
            
            # Generate the command based on fix method
            fix_cmd = job['fix_command']
            if not fix_cmd:
                method = job['fix_method']
                software = job['software_name']
                if method == 'winget':
                    fix_cmd = f'winget upgrade --name "{software}" --silent --accept-source-agreements'
                elif method == 'choco':
                    fix_cmd = f'choco upgrade {software} -y'
                else:
                    fix_cmd = f'echo "No fix command for {software}"'
            
            result.append({
                "jobId": job['id'],
                "cveId": job['cve_id'],
                "softwareName": job['software_name'],
                "softwareVersion": job['software_version'],
                "fixMethod": job['fix_method'],
                "fixCommand": fix_cmd,
                "packageName": job['package_name']
            })
        
        return {"jobs": result, "count": len(result)}


@router.post("/api/v1/remediation/jobs/{job_id}/result")
async def submit_remediation_result(job_id: int, data: Dict[str, Any]):
    """
    Agent endpoint: Submit remediation job result.
    
    Called by agent after executing the fix command.
    """
    exit_code = data.get("exitCode", -1)
    output = data.get("output", "")
    error = data.get("error", "")
    
    success = exit_code == 0
    # winget returns exit code 1 when "no upgrade available" — treat as success
    if exit_code == 1 and output and ("keine" in output.lower() or "no applicable" in output.lower() or "no available upgrade" in output.lower() or "neueren paketversionen" in output.lower()):
        success = True
    status = "success" if success else "failed"
    
    job = await update_remediation_job_status(
        db_pool,
        job_id=job_id,
        status=status,
        exit_code=exit_code,
        output_log=output[:10000] if output else None,
        error_message=error[:1000] if error else None
    )
    
    if not job:
        raise HTTPException(status_code=404, detail="Remediation job not found")
    
    # On success: mark related node_vulnerabilities as remediated
    if success:
        try:
            async with db_pool.acquire() as conn:
                # Get the job details to find node_id and vulnerability_id
                job_row = await conn.fetchrow(
                    "SELECT node_id, vulnerability_id, software_name FROM remediation_jobs WHERE id = $1", job_id
                )
                if job_row and job_row["node_id"]:
                    node_id_str = str(job_row["node_id"])
                    # Mark the specific node_vulnerability as fixed
                    await conn.execute("""
                        UPDATE node_vulnerabilities 
                        SET status = 'fixed', fixed_at = NOW(), fixed_by = 'remediation'
                        WHERE node_id = $1 AND vulnerability_id = $2 AND status != 'fixed'
                    """, node_id_str, job_row["vulnerability_id"])
                    
                    # Also mark all node_vulnerabilities for same node+software as fixed
                    # (one package update fixes all CVEs for that software)
                    if job_row["software_name"]:
                        await conn.execute("""
                            UPDATE node_vulnerabilities nv
                            SET status = 'fixed', fixed_at = NOW(), fixed_by = 'remediation'
                            FROM vulnerabilities v
                            WHERE nv.vulnerability_id = v.id
                              AND nv.node_id = $1
                              AND v.software_name = $2
                              AND nv.status != 'fixed'
                        """, node_id_str, job_row["software_name"])
        except Exception as e:
            logger.warning(f"Failed to update node_vulnerabilities after remediation: {e}")
    
    return {
        "status": status,
        "jobId": job_id,
        "success": success
    }


@router.get("/api/v1/remediation/summary")
async def remediation_dashboard(_: str = Depends(verify_api_key)):
    """Get remediation dashboard summary."""
    summary = await get_remediation_summary(db_pool)
    return summary


@router.get("/api/v1/remediation/live")
async def remediation_live_sse(request: Request, token: str = None, api_key: str = Header(None, alias="X-API-Key")):
    """
    SSE endpoint for live remediation job updates.
    Broadcasts job status changes in real-time.
    """
    # Validate auth (use centralized API_KEY from dependencies)
    if api_key != API_KEY and not token:
        raise HTTPException(401, "Unauthorized")
    
    async def event_generator():
        # Track last seen job states
        last_states = {}
        
        while True:
            if await request.is_disconnected():
                break
            
            try:
                async with db_pool.acquire() as conn:
                    rows = await conn.fetch("""
                        SELECT id, status, exit_code, software_name, cve_id, node_id,
                               created_at, completed_at, error_message
                        FROM remediation_jobs
                        WHERE updated_at > NOW() - INTERVAL '30 seconds'
                        ORDER BY updated_at DESC
                        LIMIT 20
                    """)
                    
                    for row in rows:
                        job_id = row['id']
                        current_state = f"{row['status']}:{row['exit_code']}"
                        
                        if last_states.get(job_id) != current_state:
                            last_states[job_id] = current_state
                            job_data = {
                                "type": "job_update",
                                "job": {
                                    "id": row['id'],
                                    "status": row['status'],
                                    "exit_code": row['exit_code'],
                                    "software_name": row['software_name'],
                                    "cve_id": row['cve_id'],
                                    "node_id": str(row['node_id']),
                                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                                    "completed_at": row['completed_at'].isoformat() if row['completed_at'] else None,
                                    "error_message": row['error_message']
                                }
                            }
                            yield f"data: {json.dumps(job_data, default=str)}\n\n"
            except Exception as e:
                logger.error(f"Remediation SSE error: {e}")
            
            await asyncio.sleep(2)  # Poll every 2 seconds
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
