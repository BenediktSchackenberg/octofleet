"""Removing nodes: uninstall the agent and, optionally, delete the node (#160).

Flow:
  1. request_uninstall() queues an `uninstall-agent` job for the node and marks it
     `uninstall_pending`. The job carries a one-time completion token (only its hash is
     kept on the node).
  2. The agent starts its detached removal script and reports the job as successful:
     process_removals() marks the node `uninstall_running` - the removal has only started.
  3. The removal script, after the service is gone, calls POST /api/v1/agent/uninstall-complete
     with the token (complete_uninstall()): the node becomes `uninstalled`, or
     `uninstall_failed` if the script reports a failure. Without a signal within
     NODE_REMOVAL_COMPLETE_TIMEOUT_MINUTES the node becomes `uninstall_failed`.
  4. For "uninstall and delete", process_removals() deletes the node on its next run - unless
     the node reported after the completion signal (then the agent is still running).
  5. delete_node() removes the node and all of its data. It is allowed once the agent is
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
COMPLETE_TIMEOUT = timedelta(minutes=float(os.getenv("NODE_REMOVAL_COMPLETE_TIMEOUT_MINUTES", "15")))
COMPLETION_PATH = "/api/v1/agent/uninstall-complete"

PENDING = "uninstall_pending"
RUNNING = "uninstall_running"
FAILED = "uninstall_failed"
UNINSTALLED = "uninstalled"

REMOVAL_COLUMNS = (
    "removal_state", "removal_requested_at", "removal_requested_by",
    "removal_delete_after", "removal_job_id", "uninstalled_at",
    "removal_running_at", "removal_error",
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
            ADD COLUMN IF NOT EXISTS uninstalled_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS removal_token_hash TEXT,
            ADD COLUMN IF NOT EXISTS removal_running_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS removal_error TEXT
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
        "removalError": row.get("removal_error"),
        "canDelete": state == UNINSTALLED,
        "forceDeleteAfter": force_after.isoformat() if force_after and state in (PENDING, RUNNING, FAILED) else None,
    }


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


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
    if node["removal_state"] in (PENDING, RUNNING, UNINSTALLED):
        raise ValueError(f"Node is already {node['removal_state'].replace('_', ' ')}")
    job_id = await conn.fetchval("SELECT gen_random_uuid()")
    # The removal script confirms the finished uninstall with this token; it only
    # completes this one request and is discarded on use or when the request ends.
    token = secrets.token_urlsafe(32)
    payload = {"delaySeconds": 10, "nodeId": node["node_id"], "completionToken": token,
               "completionPath": COMPLETION_PATH}
    requested_by = getattr(user, "username", None) or "api"
    async with conn.transaction():
        await conn.execute("""
            INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data, created_by)
            VALUES ($1, $2, $3, 'device', $4, $5, $6::jsonb, $7)
        """, job_id, f"Uninstall agent: {node['hostname']}",
            "Removes the Octofleet agent from this machine" + (" and then deletes the node" if delete_after else ""),
            node["id"], UNINSTALL_COMMAND, json.dumps(payload), requested_by)
        await conn.execute("""
            INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
            VALUES (gen_random_uuid(), $1, $2, 'pending', NOW())
        """, job_id, str(node["id"]))
        await conn.execute("""
            UPDATE nodes SET removal_state = $2, removal_requested_at = NOW(), removal_requested_by = $3,
                   removal_delete_after = $4, removal_job_id = $5, uninstalled_at = NULL,
                   removal_token_hash = $6, removal_running_at = NULL, removal_error = NULL, updated_at = NOW()
            WHERE id = $1
        """, node["id"], PENDING, requested_by, delete_after, job_id, _token_hash(token))
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
                   removal_running_at = NULL, removal_error = NULL, updated_at = NOW()
            WHERE id = $1
        """, node["id"])
        await _audit(conn, user, "node.uninstall_cancelled", node["id"], {"hostname": node["hostname"]})
    return {"status": "cancelled"}


