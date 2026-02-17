"""
Shared dependencies for Octofleet API routers
"""
from fastapi import Depends, HTTPException, Header, status, Request
from fastapi.responses import JSONResponse
import asyncpg
from typing import Optional, Any
import os
import json

# Config
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://octofleet:octofleet_inventory_2026@127.0.0.1:5432/inventory"
)
API_KEY = os.getenv("INVENTORY_API_KEY", "octofleet-inventory-dev-key")
GATEWAY_URL = os.getenv("OCTOFLEET_GATEWAY_URL", "http://192.168.0.5:18789")
GATEWAY_TOKEN = os.getenv("OCTOFLEET_GATEWAY_TOKEN", "")
INVENTORY_API_URL = os.getenv("OCTOFLEET_INVENTORY_URL", "http://192.168.0.5:8080")

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


async def verify_api_key(
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
            return payload  # Valid JWT
        except Exception:
            pass  # Fall through to API key check
    
    # Check X-API-Key
    if x_api_key == API_KEY:
        return x_api_key
    
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
