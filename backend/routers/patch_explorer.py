"""
E42 – Patch Explorer API
Browse nodes by OS, view available updates per node, search, deploy.
"""
import json
import uuid as _uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from dependencies import get_pool, verify_api_key

router = APIRouter(tags=["Patch Explorer"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _node_status(total_updates: int, critical_count: int) -> str:
    if critical_count > 0:
        return "critical"
    if total_updates > 3:
        return "outdated"
    if total_updates > 0:
        return "update"
    return "current"


def _os_icon(os_name: str) -> str:
    if not os_name:
        return "linux"
    low = os_name.lower()
    if "windows" in low:
        return "windows"
    if "ubuntu" in low or "debian" in low or "linux" in low:
        return "linux"
    if "macos" in low or "darwin" in low:
        return "apple"
    return "linux"


# ---------------------------------------------------------------------------
# 1. GET /api/v1/patches/explorer/tree
# ---------------------------------------------------------------------------

@router.get("/api/v1/patches/explorer/tree", dependencies=[Depends(verify_api_key)])
async def explorer_tree():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                COALESCE(n.os_name, 'Unknown') AS os_name,
                COUNT(DISTINCT n.id) AS node_count,
                COUNT(u.id) AS total_updates,
                COUNT(u.id) FILTER (WHERE u.severity IN ('critical','important')) AS critical_count
            FROM nodes n
            LEFT JOIN node_available_updates u ON u.node_id = n.id
            GROUP BY COALESCE(n.os_name, 'Unknown')
            ORDER BY os_name
        """)
        groups = []
        summary = {"total_nodes": 0, "total_updates": 0, "critical": 0, "outdated": 0, "update": 0, "current": 0}
        for r in rows:
            st = _node_status(r["total_updates"], r["critical_count"])
            groups.append({
                "os_name": r["os_name"],
                "os_icon": _os_icon(r["os_name"]),
                "node_count": r["node_count"],
                "total_updates": r["total_updates"],
                "critical_count": r["critical_count"],
                "status": st,
            })
            summary["total_nodes"] += r["node_count"]
            summary["total_updates"] += r["total_updates"]
            summary[st] += 1
        return {"groups": groups, "summary": summary}


# ---------------------------------------------------------------------------
# 2. GET /api/v1/patches/explorer/nodes
# ---------------------------------------------------------------------------

@router.get("/api/v1/patches/explorer/nodes", dependencies=[Depends(verify_api_key)])
async def explorer_nodes(os: str = Query(...)):
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                n.id, n.hostname, n.os_name, n.os_version, n.is_online,
                n.last_seen, n.agent_version,
                COUNT(u.id) AS update_count,
                COUNT(u.id) FILTER (WHERE u.severity IN ('critical','important')) AS critical_count
            FROM nodes n
            LEFT JOIN node_available_updates u ON u.node_id = n.id
            WHERE COALESCE(n.os_name, 'Unknown') = $1
            GROUP BY n.id
            ORDER BY n.hostname
        """, os)
        nodes = []
        for r in rows:
            nodes.append({
                "id": str(r["id"]),
                "hostname": r["hostname"],
                "os_name": r["os_name"],
                "os_version": r["os_version"],
                "is_online": r["is_online"],
                "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
                "agent_version": r["agent_version"],
                "update_count": r["update_count"],
                "critical_count": r["critical_count"],
                "status": _node_status(r["update_count"], r["critical_count"]),
            })
        return {"nodes": nodes}


# ---------------------------------------------------------------------------
# 3. GET /api/v1/patches/explorer/node/{node_id}/software
# ---------------------------------------------------------------------------

@router.get("/api/v1/patches/explorer/node/{node_id}/software", dependencies=[Depends(verify_api_key)])
async def explorer_node_software(node_id: str):
    async with get_pool().acquire() as conn:
        # All software for this node, left-joined with available updates and CVEs
        rows = await conn.fetch("""
            SELECT
                sc.id,
                sc.name,
                sc.publisher,
                sc.version AS installed_version,
                u.available_version,
                u.title AS update_title,
                u.kb_id,
                u.severity AS update_severity,
                u.source,
                u.is_reboot_required,
                (SELECT COUNT(*) FROM node_vulnerabilities nv
                 JOIN vulnerabilities v ON v.id = nv.vulnerability_id
                 WHERE nv.node_id = sc.node_id::text AND LOWER(v.software_name) = LOWER(sc.name)) AS cve_count
            FROM software_current sc
            LEFT JOIN node_available_updates u
                ON u.node_id = sc.node_id AND LOWER(u.software_name) = LOWER(sc.name)
            WHERE sc.node_id = $1::uuid
            ORDER BY
                CASE WHEN u.id IS NOT NULL THEN 0 ELSE 1 END,
                u.severity = 'critical' DESC,
                sc.name
        """, node_id)

        # Also include updates that have no matching software_current row
        orphan_updates = await conn.fetch("""
            SELECT
                u.id, u.title AS name, u.source AS publisher,
                NULL AS installed_version, NULL AS available_version,
                u.title AS update_title, u.kb_id, u.severity AS update_severity,
                u.source, u.is_reboot_required, 0 AS cve_count
            FROM node_available_updates u
            WHERE u.node_id = $1::uuid AND u.software_name IS NULL
        """, node_id)

        software = []
        for r in list(rows) + list(orphan_updates):
            has_update = r["update_title"] is not None
            sev = r["update_severity"] or "unknown"
            cves = r["cve_count"]
            if not has_update:
                st = "current"
            elif sev in ("critical", "important") and cves > 0:
                st = "critical"
            elif has_update and sev in ("critical", "important"):
                st = "outdated"
            else:
                st = "update"
            software.append({
                "id": str(r["id"]),
                "name": r["name"],
                "publisher": r["publisher"],
                "installed_version": r["installed_version"],
                "available_version": r["available_version"],
                "update_title": r["update_title"],
                "kb_id": r["kb_id"],
                "severity": sev,
                "source": r["source"],
                "is_reboot_required": r["is_reboot_required"] or False,
                "status": st,
                "cve_count": cves,
            })
        return {"software": software}


# ---------------------------------------------------------------------------
# 4. GET /api/v1/patches/explorer/search
# ---------------------------------------------------------------------------

@router.get("/api/v1/patches/explorer/search", dependencies=[Depends(verify_api_key)])
async def explorer_search(q: str = Query(..., min_length=1)):
    async with get_pool().acquire() as conn:
        pattern = f"%{q}%"
        results = []

        # Nodes
        nodes = await conn.fetch(
            "SELECT id, hostname, os_name FROM nodes WHERE hostname ILIKE $1 OR os_name ILIKE $1 LIMIT 10",
            pattern)
        for n in nodes:
            results.append({"type": "node", "id": str(n["id"]), "hostname": n["hostname"],
                            "os_name": n["os_name"], "match": n["hostname"]})

        # Software
        sw = await conn.fetch("""
            SELECT sc.node_id, n.hostname, sc.name, sc.version
            FROM software_current sc JOIN nodes n ON n.id = sc.node_id
            WHERE sc.name ILIKE $1 LIMIT 15
        """, pattern)
        for s in sw:
            results.append({"type": "software", "node_id": str(s["node_id"]), "hostname": s["hostname"],
                            "name": s["name"], "version": s["version"], "match": s["name"]})

        # Updates
        ups = await conn.fetch("""
            SELECT u.node_id, n.hostname, u.kb_id, u.title
            FROM node_available_updates u JOIN nodes n ON n.id = u.node_id
            WHERE u.kb_id ILIKE $1 OR u.title ILIKE $1 LIMIT 15
        """, pattern)
        for u in ups:
            results.append({"type": "update", "node_id": str(u["node_id"]), "hostname": u["hostname"],
                            "kb_id": u["kb_id"], "title": u["title"], "match": u["kb_id"] or u["title"]})

        return {"results": results}


# ---------------------------------------------------------------------------
# 5. GET /api/v1/patches/explorer/stats
# ---------------------------------------------------------------------------

@router.get("/api/v1/patches/explorer/stats", dependencies=[Depends(verify_api_key)])
async def explorer_stats():
    async with get_pool().acquire() as conn:
        total_nodes = await conn.fetchval("SELECT COUNT(*) FROM nodes")
        total_updates = await conn.fetchval("SELECT COUNT(*) FROM node_available_updates")
        critical = await conn.fetchval("SELECT COUNT(*) FROM node_available_updates WHERE severity = 'critical'")
        important = await conn.fetchval("SELECT COUNT(*) FROM node_available_updates WHERE severity = 'important'")
        reboot_required = await conn.fetchval("SELECT COUNT(*) FROM node_available_updates WHERE is_reboot_required")
        nodes_with_updates = await conn.fetchval("SELECT COUNT(DISTINCT node_id) FROM node_available_updates")
        by_source = await conn.fetch(
            "SELECT source, COUNT(*) AS cnt FROM node_available_updates GROUP BY source ORDER BY cnt DESC")
        by_severity = await conn.fetch(
            "SELECT severity, COUNT(*) AS cnt FROM node_available_updates GROUP BY severity ORDER BY cnt DESC")
        return {
            "total_nodes": total_nodes,
            "total_updates": total_updates,
            "nodes_with_updates": nodes_with_updates,
            "critical": critical,
            "important": important,
            "reboot_required": reboot_required,
            "by_source": {r["source"]: r["cnt"] for r in by_source},
            "by_severity": {r["severity"]: r["cnt"] for r in by_severity},
        }


# ---------------------------------------------------------------------------
# 6. POST /api/v1/patches/explorer/deploy
# ---------------------------------------------------------------------------

class DeployUpdate(BaseModel):
    node_id: str
    update_id: str
    kb_id: Optional[str] = None
    source: str = "windows_update"

class DeployRequest(BaseModel):
    updates: List[DeployUpdate]
    reboot_policy: str = "no_reboot"
    name: str = "Patch Explorer Deployment"

@router.post("/api/v1/patches/explorer/deploy", dependencies=[Depends(verify_api_key)])
async def explorer_deploy(data: DeployRequest, request: Request):
    user = getattr(request.state, "user", None)
    username = user.get("username", "system") if user else "system"

    async with get_pool().acquire() as conn:
        async with conn.transaction():
            # Create deployment
            dep = await conn.fetchrow("""
                INSERT INTO patch_deployments (name, patches, reboot_policy, created_by)
                VALUES ($1, '{}'::uuid[], $2, $3) RETURNING *
            """, data.name, data.reboot_policy, username)
            deployment_id = dep["id"]

            # Collect unique node IDs
            node_ids = list({u.node_id for u in data.updates})

            # Create deployment results
            for u in data.updates:
                # patch_id is UUID — use a dummy from patch_catalog or NULL workaround
                # Since our updates may not map to patch_catalog, store update info in deployment results
                await conn.execute("""
                    INSERT INTO patch_deployment_results (deployment_id, node_id, patch_id, status)
                    VALUES ($1, $2, NULL, 'pending')
                """, deployment_id, u.node_id)

            # Resolve KB IDs from node_available_updates table
            update_ids = [u.update_id for u in data.updates]
            kb_rows = await conn.fetch("""
                SELECT DISTINCT kb_id FROM node_available_updates
                WHERE id = ANY($1::text[]) AND kb_id IS NOT NULL AND kb_id != ''
            """, update_ids)
            kb_ids = [r["kb_id"] for r in kb_rows]

            # Also use kb_ids directly from request as fallback
            for u in data.updates:
                if u.kb_id and u.kb_id not in kb_ids:
                    kb_ids.append(u.kb_id)

            # Create one job per node (agent expects kb_ids per job)
            job_ids = []
            for nid in node_ids:
                job_uuid = _uuid.uuid4()
                node_updates = [u for u in data.updates if u.node_id == nid]
                node_kb_ids = []
                for u in node_updates:
                    if u.kb_id:
                        node_kb_ids.append(u.kb_id)
                # Resolve from DB if not in request
                if not node_kb_ids:
                    nk_rows = await conn.fetch("""
                        SELECT DISTINCT kb_id FROM node_available_updates
                        WHERE id = ANY($1::text[]) AND kb_id IS NOT NULL AND kb_id != ''
                    """, [u.update_id for u in node_updates])
                    node_kb_ids = [r["kb_id"] for r in nk_rows]

                await conn.execute("""
                    INSERT INTO jobs (id, name, description, target_type, command_type, command_data, created_by)
                    VALUES ($1, $2, $3, 'device', 'patch_install', $4::jsonb, $5)
                """, job_uuid, data.name,
                    f"Patch Explorer: {len(node_kb_ids)} updates for {nid}",
                    json.dumps({"kb_ids": node_kb_ids, "reboot_policy": data.reboot_policy,
                                "deployment_id": str(deployment_id)}),
                    username)


                # Resolve node UUID for job_instances
                await conn.execute("""
                    INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
                    VALUES (gen_random_uuid(), $1, $2::uuid, 'pending', NOW())
                """, job_uuid, nid)
                job_ids.append(str(job_uuid))

            return {"deployment_id": str(deployment_id), "job_ids": job_ids,
                    "message": f"Deployment created with {len(data.updates)} updates on {len(node_ids)} nodes",
                    "updates_count": len(data.updates), "nodes_count": len(node_ids)}


# ---------------------------------------------------------------------------
# 7. POST /api/v1/patches/explorer/agent-updates  (no auth — agent endpoint)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 8. GET /api/v1/patches/explorer/by-update
# ---------------------------------------------------------------------------

@router.get("/api/v1/patches/explorer/by-update", dependencies=[Depends(verify_api_key)])
async def explorer_by_update():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT u.title, u.kb_id, u.severity, u.category, u.source, u.is_reboot_required,
                   n.id AS node_id, n.hostname, n.os_name, n.is_online,
                   u.installed_version, u.available_version
            FROM node_available_updates u
            JOIN nodes n ON n.id = u.node_id
            ORDER BY
              CASE u.severity WHEN 'critical' THEN 0 WHEN 'important' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
              u.title, n.hostname
        """)

        from collections import OrderedDict
        grouped: OrderedDict[tuple, dict] = OrderedDict()
        node_ids_all = set()

        for r in rows:
            key = (r["title"], r["kb_id"])
            if key not in grouped:
                grouped[key] = {
                    "key": r["kb_id"] or f"update-{len(grouped)}",
                    "title": r["title"],
                    "kb_id": r["kb_id"],
                    "severity": r["severity"],
                    "category": r["category"],
                    "source": r["source"],
                    "is_reboot_required": r["is_reboot_required"] or False,
                    "nodes": [],
                }
            grouped[key]["nodes"].append({
                "node_id": str(r["node_id"]),
                "hostname": r["hostname"],
                "os_name": r["os_name"],
                "is_online": r["is_online"],
                "installed_version": r["installed_version"],
                "available_version": r["available_version"],
            })
            node_ids_all.add(str(r["node_id"]))

        updates = []
        severity_counts = {"critical": 0, "important": 0, "moderate": 0, "low": 0}
        for g in grouped.values():
            g["node_count"] = len(g["nodes"])
            updates.append(g)
            sev = (g["severity"] or "low").lower()
            if sev in severity_counts:
                severity_counts[sev] += 1
            else:
                severity_counts["low"] += 1

        return {
            "updates": updates,
            "summary": {
                "total_updates": len(updates),
                "total_affected_nodes": len(node_ids_all),
                **severity_counts,
            },
        }


# ---------------------------------------------------------------------------
# 9. GET /api/v1/patches/explorer/deployment-status/{deployment_id}
# ---------------------------------------------------------------------------

@router.get("/api/v1/patches/explorer/deployment-status/{deployment_id}", dependencies=[Depends(verify_api_key)])
async def explorer_deployment_status(deployment_id: str):
    async with get_pool().acquire() as conn:
        dep = await conn.fetchrow(
            "SELECT id, name, created_at FROM patch_deployments WHERE id = $1::uuid", deployment_id)
        if not dep:
            return {"error": "Deployment not found"}

        results = await conn.fetch("""
            SELECT pdr.node_id, pdr.status, pdr.started_at, pdr.completed_at, pdr.error_message,
                   n.hostname
            FROM patch_deployment_results pdr
            LEFT JOIN nodes n ON n.id::text = pdr.node_id
            WHERE pdr.deployment_id = $1::uuid
        """, deployment_id)

        # Check associated job status
        job = await conn.fetchrow("""
            SELECT j.id, j.status FROM jobs j
            WHERE j.command_data::jsonb->>'deployment_id' = $1
            ORDER BY j.created_at DESC LIMIT 1
        """, deployment_id)

        total = len(results)
        completed = sum(1 for r in results if r["status"] in ("installed", "completed"))
        failed = sum(1 for r in results if r["status"] == "failed")
        pending = total - completed - failed

        overall = "completed" if pending == 0 and failed == 0 else "failed" if pending == 0 and failed > 0 else "running" if completed > 0 or failed > 0 else "pending"
        if job and job["status"]:
            js = job["status"].lower()
            if js in ("completed", "failed"):
                overall = js

        return {
            "deployment_id": deployment_id,
            "name": dep["name"],
            "status": overall,
            "progress": {
                "total": total,
                "completed": completed,
                "failed": failed,
                "pending": pending,
            },
            "results": [
                {
                    "node_id": r["node_id"],
                    "hostname": r["hostname"],
                    "status": r["status"],
                    "started_at": r["started_at"].isoformat() if r["started_at"] else None,
                    "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                    "error_message": r["error_message"],
                }
                for r in results
            ],
        }


class AgentUpdate(BaseModel):
    kb_id: Optional[str] = None
    title: str
    software_name: Optional[str] = None
    installed_version: Optional[str] = None
    available_version: Optional[str] = None
    severity: str = "unknown"
    category: str = "update"
    source: str = "windows_update"
    is_reboot_required: bool = False

class AgentUpdatesPayload(BaseModel):
    hostname: str
    updates: List[AgentUpdate]

@router.post("/api/v1/patches/explorer/agent-updates")
async def agent_submit_updates(data: AgentUpdatesPayload):
    async with get_pool().acquire() as conn:
        # Resolve hostname → node UUID
        node = await conn.fetchrow(
            "SELECT id FROM nodes WHERE LOWER(hostname) = LOWER($1)", data.hostname)
        if not node:
            return {"status": "error", "message": f"Unknown hostname: {data.hostname}"}

        node_id = node["id"]

        # Clear old updates for this node then insert fresh
        await conn.execute("DELETE FROM node_available_updates WHERE node_id = $1", node_id)

        inserted = 0
        for u in data.updates:
            await conn.execute("""
                INSERT INTO node_available_updates
                    (node_id, kb_id, title, software_name, installed_version,
                     available_version, severity, category, source, is_reboot_required)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (node_id, kb_id, software_name) DO UPDATE SET
                    title = EXCLUDED.title,
                    installed_version = EXCLUDED.installed_version,
                    available_version = EXCLUDED.available_version,
                    severity = EXCLUDED.severity,
                    category = EXCLUDED.category,
                    source = EXCLUDED.source,
                    is_reboot_required = EXCLUDED.is_reboot_required,
                    discovered_at = NOW()
            """, node_id, u.kb_id, u.title, u.software_name,
                u.installed_version, u.available_version,
                u.severity, u.category, u.source, u.is_reboot_required)
            inserted += 1

        return {"status": "ok", "node_id": str(node_id), "updates_received": inserted}


# 8. POST /api/v1/patches/explorer/scan — Trigger on-demand patch scan on nodes
# ---------------------------------------------------------------------------

@router.post("/api/v1/patches/explorer/scan", dependencies=[Depends(verify_api_key)])
async def trigger_patch_scan(data: dict, request: Request):
    """Create patch_scan jobs for specified nodes."""
    user = getattr(request.state, "user", None)
    username = user.get("username", "system") if user else "system"
    node_ids = data.get("node_ids", [])

    if not node_ids:
        return {"error": "No node_ids specified"}, 400

    async with get_pool().acquire() as conn:
        job_ids = []
        for nid in node_ids:
            job_uuid = _uuid.uuid4()
            await conn.execute("""
                INSERT INTO jobs (id, name, description, target_type, command_type, command_data, created_by)
                VALUES ($1, $2, $3, 'device', 'patch_scan', '{}'::jsonb, $4)
            """, job_uuid, "Patch Scan", "On-demand patch scan", username)
            await conn.execute("""
                INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
                VALUES (gen_random_uuid(), $1, $2::uuid, 'pending', NOW())
            """, job_uuid, nid)
            job_ids.append(str(job_uuid))

        return {"message": f"Scan triggered on {len(node_ids)} nodes", "job_ids": job_ids}
