"""Admin-only password policy settings."""

from fastapi import APIRouter, Depends
from uuid import UUID

from auth import CurrentUser, require_permission
from dependencies import get_db
from password_policy import POLICY_KEY, PasswordPolicy, load_policy

router = APIRouter(prefix="/api/v1/security/password-policy", tags=["security"])


@router.get("", response_model=PasswordPolicy)
async def get_password_policy(user: CurrentUser = Depends(require_permission("settings:write")), db=Depends(get_db)):
    async with db.acquire() as conn:
        return await load_policy(conn)


@router.put("", response_model=PasswordPolicy)
async def put_password_policy(policy: PasswordPolicy, user: CurrentUser = Depends(require_permission("settings:write")), db=Depends(get_db)):
    async with db.acquire() as conn:
        async with conn.transaction():
            await conn.execute("""INSERT INTO system_settings (key, value, updated_at, updated_by)
                VALUES ($1, $2, NOW(), $3)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
                    updated_at = NOW(), updated_by = EXCLUDED.updated_by""",
                POLICY_KEY, policy.model_dump_json(), user.username)
            await conn.execute("""INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
                VALUES ($1, 'security.password_policy_updated', 'system_settings', $2, $3::jsonb)""",
                None if user.id == "system" else UUID(user.id), POLICY_KEY, policy.model_dump_json())
    return policy
