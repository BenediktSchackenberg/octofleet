"""
Octofleet API - Monitoring Routes
"""
import json
from typing import Any, Dict

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request

from dependencies import get_db, get_pool, verify_api_key

router = APIRouter(tags=["Monitoring"])
def _compute_posture_diff(baseline: dict, current: dict) -> dict:
    """Compute structured diff between two posture snapshots"""
    changes = []
    
    # OS info changes
    b_os = baseline.get("osInfo") or {}
    c_os = current.get("osInfo") or {}
    if isinstance(b_os, str):
        try: b_os = json.loads(b_os)
        except: b_os = {}
    if isinstance(c_os, str):
        try: c_os = json.loads(c_os)
        except: c_os = {}
    for key in set(list(b_os.keys()) + list(c_os.keys())):
        if b_os.get(key) != c_os.get(key):
            changes.append({"category": "os", "field": key, "old": b_os.get(key), "new": c_os.get(key), "severity": "medium"})
    
    # Installed packages diff
    b_pkgs = set()
    c_pkgs = set()
    b_pkg_list = baseline.get("installedPackages") or []
    c_pkg_list = current.get("installedPackages") or []
    if isinstance(b_pkg_list, str):
        try: b_pkg_list = json.loads(b_pkg_list)
        except: b_pkg_list = []
    if isinstance(c_pkg_list, str):
        try: c_pkg_list = json.loads(c_pkg_list)
        except: c_pkg_list = []
    for p in b_pkg_list:
        name = p.get("name", p) if isinstance(p, dict) else str(p)
        b_pkgs.add(name)
    for p in c_pkg_list:
        name = p.get("name", p) if isinstance(p, dict) else str(p)
        c_pkgs.add(name)
    
    for pkg in c_pkgs - b_pkgs:
        changes.append({"category": "packages", "change": "added", "name": pkg, "severity": "low"})
    for pkg in b_pkgs - c_pkgs:
        changes.append({"category": "packages", "change": "removed", "name": pkg, "severity": "medium"})
    
    # Services diff
    b_svcs = set()
    c_svcs = set()
    b_svc_list = baseline.get("runningServices") or []
    c_svc_list = current.get("runningServices") or []
    if isinstance(b_svc_list, str):
        try: b_svc_list = json.loads(b_svc_list)
        except: b_svc_list = []
    if isinstance(c_svc_list, str):
        try: c_svc_list = json.loads(c_svc_list)
        except: c_svc_list = []
    for s in b_svc_list:
        name = s.get("name", s) if isinstance(s, dict) else str(s)
        b_svcs.add(name)
    for s in c_svc_list:
        name = s.get("name", s) if isinstance(s, dict) else str(s)
        c_svcs.add(name)
    
    for svc in c_svcs - b_svcs:
        changes.append({"category": "services", "change": "started", "name": svc, "severity": "low"})
    for svc in b_svcs - c_svcs:
        changes.append({"category": "services", "change": "stopped", "name": svc, "severity": "medium"})
    
    # Config setting changes (SSH, RDP, SMB, firewall, local admins)
    b_cfg = baseline.get("configSettings") or {}
    c_cfg = current.get("configSettings") or {}
    if isinstance(b_cfg, str):
        try: b_cfg = json.loads(b_cfg)
        except: b_cfg = {}
    if isinstance(c_cfg, str):
        try: c_cfg = json.loads(c_cfg)
        except: c_cfg = {}
    
    security_critical = {"rdpEnabled", "sshEnabled", "firewallEnabled", "guestAccount", "autoLogin"}
    for key in set(list(b_cfg.keys()) + list(c_cfg.keys())):
        if b_cfg.get(key) != c_cfg.get(key):
            sev = "high" if key in security_critical else "medium"
            changes.append({"category": "config", "field": key, "old": b_cfg.get(key), "new": c_cfg.get(key), "severity": sev})
    
    # Open ports diff
    b_ports = set()
    c_ports = set()
    b_port_list = baseline.get("openPorts") or []
    c_port_list = current.get("openPorts") or []
    if isinstance(b_port_list, str):
        try: b_port_list = json.loads(b_port_list)
        except: b_port_list = []
    if isinstance(c_port_list, str):
        try: c_port_list = json.loads(c_port_list)
        except: c_port_list = []
    for p in b_port_list:
        port_key = f"{p.get('port','?')}/{p.get('protocol','tcp')}" if isinstance(p, dict) else str(p)
        b_ports.add(port_key)
    for p in c_port_list:
        port_key = f"{p.get('port','?')}/{p.get('protocol','tcp')}" if isinstance(p, dict) else str(p)
        c_ports.add(port_key)
    
    for port in c_ports - b_ports:
        changes.append({"category": "ports", "change": "opened", "port": port, "severity": "high"})
    for port in b_ports - c_ports:
        changes.append({"category": "ports", "change": "closed", "port": port, "severity": "info"})
    
    return {"changes": changes, "totalChanges": len(changes)}




