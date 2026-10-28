import json
from datetime import datetime
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import (
    CurrentUser,
    LoginRequest,
    TokenResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
    create_access_token,
    get_permissions_for_roles,
    hash_password,
    require_auth,
    require_permission,
    verify_password,
)
from dependencies import get_db, not_found
from password_policy import load_policy, password_expired, record_previous_password, validate_password

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["auth"]
)

@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, request: Request, db: asyncpg.Pool = Depends(get_db)):
    """Login with username/password, get JWT token"""
    async with db.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, username, password_hash, is_active, is_superuser, email, display_name, created_at, last_login, session_version, must_change_password, password_changed_at FROM users WHERE username = $1",
            data.username
        )
        
        if not user or not verify_password(data.password, user["password_hash"]):
            await conn.execute("""INSERT INTO audit_log (user_id, action, resource_type, details, ip_address)
                VALUES ($1, 'auth.login_failed', 'user', $2::jsonb, $3::inet)""",
                user["id"] if user else None, json.dumps({"username": data.username}),
                request.client.host if request.client else None)
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        if not user["is_active"]:
            await conn.execute("""INSERT INTO audit_log (user_id, action, resource_type, details, ip_address)
                VALUES ($1, 'auth.login_failed', 'user', $2::jsonb, $3::inet)""",
                user["id"], json.dumps({"username": data.username, "reason": "disabled"}),
                request.client.host if request.client else None)
            raise HTTPException(status_code=403, detail="Account disabled")
        
        roles = await conn.fetch(
            """SELECT r.name, r.permissions FROM roles r 
               JOIN user_roles ur ON r.id = ur.role_id 
               WHERE ur.user_id = $1""",
            user["id"]
        )
        role_names = [r["name"] for r in roles]
        db_permissions = {r["name"]: list(r["permissions"]) for r in roles if r["permissions"]}
        permissions = get_permissions_for_roles(role_names, db_permissions)
        if user["is_superuser"]:
            permissions = ["*"]
        
        await conn.execute("UPDATE users SET last_login = NOW() WHERE id = $1", user["id"])
        token = create_access_token(str(user["id"]), user["username"], permissions, user["session_version"])
        
        return TokenResponse(
            access_token=token,
            expires_in=86400,
            user=UserResponse(
                id=str(user["id"]), username=user["username"], email=user["email"],
                display_name=user["display_name"], is_active=user["is_active"],
                is_superuser=user["is_superuser"], created_at=user["created_at"],
                last_login=user["last_login"], roles=role_names,
                must_change_password=user["must_change_password"] or password_expired(
                    user["password_changed_at"], await load_policy(conn))
            )
        )

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(user: CurrentUser = Depends(require_auth), db: asyncpg.Pool = Depends(get_db)):
    """Get current user info"""
    if user.id == "system":
        return UserResponse(
            id="system", username="system", email=None, display_name="System (API Key)",
            is_active=True, is_superuser=True, created_at=datetime.utcnow(),
            last_login=None, roles=["admin"]
        )
    
    async with db.acquire() as conn:
        db_user = await conn.fetchrow(
            "SELECT id, username, email, display_name, is_active, is_superuser, created_at, last_login, must_change_password, password_changed_at FROM users WHERE id = $1",
            UUID(user.id)
        )
        if not db_user: raise not_found("User", user.id)
        roles = await conn.fetch("""SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = $1""", db_user["id"])
        return UserResponse(
            id=str(db_user["id"]), username=db_user["username"], email=db_user["email"],
            display_name=db_user["display_name"], is_active=db_user["is_active"],
            is_superuser=db_user["is_superuser"], created_at=db_user["created_at"],
            last_login=db_user["last_login"], roles=[r["name"] for r in roles],
            must_change_password=db_user["must_change_password"] or password_expired(
                db_user["password_changed_at"], await load_policy(conn))
        )

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/password")
async def change_own_password(data: ChangePasswordRequest, user: CurrentUser = Depends(require_auth),
                              db: asyncpg.Pool = Depends(get_db)):
    """Change a local account password and revoke its existing access tokens."""
    if user.id == "system":
        raise HTTPException(status_code=403, detail="API keys have no account password")
    async with db.acquire() as conn:
        async with conn.transaction():
            account = await conn.fetchrow(
                "SELECT username, password_hash FROM users WHERE id = $1 FOR UPDATE", UUID(user.id)
            )
            if not account or not verify_password(data.current_password, account["password_hash"]):
                raise HTTPException(status_code=403, detail="Current password is incorrect")
            policy = await validate_password(conn, data.new_password, account["username"],
                                             UUID(user.id), account["password_hash"])
            await record_previous_password(conn, UUID(user.id), account["password_hash"], policy)
            await conn.execute(
                """UPDATE users SET password_hash = $2, session_version = session_version + 1,
                   must_change_password = false, password_changed_at = NOW(),
                   updated_at = NOW() WHERE id = $1""",
                UUID(user.id), hash_password(data.new_password)
            )
            await conn.execute(
                """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
                   VALUES ($1, 'user.password_changed', 'user', $2, '{}'::jsonb)""",
                UUID(user.id), user.id
            )
    return {"status": "password_changed"}


