"""
Octofleet API - Patches Routes
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request

from auth import require_permission, require_user_permission
from dependencies import get_pool

router = APIRouter(tags=["Patches"])
def _is_uuid(val: str) -> bool:
    try:
        from uuid import UUID as _UUID
        _UUID(val)
        return True
    except (ValueError, AttributeError):
        return False


# Patch states that still need action on a node
OPEN_STATES = ("detected", "approved", "downloading", "installing")

# patch_catalog_nodes.node_id holds the node's UUID (patch scan report) - older entries may hold its
# node_id. $n is resolved against both, so a node can be named either way in a request.
NODE_ENTRY_MATCH = "(SELECT n.id::text FROM nodes n WHERE n.node_id = ${n} OR n.id::text = ${n}), ${n}"


def _node_entries(param_index: int) -> str:
    """SQL condition on patch_catalog_nodes (alias-free): the entries of the node in parameter $param_index."""
    return f"node_id IN ({NODE_ENTRY_MATCH.replace('{n}', str(param_index))})"


# The last Windows Update search per node, as the agent reported it (status, source, error)
NODE_PATCH_SCANS_DDL = """
    CREATE TABLE IF NOT EXISTS node_patch_scans (
        node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
        scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL,
        source TEXT,
        server TEXT,
        result_code INTEGER,
        error TEXT,
        duration_seconds REAL,
        update_count INTEGER
    )
"""

# Catalog states a successful scan may resolve: still waiting, nothing started by Octofleet yet
UNRESOLVED_STATES = ("detected", "approved")


async def ensure_schema(pool) -> None:
    """Tables added after the initial schema (existing installations)."""
    async with pool.acquire() as conn:
        await conn.execute(NODE_PATCH_SCANS_DDL)


def _scan_info(data: dict):
    """The agent's scan block ({status, result_code, error, source, server, duration_seconds}), or None
    for agents that do not send one."""
    scan = data.get("scan")
    if not isinstance(scan, dict) or scan.get("status") not in ("succeeded", "partial", "failed"):
        return None
    return scan


async def _record_scan(conn, node_uuid: str, scan: dict, update_count) -> None:
    await conn.execute("""
        INSERT INTO node_patch_scans (node_id, scanned_at, status, source, server, result_code, error,
                                      duration_seconds, update_count)
        VALUES ($1::uuid, NOW(), $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (node_id) DO UPDATE SET scanned_at = NOW(), status = EXCLUDED.status,
            source = EXCLUDED.source, server = EXCLUDED.server, result_code = EXCLUDED.result_code,
            error = EXCLUDED.error, duration_seconds = EXCLUDED.duration_seconds,
            update_count = EXCLUDED.update_count
    """, node_uuid, scan["status"], scan.get("source"), scan.get("server"), scan.get("result_code"),
        (scan.get("error") or None) and str(scan["error"])[:2000], scan.get("duration_seconds"), update_count)


@router.get("/api/v1/patches/catalog", dependencies=[Depends(require_user_permission("packages:read"))])
async def list_patch_catalog(
    severity: str = None, category: str = None, approved: str = None,
    search: str = None, node: str = None, limit: int = 100, offset: int = 0
):
    """Patch catalog. `node` (node_id or UUID) limits it to the patches still open on that node."""
    async with get_pool().acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if node:
            conditions.append(f"id IN (SELECT patch_id FROM patch_catalog_nodes WHERE {_node_entries(idx)} "
                              f"AND status = ANY(${idx + 1}::text[]))")
            params.append(node); params.append(list(OPEN_STATES)); idx += 2
        if severity:
            conditions.append(f"severity = ${idx}")
            params.append(severity); idx += 1
        if category:
            conditions.append(f"category = ${idx}")
            params.append(category); idx += 1
        if approved == "true":
            conditions.append("is_approved = true")
        elif approved == "false":
            conditions.append("is_approved = false")
        if search:
            conditions.append(f"(title ILIKE ${idx} OR kb_id ILIKE ${idx} OR description ILIKE ${idx})")
            params.append(f"%{search}%"); idx += 1
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        total = await conn.fetchval(f"SELECT COUNT(*) FROM patch_catalog{where}", *params)
        params.append(limit); params.append(offset)
        rows = await conn.fetch(
            f"SELECT * FROM patch_catalog{where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx+1}", *params
        )
        return {"items": [dict(r) for r in rows], "total": total}


@router.post("/api/v1/patches/catalog", dependencies=[Depends(require_user_permission("packages:write"))])
async def create_patch(data: dict):
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO patch_catalog (kb_id, title, description, severity, category, os_targets, release_date, supersedes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
        """, data.get("kb_id"), data.get("title",""), data.get("description"),
            data.get("severity","moderate"), data.get("category","security"),
            data.get("os_targets",[]), data.get("release_date"), data.get("supersedes",[]))
        return dict(row)


