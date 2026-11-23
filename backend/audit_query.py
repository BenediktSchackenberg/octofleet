"""The audit log (`audit_log`) as one query for `GET /api/v1/audit` and `GET /api/v1/audit-log`.

Both routes used to have their own copy (different filters, the total ignored the filters,
details came out as JSON text). Each entry now names its resource (node hostname, user name,
job, group or role name) next to the ID, so the page can show and link it.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

import asyncpg
from fastapi import HTTPException

from json_columns import decode_json

# The total is counted up to this many entries ("10,000+"), so a broad filter on a large log stays fast
COUNT_CAP = 10_000

# Resource name per resource type; deleted nodes and users keep the name the entry recorded
RESOURCE_NAME = """
    CASE a.resource_type
        WHEN 'node' THEN COALESCE(n.hostname, a.details->>'hostname')
        WHEN 'user' THEN COALESCE(ru.username, a.details->>'username')
        WHEN 'job' THEN j.name
        WHEN 'group' THEN g.name
        WHEN 'role' THEN r.name
    END"""


async def ensure_schema(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        # "Audit log of this user / node" filters by resource, newest first
        await conn.execute("""CREATE INDEX IF NOT EXISTS idx_audit_log_resource
                              ON audit_log (resource_type, resource_id, "timestamp" DESC)""")


def _timestamp(value: str, name: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{name}: an ISO 8601 date/time")


async def fetch_audit_log(
    conn: asyncpg.Connection,
    *,
    action: Optional[str] = None,
    user: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Entries newest first.

    - `action`: part of the action, any case (`reboot` finds `node.reboot`)
    - `user`: who did it - user ID or user name
    - `resource_type`: one type or several, comma-separated (`user,role`)
    - `resource_id`: the resource's ID (e.g. a node's UUID)
    - `date_from`, `date_to`: ISO 8601
    """
    conditions, params = [], []

    def add(sql: str, value) -> None:
        params.append(value)
        conditions.append(sql.format(p=f"${len(params)}"))

    if action:
        add("a.action ILIKE {p}", f"%{action}%")
    if user:
        try:
            add("a.user_id = {p}", UUID(user))
        except ValueError:
            add("a.user_id IN (SELECT id FROM users WHERE lower(username) = lower({p}))", user)
    types = [t.strip() for t in (resource_type or "").split(",") if t.strip()]
    if types:
        add("a.resource_type = ANY({p}::text[])", types)
    if resource_id:
        add("a.resource_id = {p}", resource_id)
    if date_from:
        add('a."timestamp" >= {p}', _timestamp(date_from, "date_from"))
    if date_to:
        add('a."timestamp" <= {p}', _timestamp(date_to, "date_to"))
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    total = await conn.fetchval(
        f"SELECT count(*) FROM (SELECT 1 FROM audit_log a {where} LIMIT {COUNT_CAP + 1}) x", *params)
    rows = await conn.fetch(f"""
        SELECT a.id, a."timestamp", a.user_id, u.username, a.action, a.resource_type, a.resource_id,
               {RESOURCE_NAME} AS resource_name, a.details, a.ip_address
        FROM (SELECT * FROM audit_log a {where}
              ORDER BY a."timestamp" DESC, a.id DESC
              LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}) a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN nodes n ON a.resource_type = 'node' AND (n.id::text = a.resource_id OR n.node_id = a.resource_id)
        LEFT JOIN users ru ON a.resource_type = 'user' AND ru.id::text = a.resource_id
        LEFT JOIN jobs j ON a.resource_type = 'job' AND j.id::text = a.resource_id
        LEFT JOIN groups g ON a.resource_type = 'group' AND g.id::text = a.resource_id
        LEFT JOIN roles r ON a.resource_type = 'role' AND r.id::text = a.resource_id
        ORDER BY a."timestamp" DESC, a.id DESC
    """, *params, limit, offset)
    return {
        "entries": [{
            "id": r["id"],
            "timestamp": r["timestamp"].isoformat() if r["timestamp"] else None,
            "user_id": str(r["user_id"]) if r["user_id"] else None,
            "username": r["username"],
            "action": r["action"],
            "resource_type": r["resource_type"],
            "resource_id": r["resource_id"],
            "resource_name": r["resource_name"],
            "details": decode_json(r["details"]),
            "ip_address": str(r["ip_address"]) if r["ip_address"] else None,
        } for r in rows],
        "total": min(total, COUNT_CAP),
        "total_capped": total > COUNT_CAP,
        "limit": limit,
        "offset": offset,
    }
