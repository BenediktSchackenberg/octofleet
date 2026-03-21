"""
E36 Phase 1 — RBAC management endpoints:
  - Role CRUD (enhanced), scoped role assignments, audit log
"""
import json
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from auth import CurrentUser, require_auth, require_permission, ROLE_PERMISSIONS
from dependencies import get_db, log_audit, verify_api_key

router = APIRouter(
    prefix="/api/v1",
    tags=["rbac"],
    dependencies=[Depends(verify_api_key)],
)

# ─── Models ───────────────────────────────────────────────────────────

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[List[str]] = None

class ScopeCreate(BaseModel):
    user_id: str
    group_id: Optional[str] = None

# ─── All available permissions ────────────────────────────────────────

ALL_PERMISSIONS = sorted({
    "nodes:read", "nodes:write", "nodes:assign",
    "groups:read", "groups:write",
    "jobs:read", "jobs:create", "jobs:execute", "jobs:cancel",
    "packages:read", "packages:write", "packages:deploy",
    "deployments:read", "deployments:write",
    "alerts:read", "alerts:write",
    "eventlog:read",
    "compliance:read",
    "settings:read", "settings:write",
    "users:read", "users:write",
    "roles:read", "roles:write",
    "reports:read", "reports:write",
    "audit:read",
    "security:read", "security:write",
    "terminal:access",
})


@router.get("/permissions/all")
async def list_all_permissions(auth=Depends(verify_api_key)):
    """Return all available permission strings, grouped by category."""
    categories = {}
    for p in ALL_PERMISSIONS:
        cat = p.split(":")[0]
        categories.setdefault(cat, []).append(p)
    return {"permissions": ALL_PERMISSIONS, "categories": categories}


# ─── Single role ──────────────────────────────────────────────────────

@router.get("/roles/{role_id}")
async def get_role(role_id: str, db: asyncpg.Pool = Depends(get_db), auth=Depends(verify_api_key)):
    """Get a single role with user count."""
    async with db.acquire() as conn:
        role = await conn.fetchrow(
            "SELECT id, name, description, permissions, is_system, created_at FROM roles WHERE id = $1",
            UUID(role_id),
        )
        if not role:
            raise HTTPException(404, "Role not found")
        user_count = await conn.fetchval(
            "SELECT count(*) FROM user_roles WHERE role_id = $1", UUID(role_id)
        )
        return {
            "id": str(role["id"]),
            "name": role["name"],
            "description": role["description"],
            "permissions": list(role["permissions"]) if role["permissions"] else [],
            "is_system": role["is_system"],
            "created_at": role["created_at"].isoformat() if role["created_at"] else None,
            "user_count": user_count,
        }


@router.put("/roles/{role_id}")
async def update_role(
    role_id: str,
    data: RoleUpdate,
    request: Request,
    user: CurrentUser = Depends(require_permission("roles:write")),
    db: asyncpg.Pool = Depends(get_db),
):
    """Update a custom role (not system roles)."""
    async with db.acquire() as conn:
        role = await conn.fetchrow("SELECT is_system FROM roles WHERE id = $1", UUID(role_id))
        if not role:
            raise HTTPException(404, "Role not found")
        if role["is_system"]:
            raise HTTPException(400, "Cannot modify system roles")
        updates, params, idx = [], [UUID(role_id)], 2
        if data.name is not None:
            updates.append(f"name = ${idx}"); params.append(data.name); idx += 1
        if data.description is not None:
            updates.append(f"description = ${idx}"); params.append(data.description); idx += 1
        if data.permissions is not None:
            updates.append(f"permissions = ${idx}"); params.append(data.permissions); idx += 1
        if not updates:
            raise HTTPException(400, "No updates")
        await conn.execute(f"UPDATE roles SET {', '.join(updates)} WHERE id = $1", *params)
        await log_audit(conn, UUID(user.id) if user.id != "system" else None,
                        "role.updated", "role", role_id,
                        {"changes": data.dict(exclude_none=True)},
                        request.client.host if request.client else None)
        return {"status": "updated"}


@router.get("/roles/{role_id}/users")
async def list_role_users(role_id: str, db: asyncpg.Pool = Depends(get_db), auth=Depends(verify_api_key)):
    """List users that have this role."""
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """SELECT u.id, u.username, u.display_name, u.email, ur.assigned_at
               FROM users u JOIN user_roles ur ON u.id = ur.user_id
               WHERE ur.role_id = $1 ORDER BY ur.assigned_at DESC""",
            UUID(role_id),
        )
        return {"users": [{
            "id": str(r["id"]), "username": r["username"],
            "display_name": r["display_name"], "email": r["email"],
            "assigned_at": r["assigned_at"].isoformat() if r["assigned_at"] else None,
        } for r in rows]}


# ─── Scoped roles ────────────────────────────────────────────────────

@router.post("/roles/{role_id}/scopes")
async def create_scope(
    role_id: str,
    data: ScopeCreate,
    request: Request,
    user: CurrentUser = Depends(require_permission("roles:write")),
    db: asyncpg.Pool = Depends(get_db),
):
    """Assign a scoped role to a user."""
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow(
                """INSERT INTO role_scopes (user_id, role_id, group_id, created_by)
                   VALUES ($1, $2, $3, $4) RETURNING id""",
                UUID(data.user_id), UUID(role_id),
                UUID(data.group_id) if data.group_id else None,
                UUID(user.id) if user.id != "system" else None,
            )
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "Scope already exists")
        await log_audit(conn, UUID(user.id) if user.id != "system" else None,
                        "scope.created", "role_scope", str(row["id"]),
                        {"role_id": role_id, "target_user": data.user_id, "group_id": data.group_id},
                        request.client.host if request.client else None)
        return {"id": str(row["id"]), "status": "created"}


