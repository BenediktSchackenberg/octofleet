"""
RBAC Authentication & Authorization Module
"""
import hashlib
from datetime import datetime, timedelta
from typing import List, Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.core.config import settings

# Config - Use centralized settings
JWT_SECRET = settings.JWT_SECRET
JWT_ALGORITHM = settings.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = settings.REFRESH_TOKEN_EXPIRE_DAYS


# ============== Models ==============

class UserCreate(BaseModel):
    username: str
    email: Optional[str] = None
    password: str
    display_name: Optional[str] = None

class UserUpdate(BaseModel):
    email: Optional[str] = None
    display_name: Optional[str] = None
    is_active: Optional[bool] = None

class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str]
    display_name: Optional[str]
    is_active: bool
    is_superuser: bool
    created_at: datetime
    last_login: Optional[datetime]
    roles: List[str] = []

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permissions: List[str] = []

class RoleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    permissions: List[str]
    is_system: bool
    created_at: datetime

class APIKeyCreate(BaseModel):
    name: str
    expires_days: Optional[int] = None
    scopes: Optional[List[str]] = None  # Default to ["agent"] if not specified

class APIKeyResponse(BaseModel):
    id: str
    name: str
    key: Optional[str] = None  # Only shown on creation
    created_at: datetime
    expires_at: Optional[datetime]
    last_used: Optional[datetime]
    is_active: bool


# ============== Password Hashing ==============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


# ============== JWT ==============

def create_access_token(user_id: str, username: str, permissions: List[str]) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "username": username,
        "permissions": permissions,
        "exp": expire,
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": user_id,
        "exp": expire,
        "type": "refresh"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============== Auth Dependencies ==============

security = HTTPBearer(auto_error=False)

class CurrentUser:
    def __init__(self, id: str, username: str, permissions: List[str], is_superuser: bool = False):
        self.id = id
        self.username = username
        self.permissions = permissions
        self.is_superuser = is_superuser
    
    def has_permission(self, permission: str) -> bool:
        if self.is_superuser or "*" in self.permissions:
            return True
        # Check exact match or wildcard
        resource = permission.split(":")[0]
        return permission in self.permissions or f"{resource}:*" in self.permissions


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Optional[CurrentUser]:
    """
    Get current user from JWT token or API key.
    Returns None if no auth provided (for backwards compatibility).
    """
    # Check for API key header first (backwards compatible)
    api_key = request.headers.get("X-API-Key")
    if api_key:
        # Import centralized API key
        from dependencies import API_KEY
        # Check against centralized key
        if api_key == API_KEY:
            return CurrentUser(
                id="system",
                username="system",
                permissions=["*"],
                is_superuser=True
            )
        # Check api_keys table in DB
        try:
            from dependencies import _permissions_for_scopes, get_pool
            pool = get_pool()
            if pool:
                key_hash = hash_api_key(api_key)
                async with pool.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT id, user_id, name, scopes FROM api_keys WHERE key_hash = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW())",
                        key_hash
                    )
                    if row:
                        scopes = list(row["scopes"]) if row["scopes"] else ["agent"]
                        permissions = _permissions_for_scopes(scopes)
                        return CurrentUser(
                            id=str(row["user_id"]) if row["user_id"] else "system",
                            username=row["name"],
                            permissions=permissions,
                            is_superuser="*" in permissions
                        )
        except Exception:
            pass
        return None
    
    # Check JWT
    if credentials:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return CurrentUser(
            id=payload["sub"],
            username=payload["username"],
            permissions=payload.get("permissions", []),
            is_superuser="*" in payload.get("permissions", [])
        )
    
    return None


async def require_auth(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Require authentication."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return user


def require_permission(permission: str):
    """Decorator to require specific permission."""
    async def permission_checker(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        if not user.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission}"
            )
        return user
    return permission_checker


def require_any_permission(*permissions: str):
    """Decorator to require any of the specified permissions."""
    async def permission_checker(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        for perm in permissions:
            if user.has_permission(perm):
                return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied: requires one of {permissions}"
        )
    return permission_checker


# ============== Role Permissions Lookup ==============

ROLE_PERMISSIONS = {
    "admin": ["*"],
    "operator": [
        "nodes:read", "nodes:write", "nodes:assign",
        "groups:read", "groups:write",
        "jobs:read", "jobs:create", "jobs:execute", "jobs:cancel",
        "packages:read", "packages:write", "packages:deploy",
        "deployments:read", "deployments:write",
        "alerts:read", "alerts:write",
        "eventlog:read", "compliance:read",
        "settings:read"
    ],
    "viewer": [
        "nodes:read", "groups:read", "jobs:read", "packages:read",
        "deployments:read", "alerts:read", "eventlog:read",
        "compliance:read", "settings:read"
    ],
    "auditor": [
        "eventlog:read", "compliance:read", "nodes:read"
    ]
}

def get_permissions_for_roles(roles: List[str], db_permissions: dict = None) -> List[str]:
    """Combine permissions from multiple roles.
    
    If db_permissions is provided (dict mapping role_name -> list of perms),
    use those. Fall back to ROLE_PERMISSIONS for roles not in db_permissions.
    """
    permissions = set()
    for role in roles:
        if db_permissions and role in db_permissions:
            perms = db_permissions[role]
        else:
            perms = ROLE_PERMISSIONS.get(role, [])
        if "*" in perms:
            return ["*"]
        permissions.update(perms)
    return list(permissions)
