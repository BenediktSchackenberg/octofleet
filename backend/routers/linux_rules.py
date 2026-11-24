"""
Octofleet API - Linux approval rules (#271) and the pause of deployment rings
"""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

import linux_rules as lr
from auth import require_user_permission
from dependencies import get_pool

router = APIRouter(tags=["Patches"])

_read = [Depends(require_user_permission("packages:read"))]
_write = [Depends(require_user_permission("packages:write"))]


def _username(request: Request) -> str:
    user = getattr(request.state, "user", None)
    return user.get("username", "system") if user else "system"


def _uuid_or_404(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found") from None


def _rule_out(row) -> dict:
    out = {k: row[k] for k in ("name", "description", "enabled", "action", "releases", "security_only",
                               "min_severity", "repositories", "packages", "min_age_hours", "expedite", "updated_by")}
    out.update(id=str(row["id"]), ring_ids=[str(r) for r in row["ring_ids"]],
               group_id=str(row["group_id"]) if row["group_id"] else None,
               created_at=row["created_at"].isoformat(), updated_at=row["updated_at"].isoformat())
    return out


async def _check_references(conn, rule: dict) -> None:
    """Rings and group must exist when a rule is saved (deleted later, the rule fails safe)."""
    if rule["ring_ids"]:
        found = await conn.fetchval("SELECT count(*) FROM patch_rings WHERE id = ANY($1::uuid[])",
                                    [uuid.UUID(r) for r in rule["ring_ids"]])
        if found != len(rule["ring_ids"]):
            raise HTTPException(status_code=400, detail="ring_ids: unknown deployment ring")
    if rule["group_id"] and not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM groups WHERE id = $1)",
                                                    uuid.UUID(rule["group_id"])):
        raise HTTPException(status_code=400, detail="group_id: unknown group")


def _validated(data, current=None) -> dict:
    try:
        return lr.validate(data, current)
    except lr.RuleError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.get("/api/v1/patches/linux-rules", dependencies=_read)
async def list_linux_rules():
    """The Linux approval rules, the counts of what the enabled ones approve now (from the cache;
    `evaluating`: nodes still being updated), and the Linux releases with whether they have security
    data (a security-only rule matches nothing without)."""
    async with get_pool().acquire() as conn:
        rules = await conn.fetch("SELECT * FROM linux_update_rules ORDER BY action DESC, name")
        counts = await conn.fetchrow(f"""
            SELECT count(*) FILTER (WHERE approved > 0) AS nodes,
                   COALESCE(sum(approved), 0) AS approved, COALESCE(sum(waiting), 0) AS waiting,
                   COALESCE(sum(excluded), 0) AS excluded, count(*) FILTER (WHERE evaluating) AS evaluating
              FROM ({lr.FLEET_STATE}) c""", None)
        releases = await conn.fetch(f"""
            SELECT release, package_manager, bool_and(security_data) AS security_data, count(*) AS nodes
              FROM ({lr.NODE_INFO}) i WHERE release IS NOT NULL
             GROUP BY release, package_manager ORDER BY release""", None)
    return {"rules": [_rule_out(r) for r in rules],
            "totals": {k: int(counts[k]) for k in ("nodes", "approved", "waiting", "excluded", "evaluating")},
            "releases": [dict(r) for r in releases]}


@router.post("/api/v1/patches/linux-rules", dependencies=_write, status_code=201)
async def create_linux_rule(data: dict, request: Request):
    rule = _validated(data)
    async with get_pool().acquire() as conn:
        await _check_references(conn, rule)
        row = await conn.fetchrow(lr.INSERT_RULE, *lr.rule_args(rule), _username(request))
    return _rule_out(row)


@router.put("/api/v1/patches/linux-rules/{rule_id}", dependencies=_write)
async def update_linux_rule(rule_id: str, data: dict, request: Request):
    """Change a rule; fields that are left out keep their value."""
    rid = _uuid_or_404(rule_id, "rule")
    async with get_pool().acquire() as conn, conn.transaction():
        current = await conn.fetchrow("SELECT * FROM linux_update_rules WHERE id = $1 FOR UPDATE", rid)
        if current is None:
            raise HTTPException(status_code=404, detail="rule not found")
        rule = _validated(data, _rule_out(current))
        await _check_references(conn, rule)
        row = await conn.fetchrow(lr.UPDATE_RULE, rid, *lr.rule_args(rule), _username(request))
    return _rule_out(row)