@router.post("/logout")
async def end_sessions(user: CurrentUser = Depends(require_auth), db: asyncpg.Pool = Depends(get_db)):
    """Revoke all access tokens for the current local account."""
    if user.id == "system":
        raise HTTPException(status_code=403, detail="API keys cannot log out")
    async with db.acquire() as conn:
        await conn.execute(
            "UPDATE users SET session_version = session_version + 1 WHERE id = $1",
            UUID(user.id)
        )
    return {"status": "logged_out"}


# User management endpoints (using /api/v1/users prefix)
users_router = APIRouter(
    prefix="/api/v1/users",
    tags=["users"],
    dependencies=[Depends(require_auth)]
)

@users_router.get("")
async def list_users(user: CurrentUser = Depends(require_permission("users:read")), db: asyncpg.Pool = Depends(get_db)):
    """List all users"""
    async with db.acquire() as conn:
        users = await conn.fetch("""
            SELECT u.id, u.username, u.email, u.display_name, u.is_active, u.is_superuser, 
                   u.created_at, u.last_login, array_agg(r.name) FILTER (WHERE r.name IS NOT NULL) as roles
            FROM users u LEFT JOIN user_roles ur ON u.id = ur.user_id LEFT JOIN roles r ON ur.role_id = r.id
            GROUP BY u.id ORDER BY u.created_at DESC
        """)
        return {"users": [{
            "id": str(u["id"]), "username": u["username"], "email": u["email"],
            "display_name": u["display_name"], "is_active": u["is_active"],
            "is_superuser": u["is_superuser"], "created_at": u["created_at"].isoformat() if u["created_at"] else None,
            "last_login": u["last_login"].isoformat() if u["last_login"] else None,
            "roles": u["roles"] or []
        } for u in users]}

@users_router.post("", response_model=UserResponse)
async def create_user(data: UserCreate, user: CurrentUser = Depends(require_permission("users:write")), db: asyncpg.Pool = Depends(get_db)):
    """Create new user"""
    async with db.acquire() as conn:
        existing = await conn.fetchval("SELECT 1 FROM users WHERE username = $1", data.username)
        if existing: raise HTTPException(status_code=400, detail="Username already exists")
        await validate_password(conn, data.password, data.username)
        new_user = await conn.fetchrow("""
            INSERT INTO users (username, email, password_hash, display_name) VALUES ($1, $2, $3, $4)
            RETURNING id, username, email, display_name, is_active, is_superuser, created_at
        """, data.username, data.email, hash_password(data.password), data.display_name or data.username)
        return UserResponse(
            id=str(new_user["id"]), username=new_user["username"], email=new_user["email"],
            display_name=new_user["display_name"], is_active=new_user["is_active"],
            is_superuser=new_user["is_superuser"], created_at=new_user["created_at"],
            last_login=None, roles=[]
        )


