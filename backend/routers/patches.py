"""
Octofleet API - Patches Routes
"""
import json
import re
import uuid as _uuid
from datetime import datetime, timedelta, timezone

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


# The last update search per node, as the agent reported it (status, source, error): Windows Update or
# WSUS from the Windows agent, the package lists (apt, dnf, yum) from the Linux agent
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
        update_count INTEGER,
        reboot_pending BOOLEAN
    )
"""

# Catalog states a successful scan may resolve: still waiting, nothing started by Octofleet yet
UNRESOLVED_STATES = ("detected", "approved")


async def ensure_schema(pool) -> None:
    """Tables added after the initial schema (existing installations)."""
    async with pool.acquire() as conn:
        await conn.execute(NODE_PATCH_SCANS_DDL)
        # whether Windows waits for a reboot (scan), whether an update needs one (never/always/can)
        await conn.execute("ALTER TABLE node_patch_scans ADD COLUMN IF NOT EXISTS reboot_pending BOOLEAN")
        await conn.execute("ALTER TABLE node_available_updates ADD COLUMN IF NOT EXISTS reboot_behavior TEXT")


def scan_info(data: dict):
    """The agent's scan block ({status, result_code, error, source, server, duration_seconds}), or None
    for agents that do not send one."""
    scan = data.get("scan")
    if not isinstance(scan, dict) or scan.get("status") not in ("succeeded", "partial", "failed"):
        return None
    return scan


async def record_scan(conn, node_uuid: str, scan: dict, update_count) -> None:
    await conn.execute("""
        INSERT INTO node_patch_scans (node_id, scanned_at, status, source, server, result_code, error,
                                      duration_seconds, reboot_pending, update_count)
        VALUES ($1::uuid, NOW(), $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (node_id) DO UPDATE SET scanned_at = NOW(), status = EXCLUDED.status,
            source = EXCLUDED.source, server = EXCLUDED.server, result_code = EXCLUDED.result_code,
            error = EXCLUDED.error, duration_seconds = EXCLUDED.duration_seconds,
            reboot_pending = EXCLUDED.reboot_pending, update_count = EXCLUDED.update_count
    """, node_uuid, scan["status"], scan.get("source"), scan.get("server"), scan.get("result_code"),
        (scan.get("error") or None) and str(scan["error"])[:2000], scan.get("duration_seconds"),
        scan.get("reboot_pending") if isinstance(scan.get("reboot_pending"), bool) else None, update_count)


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
    scan = scan_info(data)
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
            await record_scan(conn, node_id, scan, None)
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
                INSERT INTO node_available_updates (node_id, kb_id, title, severity, category, source,
                                                    is_reboot_required, reboot_behavior)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
            """, node_uuid, p.get("kb_id"), p.get("title", ""),
                p.get("severity", "moderate"), p.get("category", "security"), source,
                reboot_behavior(p) == "always", reboot_behavior(p))
        if scan is not None:
            await record_scan(conn, node_uuid, scan, len(patches))
    return {"imported": imported, "total": len(patches), "removed": removed}


def reboot_behavior(patch: dict):
    """never / always / can (may request a reboot) as the Windows agent reports it; None if not sent"""
    value = patch.get("reboot_behavior")
    return value if value in ("never", "always", "can") else None


def is_definition_update(kb_id, title) -> bool:
    """A Microsoft Defender signature update: offered several times a day and installed by Defender
    itself, so it does not make a node's updates pending in the UI."""
    return kb_id == "KB2267602" or "security intelligence update" in (title or "").lower()


