"""Agent Monitor (Admin → Agent Monitor): agents with their latest requests, and sampled requests.

Both routes read the in-memory state of `agent_monitor`; the only database reads are the shared,
cached job counts (one grouped query per JOB_COUNTS_TTL_SECONDS for all viewers)."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from agent_monitor import ACTIONS, monitor
from auth import require_user_permission
from dependencies import get_pool

router = APIRouter(prefix="/api/v1/admin", tags=["Agent Monitor"])


@router.get("/agent-status", dependencies=[Depends(require_user_permission("settings:read"))])
async def get_agent_status(
    q: str = Query("", max_length=200, description="Part of the hostname, or a pattern with * and ?"),
    status: Literal["", "active", "idle", "stale", "offline", "unknown", "errors"] = "",
    sort: Literal["hostname", "last_seen", "errors"] = "hostname",
    dir: Literal["asc", "desc"] = "asc",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Agents in a stable order (hostname, case-insensitive) with search, status filter and paging.
    `summary` counts all agents, independent of the filter."""
    counts = await monitor.job_counts(get_pool())
    return monitor.agents(counts, q=q.strip(), status=status, sort=sort, direction=dir, limit=limit, offset=offset)


@router.get("/agent-activity", dependencies=[Depends(require_user_permission("settings:read"))])
async def get_agent_activity(
    node: str = Query("", max_length=255, description="Node UUID, node ID or hostname"),
    action: str = Query("", max_length=40),
    errors: bool = False,
    since: Optional[float] = Query(None, description="Only requests after this time (epoch seconds)"),
    limit: int = Query(200, ge=1, le=1000),
):
    """Sampled agent requests, newest first: the last 10 per node with `node`, the last 1,000 errors
    with `errors=true`, otherwise the last 1,000 requests of all agents. `oldest` says how far back
    the sample reaches."""
    if action and action not in ACTIONS:
        action = "-"  # unknown action: nothing matches
    return monitor.events(node=node.strip(), action=action, errors_only=errors, since=since, limit=limit)
