"""Reboot nodes from the console: one `reboot` job per node (Windows and Linux).

The job asks the agent to restart the machine now (in about a minute), in N minutes or at a time, with
an optional message for logged-on users; `{"action": "cancel"}` withdraws a reboot the agent scheduled.
Before that, `preview` tells the person what a reboot interrupts on each node: logged-on users (from
the agents' live data), jobs that have not finished and open terminal, screen and shell sessions.

The "Reboot required" badge is not cleared here: it comes from what the node reports (Windows'
update search after the agent's start, the Linux update list in the push after the start), so it
disappears only once the node has reported after the reboot. Until then `reboot_state` shows the
reboot as scheduled (`restart_at`).
"""
import json
import re
import time
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

# At most this far ahead (a forgotten reboot weeks later surprises everybody)
MAX_AHEAD = timedelta(days=7)
# "Now" means in about a minute: the agent reports the job first, users see the message
NOW_DELAY = timedelta(minutes=1)
# How long a node may take to restart and report again before the reboot no longer counts as
# "restarting" (a node that stays away shows as offline instead) - the same as for installations
RESTART_GRACE = timedelta(hours=2)
MESSAGE_MAX = 200
MAX_NODES = 500
FINISHED = ("success", "completed", "failed", "cancelled", "timeout")
OPEN_JOB_STATES = ("pending", "queued", "running", "waiting", "sent")

# Logged-on users from the agents' live data (every few seconds while the agent runs): node UUID ->
# (monotonic time, users). In memory - the backend runs one process; entries older than USERS_MAX_AGE
# count as unknown.
USERS_MAX_AGE = 120
_logged_on: dict[str, tuple[float, list]] = {}


def remember_logged_on_users(node_uuid, users) -> None:
    """Keep what the agent reported (a list of {user, session, since}); ignores anything else."""
    if not isinstance(users, list):
        return
    clean = []
    for u in users[:50]:
        if isinstance(u, dict) and isinstance(u.get("user"), str) and u["user"].strip():
            clean.append({"user": u["user"].strip()[:100],
                          "session": str(u.get("session") or "")[:50] or None,
                          "since": str(u.get("since") or "")[:40] or None})
    _logged_on[str(node_uuid)] = (time.monotonic(), clean)


def logged_on_users(node_uuid) -> Optional[list]:
    """The users the node reported recently; None if it did not report (old agent, offline)."""
    entry = _logged_on.get(str(node_uuid))
    if not entry or time.monotonic() - entry[0] > USERS_MAX_AGE:
        return None
    return entry[1]


def parse_request(data: dict, now: datetime) -> dict:
    """The job payload from the request; ValueError with the reason for the person.
    `when`: `now`, `in` (`minutes`, 1-10080) or `at` (ISO 8601 with offset, in the future, at most 7 days)."""
    if data.get("action") == "cancel":
        return {"action": "cancel"}
    when = data.get("when", "now")
    if when == "now":
        at = now + NOW_DELAY
    elif when == "in":
        minutes = data.get("minutes")
        if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= MAX_AHEAD.total_seconds() // 60:
            raise ValueError("minutes: 1 to 10080")
        at = now + timedelta(minutes=minutes)
    elif when == "at":
        try:
            at = datetime.fromisoformat(str(data.get("at")).replace("Z", "+00:00"))
        except ValueError:
            at = None
        if at is None or at.tzinfo is None:
            raise ValueError("at: ISO 8601 time with offset")
        if at < now + NOW_DELAY:
            raise ValueError("at: at least a minute from now")
        if at > now + MAX_AHEAD:
            raise ValueError("at: at most 7 days ahead")
    else:
        raise ValueError("when: now, in or at")
    message = data.get("message") or ""
    if not isinstance(message, str):
        raise ValueError("message: text")
    # One line, no control characters: it goes to `shutdown` as an argument and to users' screens
    message = re.sub(r"[\x00-\x1f\x7f\s]+", " ", message).strip()
    if len(message) > MESSAGE_MAX:
        raise ValueError(f"message: at most {MESSAGE_MAX} characters")
    return {"action": "reboot", "at": at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "message": message or None}