@router.delete("/api/v1/detection-rules/{rule_id}")
async def delete_detection_rule(rule_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a detection rule"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM detection_rules WHERE id = $1 RETURNING id", rule_id)
        if not row:
            raise HTTPException(status_code=404, detail="Rule not found")
        return {"status": "deleted"}


def _parse_json_fields(d: dict, fields: tuple = ("sensors", "permissions", "sampling", "include_paths", "exclude_paths")) -> dict:
    """Parse JSON string fields that asyncpg may return as text."""
    import json as _json
    for f in fields:
        if isinstance(d.get(f), str):
            try:
                d[f] = _json.loads(d[f])
            except (ValueError, TypeError):
                pass
    return d


@router.get("/api/v1/monitoring/profiles", dependencies=[Depends(verify_api_key)])
async def list_monitoring_profiles():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM monitoring_profiles ORDER BY created_at DESC")
        return {"profiles": [_parse_json_fields(dict(r)) for r in rows]}


@router.get("/api/v1/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def get_monitoring_profile(profile_id: str):
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM monitoring_profiles WHERE id = $1::uuid", profile_id)
        if not row:
            raise HTTPException(status_code=404, detail="Profile not found")
        return _parse_json_fields(dict(row))


@router.post("/api/v1/monitoring/profiles", dependencies=[Depends(verify_api_key)])
async def create_monitoring_profile(req: Request):
    body = await req.json()
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO monitoring_profiles (name, description, sensors, sampling, include_paths, exclude_paths, created_by)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
            RETURNING *
        """, body.get("name", "Default"), body.get("description"),
            json.dumps(body.get("sensors", {})), json.dumps(body.get("sampling", {})),
            json.dumps(body.get("include_paths", [])), json.dumps(body.get("exclude_paths", [])),
            body.get("created_by"))
        return _parse_json_fields(dict(row))


@router.put("/api/v1/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def update_monitoring_profile(profile_id: str, req: Request):
    body = await req.json()
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE monitoring_profiles SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                sensors = COALESCE($4::jsonb, sensors),
                sampling = COALESCE($5::jsonb, sampling),
                include_paths = COALESCE($6::jsonb, include_paths),
                exclude_paths = COALESCE($7::jsonb, exclude_paths),
                version = version + 1,
                updated_at = now()
            WHERE id = $1::uuid RETURNING *
        """, profile_id, body.get("name"), body.get("description"),
            json.dumps(body.get("sensors")) if "sensors" in body else None,
            json.dumps(body.get("sampling")) if "sampling" in body else None,
            json.dumps(body.get("include_paths")) if "include_paths" in body else None,
            json.dumps(body.get("exclude_paths")) if "exclude_paths" in body else None)
        if not row:
            raise HTTPException(status_code=404, detail="Profile not found")
        return _parse_json_fields(dict(row))


@router.delete("/api/v1/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def delete_monitoring_profile(profile_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM monitoring_profiles WHERE id = $1::uuid", profile_id)
        return {"status": "deleted"}


@router.get("/api/v1/monitoring/assignments", dependencies=[Depends(verify_api_key)])
async def list_monitoring_assignments():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT a.*, p.name as profile_name
            FROM monitoring_assignments a
            LEFT JOIN monitoring_profiles p ON p.id = a.profile_id
            ORDER BY a.priority DESC, a.created_at DESC
        """)
        return {"assignments": [dict(r) for r in rows]}


@router.post("/api/v1/monitoring/assignments", dependencies=[Depends(verify_api_key)])
async def create_monitoring_assignment(req: Request):
    body = await req.json()
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO monitoring_assignments (target_type, target_id, profile_id, priority, status, start_time, end_time)
            VALUES ($1, $2, $3::uuid, $4, $5, $6, $7)
            RETURNING *
        """, body["target_type"], body["target_id"], body["profile_id"],
            body.get("priority", 0), body.get("status", "active"),
            body.get("start_time"), body.get("end_time"))
        return dict(row)