@router.get("/api/v1/patches/available/{node_id}", dependencies=[Depends(require_user_permission("packages:read"))])
async def get_available_updates(node_id: str):
    """The updates the node's last successful update search found (node_id or UUID), newest first.
    `definition` marks Microsoft Defender signature updates."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT u.kb_id, u.title, u.severity, u.category, u.source, u.is_reboot_required, u.reboot_behavior,
                   u.discovered_at
            FROM node_available_updates u JOIN nodes n ON n.id = u.node_id
            WHERE n.node_id = $1 OR n.id::text = $1
            ORDER BY u.discovered_at DESC NULLS LAST, u.kb_id
        """, node_id)
    return {"updates": [{
        **dict(r),
        "is_reboot_required": bool(r["is_reboot_required"]),
        "discovered_at": r["discovered_at"].isoformat() if r["discovered_at"] else None,
        "definition": is_definition_update(r["kb_id"], r["title"]),
    } for r in rows]}


@router.get("/api/v1/patches/scan-status/{node_id}", dependencies=[Depends(require_user_permission("packages:read"))])
async def get_patch_scan_status(node_id: str):
    """The node's last update search (node_id or UUID): when, status, source, error, update count."""
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


# ---------------------------------------------------------------------------
# Fleet updates: one row per node (Windows and Linux) with its pending updates, reboot state and last
# update search; search / install on several nodes at once (/patches/updates in the UI)
# ---------------------------------------------------------------------------

# Linux: whether upgrading a package usually needs a reboot, from its name (like the UI's estimate)
# Arch and derivatives name the kernel package itself linux, linux-lts, linux-zen, linux-cachyos, ...
_LINUX_REBOOT_ALWAYS = re.compile(
    r"^((linux-(image|modules|headers|base)|kernel(-core|-modules)?)(\b|-|$)"
    r"|linux(-(lts|zen|hardened|rt|rt-lts|cachyos[a-z0-9-]*))?$)")
_LINUX_REBOOT_CAN = re.compile(r"^(libc6|glibc|systemd|libsystemd0|dbus|dbus-broker|libssl\d+(t64)?|openssl(-libs)?)(\b|-|:|$)")

FLEET_SORTS = ("hostname", "pending", "security", "reboot", "last_search", "os")
REBOOT_ORDER = {"pending": 0, "needed": 1, "maybe": 2, "unknown": 3, "none": 4}


def _linux_reboot(names, pending) -> str:
    if pending:
        return "pending"
    if any(_LINUX_REBOOT_ALWAYS.match(n) for n in names):
        return "needed"
    if any(_LINUX_REBOOT_CAN.match(n) for n in names):
        return "maybe"
    return "none"


def _windows_reboot(pending, behaviors) -> str:
    if pending:
        return "pending"
    if "always" in behaviors:
        return "needed"
    if "can" in behaviors:
        return "maybe"
    if any(b is None for b in behaviors):
        return "unknown"
    return "none"


# How long a node may take to restart and report again before the installation no longer counts as
# "restarting" (a node that stays away shows as offline instead)
RESTART_GRACE = timedelta(hours=2)
FINISHED = ("success", "failed", "cancelled", "timeout")


def _reboot_required(output: str | None) -> bool:
    """Whether an installation's output says a reboot is required: the Windows agent's JSON
    (`reboot_required`), the Linux agent's line `Reboot required: yes`"""
    if not output:
        return False
    if re.search(r"^Reboot required: yes", output, re.MULTILINE):
        return True
    start = output.find("{")
    if start >= 0:
        try:
            return json.JSONDecoder().raw_decode(output[start:])[0].get("reboot_required") is True
        except (ValueError, AttributeError):
            # A large per-KB result may be truncated after the reboot flag.
            return re.search(r'"reboot_required"\s*:\s*true', output[start:]) is not None
    return False