async def complete_uninstall(conn, node_ref: str, token: str, success: bool, details: Optional[dict]) -> bool:
    """Completion signal from the removal script. Returns False for an unknown node,
    a node without an active removal or a wrong token (all answered the same way)."""
    node = await find_node(conn, node_ref)
    if (not node or node["removal_state"] not in (PENDING, RUNNING) or not node["removal_token_hash"]
            or not hmac.compare_digest(node["removal_token_hash"], _token_hash(token))):
        return False
    details = details if isinstance(details, dict) else {}
    async with conn.transaction():
        if success:
            await conn.execute("""
                UPDATE nodes SET removal_state = $2, uninstalled_at = NOW(), is_online = false,
                       removal_token_hash = NULL, removal_error = NULL, updated_at = NOW()
                WHERE id = $1
            """, node["id"], UNINSTALLED)
            await _audit(conn, _System, "node.uninstalled", node["id"],
                         {"hostname": node["hostname"], "details": details})
        else:
            reason = str(details.get("reason") or "The removal script reported a failure")[:500]
            await _fail(conn, node, reason, details)
    return True


async def _fail(conn, node, reason: str, details: Optional[dict] = None) -> None:
    await conn.execute("""
        UPDATE nodes SET removal_state = $2, removal_error = $3, removal_token_hash = NULL, updated_at = NOW()
        WHERE id = $1
    """, node["id"], FAILED, reason)
    await _audit(conn, _System, "node.uninstall_failed", node["id"],
                 {"hostname": node["hostname"], "reason": reason, **({"details": details} if details else {})})


def deletion_blocker(node, force: bool, now: Optional[datetime] = None) -> Optional[str]:
    """Why the node cannot be deleted now, or None."""
    state = node["removal_state"]
    if state == UNINSTALLED:
        return None
    if state not in (PENDING, RUNNING, FAILED):
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


class _System:
    username = "system"
    id = None


async def process_removals(pool: asyncpg.Pool) -> None:
    """Move removals on: job results, missing completion signals, deletion after uninstall."""
    async with pool.acquire() as conn:
        # Job result: success only means the agent started its removal script
        rows = await conn.fetch("""
            SELECT n.id, ji.status, ji.stdout, ji.stderr FROM nodes n
            JOIN job_instances ji ON ji.job_id = n.removal_job_id AND ji.node_id::text = n.id::text
            WHERE n.removal_state = $1 AND ji.status IN ('success', 'failed')
        """, PENDING)
        for row in rows:
            node = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1", row["id"])
            if row["status"] == "failed":
                output = (row["stderr"] or row["stdout"] or "").strip()[:300]
                await _fail(conn, node, "The agent could not start the removal" + (f": {output}" if output else ""))
                continue
            await conn.execute("""
                UPDATE nodes SET removal_state = $2, removal_running_at = NOW(), updated_at = NOW()
                WHERE id = $1 AND removal_state = $3
            """, node["id"], RUNNING, PENDING)
            await _audit(conn, _System, "node.uninstall_started", node["id"], {"hostname": node["hostname"]})

        # Removal started, but the script never confirmed it
        minutes = int(COMPLETE_TIMEOUT.total_seconds() // 60)
        for node in await conn.fetch("""
            SELECT * FROM nodes WHERE removal_state = $1 AND removal_running_at < NOW() - $2::interval
        """, RUNNING, COMPLETE_TIMEOUT):
            await _fail(conn, node, f"No completion signal from the removal script within {minutes} minutes")

        # Uninstalled and to be deleted: only if the node did not report after the signal
        for node in await conn.fetch("""
            SELECT * FROM nodes WHERE removal_state = $1 AND removal_delete_after
        """, UNINSTALLED):
            if node["last_seen"] and node["uninstalled_at"] and node["last_seen"] > node["uninstalled_at"]:
                await _fail(conn, node, "The agent still reported after its completion signal; the node was not deleted")
                continue
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
    """An agent reporting for an uninstalled node means the machine was set up again -
    unless the node was waiting for its deletion: then the agent never went away."""
    node = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1 AND removal_state = $2", node_uuid, UNINSTALLED)
    if not node:
        return
    if node["removal_delete_after"]:
        await _fail(conn, node, "The agent still reported after its completion signal; the node was not deleted")
        return
    await conn.execute("""
        UPDATE nodes SET removal_state = NULL, removal_requested_at = NULL, removal_requested_by = NULL,
               removal_delete_after = false, removal_job_id = NULL, uninstalled_at = NULL,
               removal_token_hash = NULL, removal_running_at = NULL, removal_error = NULL
        WHERE id = $1
    """, node_uuid)
    await _audit(conn, _System, "node.reinstalled", node_uuid, {"hostname": hostname})