@router.put("/api/v1/monitoring/assignments/{assignment_id}", dependencies=[Depends(verify_api_key)])
async def update_monitoring_assignment(assignment_id: str, req: Request):
    body = await req.json()
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE monitoring_assignments SET
                status = COALESCE($2, status),
                priority = COALESCE($3, priority),
                end_time = COALESCE($4, end_time),
                updated_at = now()
            WHERE id = $1::uuid RETURNING *
        """, assignment_id, body.get("status"), body.get("priority"), body.get("end_time"))
        if not row:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return dict(row)


@router.delete("/api/v1/monitoring/assignments/{assignment_id}", dependencies=[Depends(verify_api_key)])
async def delete_monitoring_assignment(assignment_id: str):
    async with get_pool().acquire() as conn:
        await conn.execute("DELETE FROM monitoring_assignments WHERE id = $1::uuid", assignment_id)
        return {"status": "deleted"}


@router.get("/api/v1/monitoring/nodes/{node_id}/effective-policy", dependencies=[Depends(verify_api_key)])
async def get_effective_policy(node_id: str):
    async with get_pool().acquire() as conn:
        # Resolve hostname to UUID if needed
        resolved_id = node_id
        uuid_row = await conn.fetchval("SELECT id::text FROM nodes WHERE hostname = $1", node_id)
        if uuid_row:
            resolved_id = str(uuid_row)
        # Also try: node_id might already be a UUID
        if not uuid_row:
            uuid_row2 = await conn.fetchval("SELECT id::text FROM nodes WHERE id::text = $1", node_id)
            if uuid_row2:
                resolved_id = str(uuid_row2)
        # Check direct node assignment — match both hostname and UUID
        candidates = [node_id, resolved_id]
        row = await conn.fetchrow("""
            SELECT a.*, p.name as profile_name, p.sensors, p.sampling, p.include_paths, p.exclude_paths
            FROM monitoring_assignments a
            JOIN monitoring_profiles p ON p.id = a.profile_id
            WHERE a.target_type = 'node' AND a.target_id = ANY($1::text[]) AND a.status = 'active'
                AND (a.end_time IS NULL OR a.end_time > now())
            ORDER BY a.priority DESC LIMIT 1
        """, candidates)
        if not row:
            # Fallback to group assignments
            row = await conn.fetchrow("""
                SELECT a.*, p.name as profile_name, p.sensors, p.sampling, p.include_paths, p.exclude_paths
                FROM monitoring_assignments a
                JOIN monitoring_profiles p ON p.id = a.profile_id
                JOIN device_groups dg ON dg.group_id = a.target_id::uuid
                WHERE a.target_type = 'group' AND dg.node_id::text = ANY($1::text[]) AND a.status = 'active'
                    AND (a.end_time IS NULL OR a.end_time > now())
                ORDER BY a.priority DESC LIMIT 1
            """, candidates)
        if not row:
            return {"policy": None, "message": "No monitoring policy assigned"}
        return {"policy": _parse_json_fields(dict(row))}


@router.post("/api/v1/ingest/events", dependencies=[Depends(verify_api_key)])
async def ingest_events(req: Request):
    body = await req.json()
    events = body.get("events", [body] if "event_type" in body else [])
    inserted = 0
    async with get_pool().acquire() as conn:
        for evt in events:
            event_type = evt.get("event_type", "unknown")
            # Route file events to file_events table
            if event_type.startswith("file."):
                await conn.execute("""
                    INSERT INTO file_events (node_id, user_id, op, path, old_path, new_path, process_name, pid, hash_before, hash_after, file_size, success)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """, evt.get("node_id"), evt.get("user_id"), evt.get("op", event_type),
                    evt.get("path"), evt.get("old_path"), evt.get("new_path"),
                    evt.get("process_name"), evt.get("pid"),
                    evt.get("hash_before"), evt.get("hash_after"),
                    evt.get("file_size"), evt.get("success", True))
            else:
                await conn.execute("""
                    INSERT INTO events_normalized (node_id, user_id, event_type, severity, payload)
                    VALUES ($1, $2, $3, $4, $5::jsonb)
                """, evt.get("node_id"), evt.get("user_id"), event_type,
                    evt.get("severity", "info"), json.dumps(evt.get("payload", {})))
            inserted += 1
    return {"inserted": inserted}


@router.get("/api/v1/events", dependencies=[Depends(verify_api_key)])
async def query_events(
    node_id: str = None, user_id: str = None, event_type: str = None,
    severity: str = None, since: str = None, until: str = None,
    limit: int = 100, offset: int = 0
):
    async with get_pool().acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if node_id:
            conditions.append(f"node_id = ${idx}")
            params.append(node_id); idx += 1
        if user_id:
            conditions.append(f"user_id = ${idx}")
            params.append(user_id); idx += 1
        if event_type:
            conditions.append(f"event_type = ${idx}")
            params.append(event_type); idx += 1
        if severity:
            conditions.append(f"severity = ${idx}")
            params.append(severity); idx += 1
        if since:
            conditions.append(f"ts >= ${idx}::timestamptz")
            params.append(since); idx += 1
        if until:
            conditions.append(f"ts <= ${idx}::timestamptz")
            params.append(until); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM events_normalized {where}
            ORDER BY ts DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        count = await conn.fetchval(f"SELECT count(*) FROM events_normalized {where}", *params[:-2])
        return {"events": [dict(r) for r in rows], "total": count}


@router.get("/api/v1/events/files", dependencies=[Depends(verify_api_key)])
async def query_file_events(
    node_id: str = None, user_id: str = None, op: str = None,
    path: str = None, since: str = None, until: str = None,
    limit: int = 100, offset: int = 0
):
    async with get_pool().acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if node_id:
            conditions.append(f"node_id = ${idx}")
            params.append(node_id); idx += 1
        if user_id:
            conditions.append(f"user_id = ${idx}")
            params.append(user_id); idx += 1
        if op:
            conditions.append(f"op = ${idx}")
            params.append(op); idx += 1
        if path:
            conditions.append(f"path ILIKE ${idx}")
            params.append(f"%{path}%"); idx += 1
        if since:
            conditions.append(f"ts >= ${idx}::timestamptz")
            params.append(since); idx += 1
        if until:
            conditions.append(f"ts <= ${idx}::timestamptz")
            params.append(until); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM file_events {where}
            ORDER BY ts DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        count = await conn.fetchval(f"SELECT count(*) FROM file_events {where}", *params[:-2])
        return {"events": [dict(r) for r in rows], "total": count}


@router.get("/api/v1/findings", dependencies=[Depends(verify_api_key)])
async def list_findings(
    status: str = None, severity: str = None, node_id: str = None,
    limit: int = 50, offset: int = 0
):
    async with get_pool().acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if status:
            conditions.append(f"status = ${idx}")
            params.append(status); idx += 1
        if severity:
            conditions.append(f"severity = ${idx}")
            params.append(severity); idx += 1
        if node_id:
            conditions.append(f"node_id = ${idx}")
            params.append(node_id); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM findings {where}
            ORDER BY score DESC NULLS LAST, last_seen DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        count = await conn.fetchval(f"SELECT count(*) FROM findings {where}", *params[:-2])
        return {"findings": [dict(r) for r in rows], "total": count}


@router.get("/api/v1/findings/{finding_id}", dependencies=[Depends(verify_api_key)])
async def get_finding(finding_id: str):
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM findings WHERE id = $1::uuid", finding_id)
        if not row:
            raise HTTPException(status_code=404, detail="Finding not found")
        return dict(row)


@router.put("/api/v1/findings/{finding_id}", dependencies=[Depends(verify_api_key)])
async def update_finding(finding_id: str, req: Request):
    body = await req.json()
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE findings SET
                status = COALESCE($2, status),
                updated_at = now()
            WHERE id = $1::uuid RETURNING *
        """, finding_id, body.get("status"))
        if not row:
            raise HTTPException(status_code=404, detail="Finding not found")
        return dict(row)


