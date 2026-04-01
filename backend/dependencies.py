"""
Shared dependencies for Octofleet API routers
"""
from typing import Any, Optional
from uuid import UUID

import asyncpg
from fastapi import Depends, Header, HTTPException, Request, status

from app.core.config import settings

# Config
DATABASE_URL = settings.DATABASE_URL
API_KEY = settings.API_KEY
GATEWAY_URL = settings.GATEWAY_URL
GATEWAY_TOKEN = settings.GATEWAY_TOKEN
INVENTORY_API_URL = settings.INVENTORY_API_URL

# Database pool - set by main.py on startup
db_pool: Optional[asyncpg.Pool] = None


# ============================================
# Standardized API Error Handling
# ============================================

class APIError(HTTPException):
    """Standardized API error with error code and details"""
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        details: Optional[dict] = None
    ):
        self.error_code = error_code
        self.details = details or {}
        super().__init__(
            status_code=status_code,
            detail={
                "error": error_code,
                "message": message,
                "details": self.details
            }
        )


# Common error factory functions
def not_found(resource: str, identifier: str = None) -> APIError:
    """Create a 404 Not Found error"""
    msg = f"{resource} not found"
    if identifier:
        msg = f"{resource} '{identifier}' not found"
    return APIError(
        status_code=404,
        error_code=f"{resource.upper().replace(' ', '_')}_NOT_FOUND",
        message=msg,
        details={"resource": resource, "identifier": identifier}
    )


def bad_request(message: str, field: str = None) -> APIError:
    """Create a 400 Bad Request error"""
    return APIError(
        status_code=400,
        error_code="BAD_REQUEST",
        message=message,
        details={"field": field} if field else {}
    )


def conflict(message: str, resource: str = None) -> APIError:
    """Create a 409 Conflict error"""
    return APIError(
        status_code=409,
        error_code="CONFLICT",
        message=message,
        details={"resource": resource} if resource else {}
    )


def unauthorized(message: str = "Invalid API key or token") -> APIError:
    """Create a 401 Unauthorized error"""
    return APIError(
        status_code=401,
        error_code="UNAUTHORIZED",
        message=message
    )


def forbidden(message: str = "Access denied") -> APIError:
    """Create a 403 Forbidden error"""
    return APIError(
        status_code=403,
        error_code="FORBIDDEN",
        message=message
    )


def internal_error(message: str = "An unexpected error occurred", error: Exception = None) -> APIError:
    """Create a 500 Internal Server Error"""
    details = {}
    if error:
        details["exception"] = str(error)
    return APIError(
        status_code=500,
        error_code="INTERNAL_ERROR",
        message=message,
        details=details
    )

# Database pool - set by main.py on startup
db_pool: Optional[asyncpg.Pool] = None


def set_db_pool(pool: asyncpg.Pool):
    """Set the database pool (called from main.py startup)"""
    global db_pool
    db_pool = pool


async def get_db() -> asyncpg.Pool:
    """Dependency to get database pool"""
    if db_pool is None:
        raise HTTPException(status_code=503, detail="Database not available")
    return db_pool


def _permissions_for_scopes(scopes: list) -> list:
    """Map API key scopes to specific permissions (P1-1 fix)."""
    SCOPE_PERMISSIONS = {
        "agent": [
            "inventory:write", "jobs:read", "jobs:poll",
            "terminal:pending", "nodes:heartbeat",
        ],
        "admin": ["*"],
        "read": [
            "nodes:read", "groups:read", "jobs:read", "packages:read",
            "deployments:read", "alerts:read", "eventlog:read",
            "compliance:read", "settings:read", "reports:read",
        ],
        "write": [
            "nodes:read", "nodes:write", "groups:read", "groups:write",
            "jobs:read", "jobs:create", "jobs:execute", "jobs:cancel",
            "packages:read", "packages:write", "packages:deploy",
            "deployments:read", "deployments:write",
            "alerts:read", "alerts:write", "eventlog:read",
            "compliance:read", "settings:read", "reports:read",
        ],
    }
    permissions: set = set()
    for scope in scopes:
        perms = SCOPE_PERMISSIONS.get(scope, [])
        if "*" in perms:
            return ["*"]
        permissions.update(perms)
    return list(permissions)


