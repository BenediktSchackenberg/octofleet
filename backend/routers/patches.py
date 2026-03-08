"""
Octofleet API - Patches Routes
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request

from dependencies import get_pool, verify_api_key

router = APIRouter(tags=["Patches"])
def _is_uuid(val: str) -> bool:
    try:
        from uuid import UUID as _UUID
        _UUID(val)
        return True
    except (ValueError, AttributeError):
        return False


@router.get("/api/v1/patches/catalog", dependencies=[Depends(verify_api_key)])
async def list_patch_catalog(
    severity: str = None, category: str = None, approved: str = None,
    search: str = None, limit: int = 100, offset: int = 0
):
    async with get_pool().acquire() as conn:
        conditions = []
        params = []
        idx = 1
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


@router.post("/api/v1/patches/catalog", dependencies=[Depends(verify_api_key)])
async def create_patch(data: dict):
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO patch_catalog (kb_id, title, description, severity, category, os_targets, release_date, supersedes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
        """, data.get("kb_id"), data.get("title",""), data.get("description"),
            data.get("severity","moderate"), data.get("category","security"),
            data.get("os_targets",[]), data.get("release_date"), data.get("supersedes",[]))
        return dict(row)


@router.post("/api/v1/patches/catalog/import", dependencies=[Depends(verify_api_key)])
async def import_patches(data: dict):
    """Import patches from agent scan results. Expects {node_id, patches: [{kb_id, title, ...}]}"""
    node_id = data.get("node_id")
    patches = data.get("patches", [])
    # Resolve hostname to UUID if needed
    if node_id and not _is_uuid(node_id):
        async with get_pool().acquire() as conn:
            row = await conn.fetchrow(
                "SELECT node_id FROM nodes WHERE UPPER(hostname) = UPPER($1)", node_id)
            if row:
                node_id = str(row["node_id"])
    imported = 0
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
            # Upsert node association
            exists = await conn.fetchval(
                "SELECT 1 FROM patch_catalog_nodes WHERE patch_id=$1 AND node_id=$2", patch_id, node_id)
            if not exists:
                await conn.execute("""
                    INSERT INTO patch_catalog_nodes (patch_id, node_id, status) VALUES ($1,$2,'detected')
                """, patch_id, node_id)
    return {"imported": imported, "total": len(patches)}


@router.patch("/api/v1/patches/catalog/{patch_id}/approve", dependencies=[Depends(verify_api_key)])
async def approve_patch(patch_id: str, request: Request):
    user = getattr(request.state, "user", None)
    username = user.get("username", "system") if user else "system"
    async with get_pool().acquire() as conn:
        await conn.execute("""
            UPDATE patch_catalog SET is_approved=true, is_excluded=false, approved_by=$2, approved_at=NOW()
            WHERE id=$1
        """, patch_id, username)
        return {"status": "approved"}