@router.get("/api/v1/retention", dependencies=[Depends(verify_api_key)])
async def get_retention_config():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM retention_config ORDER BY category")
        return {"retention": [dict(r) for r in rows]}


@router.put("/api/v1/retention/{category}", dependencies=[Depends(verify_api_key)])
async def update_retention_config(category: str, req: Request):
    body = await req.json()
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE retention_config SET
                hot_days = COALESCE($2, hot_days),
                warm_days = COALESCE($3, warm_days),
                cold_days = COALESCE($4, cold_days),
                legal_hold = COALESCE($5, legal_hold),
                updated_at = now()
            WHERE category = $1 RETURNING *
        """, category, body.get("hot_days"), body.get("warm_days"),
            body.get("cold_days"), body.get("legal_hold"))
        if not row:
            raise HTTPException(status_code=404, detail="Category not found")
        return dict(row)


@router.get("/api/v1/evidence/exports", dependencies=[Depends(verify_api_key)])
async def list_evidence_exports():
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("SELECT * FROM evidence_exports ORDER BY created_at DESC LIMIT 50")
        return {"exports": [dict(r) for r in rows]}


@router.post("/api/v1/evidence/export", dependencies=[Depends(verify_api_key)])
async def create_evidence_export(req: Request):
    body = await req.json()
    async with get_pool().acquire() as conn:
        # Create export record
        row = await conn.fetchrow("""
            INSERT INTO evidence_exports (scope, filter_criteria, created_by)
            VALUES ($1, $2::jsonb, $3)
            RETURNING *
        """, body.get("scope", "manual"), json.dumps(body.get("filter", {})), body.get("created_by"))
        # Log UI audit event
        await conn.execute("""
            INSERT INTO ui_audit_events (actor_user_id, action, object_type, object_id, details)
            VALUES ($1, 'evidence_export', 'evidence_exports', $2, $3::jsonb)
        """, body.get("created_by", "system"), str(row["id"]), json.dumps({"scope": body.get("scope")}))
        return dict(row)


@router.get("/api/v1/audit/ui-events", dependencies=[Depends(verify_api_key)])
async def query_ui_audit_events(
    actor: str = None, action: str = None, since: str = None,
    limit: int = 100, offset: int = 0
):
    async with get_pool().acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if actor:
            conditions.append(f"actor_user_id = ${idx}")
            params.append(actor); idx += 1
        if action:
            conditions.append(f"action = ${idx}")
            params.append(action); idx += 1
        if since:
            conditions.append(f"ts >= ${idx}::timestamptz")
            params.append(since); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM ui_audit_events {where}
            ORDER BY ts DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        return {"events": [dict(r) for r in rows]}


@router.post("/api/v1/agents/{node_id}/capabilities", dependencies=[Depends(verify_api_key)])
async def report_agent_capabilities(node_id: str, req: Request):
    """Agent reports its capabilities, OS info, and available sensors."""
    body = await req.json()
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO agent_capabilities (node_id, sensors, agent_version, os_type, os_version, kernel_build, permissions, last_seen)
            VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::jsonb, now())
            ON CONFLICT (node_id) DO UPDATE SET
                sensors = EXCLUDED.sensors,
                agent_version = EXCLUDED.agent_version,
                os_type = EXCLUDED.os_type,
                os_version = EXCLUDED.os_version,
                kernel_build = EXCLUDED.kernel_build,
                permissions = EXCLUDED.permissions,
                last_seen = now()
            RETURNING *
        """, node_id, json.dumps(body.get("sensors", {})), body.get("agent_version"),
            body.get("os_type"), body.get("os_version"), body.get("kernel_build"),
            json.dumps(body.get("permissions", {})))
        return dict(row)


