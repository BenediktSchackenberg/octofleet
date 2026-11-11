"""Job command types and the database check that allows them.

The agents pick a handler by `jobs.command_type`; the column has a CHECK constraint, so a type the
server creates must be listed there, or the insert fails.
"""
import re

import asyncpg

# Every command type the server creates (UI, API, services, patches, node removal)
JOB_COMMAND_TYPES = (
    "run", "script", "inventory", "install_package", "uninstall_package", "update_package",
    "restart-agent", "patch_install", "patch_scan", "uninstall-agent",
    # the Services module (services_mgmt.py) creates it; both agents handle it
    "service_reconcile",
)


async def ensure_command_types(conn, types=JOB_COMMAND_TYPES) -> None:
    """Add missing types to jobs_command_type_check, keeping the values it already allows."""
    definition = await conn.fetchval("""
        SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conname = 'jobs_command_type_check' AND conrelid = 'jobs'::regclass
    """)
    if not definition:
        return
    current = re.findall(r"'([^']+)'::text", definition)
    missing = [t for t in types if t not in current]
    if not missing:
        return
    allowed = ", ".join("'" + v.replace("'", "''") + "'" for v in dict.fromkeys(current + missing))
    async with conn.transaction():
        await conn.execute("ALTER TABLE jobs DROP CONSTRAINT jobs_command_type_check")
        await conn.execute(
            f"ALTER TABLE jobs ADD CONSTRAINT jobs_command_type_check CHECK (command_type IN ({allowed}))")


async def ensure_schema(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await ensure_command_types(conn)
