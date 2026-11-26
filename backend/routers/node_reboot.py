"""Reboot nodes (Windows and Linux) from the node page and Fleet updates: see node_reboot.py."""
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

import node_reboot
from auth import require_user_permission
from dependencies import get_db, not_found

router = APIRouter(prefix="/api/v1/nodes", tags=["nodes"])


@router.post("/reboot/preview")
async def reboot_preview(data: dict, _user=Depends(require_user_permission("nodes:reboot")),
                         db: asyncpg.Pool = Depends(get_db)):
    """What a reboot would interrupt on each node: logged-on users (`null` when the agent does not
    report them), jobs that have not finished, open terminal/screen/shell sessions, a reboot that is
    already scheduled, and `blocker` when no job would be created."""
    try:
        uuids = node_reboot.node_ids(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    async with db.acquire() as conn:
        return {"nodes": await node_reboot.preview(conn, uuids)}


@router.post("/reboot")
async def reboot_nodes(data: dict, user=Depends(require_user_permission("nodes:reboot")),
                       db: asyncpg.Pool = Depends(get_db)):
    """Reboot the nodes: `{"node_ids": [...], "when": "now" | "in" | "at", "minutes": N (for in),
    "at": ISO 8601 with offset (for at), "message": "..."}` - one `reboot` job per node, audited.
    `{"node_ids": [...], "action": "cancel"}` withdraws a scheduled reboot. Returns `jobs` and `skipped`."""
    try:
        uuids = node_reboot.node_ids(data)
        payload = node_reboot.parse_request(data, datetime.now(timezone.utc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    async with db.acquire() as conn, conn.transaction():
        # one request at a time per node set: two people pressing Reboot get one job each, not a race
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext('octofleet:node-reboot'))")
        return await node_reboot.create_jobs(conn, uuids, payload, user)


@router.get("/{node_id}/reboot", dependencies=[Depends(require_user_permission("nodes:read"))])
async def node_reboot_state(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """The node's newest reboot until it has reported after it: `state` scheduled / restarting /
    failed with `restart_at`, `job_id`, `error`; `null` when nothing is pending. Also `reported_at`
    (the node's last update report: Windows update search or Linux update list) and
    `last_boot_time` (as the agent reported it, see GET /inventory/system): the node page polls this
    route anyway and reloads its update data when either changes, e.g. after a reboot."""
    async with db.acquire() as conn:
        uid = await conn.fetchval("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if uid is None:
            raise not_found("Node", node_id)
        row = (await node_reboot.node_states(conn, [str(uid)])).get(str(uid))
        last_boot = await conn.fetchval("SELECT last_boot_time FROM system_current WHERE node_id = $1", uid)
        reported = row["reported_at"] if row else None
        return {"reboot": row["reboot"] if row else None,
                "reported_at": reported.isoformat() if reported else None,
                "last_boot_time": last_boot.isoformat() if last_boot else None}