@router.post("/api/v1/patches/catalog/import", dependencies=[Depends(require_user_permission("packages:write"))])
async def import_patches(data: dict):
    """Import patches from agent scan results. Expects {node_id, patches: [{kb_id, title, ...}]}.

    Agents that send a scan block ({status: succeeded | partial | failed, ...}):
    - failed: the search did not work (e.g. WSUS not reachable) - the node's lists stay as they are;
      only the status is recorded. Before, a failed search arrived as an empty list and cleared them.
    - succeeded: catalog entries of the node that are still waiting (detected/approved) but no
      longer offered are removed - installed outside Octofleet (WSUS, Windows Update, Defender),
      superseded or declined. Entries of Octofleet's own deployments stay.
    - partial (searched with errors): the lists are updated, nothing is removed.
    Without a scan block (older agents, the catalog import) nothing is removed, as before.
    """
    node_id = data.get("node_id")
    patches = data.get("patches", [])
    scan = _scan_info(data)
    # Resolve hostname to UUID if needed
    if node_id and not _is_uuid(node_id):
        async with get_pool().acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id FROM nodes WHERE UPPER(hostname) = UPPER($1) OR node_id = $1", node_id)
            if not row:
                raise HTTPException(status_code=404, detail=f"Unknown node: {node_id}")
            node_id = str(row["id"])
    if scan is not None and scan["status"] == "failed":
        async with get_pool().acquire() as conn:
            await _record_scan(conn, node_id, scan, None)
        return {"imported": 0, "total": 0, "removed": 0, "scan": "failed"}
    imported = 0
    reported_ids = []
    async with get_pool().acquire() as conn:
        for p in patches:
            # Upsert patch catalog entry
            existing = await conn.fetchrow("SELECT id FROM patch_catalog WHERE kb_id = $1", p.get("kb_id"))
            if existing:
                patch_id = existing["id"]
            else:
                row = await conn.fetchrow("""
                    INSERT INTO patch_catalog (kb_id, title, description, severity, category)
                    VALUES ($1,$2,$3,$4,$5) RETURNING id
                """, p.get("kb_id"), p.get("title",""), p.get("description"),
                    p.get("severity","moderate"), p.get("category","security"))
                patch_id = row["id"]
                imported += 1
            reported_ids.append(patch_id)
            # Upsert node association
            exists = await conn.fetchval(
                "SELECT 1 FROM patch_catalog_nodes WHERE patch_id=$1 AND node_id=$2", patch_id, node_id)
            if not exists:
                await conn.execute("""
                    INSERT INTO patch_catalog_nodes (patch_id, node_id, status) VALUES ($1,$2,'detected')
                """, patch_id, node_id)

        removed = 0
        if scan is not None and scan["status"] == "succeeded":
            result = await conn.execute(
                f"DELETE FROM patch_catalog_nodes WHERE {_node_entries(1)} AND status = ANY($2::text[]) "
                "AND NOT (patch_id = ANY($3::uuid[]))", node_id, list(UNRESOLVED_STATES), reported_ids)
            removed = int(result.split()[-1])

        # Also sync to node_available_updates for Patch Explorer
        # Clear old entries for this node, then re-insert from scan
        node_uuid = node_id
        source = (scan or {}).get("source") or "windows_update"
        await conn.execute("DELETE FROM node_available_updates WHERE node_id = $1::uuid", node_uuid)
        for p in patches:
            await conn.execute("""
                INSERT INTO node_available_updates (node_id, kb_id, title, severity, category, source, is_reboot_required)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, false)
            """, node_uuid, p.get("kb_id"), p.get("title", ""),
                p.get("severity", "moderate"), p.get("category", "security"), source)
        if scan is not None:
            await _record_scan(conn, node_uuid, scan, len(patches))
    return {"imported": imported, "total": len(patches), "removed": removed}