class ResetPasswordRequest(BaseModel):
    new_password: str
    must_change_password: bool = True


@users_router.post("/{user_id}/password")
async def reset_user_password(user_id: UUID, data: ResetPasswordRequest,
                              actor: CurrentUser = Depends(require_permission("users:write")),
                              db: asyncpg.Pool = Depends(get_db)):
    """Reset a local account password, revoke its tokens, and optionally require a change."""
    async with db.acquire() as conn:
        async with conn.transaction():
            account = await conn.fetchrow(
                "SELECT username, password_hash FROM users WHERE id = $1 FOR UPDATE", user_id
            )
            if not account:
                raise not_found("User", str(user_id))
            policy = await validate_password(conn, data.new_password, account["username"],
                                             user_id, account["password_hash"])
            await record_previous_password(conn, user_id, account["password_hash"], policy)
            await conn.execute("""UPDATE users SET password_hash = $2,
                must_change_password = $3, password_changed_at = NOW(),
                session_version = session_version + 1, updated_at = NOW()
                WHERE id = $1""", user_id, hash_password(data.new_password), data.must_change_password)
            await conn.execute("""INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
                VALUES ($1, 'user.password_reset', 'user', $2, $3::jsonb)""",
                None if actor.id == "system" else UUID(actor.id), str(user_id),
                json.dumps({"must_change_password": data.must_change_password}))
    return {"status": "password_reset"}

@users_router.put("/{user_id}")
async def update_user(user_id: str, data: UserUpdate, user: CurrentUser = Depends(require_permission("users:write")), db: asyncpg.Pool = Depends(get_db)):
    """Update user"""
    async with db.acquire() as conn:
        updates = []
        params = [UUID(user_id)]
        param_idx = 2
        if data.email is not None:
            updates.append(f"email = ${param_idx}"); params.append(data.email); param_idx += 1
        if data.display_name is not None:
            updates.append(f"display_name = ${param_idx}"); params.append(data.display_name); param_idx += 1
        if data.is_active is not None:
            updates.append(f"is_active = ${param_idx}"); params.append(data.is_active); param_idx += 1
        
        if not updates: raise HTTPException(status_code=400, detail="No updates provided")
        updates.append("updated_at = NOW()")
        await conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = $1", *params)
        return {"status": "updated"}

@users_router.delete("/{user_id}")
async def delete_user(user_id: str, user: CurrentUser = Depends(require_permission("users:write")), db: asyncpg.Pool = Depends(get_db)):
    """Delete user"""
    if user_id == user.id: raise HTTPException(status_code=400, detail="Cannot delete yourself")
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM users WHERE id = $1", UUID(user_id))
        return {"status": "deleted"}


@router.get("/permissions")
async def get_my_permissions(user: CurrentUser = Depends(require_auth), db: asyncpg.Pool = Depends(get_db)):
    """Return the current user's resolved permissions based on their roles.
    Used by the frontend to avoid hardcoding the role→permission matrix."""
    if user.is_superuser:
        return {"permissions": ["*"], "roles": ["admin"]}

    if user.id == "system":
        return {"permissions": ["*"], "roles": ["admin"]}

    async with db.acquire() as conn:
        roles = await conn.fetch(
            """SELECT r.name, r.permissions FROM roles r
               JOIN user_roles ur ON r.id = ur.role_id
               WHERE ur.user_id = $1""",
            UUID(user.id)
        )
        role_names = [r["name"] for r in roles]
        db_permissions = {r["name"]: list(r["permissions"]) for r in roles if r["permissions"]}
        permissions = get_permissions_for_roles(role_names, db_permissions)
        return {"permissions": permissions, "roles": role_names}