@router.patch("/api/v1/patches/catalog/{patch_id}/exclude", dependencies=[Depends(verify_api_key)])
async def exclude_patch(patch_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_catalog SET is_excluded=true, is_approved=false WHERE id=$1", patch_id)
        # Also exclude all node entries
        await conn.execute("UPDATE patch_catalog_nodes SET status='excluded' WHERE patch_id=$1", patch_id)
        return {"status": "excluded"}


@router.get("/api/v1/patches/catalog/{patch_id}", dependencies=[Depends(verify_api_key)])
async def get_patch_detail(patch_id: str):
    async with get_pool().acquire() as conn:
        patch = await conn.fetchrow("SELECT * FROM patch_catalog WHERE id=$1", patch_id)
        if not patch:
            raise HTTPException(404, "Patch not found")
        nodes = await conn.fetch("""
            SELECT pcn.*, n.hostname FROM patch_catalog_nodes pcn
            LEFT JOIN nodes n ON n.node_id = pcn.node_id
            WHERE pcn.patch_id=$1 ORDER BY pcn.detected_at DESC
        """, patch_id)
        result = dict(patch)
        result["affected_nodes"] = [dict(n) for n in nodes]
        return result


@router.get("/api/v1/patches/compliance", dependencies=[Depends(verify_api_key)])
async def get_patch_compliance():
    async with get_pool().acquire() as conn:
        total_patches = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog")
        approved = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog WHERE is_approved=true")
        total_node_patches = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog_nodes")
        installed = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog_nodes WHERE status='installed'")
        failed = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog_nodes WHERE status='failed'")
        pending = await conn.fetchval("SELECT COUNT(*) FROM patch_catalog_nodes WHERE status IN ('detected','approved','downloading','installing')")
        compliance_pct = round((installed / total_node_patches * 100), 1) if total_node_patches > 0 else 100.0
        # MTTP - mean time to patch (avg time from detected to installed)
        mttp = await conn.fetchval("""
            SELECT AVG(EXTRACT(EPOCH FROM (installed_at - detected_at))/3600)
            FROM patch_catalog_nodes WHERE status='installed' AND installed_at IS NOT NULL
        """)
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


@router.get("/api/v1/patches/compliance/nodes", dependencies=[Depends(verify_api_key)])
async def get_node_compliance(limit: int = 100, offset: int = 0):
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT pcn.node_id, n.hostname,
                COUNT(*) as total_patches,
                COUNT(CASE WHEN pcn.status='installed' THEN 1 END) as installed,
                COUNT(CASE WHEN pcn.status='failed' THEN 1 END) as failed,
                COUNT(CASE WHEN pcn.status IN ('detected','approved','downloading','installing') THEN 1 END) as pending
            FROM patch_catalog_nodes pcn
            LEFT JOIN nodes n ON n.node_id = pcn.node_id
            GROUP BY pcn.node_id, n.hostname
            ORDER BY pending DESC
            LIMIT $1 OFFSET $2
        """, limit, offset)
        return {"items": [dict(r) for r in rows]}


@router.get("/api/v1/patches/rings", dependencies=[Depends(verify_api_key)])
async def list_patch_rings():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM patch_rings ORDER BY priority")
        return [dict(r) for r in rows]


@router.post("/api/v1/patches/rings", dependencies=[Depends(verify_api_key)])
async def create_patch_ring(data: dict):
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO patch_rings (name, description, priority, delay_hours, node_group_id)
            VALUES ($1,$2,$3,$4,$5) RETURNING *
        """, data.get("name"), data.get("description"), data.get("priority",0),
            data.get("delay_hours",0), data.get("node_group_id"))
        return dict(row)


@router.put("/api/v1/patches/rings/{ring_id}", dependencies=[Depends(verify_api_key)])
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


@router.delete("/api/v1/patches/rings/{ring_id}", dependencies=[Depends(verify_api_key)])
async def delete_patch_ring(ring_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM patch_rings WHERE id=$1", ring_id)
        return {"deleted": True}


@router.get("/api/v1/patches/deployments", dependencies=[Depends(verify_api_key)])
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


@router.post("/api/v1/patches/deployments", dependencies=[Depends(verify_api_key)])
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


@router.get("/api/v1/patches/deployments/{deployment_id}", dependencies=[Depends(verify_api_key)])
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


@router.post("/api/v1/patches/deployments/{deployment_id}/pause", dependencies=[Depends(verify_api_key)])
async def pause_patch_deployment(deployment_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_deployments SET status='paused' WHERE id=$1 AND status='in_progress'", deployment_id)
        return {"status": "paused"}


@router.post("/api/v1/patches/deployments/{deployment_id}/resume", dependencies=[Depends(verify_api_key)])
async def resume_patch_deployment(deployment_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_deployments SET status='in_progress' WHERE id=$1 AND status='paused'", deployment_id)
        return {"status": "in_progress"}


@router.post("/api/v1/patches/deployments/{deployment_id}/cancel", dependencies=[Depends(verify_api_key)])
async def cancel_patch_deployment(deployment_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("UPDATE patch_deployments SET status='cancelled', completed_at=NOW() WHERE id=$1", deployment_id)
        await conn.execute("UPDATE patch_deployment_results SET status='excluded' WHERE deployment_id=$1 AND status='pending'", deployment_id)
        return {"status": "cancelled"}


@router.post("/api/v1/patches/scan-results")
async def submit_patch_scan_results(data: dict):
    """Agent submits available Windows Updates. Same as import but explicit agent endpoint."""
    return await import_patches(data)


@router.get("/api/v1/patches/pending/{node_id}")
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


@router.post("/api/v1/patches/results")
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