@router.get("/api/v1/agents/{node_id}/capabilities", dependencies=[Depends(verify_api_key)])
async def get_agent_capabilities(node_id: str):
    import json as _json
    async with get_pool().acquire() as conn:
        # Try by node_id directly, then resolve hostname→UUID
        row = await conn.fetchrow("SELECT * FROM agent_capabilities WHERE node_id = $1", node_id)
        if not row:
            # Frontend sends UUID but agent registers with hostname — try reverse lookup
            resolved = await conn.fetchval("SELECT hostname FROM nodes WHERE id::text = $1", node_id)
            if resolved:
                row = await conn.fetchrow("SELECT * FROM agent_capabilities WHERE node_id = $1", resolved)
        if not row:
            raise HTTPException(status_code=404, detail="No capabilities reported for this node")
        return _parse_json_fields(dict(row))


@router.get("/api/v1/agents/capabilities", dependencies=[Depends(verify_api_key)])
async def list_agent_capabilities():
    """List all agents with their capabilities and health status."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT ac.*, n.hostname, n.os
            FROM agent_capabilities ac
            LEFT JOIN nodes n ON n.id = ac.node_id OR n.hostname = ac.node_id
            ORDER BY ac.last_seen DESC
        """)
        return {"agents": [_parse_json_fields(dict(r)) for r in rows]}