@router.delete("/api/v1/patches/linux-rules/{rule_id}", dependencies=_write)
async def delete_linux_rule(rule_id: str):
    rid = _uuid_or_404(rule_id, "rule")
    async with get_pool().acquire() as conn:
        deleted = await conn.fetchval("DELETE FROM linux_update_rules WHERE id = $1 RETURNING id", rid)
    if deleted is None:
        raise HTTPException(status_code=404, detail="rule not found")
    return {"deleted": True}


@router.post("/api/v1/patches/linux-rules/preview", dependencies=_read)
async def preview_linux_rule(data: dict):
    """What an (unsaved) rule matches on its own, without the other rules: nodes in its scope,
    pending versions approved now / waiting for the minimum age (an exclusion rule: excluded), and
    nodes in scope without security data when it is security-only."""
    rule = _validated(data)
    async with get_pool().acquire() as conn:
        await _check_references(conn, rule)
        preview = json.dumps(lr.preview_json(rule))
        row = await conn.fetchrow(f"""
            SELECT count(*) FILTER (WHERE NOT excluded AND approved_at <= now()) AS approved,
                   count(*) FILTER (WHERE NOT excluded AND approved_at > now()) AS waiting,
                   count(*) FILTER (WHERE excluded) AS excluded
              FROM ({lr.EVALUATE}) e""", None, preview, None)
        scope = await conn.fetchrow(f"""
            SELECT count(*) AS nodes, count(*) FILTER (WHERE NOT security_data) AS no_security
              FROM ({lr.SCOPE_NODES}) s""", None, preview, None)
        no_security = scope["no_security"] if rule["security_only"] else 0
    return {"nodes": scope["nodes"], "approved": row["approved"], "waiting": row["waiting"],
            "excluded": row["excluded"], "nodes_without_security_data": no_security}


@router.get("/api/v1/patches/linux-approved/{node_id}", dependencies=_read)
async def linux_node_approvals(node_id: str):
    """The node's pending Linux updates with their approval state: approved, waiting (with
    `approved_at`), excluded or not_approved, and the rules that decide it."""
    nid = _uuid_or_404(node_id, "node")
    now = datetime.now(timezone.utc)
    async with get_pool().acquire() as conn:
        info = await conn.fetchrow(lr.NODE_INFO, [str(nid)])
        if info is None:
            raise HTTPException(status_code=404, detail="no Linux update data for this node")
        rows = await conn.fetch(lr.NODE_DETAIL, None, None, [str(nid)])
    updates = [{
        "name": r["package"], "package": r["name"], "arch": r["arch"], "version": r["version"],
        "installed_version": r["installed_version"], "repository": r["repository"], "security": r["security"],
        "severity": r["severity"], "first_seen_at": r["first_seen_at"].isoformat(),
        "state": lr.approval_state(r, now),
        "approved_at": r["approved_at"].isoformat() if r["approved_at"] else None,
        "rules": [str(x) for x in (r["exclude_rules"] if r["excluded"] else r["approve_rules"]) or []],
    } for r in rows]
    return {"release": info["release"], "package_manager": info["package_manager"],
            "security_data": info["security_data"], "updates": updates}


async def _set_paused(ring_id: str, paused: bool) -> dict:
    rid = _uuid_or_404(ring_id, "ring")
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow("UPDATE patch_rings SET paused = $2 WHERE id = $1 RETURNING id, name, paused", rid, paused)
    if row is None:
        raise HTTPException(status_code=404, detail="ring not found")
    return {"id": str(row["id"]), "name": row["name"], "paused": row["paused"]}


@router.post("/api/v1/patches/rings/{ring_id}/pause", dependencies=_write)
async def pause_ring(ring_id: str):
    """Linux approval rules approve nothing through a paused ring (exclusions still apply)."""
    return await _set_paused(ring_id, True)


@router.post("/api/v1/patches/rings/{ring_id}/resume", dependencies=_write)
async def resume_ring(ring_id: str):
    return await _set_paused(ring_id, False)
