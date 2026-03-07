from fastapi import APIRouter, Depends, HTTPException, status
import asyncpg
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from dependencies import get_db, not_found
from auth import (
    UserCreate, UserUpdate, UserResponse, LoginRequest, TokenResponse,
    hash_password, verify_password, create_access_token,
    require_auth, require_permission, CurrentUser,
    get_permissions_for_roles
)

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["auth"]
)

@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, db: asyncpg.Pool = Depends(get_db)):
    """Login with username/password, get JWT token"""
    async with db.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, username, password_hash, is_active, is_superuser, email, display_name, created_at, last_login FROM users WHERE username = $1",
            request.username
        )
        
        if not user or not verify_password(request.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        if not user["is_active"]:
            raise HTTPException(status_code=403, detail="Account disabled")
        
        roles = await conn.fetch(
            """SELECT r.name FROM roles r 
               JOIN user_roles ur ON r.id = ur.role_id 
               WHERE ur.user_id = $1""",
            user["id"]
        )
        role_names = [r["name"] for r in roles]
        permissions = get_permissions_for_roles(role_names)
        if user["is_superuser"]:
            permissions = ["*"]
        
        await conn.execute("UPDATE users SET last_login = NOW() WHERE id = $1", user["id"])
        token = create_access_token(str(user["id"]), user["username"], permissions)
        
        return TokenResponse(
            access_token=token,
            expires_in=86400,
            user=UserResponse(
                id=str(user["id"]), username=user["username"], email=user["email"],
                display_name=user["display_name"], is_active=user["is_active"],
                is_superuser=user["is_superuser"], created_at=user["created_at"],
                last_login=user["last_login"], roles=role_names
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
            "SELECT id, username, email, display_name, is_active, is_superuser, created_at, last_login FROM users WHERE id = $1",
            UUID(user.id)
        )
        if not db_user: raise not_found("User", user.id)
        roles = await conn.fetch("""SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = $1""", db_user["id"])
        return UserResponse(
            id=str(db_user["id"]), username=db_user["username"], email=db_user["email"],
            display_name=db_user["display_name"], is_active=db_user["is_active"],
            is_superuser=db_user["is_superuser"], created_at=db_user["created_at"],
            last_login=db_user["last_login"], roles=[r["name"] for r in roles]
        )

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
            """SELECT r.name FROM roles r
               JOIN user_roles ur ON r.id = ur.role_id
               WHERE ur.user_id = $1""",
            UUID(user.id)
        )
        role_names = [r["name"] for r in roles]
        permissions = get_permissions_for_roles(role_names)
        return {"permissions": permissions, "roles": role_names}