@router.post("/api/v1/agents/{node_id}/health")
async def report_agent_health(node_id: str, req: Request):
    """Agent reports health metrics: queue depth, drops, CPU overhead, etc."""
    body = await req.json()
    # Store as a normalized event
    async with get_pool().acquire() as conn:
        await conn.execute("""
            INSERT INTO events_normalized (node_id, event_type, severity, payload)
            VALUES ($1, 'agent.health', $2, $3::jsonb)
        """, node_id,
            'warning' if body.get("drop_count", 0) > 100 or body.get("queue_depth", 0) > 1000 else 'info',
            json.dumps(body))
        # Update last_seen
        await conn.execute("""
            UPDATE agent_capabilities SET last_seen = now() WHERE node_id = $1
        """, node_id)
        # Auto-create finding if drops exceed threshold
        if body.get("drop_count", 0) > 100:
            await conn.execute("""
                INSERT INTO findings (type, title, description, severity, score, node_id)
                VALUES ('agent_health', 'High event drop count', $1, 'medium', $2, $3)
            """, f"Agent on {node_id} dropped {body['drop_count']} events. Queue depth: {body.get('queue_depth', 'unknown')}",
                min(body["drop_count"] / 10, 100), node_id)
        return {"status": "ok"}


@router.post("/api/v1/ingest/events/normalized", dependencies=[Depends(verify_api_key)])
async def ingest_normalized_events(req: Request):
    """Batch ingest with full normalized schema support.
    
    Accepts events with rich structure: user{}, process{}, file{}, network{} sub-objects.
    Flattens into events_normalized or file_events based on event_type.
    """
    body = await req.json()
    events = body.get("events", [body] if "event_type" in body else [])
    inserted = 0
    findings_created = 0
    
    async with get_pool().acquire() as conn:
        for evt in events:
            event_type = evt.get("event_type", "unknown")
            event_subtype = evt.get("event_subtype", "")
            node_id = evt.get("node_id")
            
            # Extract user info
            user = evt.get("user", {})
            user_id = user.get("username") or user.get("sid") or user.get("uid") or evt.get("user_id")
            
            # Build enriched payload (keep process, network, raw_event_ref)
            payload = {}
            for key in ("process", "network", "user", "raw_event_ref", "metadata"):
                if key in evt:
                    payload[key] = evt[key]
            if event_subtype:
                payload["event_subtype"] = event_subtype
            # Merge any extra fields
            for key in evt:
                if key not in ("event_type", "event_subtype", "node_id", "user_id", "severity",
                               "timestamp", "process", "network", "user", "file", "raw_event_ref",
                               "metadata", "agent_id", "tenant_id"):
                    payload[key] = evt[key]
            
            severity = evt.get("severity", "info")
            ts = evt.get("timestamp")  # Optional: agent-provided timestamp
            
            # Route file events to file_events table
            if event_type.startswith("file.") or (event_type == "file" and event_subtype):
                file_info = evt.get("file", {})
                op = event_subtype or file_info.get("operation") or event_type
                proc = evt.get("process", {})
                
                if ts:
                    await conn.execute("""
                        INSERT INTO file_events (ts, node_id, user_id, op, path, old_path, new_path,
                            process_name, pid, hash_before, hash_after, file_size, success)
                        VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    """, ts, node_id, user_id, op,
                        file_info.get("path") or file_info.get("normalized_path"),
                        file_info.get("old_path"), file_info.get("new_path"),
                        proc.get("name"), proc.get("pid"),
                        file_info.get("hash_before"), file_info.get("hash_after"),
                        file_info.get("size"), evt.get("success", True))
                else:
                    await conn.execute("""
                        INSERT INTO file_events (node_id, user_id, op, path, old_path, new_path,
                            process_name, pid, hash_before, hash_after, file_size, success)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """, node_id, user_id, op,
                        file_info.get("path") or file_info.get("normalized_path"),
                        file_info.get("old_path"), file_info.get("new_path"),
                        proc.get("name"), proc.get("pid"),
                        file_info.get("hash_before"), file_info.get("hash_after"),
                        file_info.get("size"), evt.get("success", True))
            else:
                if ts:
                    await conn.execute("""
                        INSERT INTO events_normalized (ts, node_id, user_id, event_type, severity, payload)
                        VALUES ($1::timestamptz, $2, $3, $4, $5, $6::jsonb)
                    """, ts, node_id, user_id, event_type, severity, json.dumps(payload))
                else:
                    await conn.execute("""
                        INSERT INTO events_normalized (node_id, user_id, event_type, severity, payload)
                        VALUES ($1, $2, $3, $4, $5::jsonb)
                    """, node_id, user_id, event_type, severity, json.dumps(payload))
            
            inserted += 1
    
    return {"inserted": inserted, "findings_created": findings_created}


