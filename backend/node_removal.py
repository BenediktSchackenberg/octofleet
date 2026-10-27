"""Removing nodes: uninstall the agent and, optionally, delete the node (#160).

Flow:
  1. request_uninstall() queues an `uninstall-agent` job for the node and marks it
     `uninstall_pending`. The agent reports the job as successful and then removes itself.
  2. process_removals() runs in the background: once the job has succeeded the node is
     marked `uninstalled`, and deleted if the admin chose "uninstall and delete".
     A failed job marks the node `uninstall_failed`.
  3. delete_node() removes the node and all of its data. It is allowed once the agent is
     uninstalled, or with force after NODE_REMOVAL_FORCE_DELETE_HOURS (the agent never
     confirmed, e.g. the machine is gone).

Deleting only the database rows of a running agent is not offered: it would register again.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import asyncpg

log = logging.getLogger(__name__)

UNINSTALL_COMMAND = "uninstall-agent"
FORCE_DELETE_AFTER = timedelta(hours=float(os.getenv("NODE_REMOVAL_FORCE_DELETE_HOURS", "24")))
PROCESS_INTERVAL_SECONDS = float(os.getenv("NODE_REMOVAL_PROCESS_INTERVAL", "60"))

PENDING = "uninstall_pending"
FAILED = "uninstall_failed"
UNINSTALLED = "uninstalled"

REMOVAL_COLUMNS = (
    "removal_state", "removal_requested_at", "removal_requested_by",
    "removal_delete_after", "removal_job_id", "removal_token_hash",
    "removal_confirmed_at", "uninstalled_at",
)


async def ensure_schema(conn) -> None:
    """Idempotent schema changes for node removal (existing installs get them at startup)."""
    await conn.execute("""
        ALTER TABLE nodes
            ADD COLUMN IF NOT EXISTS removal_state TEXT,
            ADD COLUMN IF NOT EXISTS removal_requested_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS removal_requested_by TEXT,
            ADD COLUMN IF NOT EXISTS removal_delete_after BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS removal_job_id UUID,
            ADD COLUMN IF NOT EXISTS removal_token_hash TEXT,
            ADD COLUMN IF NOT EXISTS removal_confirmed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS uninstalled_at TIMESTAMPTZ
    """)
    # Allow the new job type in the jobs command_type check, keeping the existing values
    definition = await conn.fetchval("""
        SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conname = 'jobs_command_type_check' AND conrelid = 'jobs'::regclass
    """)
    if definition and f"'{UNINSTALL_COMMAND}'" not in definition:
        values = re.findall(r"'([^']+)'::text", definition) + [UNINSTALL_COMMAND]
        allowed = ", ".join("'" + v.replace("'", "''") + "'" for v in dict.fromkeys(values))
        async with conn.transaction():
            await conn.execute("ALTER TABLE jobs DROP CONSTRAINT jobs_command_type_check")
            await conn.execute(
                f"ALTER TABLE jobs ADD CONSTRAINT jobs_command_type_check CHECK (command_type IN ({allowed}))")


async def ensure_schema_on(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await ensure_schema(conn)


def removal_info(row) -> dict:
    """Removal fields of a node row for API responses."""
    state = row.get("removal_state")
    requested_at = row.get("removal_requested_at")
    force_after = requested_at + FORCE_DELETE_AFTER if requested_at else None
    return {
        "removalState": state,
        "removalRequestedAt": requested_at.isoformat() if requested_at else None,
        "removalRequestedBy": row.get("removal_requested_by"),
        "removalDeleteAfter": bool(row.get("removal_delete_after")),
        "uninstalledAt": row["uninstalled_at"].isoformat() if row.get("uninstalled_at") else None,
        "canDelete": state == UNINSTALLED,
        "forceDeleteAfter": force_after.isoformat() if force_after and state in (PENDING, FAILED) else None,
    }


def _audit_user_id(user) -> Optional[UUID]:
    try:
        return UUID(str(getattr(user, "id", "")))
    except ValueError:
        return None  # API keys have no user id; the name goes into the details


async def _audit(conn, user, action: str, node_uuid, details: dict) -> None:
    await conn.execute(
        """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
           VALUES ($1, $2, 'node', $3, $4::jsonb)""",
        _audit_user_id(user), action, str(node_uuid),
        json.dumps({"by": getattr(user, "username", None) or "system", **details}),
    )


async def find_node(conn, node_ref: str):
    return await conn.fetchrow(
        "SELECT * FROM nodes WHERE node_id = $1 OR id::text = $1", node_ref)


async def request_uninstall(conn, node, delete_after: bool, user) -> dict:
    """Queue the uninstall job and mark the node as pending."""
    if node["removal_state"] in (PENDING, UNINSTALLED):
        raise ValueError(f"Node is already {node['removal_state'].replace('_', ' ')}")
    job_id = await conn.fetchval("SELECT gen_random_uuid()")
    confirmation_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(confirmation_token.encode()).hexdigest()
    requested_by = getattr(user, "username", None) or "api"
    async with conn.transaction():
        await conn.execute("""
            INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data, created_by)
            VALUES ($1, $2, $3, 'device', $4, $5, $6::jsonb, $7)
        """, job_id, f"Uninstall agent: {node['hostname']}",
            "Removes the Octofleet agent from this machine" + (" and then deletes the node" if delete_after else ""),
            node["id"], UNINSTALL_COMMAND, json.dumps({
                "delaySeconds": 10,
                "confirmationNodeId": str(node["id"]),
                "confirmationToken": confirmation_token,
            }), requested_by)
        await conn.execute("""
            INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
            VALUES (gen_random_uuid(), $1, $2, 'pending', NOW())
        """, job_id, str(node["id"]))
        await conn.execute("""
            UPDATE nodes SET removal_state = $2, removal_requested_at = NOW(), removal_requested_by = $3,
                   removal_delete_after = $4, removal_job_id = $5, removal_token_hash = $6,
                   removal_confirmed_at = NULL, uninstalled_at = NULL, updated_at = NOW()
            WHERE id = $1
        """, node["id"], PENDING, requested_by, delete_after, job_id, token_hash)
        await _audit(conn, user, "node.uninstall_requested", node["id"],
                     {"hostname": node["hostname"], "deleteAfter": delete_after, "jobId": str(job_id)})
    return {"status": PENDING, "jobId": str(job_id), "deleteAfter": delete_after}


async def cancel_uninstall(conn, node, user) -> dict:
    """Withdraw a request the agent has not carried out yet."""
    if node["removal_state"] not in (PENDING, FAILED):
        raise ValueError("No pending uninstall request")
    async with conn.transaction():
        cancelled = await conn.execute("""
            UPDATE job_instances SET status = 'cancelled'
            WHERE job_id = $1 AND status IN ('pending', 'queued')
        """, node["removal_job_id"])
        if node["removal_state"] == PENDING and cancelled.endswith(" 0"):
            raise ValueError("The agent has already picked up the uninstall job")
        await conn.execute("""
            UPDATE nodes SET removal_state = NULL, removal_requested_at = NULL, removal_requested_by = NULL,
                   removal_delete_after = false, removal_job_id = NULL, removal_token_hash = NULL,
                   removal_confirmed_at = NULL, updated_at = NOW()
            WHERE id = $1
        """, node["id"])
        await _audit(conn, user, "node.uninstall_cancelled", node["id"], {"hostname": node["hostname"]})
    return {"status": "cancelled"}


def deletion_blocker(node, force: bool, now: Optional[datetime] = None) -> Optional[str]:
    """Why the node cannot be deleted now, or None."""
    state = node["removal_state"]
    if state == UNINSTALLED:
        return None
    if state not in (PENDING, FAILED):
        return "Uninstall the agent first; a running agent would register the node again"
    allowed_at = node["removal_requested_at"] + FORCE_DELETE_AFTER
    if (now or datetime.now(timezone.utc)) < allowed_at:
        return f"The agent has not confirmed the uninstall; deleting anyway is possible from {allowed_at.isoformat()}"
    if not force:
        return "The agent has not confirmed the uninstall; repeat with force=true to delete the node anyway"
    return None


async def _node_text_tables(conn) -> list[str]:
    """Tables that reference nodes only by a text node_id (no foreign key, not cleaned up by cascade)."""
    rows = await conn.fetch("""
        SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'node_id'
          AND c.data_type IN ('text', 'character varying') AND c.table_name <> 'nodes'
        ORDER BY c.table_name
    """)
    return [r["table_name"] for r in rows]


async def _blocking_fk_tables(conn) -> list[tuple[str, str, str]]:
    """Foreign keys to nodes without ON DELETE CASCADE / SET NULL (they would block the delete).

    Returns (table, column, referenced nodes column); most reference nodes.id, some nodes.node_id.
    """
    rows = await conn.fetch("""
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, fa.attname AS refcol
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = ANY(c.confkey)
        WHERE c.contype = 'f' AND c.confrelid = 'nodes'::regclass AND c.confdeltype IN ('a', 'r')
    """)
    return [(r["tbl"], r["col"], r["refcol"]) for r in rows]


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


async def delete_node(conn, node, user, forced: bool = False) -> dict:
    """Delete the node and all of its data in one transaction."""
    keys = list(dict.fromkeys([str(node["id"]), node["node_id"]]))
    removed = {}
    async with conn.transaction():
        for table in await _node_text_tables(conn):
            result = await conn.execute(f"DELETE FROM {_ident(table)} WHERE node_id = ANY($1::text[])", keys)
            if not result.endswith(" 0"):
                removed[table] = int(result.split()[-1])
        for table, column, refcol in await _blocking_fk_tables(conn):
            result = await conn.execute(
                f"DELETE FROM {table} WHERE {_ident(column)} = $1", node[refcol])  # regclass text is already quoted
            if not result.endswith(" 0"):
                removed[table] = int(result.split()[-1])
        await conn.execute("DELETE FROM nodes WHERE id = $1", node["id"])  # cascades to the remaining tables
        await _audit(conn, user, "node.deleted", node["id"], {
            "hostname": node["hostname"], "nodeId": node["node_id"], "forced": forced,
            "uninstalledAt": node["uninstalled_at"].isoformat() if node["uninstalled_at"] else None,
            "removedRows": removed})
    return {"status": "deleted", "removedRows": removed}


async def confirm_uninstall(conn, node_ref: str, token: str) -> bool:
    """Accept one completion signal from the detached uninstall process."""
    async with conn.transaction():
        node = await find_node(conn, node_ref)
        if not node or node["removal_state"] != PENDING or not node["removal_token_hash"]:
            return False
        received_hash = hashlib.sha256(token.encode()).hexdigest()
        if not hmac.compare_digest(received_hash, node["removal_token_hash"]):
            return False
        await conn.execute(
            """UPDATE nodes SET removal_confirmed_at = NOW(), removal_token_hash = NULL
               WHERE id = $1""", node["id"]
        )
        await _audit(conn, _System, "node.uninstall_confirmed", node["id"],
                     {"hostname": node["hostname"]})
    return True


class _System:
    username = "system"
    id = None


async def process_removals(pool: asyncpg.Pool) -> None:
    """Apply the agents' results to pending removals."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.id, ji.status FROM nodes n
            JOIN job_instances ji ON ji.job_id = n.removal_job_id AND ji.node_id::text = n.id::text
            WHERE n.removal_state = $1 AND
                  (ji.status = 'failed' OR (ji.status = 'success' AND n.removal_confirmed_at IS NOT NULL))
        """, PENDING)
        for row in rows:
            node = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1", row["id"])
            if row["status"] == "failed":
                await conn.execute("UPDATE nodes SET removal_state = $2, updated_at = NOW() WHERE id = $1", node["id"], FAILED)
                await _audit(conn, _System, "node.uninstall_failed", node["id"], {"hostname": node["hostname"]})
                continue
            await conn.execute("""
                UPDATE nodes SET removal_state = $2, uninstalled_at = NOW(), is_online = false, updated_at = NOW()
                WHERE id = $1
            """, node["id"], UNINSTALLED)
            await _audit(conn, _System, "node.uninstalled", node["id"], {"hostname": node["hostname"]})
            if node["removal_delete_after"]:
                node = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1", node["id"])
                await delete_node(conn, node, _System)


async def removal_loop(pool: asyncpg.Pool) -> None:
    while True:
        try:
            await process_removals(pool)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Processing node removals failed")
        await asyncio.sleep(PROCESS_INTERVAL_SECONDS)


async def reactivate_if_reinstalled(conn, node_uuid, hostname: str) -> None:
    """An agent reporting for an uninstalled node means the machine was set up again."""
    result = await conn.execute("""
        UPDATE nodes SET removal_state = NULL, removal_requested_at = NULL, removal_requested_by = NULL,
               removal_delete_after = false, removal_job_id = NULL, removal_token_hash = NULL,
               removal_confirmed_at = NULL, uninstalled_at = NULL
        WHERE id = $1 AND removal_state = $2
    """, node_uuid, UNINSTALLED)
    if not result.endswith(" 0"):
        await _audit(conn, _System, "node.reinstalled", node_uuid, {"hostname": hostname})