def install_state(last_install: dict | None, scanned_at: datetime | None, reboot_pending: bool | None,
                  now: datetime) -> dict | None:
    """The state of the newest installation until the node has finished it:
    - `installing`: the job has not finished;
    - `restarting`: finished, a reboot is required and was ordered (now or at a time), and the node has
      not searched for updates since (the agent searches again after its restart) - `restart_at` is when;
    - `awaiting_restart`: finished, a reboot is required, none was ordered, and the node still reports
      a pending reboot.
    None once the node has reported after the restart (or nothing is pending)."""
    if not last_install:
        return None
    status = last_install.get("status")
    if status not in FINISHED:
        return {"state": "installing", "job_id": str(last_install.get("id"))}
    completed = last_install.get("completed_at")
    if isinstance(completed, str):
        completed = datetime.fromisoformat(completed)
    if completed is None or not _reboot_required(last_install.get("output")):
        return None
    if completed.tzinfo is None:
        completed = completed.replace(tzinfo=timezone.utc)
    policy = last_install.get("reboot_policy") or "no_reboot"
    searched_since = scanned_at is not None and scanned_at > completed
    if policy in ("force", "schedule"):
        restart_at = completed + timedelta(minutes=1)
        if policy == "schedule":
            try:
                restart_at = max(restart_at, datetime.fromisoformat(str(last_install.get("reboot_schedule_time")).replace("Z", "+00:00")))
            except ValueError:
                pass
        if not searched_since and now < restart_at + RESTART_GRACE:
            return {"state": "restarting", "job_id": str(last_install.get("id")), "restart_at": restart_at.isoformat()}
        return None
    if reboot_pending:
        return {"state": "awaiting_restart", "job_id": str(last_install.get("id"))}
    return None


async def _fleet_rows(conn) -> list:
    """All nodes with their update state (unfiltered)"""
    rows = await conn.fetch("""
        SELECT n.id, n.node_id, n.hostname, n.os_name, n.is_online, n.last_seen,
               s.scanned_at, s.status AS search_status, s.source AS search_source, s.server AS search_server,
               s.error AS search_error, s.reboot_pending,
               l.node_id AS linux_node_id, l.updates AS linux_updates,
               (SELECT json_agg(json_build_object('kb_id', u.kb_id, 'title', u.title, 'severity', u.severity, 'category', u.category,
                                                  'reboot_behavior', u.reboot_behavior,
                                                  'approved', EXISTS (SELECT 1 FROM patch_catalog c WHERE c.kb_id = u.kb_id
                                                                      AND c.is_approved AND NOT COALESCE(c.is_excluded, false))))
                  FROM node_available_updates u WHERE u.node_id = n.id) AS windows_updates,
               (SELECT json_build_object('id', j.id, 'type', j.command_type, 'status', ji.status,
                                         'at', COALESCE(ji.completed_at, ji.queued_at))
                  FROM job_instances ji JOIN jobs j ON j.id = ji.job_id
                 WHERE ji.node_id IN (n.id::text, n.node_id)
                   AND j.command_type IN ('patch_scan', 'patch_install')
                 ORDER BY ji.queued_at DESC LIMIT 1) AS last_job,
               (SELECT json_build_object('id', j.id, 'status', ji.status, 'completed_at', ji.completed_at,
                                         'reboot_policy', j.command_data->>'reboot_policy',
                                         'reboot_schedule_time', j.command_data->>'reboot_schedule_time',
                                         'output', left(ji.stdout, 4000))
                  FROM job_instances ji JOIN jobs j ON j.id = ji.job_id
                 WHERE ji.node_id IN (n.id::text, n.node_id) AND j.command_type = 'patch_install'
                 ORDER BY ji.queued_at DESC LIMIT 1) AS last_install
        FROM nodes n
        LEFT JOIN node_patch_scans s ON s.node_id = n.id
        LEFT JOIN linux_data_current l ON l.node_id = n.id::text
        WHERE n.removal_state IS NULL OR n.removal_state NOT IN ('removed', 'uninstalling')
    """)
    out = []
    now = datetime.now(timezone.utc)
    for r in rows:
        linux = r["linux_updates"]
        if isinstance(linux, str):
            linux = json.loads(linux)
        windows = r["windows_updates"]
        if isinstance(windows, str):
            windows = json.loads(windows)
        last_job = r["last_job"]
        if isinstance(last_job, str):
            last_job = json.loads(last_job)
        last_install = r["last_install"]
        if isinstance(last_install, str):
            last_install = json.loads(last_install)
        os_name = (r["os_name"] or "").lower()
        is_windows = "windows" in os_name
        is_linux = r["linux_node_id"] is not None or any(name in os_name for name in
            ("linux", "ubuntu", "debian", "fedora", "centos", "rocky", "alma", "rhel", "suse", "red hat"))
        if not is_windows and not is_linux:
            continue
        if is_windows:
            updates = windows or []
            definitions = [u for u in updates if is_definition_update(u.get("kb_id"), u.get("title"))]
            relevant = [u for u in updates if u not in definitions]
            pending = len(relevant)
            # security: the category (cumulative updates often only have "moderate" as severity) or the severity
            security = sum(1 for u in relevant if (u.get("category") or "").lower() == "security"
                           or (u.get("severity") or "").lower() in ("critical", "important"))
            reboot = _windows_reboot(r["reboot_pending"], [u.get("reboot_behavior") for u in relevant])
            os_family = "windows"
            # approved in the catalog (Patches -> Catalog): what a bulk installation installs
            approved = sum(1 for u in relevant if u.get("approved"))
            approved_definitions = sum(1 for u in definitions if u.get("approved"))
        else:
            linux = linux or {}
            names = [p.get("name") for p in (linux.get("updates") or []) if p.get("name")]
            definitions = []
            pending = linux.get("totalUpdates") if isinstance(linux.get("totalUpdates"), int) else len(names)
            security = linux.get("securityUpdates") if isinstance(linux.get("securityUpdates"), int) else 0
            reboot = _linux_reboot(names, linux.get("rebootRequired") is True)
            os_family = "linux"
            approved = approved_definitions = None  # no approval path for Linux packages yet
        out.append({
            "id": str(r["id"]), "node_id": r["node_id"], "hostname": r["hostname"], "os_name": r["os_name"],
            "os_family": os_family, "online": bool(r["is_online"]),
            "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
            "pending": pending, "security": security, "definitions": len(definitions),
            "approved": approved, "approved_definitions": approved_definitions,
            "reboot": reboot if (pending or reboot == "pending") else "none",
            "last_search": {
                "at": r["scanned_at"].isoformat() if r["scanned_at"] else None,
                "status": r["search_status"], "source": r["search_source"], "server": r["search_server"],
                "error": r["search_error"],
            },
            # the newest search or installation; `running` while the agent has not answered
            "last_job": last_job,
            "running": last_job["type"] if last_job and last_job["status"] in ("pending", "queued", "running") else None,
            # an installation that has not finished on the node yet (job running, restarting, awaiting restart)
            "installation": install_state(last_install, r["scanned_at"], r["reboot_pending"], now),
        })
    return out