@router.get("/api/v1/agents/{node_id}/health/history", dependencies=[Depends(verify_api_key)])
async def get_agent_health_history(node_id: str, limit: int = 50):
    """Get recent health reports for a node."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT ts, payload FROM events_normalized
            WHERE node_id = $1 AND event_type = 'agent.health'
            ORDER BY ts DESC LIMIT $2
        """, node_id, limit)
        return {"history": [{"ts": str(r["ts"]), **json.loads(r["payload"])} if isinstance(r["payload"], str) else {"ts": str(r["ts"]), **r["payload"]} for r in rows]}


@router.post("/api/v1/posture/snapshots", dependencies=[Depends(verify_api_key)])
async def submit_posture_snapshot(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Agent submits a config posture snapshot"""
    node_id = data.get("nodeId") or data.get("node_id")
    if not node_id:
        raise HTTPException(status_code=400, detail="nodeId required")
    
    snapshot_type = data.get("snapshotType", "full")
    
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO config_posture_snapshots 
                (node_id, snapshot_type, os_info, installed_packages, running_services, config_settings, open_ports)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
            RETURNING id, created_at
        """, node_id, snapshot_type,
            json.dumps(data.get("osInfo", {})),
            json.dumps(data.get("installedPackages", [])),
            json.dumps(data.get("runningServices", [])),
            json.dumps(data.get("configSettings", {})),
            json.dumps(data.get("openPorts", [])))
        
        snapshot_id = str(row["id"])
        
        # Auto-generate diff against previous baseline if this is not the first snapshot
        if snapshot_type == "full":
            prev = await conn.fetchrow("""
                SELECT id, os_info, installed_packages, running_services, config_settings, open_ports
                FROM config_posture_snapshots 
                WHERE node_id = $1 AND id != $2::uuid
                ORDER BY created_at DESC LIMIT 1
            """, node_id, snapshot_id)
            
            if prev:
                diff = _compute_posture_diff(
                    {"osInfo": prev["os_info"], "installedPackages": prev["installed_packages"],
                     "runningServices": prev["running_services"], "configSettings": prev["config_settings"],
                     "openPorts": prev["open_ports"]},
                    {"osInfo": data.get("osInfo", {}), "installedPackages": data.get("installedPackages", []),
                     "runningServices": data.get("runningServices", []), "configSettings": data.get("configSettings", {}),
                     "openPorts": data.get("openPorts", [])}
                )
                if diff["changes"]:
                    severity = "info"
                    if any(c.get("severity") == "critical" for c in diff["changes"]):
                        severity = "critical"
                    elif any(c.get("severity") == "high" for c in diff["changes"]):
                        severity = "high"
                    elif any(c.get("severity") == "medium" for c in diff["changes"]):
                        severity = "medium"
                    
                    await conn.execute("""
                        INSERT INTO config_posture_diffs (node_id, baseline_snapshot_id, current_snapshot_id, diff_data, severity)
                        VALUES ($1, $2::uuid, $3::uuid, $4::jsonb, $5)
                    """, node_id, str(prev["id"]), snapshot_id, json.dumps(diff), severity)
        
        return {"id": snapshot_id, "createdAt": str(row["created_at"]), "type": snapshot_type}


@router.get("/api/v1/posture/snapshots/{node_id}")
async def get_posture_snapshots(node_id: str, limit: int = 10, db: asyncpg.Pool = Depends(get_db)):
    """Get posture snapshots for a node"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, node_id, snapshot_type, os_info, installed_packages, running_services,
                   config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1)
            ORDER BY created_at DESC LIMIT $2
        """, node_id, limit)
        
        snapshots = []
        for r in rows:
            snapshots.append({
                "id": str(r["id"]),
                "nodeId": r["node_id"],
                "snapshotType": r["snapshot_type"],
                "osInfo": json.loads(r["os_info"]) if isinstance(r["os_info"], str) else r["os_info"],
                "installedPackages": json.loads(r["installed_packages"]) if isinstance(r["installed_packages"], str) else r["installed_packages"],
                "runningServices": json.loads(r["running_services"]) if isinstance(r["running_services"], str) else r["running_services"],
                "configSettings": json.loads(r["config_settings"]) if isinstance(r["config_settings"], str) else r["config_settings"],
                "openPorts": json.loads(r["open_ports"]) if isinstance(r["open_ports"], str) else r["open_ports"],
                "createdAt": str(r["created_at"])
            })
        return {"snapshots": snapshots}