@router.get("/api/v1/patches/scan-status/{node_id}", dependencies=[Depends(require_user_permission("packages:read"))])
async def get_patch_scan_status(node_id: str):
    """The node's last Windows Update search (node_id or UUID): when, status, source, error, update count."""
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            SELECT s.* FROM node_patch_scans s JOIN nodes n ON n.id = s.node_id
            WHERE n.node_id = $1 OR n.id::text = $1
        """, node_id)
    if not row:
        return {"data": None}
    data = dict(row)
    data["node_id"] = str(data["node_id"])
    data["scanned_at"] = data["scanned_at"].isoformat()
    return {"data": data}


@router.patch("/api/v1/patches/catalog/{patch_id}/approve", dependencies=[Depends(require_user_permission("packages:write"))])
async def approve_patch(patch_id: str, request: Request):
    user = getattr(request.state, "user", None)
    username = user.get("username", "system") if user else "system"
    async with get_pool().acquire() as conn:
        await conn.execute("""
            UPDATE patch_catalog SET is_approved=true, is_excluded=false, approved_by=$2, approved_at=NOW()
            WHERE id=$1
        """, patch_id, username)
        return {"status": "approved"}


@router.patch("/api/v1/patches/catalog/{patch_id}/exclude", dependencies=[Depends(require_user_permission("packages:write"))])
async def exclude_patch(patch_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_catalog SET is_excluded=true, is_approved=false WHERE id=$1", patch_id)
        # Also exclude all node entries
        await conn.execute("UPDATE patch_catalog_nodes SET status='excluded' WHERE patch_id=$1", patch_id)
        return {"status": "excluded"}


@router.get("/api/v1/patches/catalog/{patch_id}", dependencies=[Depends(require_user_permission("packages:read"))])
async def get_patch_detail(patch_id: str):
    async with get_pool().acquire() as conn:
        patch = await conn.fetchrow("SELECT * FROM patch_catalog WHERE id=$1", patch_id)
        if not patch:
            raise HTTPException(404, "Patch not found")
        nodes = await conn.fetch("""
            SELECT pcn.*, n.hostname FROM patch_catalog_nodes pcn
            LEFT JOIN nodes n ON (n.id::text = pcn.node_id OR n.node_id = pcn.node_id)
            WHERE pcn.patch_id=$1 ORDER BY pcn.detected_at DESC
        """, patch_id)
        result = dict(patch)
        result["affected_nodes"] = [dict(n) for n in nodes]
        return result


@router.get("/api/v1/patches/compliance", dependencies=[Depends(require_user_permission("compliance:read"))])
async def get_patch_compliance(node_id: str = None):
    """Patch compliance of the fleet, or of one node with `node_id` (node_id or UUID): the patch and
    entry counts, compliance and MTTP then cover only that node's entries; rings and active
    deployments stay fleet-wide."""
    async with get_pool().acquire() as conn:
        # the node's entries, or all of them
        entries = f"patch_catalog_nodes WHERE {_node_entries(1)}" if node_id else "patch_catalog_nodes WHERE TRUE"
        args = [node_id] if node_id else []
        if node_id:
            total_patches = await conn.fetchval(f"SELECT COUNT(DISTINCT patch_id) FROM {entries}", *args)
            approved = await conn.fetchval(
                f"SELECT COUNT(*) FROM patch_catalog WHERE is_approved=true AND id IN (SELECT patch_id FROM {entries})", *args)
        else:
            total_patches = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog")
            approved = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog WHERE is_approved=true")
        total_node_patches = await conn.fetchval(f"SELECT COUNT(*) FROM {entries}", *args)
        installed = await conn.fetchval(f"SELECT COUNT(*) FROM {entries} AND status='installed'", *args)
        failed = await conn.fetchval(f"SELECT COUNT(*) FROM {entries} AND status='failed'", *args)
        pending = await conn.fetchval(
            f"SELECT COUNT(*) FROM {entries} AND status = ANY(${len(args) + 1}::text[])", *args, list(OPEN_STATES))
        compliance_pct = round((installed / total_node_patches * 100), 1) if total_node_patches > 0 else 100.0
        # MTTP - mean time to patch (avg time from detected to installed)
        mttp = await conn.fetchval(f"""
            SELECT AVG(EXTRACT(EPOCH FROM (installed_at - detected_at))/3600)
            FROM {entries} AND status='installed' AND installed_at IS NOT NULL
        """, *args)
        active_deployments = await conn.fetchval("SELECT COUNT(*) FROM patch_deployments WHERE status='in_progress'")
        # Per-ring compliance
        rings = await conn.fetch("""
            SELECT pr.id, pr.name, pr.priority,
                COUNT(pdr.id) as total,
                COUNT(CASE WHEN pdr.status='installed' THEN 1 END) as installed
            FROM patch_rings pr
            LEFT JOIN patch_deployments pd ON pd.ring_id = pr.id
            LEFT JOIN patch_deployment_results pdr ON pdr.deployment_id = pd.id
            GROUP BY pr.id, pr.name, pr.priority ORDER BY pr.priority
        """)
        return {
            "total_patches": total_patches, "approved": approved,
            "compliance_percent": compliance_pct,
            "installed": installed, "failed": failed, "pending": pending,
            "mttp_hours": round(float(mttp), 1) if mttp else None,
            "active_deployments": active_deployments,
            "rings": [dict(r) for r in rings]
        }


@router.get("/api/v1/patches/compliance/nodes", dependencies=[Depends(require_user_permission("compliance:read"))])
async def get_node_compliance(limit: int = 100, offset: int = 0):
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT pcn.node_id, n.hostname,
                COUNT(*) as total_patches,
                COUNT(CASE WHEN pcn.status='installed' THEN 1 END) as installed,
                COUNT(CASE WHEN pcn.status='failed' THEN 1 END) as failed,
                COUNT(CASE WHEN pcn.status IN ('detected','approved','downloading','installing') THEN 1 END) as pending
            FROM patch_catalog_nodes pcn
            LEFT JOIN nodes n ON (n.id::text = pcn.node_id OR n.node_id = pcn.node_id)
            GROUP BY pcn.node_id, n.hostname
            ORDER BY pending DESC
            LIMIT $1 OFFSET $2
        """, limit, offset)
        return {"items": [dict(r) for r in rows]}