async def verify_api_key(
    request: Request = None,
    x_api_key: str = Header(None),
    authorization: str = Header(None)
):
    """Verify API key or JWT token from header"""
    # Check JWT Bearer token first
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            import jwt

            from auth import JWT_SECRET
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            if payload.get("type") != "access":
                pass  # Fall through, don't accept refresh tokens
            else:
                return payload
        except Exception:
            pass  # Fall through to API key check
    
    # Check X-API-Key against centralized key
    if x_api_key and x_api_key == API_KEY:
        return x_api_key
    
    # Check X-API-Key against user-generated keys in DB
    if x_api_key and hasattr(request, 'app'):
        try:
            from auth import hash_api_key
            key_hash = hash_api_key(x_api_key)
            async with db_pool.acquire() as conn:
                row = await conn.fetchrow(
                    """SELECT id, user_id, name, scopes FROM api_keys 
                       WHERE key_hash = $1 AND is_active = true 
                       AND (expires_at IS NULL OR expires_at > NOW())""",
                    key_hash
                )
                if row:
                    # Update last_used
                    await conn.execute(
                        "UPDATE api_keys SET last_used = NOW() WHERE id = $1",
                        row["id"]
                    )
                    scopes = list(row["scopes"]) if row["scopes"] else ["agent"]
                    # Store scopes in request state for downstream dependencies
                    if request:
                        request.state.api_key_scopes = scopes
                    # Map scopes to specific permissions
                    permissions = _permissions_for_scopes(scopes)
                    return {"sub": str(row["user_id"]) if row["user_id"] else "system", 
                            "api_key_name": row["name"], "permissions": permissions,
                            "scopes": scopes}
        except Exception:
            pass  # DB not ready or other error, fall through
    
    # Neither valid
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid API key or token"
    )


async def verify_api_key_or_query(
    request: Request,
    x_api_key: str = Header(None),
    authorization: str = Header(None),
):
    """Verify API key or JWT token from header OR query param (for SSE)"""
    token = request.query_params.get("token")
    if token:
        if token == API_KEY:
            return token
        try:
            import jwt

            from auth import JWT_SECRET
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            return payload
        except Exception:
            pass
    
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization[7:]
        try:
            import jwt

            from auth import JWT_SECRET
            payload = jwt.decode(auth_token, JWT_SECRET, algorithms=["HS256"])
            return payload
        except Exception:
            pass
    
    if x_api_key == API_KEY:
        return x_api_key
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid API key or token"
    )


# ============== API Key Scopes ==============

SCOPES = {
    "agent": "Agent inventory/job operations",
    "admin": "Full administrative access",
    "read": "Read-only access",
    "write": "Read-write access",
}


def require_scope(scope: str):
    """Dependency that checks if the current API key has the required scope.
    Must be used after verify_api_key has run (which sets request.state.api_key_scopes).
    JWT-authenticated users (human auth) bypass scope checks.
    """
    async def scope_checker(request: Request, auth=Depends(verify_api_key)):
        # JWT users bypass scope checks (they use role-based permissions)
        if isinstance(auth, dict) and "scopes" not in auth:
            return auth
        # Centralized API key (env var) gets all scopes
        if isinstance(auth, str):
            return auth
        # Check scopes from API key
        scopes = getattr(request.state, "api_key_scopes", [])
        if "admin" in scopes or scope in scopes:
            return auth
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API key missing required scope: {scope}"
        )
    return scope_checker


def sanitize_for_postgres(value: Any) -> Any:
    """Remove null bytes and other problematic characters from strings"""
    if value is None:
        return None
    if isinstance(value, str):
        return value.replace('\x00', '').replace('\u0000', '')
    if isinstance(value, dict):
        return {k: sanitize_for_postgres(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_for_postgres(item) for item in value]
    return value


def parse_datetime(value: str | None) -> Any:
    """Parse datetime string to timestamp or None"""
    if not value:
        return None
    try:
        from datetime import datetime
        if 'T' in value:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%m/%d/%Y']:
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        return None
    except Exception:
        return None


def get_username_from_auth(auth: Any) -> str:
    """Extract username from JWT payload or return 'api-key'"""
    if isinstance(auth, dict):
        return auth.get("sub") or auth.get("username") or auth.get("email", "unknown")
    return "api-key"

def get_pool():
    """Get the current database pool (non-async, for direct use)"""
    return db_pool


# ============== Audit Logging ==============

async def log_audit(conn, user_id, action: str, resource_type: str, resource_id: str = None, details: dict = None, ip: str = None):
    """Write a row into audit_log."""
    import json as _json
    await conn.execute(
        """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)""",
        user_id, action, resource_type, resource_id,
        _json.dumps(details) if details else None, ip
    )


# ============== Scoped Permission Check ==============

def require_scoped_permission(permission: str, group_id_param: str = "group_id"):
    """Check if user has permission globally OR for the specific group."""
    from auth import CurrentUser, require_auth
    async def checker(request: Request, user: CurrentUser = Depends(require_auth), db: asyncpg.Pool = Depends(get_db)):
        # Superusers / wildcard bypass
        if user.is_superuser or "*" in (user.permissions or []):
            return user
        # Check if user has the permission globally (already in JWT)
        if permission in (user.permissions or []):
            return user
        # Check scoped permissions via DB
        group_id = request.path_params.get(group_id_param) or request.query_params.get(group_id_param)
        if group_id:
            async with db.acquire() as conn:
                row = await conn.fetchval(
                    """SELECT 1 FROM role_scopes rs
                       JOIN roles r ON r.id = rs.role_id
                       WHERE rs.user_id = $1 AND rs.group_id = $2
                         AND $3 = ANY(r.permissions)""",
                    UUID(user.id), UUID(group_id), permission
                )
                if row:
                    return user
        raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")
    return checker