@router.get("/api/v1/patches/fleet", dependencies=[Depends(require_user_permission("packages:read"))])
async def fleet_updates(os: str = None, pending: bool = False, security: bool = False, reboot: bool = False,
                        failed: bool = False, stale_days: int = 0, offline: bool = False, q: str = None,
                        sort: str = "pending", dir: str = None, limit: int = 100, offset: int = 0):
    """Nodes with their update state: pending and security updates (Windows without Defender signature
    updates, counted as `definitions`), reboot (pending / needed / maybe / unknown / none), the last
    update search, the newest search or installation (`last_job`: id, type, status, at), `running`
    while one has not finished, and `installation` while the newest installation has not finished on
    the node (`installing`, `restarting` with `restart_at`, `awaiting_restart`).

    Filters: `os` (windows / linux), `pending`, `security`, `reboot` (pending or needed), `failed`
    (last search failed), `stale_days` (no search for that many days), `offline`, `q` (hostname).
    `sort`: hostname, pending, security, reboot, last_search, os; `dir`: asc / desc.
    `counts` are over all nodes (for the cards), `total` over the filtered ones."""
    async with get_pool().acquire() as conn:
        rows = await _fleet_rows(conn)
    now = datetime.now(timezone.utc)

    def stale(r, days):
        at = r["last_search"]["at"]
        return at is None or (now - datetime.fromisoformat(at)).days >= days

    counts = {
        "nodes": len(rows),
        "pending": sum(1 for r in rows if r["pending"]),
        "security": sum(1 for r in rows if r["security"]),
        "reboot": sum(1 for r in rows if r["reboot"] in ("pending", "needed")),
        "failed": sum(1 for r in rows if r["last_search"]["status"] == "failed"),
        "stale": sum(1 for r in rows if stale(r, 7)),
        "offline": sum(1 for r in rows if not r["online"]),
    }
    if os in ("windows", "linux"):
        rows = [r for r in rows if r["os_family"] == os]
    if pending:
        rows = [r for r in rows if r["pending"]]
    if security:
        rows = [r for r in rows if r["security"]]
    if reboot:
        rows = [r for r in rows if r["reboot"] in ("pending", "needed")]
    if failed:
        rows = [r for r in rows if r["last_search"]["status"] == "failed"]
    if stale_days and stale_days > 0:
        rows = [r for r in rows if stale(r, stale_days)]
    if offline:
        rows = [r for r in rows if not r["online"]]
    if q:
        rows = [r for r in rows if q.lower() in (r["hostname"] or "").lower()]

    if sort not in FLEET_SORTS:
        raise HTTPException(status_code=400, detail=f"sort: one of {', '.join(FLEET_SORTS)}")
    descending = (dir or ("desc" if sort in ("pending", "security", "last_search") else "asc")) == "desc"
    keys = {
        "hostname": lambda r: (r["hostname"] or "").lower(),
        "pending": lambda r: (r["pending"], r["security"]),
        "security": lambda r: (r["security"], r["pending"]),
        "reboot": lambda r: REBOOT_ORDER.get(r["reboot"], 9),
        "last_search": lambda r: r["last_search"]["at"] or "",
        "os": lambda r: (r["os_family"], (r["hostname"] or "").lower()),
    }
    # stable: the name first, then the chosen column
    rows.sort(key=lambda r: (r["hostname"] or "").lower())
    rows.sort(key=keys[sort], reverse=descending)
    return {"nodes": rows[offset:offset + limit], "total": len(rows), "counts": counts}