@router.delete("/roles/{role_id}/scopes/{scope_id}")
async def delete_scope(
    role_id: str,
    scope_id: str,
    request: Request,
    user: CurrentUser = Depends(require_permission("roles:write")),
    db: asyncpg.Pool = Depends(get_db),
):
    """Remove a scoped role assignment."""
    async with db.acquire() as conn:
        deleted = await conn.execute(
            "DELETE FROM role_scopes WHERE id = $1 AND role_id = $2", UUID(scope_id), UUID(role_id)
        )
        if deleted == "DELETE 0":
            raise HTTPException(404, "Scope not found")
        await log_audit(conn, UUID(user.id) if user.id != "system" else None,
                        "scope.deleted", "role_scope", scope_id, {"role_id": role_id},
                        request.client.host if request.client else None)
        return {"status": "deleted"}


@router.get("/users/{user_id}/scopes")
async def list_user_scopes(user_id: str, db: asyncpg.Pool = Depends(get_db), auth=Depends(verify_api_key)):
    """List all scoped role assignments for a user."""
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """SELECT rs.id, rs.role_id, r.name as role_name, rs.group_id,
                      g.name as group_name, rs.created_at
               FROM role_scopes rs
               JOIN roles r ON r.id = rs.role_id
               LEFT JOIN groups g ON g.id = rs.group_id
               WHERE rs.user_id = $1
               ORDER BY rs.created_at DESC""",
            UUID(user_id),
        )
        return {"scopes": [{
            "id": str(r["id"]),
            "role_id": str(r["role_id"]),
            "role_name": r["role_name"],
            "group_id": str(r["group_id"]) if r["group_id"] else None,
            "group_name": r["group_name"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        } for r in rows]}


# ─── Audit Log ────────────────────────────────────────────────────────

@router.get("/audit-log")
async def get_audit_log(
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    db: asyncpg.Pool = Depends(get_db),
    auth=Depends(verify_api_key),
):
    """Paginated audit log with filters."""
    conditions, params, idx = [], [], 1
    if action:
        conditions.append(f"a.action = ${idx}"); params.append(action); idx += 1
    if user_id:
        conditions.append(f"a.user_id = ${idx}"); params.append(UUID(user_id)); idx += 1
    if resource_type:
        conditions.append(f"a.resource_type = ${idx}"); params.append(resource_type); idx += 1
    if date_from:
        conditions.append(f"a.timestamp >= ${idx}::timestamptz"); params.append(date_from); idx += 1
    if date_to:
        conditions.append(f"a.timestamp <= ${idx}::timestamptz"); params.append(date_to); idx += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with db.acquire() as conn:
        total = await conn.fetchval(f"SELECT count(*) FROM audit_log a {where}", *params)
        rows = await conn.fetch(
            f"""SELECT a.id, a.timestamp, a.user_id, u.username, a.action,
                       a.resource_type, a.resource_id, a.details, a.ip_address
                FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                {where} ORDER BY a.timestamp DESC
                LIMIT ${idx} OFFSET ${idx+1}""",
            *params, limit, offset,
        )
        return {
            "total": total,
            "entries": [{
                "id": str(r["id"]),
                "timestamp": r["timestamp"].isoformat() if r["timestamp"] else None,
                "user_id": str(r["user_id"]) if r["user_id"] else None,
                "username": r["username"],
                "action": r["action"],
                "resource_type": r["resource_type"],
                "resource_id": r["resource_id"],
                "details": r["details"],
                "ip_address": r["ip_address"],
            } for r in rows],
        }


@router.get("/audit-log/stats")
async def get_audit_stats(db: asyncpg.Pool = Depends(get_db), auth=Depends(verify_api_key)):
    """Audit summary stats."""
    async with db.acquire() as conn:
        per_day = await conn.fetch(
            """SELECT date_trunc('day', timestamp) as day, count(*) as cnt
               FROM audit_log WHERE timestamp > now() - interval '30 days'
               GROUP BY 1 ORDER BY 1"""
        )
        top_users = await conn.fetch(
            """SELECT u.username, count(*) as cnt FROM audit_log a
               JOIN users u ON u.id = a.user_id
               GROUP BY u.username ORDER BY cnt DESC LIMIT 10"""
        )
        top_types = await conn.fetch(
            "SELECT resource_type, count(*) as cnt FROM audit_log GROUP BY 1 ORDER BY cnt DESC LIMIT 10"
        )
        top_actions = await conn.fetch(
            "SELECT action, count(*) as cnt FROM audit_log GROUP BY 1 ORDER BY cnt DESC LIMIT 10"
        )
        return {
            "per_day": [{"day": r["day"].isoformat(), "count": r["cnt"]} for r in per_day],
            "top_users": [{"username": r["username"], "count": r["cnt"]} for r in top_users],
            "top_resource_types": [{"type": r["resource_type"], "count": r["cnt"]} for r in top_types],
            "top_actions": [{"action": r["action"], "count": r["cnt"]} for r in top_actions],
        }