@router.get("/api/v1/patches/rings", dependencies=[Depends(require_user_permission("packages:read"))])
async def list_patch_rings():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM patch_rings ORDER BY priority")
        return [dict(r) for r in rows]


@router.post("/api/v1/patches/rings", dependencies=[Depends(require_user_permission("packages:write"))])
async def create_patch_ring(data: dict):
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO patch_rings (name, description, priority, delay_hours, node_group_id)
            VALUES ($1,$2,$3,$4,$5) RETURNING *
        """, data.get("name"), data.get("description"), data.get("priority",0),
            data.get("delay_hours",0), data.get("node_group_id"))
        return dict(row)


@router.put("/api/v1/patches/rings/{ring_id}", dependencies=[Depends(require_user_permission("packages:write"))])
async def update_patch_ring(ring_id: str, data: dict):
    async with get_pool().acquire() as conn:
        await conn.execute("""
            UPDATE patch_rings SET name=COALESCE($2,name), description=COALESCE($3,description),
            priority=COALESCE($4,priority), delay_hours=COALESCE($5,delay_hours),
            node_group_id=COALESCE($6,node_group_id) WHERE id=$1
        """, ring_id, data.get("name"), data.get("description"),
            data.get("priority"), data.get("delay_hours"), data.get("node_group_id"))
        row = await conn.fetchrow("SELECT * FROM patch_rings WHERE id=$1", ring_id)
        return dict(row) if row else {"error": "not found"}


@router.delete("/api/v1/patches/rings/{ring_id}", dependencies=[Depends(require_user_permission("packages:write"))])
async def delete_patch_ring(ring_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM patch_rings WHERE id=$1", ring_id)
        return {"deleted": True}


@router.get("/api/v1/patches/deployments", dependencies=[Depends(require_user_permission("packages:read"))])
async def list_patch_deployments(status: str = None, limit: int = 50, offset: int = 0):
    async with get_pool().acquire() as conn:
        where = ""
        params = []
        idx = 1
        if status:
            where = f" WHERE status=${idx}"
            params.append(status); idx += 1
        params.append(limit); params.append(offset)
        rows = await conn.fetch(
            f"SELECT pd.*, pr.name as ring_name FROM patch_deployments pd LEFT JOIN patch_rings pr ON pr.id=pd.ring_id{where} ORDER BY pd.created_at DESC LIMIT ${idx} OFFSET ${idx+1}",
            *params
        )
        return [dict(r) for r in rows]


@router.post("/api/v1/patches/deployments", dependencies=[Depends(require_user_permission("packages:deploy"))])
async def create_patch_deployment(data: dict, request: Request):
    user = getattr(request.state, "user", None)
    username = user.get("username", "system") if user else "system"
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO patch_deployments (name, patches, ring_id, reboot_policy, reboot_schedule_time, created_by)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
        """, data.get("name",""), data.get("patches",[]), data.get("ring_id"),
            data.get("reboot_policy","no_reboot"), data.get("reboot_schedule_time"), username)
        deployment_id = row["id"]
        # Create per-node results for each patch × node in ring
        ring_id = data.get("ring_id")
        ring = None
        if ring_id:
            ring = await conn.fetchrow("SELECT node_group_id FROM patch_rings WHERE id=$1", ring_id)
            if ring and ring["node_group_id"]:
                nodes = await conn.fetch(
                    "SELECT node_id FROM device_groups WHERE group_id=$1",
                    ring["node_group_id"])
                node_ids = [str(n["node_id"]) for n in nodes]
            else:
                node_ids_rows = await conn.fetch("SELECT node_id FROM nodes")
                node_ids = [n["node_id"] for n in node_ids_rows]
        else:
            node_ids_rows = await conn.fetch("SELECT node_id FROM nodes")
            node_ids = [n["node_id"] for n in node_ids_rows]
        for patch_id in data.get("patches", []):
            for nid in node_ids:
                await conn.execute("""
                    INSERT INTO patch_deployment_results (deployment_id, node_id, patch_id, status)
                    VALUES ($1,$2,$3,'pending')
                """, deployment_id, nid, patch_id)

        # Also create a Job so it shows on the Jobs page
        import uuid as _uuid
        job_uuid = _uuid.uuid4()
        patch_names = ", ".join(data.get("patches", [])[:3])
        await conn.execute("""
            INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        """, job_uuid, data.get("name", "Patch Deployment"),
            f"Patch deployment: {patch_names}",
            "group" if ring_id else "all",
            str(ring.get("node_group_id", "")) if ring_id and ring and ring.get("node_group_id") else None,
            "patch_install",
            json.dumps({"deployment_id": str(deployment_id), "patches": data.get("patches", []), "reboot_policy": data.get("reboot_policy", "no_reboot")}),
            username)
        for nid in node_ids:
            await conn.execute("""
                INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
                VALUES (gen_random_uuid(), $1, $2::uuid, 'pending', NOW())
            """, job_uuid, nid)

        return dict(row)


