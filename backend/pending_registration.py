"""Self-registration of new agents (POST /nodes/register, GET /pending-nodes/{id}/config).

The agent has no key yet when it registers. It gets a random one-time secret with its pending ID and
sends it (X-Registration-Secret) when it polls for its configuration; only the hash is stored. After
approval the configuration (with the agent key) is handed out once, then the secret is invalid.
"""
import hashlib
import hmac
import secrets
from typing import Optional

SECRET_HEADER = "X-Registration-Secret"


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def secret_matches(stored_hash: Optional[str], secret: Optional[str]) -> bool:
    """False without a stored hash (registered by an older agent, or the configuration was already
    handed out) or without a secret."""
    if not stored_hash or not secret:
        return False
    return hmac.compare_digest(stored_hash, hash_secret(secret))


async def ensure_schema(pool):
    """The columns the registration uses, for existing databases too (schema-full.sql had only the
    first ones). IDs stay as they are (serial or UUID): the routes compare them as text."""
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS pending_nodes (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                hostname text, os_name text, os_version text, ip_address text,
                agent_version text, machine_id text, status text DEFAULT 'pending',
                config_fetched_at timestamptz, created_at timestamptz DEFAULT now()
            )
        """)
        await conn.execute("""
            ALTER TABLE pending_nodes
                ADD COLUMN IF NOT EXISTS approved_at timestamptz,
                ADD COLUMN IF NOT EXISTS approved_by text,
                ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
                ADD COLUMN IF NOT EXISTS rejected_by text,
                ADD COLUMN IF NOT EXISTS secret_hash text
        """)