@router.get("/api/v1/posture/snapshots/{node_id}/latest")
async def get_latest_posture(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get latest posture snapshot for a node"""
    async with db.acquire() as conn:
        r = await conn.fetchrow("""
            SELECT id, node_id, snapshot_type, os_info, installed_packages, running_services,
                   config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1)
            ORDER BY created_at DESC LIMIT 1
        """, node_id)
        
        if not r:
            return {"snapshot": None}
        
        return {"snapshot": {
            "id": str(r["id"]),
            "nodeId": r["node_id"],
            "snapshotType": r["snapshot_type"],
            "osInfo": json.loads(r["os_info"]) if isinstance(r["os_info"], str) else r["os_info"],
            "installedPackages": json.loads(r["installed_packages"]) if isinstance(r["installed_packages"], str) else r["installed_packages"],
            "runningServices": json.loads(r["running_services"]) if isinstance(r["running_services"], str) else r["running_services"],
            "configSettings": json.loads(r["config_settings"]) if isinstance(r["config_settings"], str) else r["config_settings"],
            "openPorts": json.loads(r["open_ports"]) if isinstance(r["open_ports"], str) else r["open_ports"],
            "createdAt": str(r["created_at"])
        }}


@router.get("/api/v1/posture/diffs/{node_id}")
async def get_posture_diffs(node_id: str, limit: int = 20, db: asyncpg.Pool = Depends(get_db)):
    """Get config posture diffs for a node"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, node_id, baseline_snapshot_id, current_snapshot_id, diff_data, severity, created_at
            FROM config_posture_diffs
            WHERE UPPER(node_id) = UPPER($1)
            ORDER BY created_at DESC LIMIT $2
        """, node_id, limit)
        
        return {"diffs": [{
            "id": str(r["id"]),
            "nodeId": r["node_id"],
            "baselineSnapshotId": str(r["baseline_snapshot_id"]) if r["baseline_snapshot_id"] else None,
            "currentSnapshotId": str(r["current_snapshot_id"]) if r["current_snapshot_id"] else None,
            "diffData": json.loads(r["diff_data"]) if isinstance(r["diff_data"], str) else r["diff_data"],
            "severity": r["severity"],
            "createdAt": str(r["created_at"])
        } for r in rows]}


@router.get("/api/v1/posture/compare/{node_id}")
async def compare_posture(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Compare baseline (oldest) vs current (latest) snapshot for a node"""
    async with db.acquire() as conn:
        baseline = await conn.fetchrow("""
            SELECT id, os_info, installed_packages, running_services, config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1) AND snapshot_type = 'full'
            ORDER BY created_at ASC LIMIT 1
        """, node_id)
        
        current = await conn.fetchrow("""
            SELECT id, os_info, installed_packages, running_services, config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1) AND snapshot_type = 'full'
            ORDER BY created_at DESC LIMIT 1
        """, node_id)
        
        if not baseline or not current:
            return {"baseline": None, "current": None, "diff": None, "message": "Need at least 2 snapshots to compare"}
        
        if str(baseline["id"]) == str(current["id"]):
            return {"baseline": str(baseline["id"]), "current": str(current["id"]), "diff": {"changes": [], "totalChanges": 0}, "message": "Only one snapshot exists"}
        
        def parse(v):
            return json.loads(v) if isinstance(v, str) else v
        
        diff = _compute_posture_diff(
            {"osInfo": parse(baseline["os_info"]), "installedPackages": parse(baseline["installed_packages"]),
             "runningServices": parse(baseline["running_services"]), "configSettings": parse(baseline["config_settings"]),
             "openPorts": parse(baseline["open_ports"])},
            {"osInfo": parse(current["os_info"]), "installedPackages": parse(current["installed_packages"]),
             "runningServices": parse(current["running_services"]), "configSettings": parse(current["config_settings"]),
             "openPorts": parse(current["open_ports"])}
        )
        
        return {
            "baselineId": str(baseline["id"]),
            "baselineDate": str(baseline["created_at"]),
            "currentId": str(current["id"]),
            "currentDate": str(current["created_at"]),
            "diff": diff
        }