@router.get("/api/v1/patches/deployments/{deployment_id}", dependencies=[Depends(require_user_permission("packages:read"))])
async def get_patch_deployment(deployment_id: str):
    async with get_pool().acquire() as conn:
        dep = await conn.fetchrow("""
            SELECT pd.*, pr.name as ring_name FROM patch_deployments pd
            LEFT JOIN patch_rings pr ON pr.id=pd.ring_id WHERE pd.id=$1
        """, deployment_id)
        if not dep:
            raise HTTPException(404, "Deployment not found")
        results = await conn.fetch("""
            SELECT pdr.*, n.hostname, pc.title as patch_title, pc.kb_id
            FROM patch_deployment_results pdr
            LEFT JOIN nodes n ON n.id::text = pdr.node_id
            LEFT JOIN patch_catalog pc ON pc.id = pdr.patch_id
            WHERE pdr.deployment_id=$1 ORDER BY n.hostname, pc.title
        """, deployment_id)
        result = dict(dep)
        result["results"] = [dict(r) for r in results]
        # Summary counts
        result["summary"] = {
            "total": len(results),
            "installed": sum(1 for r in results if r["status"] == "installed"),
            "failed": sum(1 for r in results if r["status"] == "failed"),
            "pending": sum(1 for r in results if r["status"] == "pending"),
            "in_progress": sum(1 for r in results if r["status"] in ("downloading","installing")),
        }
        return result