def node_ids(data: dict) -> list:
    ids = data.get("node_ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        raise ValueError("node_ids: a nonempty list of node UUIDs")
    unique = list(dict.fromkeys(ids))
    if len(unique) > MAX_NODES:
        raise ValueError(f"node_ids: at most {MAX_NODES} nodes")
    for i in unique:
        try:
            _uuid.UUID(i)
        except ValueError:
            raise ValueError(f"node_ids: not a node UUID: {i[:40]}") from None
    return unique


def os_family(os_name: Optional[str], has_linux_data: bool) -> Optional[str]:
    name = (os_name or "").lower()
    if "windows" in name:
        return "windows"
    if has_linux_data or any(n in name for n in ("linux", "ubuntu", "debian", "fedora", "centos", "rocky",
                                                  "alma", "rhel", "suse", "red hat", "arch", "cachyos")):
        return "linux"
    return None


def _dt(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def reboot_state(last_job: Optional[dict], reported_at, now: datetime) -> Optional[dict]:
    """The newest reboot job until the node has reported after the reboot:
    - `scheduled`: the job has not reached the agent or the agent has not answered yet;
    - `restarting`: the agent scheduled the reboot (`restart_at`) and the node has not reported since
      (within RESTART_GRACE after `restart_at`);
    - `failed`: the agent could not schedule it (`error`), until the node reports again.
    None when there is no reboot job, it was cancelled, or the node reported after the reboot."""
    if not last_job or (last_job.get("payload") or {}).get("action") == "cancel":
        return None
    payload = last_job.get("payload") or {}
    restart_at = _dt(payload.get("at"))
    job_id = str(last_job.get("id"))
    status = last_job.get("status")
    reported = _dt(reported_at)
    completed = _dt(last_job.get("completed_at"))
    if status not in FINISHED:
        return {"state": "scheduled", "job_id": job_id, "restart_at": restart_at.isoformat() if restart_at else None}
    if status in ("success", "completed"):
        if restart_at and (reported is None or reported < restart_at) and now < restart_at + RESTART_GRACE:
            return {"state": "restarting", "job_id": job_id, "restart_at": restart_at.isoformat()}
        return None
    if status == "cancelled":
        return None
    if completed and (reported is None or reported <= completed):
        return {"state": "failed", "job_id": job_id, "error": (last_job.get("error") or "")[:300] or None}
    return None


# The newest reboot job per node and the time the node last reported its update state: Windows
# searches for updates after every agent start, Linux pushes its update list right after the start.
STATE_SQL = """
    SELECT n.id, n.node_id, n.hostname, n.os_name, n.is_online, n.last_seen, n.removal_state,
           l.node_id IS NOT NULL AS has_linux_data,
           GREATEST(s.scanned_at, l.updated_at) AS reported_at,
           (SELECT json_build_object('id', j.id, 'status', ji.status, 'completed_at', ji.completed_at,
                                     'payload', j.command_data,
                                     'error', COALESCE(NULLIF(ji.error_message, ''), left(ji.stderr, 300), left(ji.stdout, 300)))
              FROM job_instances ji JOIN jobs j ON j.id = ji.job_id
             WHERE ji.node_id IN (n.id::text, n.node_id) AND j.command_type = 'reboot'
             ORDER BY ji.queued_at DESC LIMIT 1) AS last_reboot
      FROM nodes n
      LEFT JOIN node_patch_scans s ON s.node_id = n.id
      LEFT JOIN linux_data_current l ON l.node_id = n.id::text
     WHERE n.id = ANY($1::uuid[])
"""


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


async def node_states(conn, uuids: list) -> dict:
    """node UUID -> row with `reboot` (reboot_state) and `os_family`; only the requested nodes."""
    rows = await conn.fetch(STATE_SQL, uuids)
    now = datetime.now(timezone.utc)
    out = {}
    for r in rows:
        last = _json(r["last_reboot"])
        if last:
            last["payload"] = _json(last.get("payload")) or {}
        out[str(r["id"])] = {**dict(r), "last_reboot": last, "os_family": os_family(r["os_name"], r["has_linux_data"]),
                             "reboot": reboot_state(last, r["reported_at"], now)}
    return out


def _session_node_matches(session_node: Optional[str], row: dict) -> bool:
    s = (session_node or "").lower()
    return bool(s) and s in (str(row["id"]).lower(), (row["node_id"] or "").lower(), (row["hostname"] or "").lower())


def open_sessions(row: dict) -> dict:
    """Open terminal, screen and shell sessions for the node (kept in memory by the backend)."""
    from routers import terminal
    from screen_session import ScreenSessionState, screen_session_manager
    from shell_session import ShellSessionState, shell_session_manager
    term = sum(1 for s in list(terminal._terminal_sessions.values())
               if _session_node_matches(s.node_id, row) and s.viewer_active())
    screen = sum(1 for s in list(screen_session_manager.sessions.values())
                 if _session_node_matches(s.node_id, row) and s.state != ScreenSessionState.CLOSED)
    shell = sum(1 for s in list(shell_session_manager._sessions.values())
                if _session_node_matches(s.node_id, row) and s.state != ShellSessionState.CLOSED)
    return {"terminal": term, "screen": screen, "shell": shell}


OPEN_JOBS_SQL = """
    SELECT ji.node_id, j.id, j.name, j.command_type, ji.status
      FROM job_instances ji JOIN jobs j ON j.id = ji.job_id
     WHERE ji.node_id = ANY($1::text[]) AND ji.status = ANY($2::text[])
     ORDER BY ji.queued_at
"""


async def preview(conn, uuids: list) -> list:
    """What a reboot interrupts on each node, in the order asked for."""
    states = await node_states(conn, uuids)
    keys = [k for row in states.values() for k in (str(row["id"]), row["node_id"]) if k]
    jobs: dict[str, list] = {}
    for j in await conn.fetch(OPEN_JOBS_SQL, keys, list(OPEN_JOB_STATES)):
        jobs.setdefault(j["node_id"], []).append(
            {"id": str(j["id"]), "name": j["name"], "type": j["command_type"], "status": j["status"]})
    out = []
    for uid in uuids:
        row = states.get(uid)
        if row is None:
            out.append({"id": uid, "found": False})
            continue
        node_jobs = jobs.get(str(row["id"]), []) + jobs.get(row["node_id"], [])
        out.append({
            "id": uid, "found": True, "node_id": row["node_id"], "hostname": row["hostname"],
            "os_family": row["os_family"], "online": bool(row["is_online"]),
            "last_seen": row["last_seen"].isoformat() if row["last_seen"] else None,
            "removal_state": row["removal_state"],
            # None: the agent does not report them (older agent) or did not report recently
            "logged_on_users": logged_on_users(row["id"]),
            "running_jobs": [j for j in node_jobs if j["type"] != "reboot"][:10],
            "running_job_count": sum(1 for j in node_jobs if j["type"] != "reboot"),
            "sessions": open_sessions(row),
            "reboot": row["reboot"],
            "blocker": blocker(row),
        })
    return out


def blocker(row: dict) -> Optional[str]:
    """Why no reboot job is created for the node (shown in the dialog, `skipped` in the answer)."""
    if row["removal_state"] in ("uninstall_pending", "uninstalled", "removed", "uninstalling"):
        return "removal"
    if row["os_family"] is None:
        return "unsupported_os"
    return None


async def create_jobs(conn, uuids: list, payload: dict, user) -> dict:
    """One `reboot` job per node (or a cancel job for nodes with a scheduled reboot), audited per node."""
    username = getattr(user, "username", None) or "system"
    states = await node_states(conn, uuids)
    jobs, skipped = [], []
    cancel = payload["action"] == "cancel"
    for uid in uuids:
        row = states.get(uid)
        if row is None:
            skipped.append({"node": uid, "reason": "unknown node"})
            continue
        reason = blocker(row)
        if reason:
            skipped.append({"node": uid, "reason": reason})
            continue
        state = (row["reboot"] or {}).get("state")
        if cancel and state not in ("scheduled", "restarting"):
            skipped.append({"node": uid, "reason": "no_reboot_scheduled"})
            continue
        job_id = _uuid.uuid4()
        name = "Cancel reboot" if cancel else "Reboot"
        await conn.execute("""
            INSERT INTO jobs (id, name, description, target_type, target_id, command_type, command_data, created_by)
            VALUES ($1, $2, $3, 'device', $4::uuid, 'reboot', $5::jsonb, $6)
        """, job_id, name, f"{name} {row['hostname']}", uid, json.dumps(payload), username)
        await conn.execute("""
            INSERT INTO job_instances (id, job_id, node_id, status, queued_at)
            VALUES (gen_random_uuid(), $1, $2, 'pending', NOW())
        """, job_id, uid)
        await conn.execute(
            """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details)
               VALUES ($1, $2, 'node', $3, $4::jsonb)""",
            _audit_user_id(user), "node.reboot_cancel" if cancel else "node.reboot", uid,
            json.dumps({"by": username, "hostname": row["hostname"], "job_id": str(job_id),
                        **({} if cancel else {"at": payload["at"], "message": payload["message"]})}))
        jobs.append({"node": uid, "hostname": row["hostname"], "job_id": str(job_id)})
    return {"jobs": jobs, "skipped": skipped}


def _audit_user_id(user):
    try:
        return _uuid.UUID(str(getattr(user, "id", "")))
    except ValueError:
        return None