async def _create_node_job(conn, node_uuid: str, name: str, command_type: str, data: dict, username: str) -> str:
    job_id = _uuid.uuid4()
    await conn.execute("""
        INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data, created_by)
        VALUES ($1, $2, $3, 'device', $4::uuid, $5, $6::jsonb, $7)
    """, job_id, name, "Fleet updates", node_uuid, command_type, json.dumps(data), username)
    await conn.execute("""
        INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
        VALUES (gen_random_uuid(), $1, $2, 'pending', NOW())
    """, job_id, node_uuid)
    return str(job_id)


def _node_ids(data: dict) -> list:
    ids = data.get("node_ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        raise HTTPException(status_code=400, detail="node_ids: a nonempty list of node UUIDs")
    unique = list(dict.fromkeys(ids))
    if len(unique) > 500:
        raise HTTPException(status_code=400, detail="node_ids: at most 500 nodes")
    return unique


@router.post("/api/v1/patches/fleet/search", dependencies=[Depends(require_user_permission("packages:deploy"))])
async def fleet_search(data: dict, request: Request):
    """An update search (patch_scan job) on each of the nodes; skipped (`busy`) while a search or
    installation runs or the node restarts after one."""
    user = getattr(request.state, "user", None)
    username = user.get("username", "system") if user else "system"
    jobs, skipped = [], []
    async with get_pool().acquire() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext('octofleet:fleet-updates'))")
        rows = {r["id"]: r for r in await _fleet_rows(conn)}
        for node_uuid in _node_ids(data):
            row = rows.get(node_uuid)
            if row is None:
                skipped.append({"node": node_uuid, "reason": "unknown node"})
                continue
            if row["running"] or (row["installation"] or {}).get("state") in ("installing", "restarting"):
                skipped.append({"node": node_uuid, "reason": "busy"})
                continue
            jobs.append({"node": node_uuid, "job_id": await _create_node_job(
                conn, node_uuid, "Search for updates", "patch_scan", {"timeout": 1500}, username)})
    return {"jobs": jobs, "skipped": skipped}


