"""Admin -> Settings -> Logging: GET/PUT /api/v1/settings/logging (see logging_config.py)."""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException

import logging_config
from auth import require_user_permission
from dependencies import get_pool

router = APIRouter(tags=["settings"])


@router.get("/api/v1/settings/logging", dependencies=[Depends(require_user_permission("settings:read"))])
async def get_logging_setting():
    """The backend's log level and access log (`all` / `errors_slow` / `off`, `slow_ms`), as applied now."""
    return {**logging_config.current(), "defaults": logging_config.DEFAULTS}


@router.put("/api/v1/settings/logging")
async def put_logging_setting(data: dict, user=Depends(require_user_permission("settings:write"))):
    """Change the log level and the access log; applies at once, no restart. Audited."""
    try:
        setting = logging_config.validate(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    before = logging_config.current()
    username = getattr(user, "username", None) or "system"
    pool = get_pool()
    await logging_config.save(pool, setting, username)
    try:
        user_id = uuid.UUID(str(getattr(user, "id", "")))
    except ValueError:
        user_id = None
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
               VALUES ($1, 'settings.logging', 'settings', 'logging', $2::jsonb)""",
            user_id, json.dumps({"by": username, "before": before, "after": setting}))
    return {**setting, "defaults": logging_config.DEFAULTS}
