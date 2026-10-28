"""Password policy and password history for local accounts."""

import re
from datetime import datetime, timezone
from typing import Optional

import asyncpg
from fastapi import HTTPException
from pydantic import BaseModel, Field

from auth import verify_password

POLICY_KEY = "password_policy"


class PasswordPolicy(BaseModel):
    min_length: int = Field(default=12, ge=12, le=72)
    require_uppercase: bool = False
    require_lowercase: bool = False
    require_digit: bool = False
    require_symbol: bool = False
    max_age_days: Optional[int] = Field(default=None, ge=1, le=3650)
    history_count: int = Field(default=0, ge=0, le=10)


async def ensure_schema(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
        await conn.execute("""CREATE TABLE IF NOT EXISTS password_history (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history (user_id, created_at DESC, id DESC)")


async def load_policy(conn: asyncpg.Connection) -> PasswordPolicy:
    raw = await conn.fetchval("SELECT value FROM system_settings WHERE key = $1", POLICY_KEY)
    if not raw:
        return PasswordPolicy()
    return PasswordPolicy.model_validate_json(raw)


def password_expired(changed_at: datetime, policy: PasswordPolicy) -> bool:
    if policy.max_age_days is None:
        return False
    from datetime import timedelta
    return datetime.now(timezone.utc) >= changed_at + timedelta(days=policy.max_age_days)


async def validate_password(conn: asyncpg.Connection, password: str, username: str,
                            user_id=None, current_hash: str | None = None,
                            policy: PasswordPolicy | None = None) -> PasswordPolicy:
    policy = policy or await load_policy(conn)
    if len(password) < policy.min_length or len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail=f"Password must be at least {policy.min_length} characters and at most 72 bytes")
    if password.casefold() == username.casefold():
        raise HTTPException(status_code=400, detail="Password must differ from username")
    checks = (
        (policy.require_uppercase, r"[A-Z]", "uppercase letter"),
        (policy.require_lowercase, r"[a-z]", "lowercase letter"),
        (policy.require_digit, r"[0-9]", "digit"),
        (policy.require_symbol, r"[^A-Za-z0-9]", "symbol"),
    )
    for required, pattern, label in checks:
        if required and not re.search(pattern, password):
            raise HTTPException(status_code=400, detail=f"Password must contain a {label}")
    if current_hash and verify_password(password, current_hash):
        raise HTTPException(status_code=400, detail="Choose a different password")
    if user_id is not None and policy.history_count:
        hashes = await conn.fetch("""SELECT password_hash FROM password_history WHERE user_id = $1
            ORDER BY created_at DESC, id DESC LIMIT $2""", user_id, policy.history_count)
        if any(verify_password(password, row["password_hash"]) for row in hashes):
            raise HTTPException(status_code=400, detail="Password was used recently")
    return policy


async def record_previous_password(conn: asyncpg.Connection, user_id, old_hash: str,
                                   policy: PasswordPolicy) -> None:
    if policy.history_count:
        await conn.execute("INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)", user_id, old_hash)
        await conn.execute("""DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (
            SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2
        )""", user_id, policy.history_count)