@router.post("/api/v1/patches/fleet/install", dependencies=[Depends(require_user_permission("packages:deploy"))])
async def fleet_install(data: dict, request: Request):
    """Install the approved updates on each of the Windows nodes (patch_install job per node). The
    server builds each payload from what it stores: the KB IDs of the node's available updates that are
    approved (and not excluded) in the patch catalog; Defender signature updates only with
    `include_definitions`. Linux nodes are skipped (`linux_not_available`): Linux packages have no
    approval path yet, so they are installed from the node page. `reboot_policy`
    (no_reboot / schedule with `reboot_schedule_time` / force) applies when an update needs a reboot.
    Nodes whose newest installation has not finished (`installation`: installing, restarting, awaiting
    restart) are skipped - a cumulative update stays listed until the restart; `retry: true` installs
    again anyway on those that are restarting or awaiting a restart (never while a job runs)."""
    policy = data.get("reboot_policy", "no_reboot")
    if policy not in ("no_reboot", "schedule", "force"):
        raise HTTPException(status_code=400, detail="reboot_policy: no_reboot, schedule or force")
    schedule = data.get("reboot_schedule_time")
    if policy == "schedule":
        try:
            scheduled_at = datetime.fromisoformat(str(schedule).replace("Z", "+00:00"))
            if scheduled_at.tzinfo is None or scheduled_at <= datetime.now(timezone.utc) + timedelta(minutes=1):
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="reboot_schedule_time: future ISO 8601 with offset") from None
    include_definitions = data.get("include_definitions") is True
    retry = data.get("retry") is True
    user = getattr(request.state, "user", None)
    username = user.get("username", "system") if user else "system"
    jobs, skipped = [], []
    async with get_pool().acquire() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext('octofleet:fleet-updates'))")
        rows = {r["id"]: r for r in await _fleet_rows(conn)}
        for node_uuid in _node_ids(data):
            row = rows.get(node_uuid)
            if row is None:
                skipped.append({"node": node_uuid, "reason": "unknown node"})
                continue
            state = (row["installation"] or {}).get("state")
            if row["running"] or state == "installing":
                skipped.append({"node": node_uuid, "reason": "busy"})
                continue
            if state in ("restarting", "awaiting_restart") and not retry:
                skipped.append({"node": node_uuid, "reason": state})
                continue
            reboot = {"reboot_policy": policy, **({"reboot_schedule_time": schedule} if policy == "schedule" else {})}
            if row["os_family"] != "windows":
                skipped.append({"node": node_uuid, "reason": "linux_not_available"})
                continue
            available = await conn.fetch("""
                SELECT u.kb_id, u.title,
                       EXISTS (SELECT 1 FROM patch_catalog c WHERE c.kb_id = u.kb_id
                               AND c.is_approved AND NOT COALESCE(c.is_excluded, false)) AS approved
                  FROM node_available_updates u WHERE u.node_id = $1::uuid AND u.kb_id IS NOT NULL""", node_uuid)
            wanted = [r for r in available if include_definitions or not is_definition_update(r["kb_id"], r["title"])]
            kb_ids = [r["kb_id"] for r in wanted if r["approved"]]
            if not kb_ids:
                skipped.append({"node": node_uuid, "reason": "not_approved" if wanted else "no pending updates"})
                continue
            payload = {"kb_ids": kb_ids, "timeout": 1800, **reboot}
            jobs.append({"node": node_uuid, "job_id": await _create_node_job(
                conn, node_uuid, "Install updates", "patch_install", payload, username)})
    return {"jobs": jobs, "skipped": skipped}