@router.post("/api/v1/patches/deployments/{deployment_id}/pause", dependencies=[Depends(require_user_permission("packages:deploy"))])
async def pause_patch_deployment(deployment_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_deployments SET status='paused' WHERE id=$1 AND status='in_progress'", deployment_id)
        return {"status": "paused"}


@router.post("/api/v1/patches/deployments/{deployment_id}/resume", dependencies=[Depends(require_user_permission("packages:deploy"))])
async def resume_patch_deployment(deployment_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_deployments SET status='in_progress' WHERE id=$1 AND status='paused'", deployment_id)
        return {"status": "in_progress"}


@router.post("/api/v1/patches/deployments/{deployment_id}/cancel", dependencies=[Depends(require_user_permission("packages:deploy"))])
async def cancel_patch_deployment(deployment_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_deployments SET status='cancelled', completed_at=NOW() WHERE id=$1", deployment_id)
        await conn.execute("UPDATE patch_deployment_results SET status='excluded' WHERE deployment_id=$1 AND status='pending'", deployment_id)
        return {"status": "cancelled"}


@router.post("/api/v1/patches/scan-results", dependencies=[Depends(require_permission("inventory:write"))])
async def submit_patch_scan_results(data: dict):
    """Agent submits available Windows Updates. Same as import but explicit agent endpoint."""
    return await import_patches(data)


@router.get("/api/v1/patches/pending/{node_id}", dependencies=[Depends(require_permission("jobs:poll"))])
async def get_pending_patches(node_id: str):
    """Agent polls for patches it needs to install."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT pdr.id as result_id, pdr.deployment_id, pdr.patch_id,
                pc.kb_id, pc.title, pc.category,
                pd.reboot_policy, pd.reboot_schedule_time
            FROM patch_deployment_results pdr
            JOIN patch_deployments pd ON pd.id = pdr.deployment_id
            JOIN patch_catalog pc ON pc.id = pdr.patch_id
            WHERE pdr.node_id=$1 AND pdr.status='pending' AND pd.status='in_progress'
            ORDER BY pc.severity DESC
        """, node_id)
        return [dict(r) for r in rows]


@router.post("/api/v1/patches/results", dependencies=[Depends(require_permission("inventory:write"))])
async def submit_patch_results(data: dict):
    """Agent submits install results for patches."""
    async with get_pool().acquire() as conn:
        for result in data.get("results", []):
            result_id = result.get("result_id")
            status = result.get("status", "installed")
            error = result.get("error_message")
            reboot_required = result.get("reboot_required", False)
            await conn.execute("""
                UPDATE patch_deployment_results
                SET status=$2, completed_at=NOW(), error_message=$3, reboot_required=$4
                WHERE id=$1
            """, result_id, status, error, reboot_required)
            # Also update patch_catalog_nodes
            pdr = await conn.fetchrow("SELECT patch_id, node_id FROM patch_deployment_results WHERE id=$1", result_id)
            if pdr:
                await conn.execute("""
                    UPDATE patch_catalog_nodes SET status=$3, installed_at=CASE WHEN $3='installed' THEN NOW() ELSE installed_at END,
                    error_message=$4 WHERE patch_id=$1 AND node_id=$2
                """, pdr["patch_id"], pdr["node_id"], status, error)
        # Check if deployment is complete
        if data.get("results"):
            r0 = data["results"][0]
            if r0.get("result_id"):
                pdr = await conn.fetchrow("SELECT deployment_id FROM patch_deployment_results WHERE id=$1", r0["result_id"])
                if pdr:
                    remaining = await conn.fetchval(
                        "SELECT COUNT(*) FROM patch_deployment_results WHERE deployment_id=$1 AND status IN ('pending','downloading','installing')",
                        pdr["deployment_id"])
                    if remaining == 0:
                        await conn.execute("UPDATE patch_deployments SET status='completed', completed_at=NOW() WHERE id=$1", pdr["deployment_id"])
        return {"status": "ok"}
