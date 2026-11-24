"""
Octofleet API - Agent long-poll (#283)

One held request per agent instead of several idle pollers; see agent_wait.py.
"""
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, Query, Request

import agent_wait
from auth import require_permission
from dependencies import get_db
from routers import terminal

router = APIRouter(tags=["Agent"])


def _lookup_id(node_id: str) -> str:
    # Like the job poll: the Windows agent may send "win-<hostname>"
    return node_id[4:].upper() if node_id.startswith("win-") else node_id


async def _waiting_work(conn, node_id: str, resolved_id: str, kinds: set) -> list:
    """The kinds of work the agent's polls would hand out right now.

    The conditions are those of the poll routes (jobs/pending, remediation/jobs/pending,
    terminal/pending): a wake-up the poll then cannot serve would bring the agent straight back.
    Screen and shell sessions only wake through a notify, since only an agent that opens the stream
    ends their pending state.
    """
    found = []
    if kinds & {"jobs", "remediation"}:
        row = await conn.fetchrow("""
            SELECT
              EXISTS (SELECT 1 FROM job_instances ji JOIN jobs j ON j.id = ji.job_id
                      WHERE (ji.node_id::text = $2 OR UPPER(ji.node_id::text) = UPPER($2))
                        AND ji.status = 'pending'
                        AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
                        AND (j.expires_at IS NULL OR j.expires_at > NOW())) AS jobs,
              EXISTS (SELECT 1 FROM remediation_jobs rj
                      LEFT JOIN remediation_rules rr ON rr.id = rj.rule_id
                      WHERE rj.node_id = (SELECT id FROM nodes
                                          WHERE UPPER(hostname) = UPPER($1) OR UPPER(node_id) = UPPER($1)
                                          LIMIT 1)
                        AND rj.status = 'approved'
                        AND NOT COALESCE(rr.maintenance_window_only, FALSE)) AS remediation
        """, _lookup_id(node_id), resolved_id)
        found += [k for k in ("jobs", "remediation") if k in kinds and row[k]]
    if "terminal" in kinds and any(
            s.node_id == node_id and s.pending_commands for s in terminal._terminal_sessions.values()):
        found.append("terminal")
    return found


@router.get("/api/v1/agent/wait/{node_id}", dependencies=[Depends(require_permission("jobs:poll"))])
async def agent_wait_route(
    node_id: str,
    request: Request,
    kinds: Optional[str] = Query(None, description="Comma-separated: jobs, remediation, terminal, screen, shell (default: all)"),
    timeout: Optional[float] = Query(None, ge=0, description="Hold time in seconds, at most the server's AGENT_WAIT_SECONDS"),
    db: asyncpg.Pool = Depends(get_db),
):
    """Agent long-poll: answers as soon as there is work for the node, or empty after the hold time.

    `{"wake": [...]}` names the polls the agent should run now. Needs `jobs:poll` (the agent key).
    The agent sends only the kinds it handles, so work it cannot take does not wake it.
    """
    wanted = set(agent_wait.KINDS) if not kinds else {k.strip() for k in kinds.split(",")} & set(agent_wait.KINDS)
    lookup_id = _lookup_id(node_id)
    async with db.acquire() as conn:
        node = await conn.fetchrow(
            "SELECT id, node_id, hostname FROM nodes WHERE UPPER(hostname) = UPPER($1) OR UPPER(node_id) = UPPER($1) OR id::text = $1",
            lookup_id)
    keys = [node_id, lookup_id] + ([node["id"], node["node_id"], node["hostname"]] if node else [])
    resolved_id = str(node["id"]) if node else lookup_id

    async def check():
        async with db.acquire() as conn:
            return await _waiting_work(conn, node_id, resolved_id, wanted)

    wake = await agent_wait.hub.wait(keys, wanted, agent_wait.hold_seconds(timeout), check=check,
                                     disconnected=request.is_disconnected)
    return {"wake": wake}
