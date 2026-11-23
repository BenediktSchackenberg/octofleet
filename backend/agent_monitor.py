"""Agent Monitor: what the agents ask the server, sized for large fleets.

Every agent request is recorded in memory with O(1) work and no database query:
- the node it belongs to comes from a cached map of node IDs and hostnames (`NodeDirectory`),
  refreshed in the background, so `win-pc01`, `PC01` and the node UUID are one node;
- counters per node and action (requests, errors, last time, last status) instead of keeping
  every request;
- samples of the raw requests: the last `PER_NODE_EVENTS` per node, the last `RECENT_EVENTS`
  overall and the last `ERROR_EVENTS` errors.

The state lives in the backend process (like the rest of the in-memory caches) and starts empty
after a restart.
"""
from __future__ import annotations

import asyncio
import fnmatch
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Iterable, Optional, Tuple

logger = logging.getLogger(__name__)

PER_NODE_EVENTS = 10
RECENT_EVENTS = 1000
ERROR_EVENTS = 1000
DIRECTORY_REFRESH_SECONDS = 60
DIRECTORY_MISS_REFRESH_SECONDS = 10
JOB_COUNTS_TTL_SECONDS = 10
UNREGISTERED_LIMIT = 1000  # names without a node that are tracked at most

# Status by the time since the node was last heard from (agent request or last_seen in the DB)
ACTIVE_SECONDS = 30
IDLE_SECONDS = 120
STALE_SECONDS = 600

ACTIONS = ("job-poll", "terminal-poll", "shell-poll", "screen-poll", "remediation-poll",
           "live-data", "health-report", "job-result", "remediation-result", "poll")
STATUSES = ("active", "idle", "stale", "offline", "unknown")


def status_for(seconds_ago: Optional[float]) -> str:
    if seconds_ago is None:
        return "unknown"
    if seconds_ago < ACTIVE_SECONDS:
        return "active"
    if seconds_ago < IDLE_SECONDS:
        return "idle"
    if seconds_ago < STALE_SECONDS:
        return "stale"
    return "offline"


@dataclass
class NodeInfo:
    id: str
    node_id: str
    hostname: str
    os_name: Optional[str] = None
    agent_version: Optional[str] = None
    last_seen: Optional[float] = None  # epoch seconds from the DB


class NodeDirectory:
    """Maps what agents send (node ID, hostname, `win-<hostname>`, UUID) to the node record."""

    def __init__(self) -> None:
        self.nodes: Dict[str, NodeInfo] = {}
        self._keys: Dict[str, str] = {}
        self.loaded_at = 0.0
        self._miss_refresh_at = 0.0

    @staticmethod
    def keys_for(node: NodeInfo) -> Iterable[str]:
        host = (node.hostname or "").lower()
        yield node.id.lower()
        yield (node.node_id or "").lower()
        yield host
        yield f"win-{host}"
        yield host.split(".")[0]

    def load(self, rows: Iterable[Dict[str, Any]]) -> None:
        nodes: Dict[str, NodeInfo] = {}
        keys: Dict[str, str] = {}
        for r in rows:
            last_seen = r.get("last_seen")
            node = NodeInfo(id=str(r["id"]), node_id=r.get("node_id") or "", hostname=r.get("hostname") or "",
                            os_name=r.get("os_name"), agent_version=r.get("agent_version"),
                            last_seen=last_seen.timestamp() if last_seen else None)
            nodes[node.id] = node
            for k in self.keys_for(node):
                if k:
                    keys.setdefault(k, node.id)  # node ID and hostname win over the derived keys
        self.nodes, self._keys = nodes, keys
        self.loaded_at = time.time()

    def resolve(self, name: str) -> Optional[str]:
        return self._keys.get((name or "").lower())

    def wants_refresh_after_miss(self, now: float) -> bool:
        if now - self.loaded_at < DIRECTORY_MISS_REFRESH_SECONDS or now - self._miss_refresh_at < DIRECTORY_MISS_REFRESH_SECONDS:
            return False
        self._miss_refresh_at = now
        return True


@dataclass
class ActionStats:
    requests: int = 0
    errors: int = 0
    last: float = 0.0
    last_status: int = 0


@dataclass
class NodeActivity:
    last: float = 0.0
    last_error: float = 0.0
    names: set = field(default_factory=set)  # names the agent used (when they differ from the hostname)
    actions: Dict[str, ActionStats] = field(default_factory=dict)
    events: Deque[Tuple] = field(default_factory=lambda: deque(maxlen=PER_NODE_EVENTS))


class AgentMonitor:
    def __init__(self) -> None:
        self.directory = NodeDirectory()
        self.activity: Dict[str, NodeActivity] = {}  # node UUID, or "?<name>" for unregistered names
        # Dicts, newest last; `recent` is also what the live activity stream reads
        self.recent: Deque[Dict[str, Any]] = deque(maxlen=RECENT_EVENTS)
        self.errors: Deque[Dict[str, Any]] = deque(maxlen=ERROR_EVENTS)
        self.started = time.time()
        self.total_requests = 0
        self._unregistered = 0
        self._refresh_requested = False
        self._job_counts: Dict[str, Dict[str, int]] = {}
        self._job_counts_at = 0.0
        self._job_counts_lock = asyncio.Lock()

    # -- recording (request path) ---------------------------------------------------------------

    def record(self, name: str, action: str, detail: str = "", ip: str = "", status_code: int = 200,
               now: Optional[float] = None) -> None:
        now = time.time() if now is None else now
        name = name or "unknown"
        node_uuid = self.directory.resolve(name)
        if node_uuid is None and self.directory.wants_refresh_after_miss(now):
            self._refresh_requested = True
        key = node_uuid or f"?{name.lower()}"
        act = self.activity.get(key)
        if act is None:
            if node_uuid is None and self._unregistered >= UNREGISTERED_LIMIT:
                key, act = "?other", self.activity.setdefault("?other", NodeActivity())
            else:
                act = self.activity[key] = NodeActivity()
                if node_uuid is None:
                    self._unregistered += 1
        node = self.directory.nodes.get(node_uuid) if node_uuid else None
        if node is not None and name.lower() != node.hostname.lower() and len(act.names) < 5:
            act.names.add(name)
        is_error = status_code >= 400
        stats = act.actions.get(action)
        if stats is None:
            stats = act.actions[action] = ActionStats()
        stats.requests += 1
        stats.last = now
        stats.last_status = status_code
        act.last = now
        if is_error:
            stats.errors += 1
            act.last_error = now
        self.total_requests += 1
        act.events.append((now, action, detail, ip, status_code, name))
        event = {
            "timestamp": datetime.fromtimestamp(now, timezone.utc).isoformat(),
            "ts": now,
            "hostname": node.hostname if node else name,
            "reported_name": name,
            "node_id": node_uuid,
            "action": action,
            "detail": detail,
            "ip": ip,
            "status_code": status_code,
        }
        self.recent.append(event)
        if is_error:
            self.errors.append(event)

    # -- background ---------------------------------------------------------------------------

    async def refresh_directory(self, pool) -> None:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, node_id, hostname, os_name, agent_version, last_seen FROM nodes WHERE uninstalled_at IS NULL")
        self.directory.load(dict(r) for r in rows)
        # requests recorded under a name before its node was known move to the node
        for key in [k for k in self.activity if k.startswith("?") and k != "?other"]:
            node_uuid = self.directory.resolve(key[1:])
            if node_uuid:
                old = self.activity.pop(key)
                merged = self.activity.setdefault(node_uuid, NodeActivity())
                merged.last = max(merged.last, old.last)
                merged.last_error = max(merged.last_error, old.last_error)
                for action, s in old.actions.items():
                    m = merged.actions.setdefault(action, ActionStats())
                    m.requests += s.requests
                    m.errors += s.errors
                    if s.last > m.last:
                        m.last, m.last_status = s.last, s.last_status
                combined = sorted(list(merged.events) + list(old.events), key=lambda e: e[0])[-PER_NODE_EVENTS:]
                merged.events.clear()
                merged.events.extend(combined)
                self._unregistered -= 1
        # nodes removed from the inventory
        for key in [k for k in self.activity if not k.startswith("?") and k not in self.directory.nodes]:
            self.activity.pop(key, None)

    async def run(self, pool) -> None:
        """Background task: keeps the node directory current."""
        while True:
            try:
                await self.refresh_directory(pool)
            except Exception as exc:  # DB restarting: keep the old directory
                logger.warning("Agent monitor: node list not refreshed: %s", exc)
            for _ in range(DIRECTORY_REFRESH_SECONDS):
                await asyncio.sleep(1)
                if self._refresh_requested:
                    self._refresh_requested = False
                    break

    async def job_counts(self, pool) -> Dict[str, Dict[str, int]]:
        """Running/queued jobs and pending/running remediation per node: one grouped query each,
        shared by all viewers for JOB_COUNTS_TTL_SECONDS."""
        if time.time() - self._job_counts_at < JOB_COUNTS_TTL_SECONDS:
            return self._job_counts
        async with self._job_counts_lock:
            if time.time() - self._job_counts_at < JOB_COUNTS_TTL_SECONDS:
                return self._job_counts
            counts: Dict[str, Dict[str, int]] = {}
            async with pool.acquire() as conn:
                for r in await conn.fetch("""
                    SELECT node_id, COUNT(*) FILTER (WHERE status = 'running') AS running,
                           COUNT(*) FILTER (WHERE status = 'queued') AS queued
                    FROM job_instances WHERE status IN ('running', 'queued') GROUP BY node_id"""):
                    counts.setdefault(str(r["node_id"]), {}).update(running_jobs=r["running"], queued_jobs=r["queued"])
                for r in await conn.fetch("""
                    SELECT node_id, COUNT(*) FILTER (WHERE status IN ('pending', 'approved')) AS pending,
                           COUNT(*) FILTER (WHERE status = 'running') AS running
                    FROM remediation_jobs WHERE status IN ('pending', 'approved', 'running') GROUP BY node_id"""):
                    counts.setdefault(str(r["node_id"]), {}).update(pending_remediation=r["pending"],
                                                                     running_remediation=r["running"])
            self._job_counts, self._job_counts_at = counts, time.time()
            return counts

    # -- reading (admin page) -----------------------------------------------------------------

    def _agent_row(self, key: str, act: Optional[NodeActivity], now: float, counts: Dict[str, Dict[str, int]]) -> Dict[str, Any]:
        node = self.directory.nodes.get(key)
        heard = max(filter(None, [act.last if act else None, node.last_seen if node else None]), default=None)
        ago = now - heard if heard else None
        c = counts.get(key, {})
        requests = sum(s.requests for s in act.actions.values()) if act else 0
        errors = sum(s.errors for s in act.actions.values()) if act else 0
        return {
            "id": node.id if node else None,
            "hostname": node.hostname if node else key[1:],
            "registered": node is not None,
            "reported_names": sorted(act.names) if act else [],
            "os_name": node.os_name if node else None,
            "agent_version": node.agent_version if node else None,
            "last_seen": datetime.fromtimestamp(heard, timezone.utc).isoformat() if heard else None,
            "seconds_ago": int(ago) if ago is not None else None,
            "status": status_for(ago),
            "requests": requests,
            "errors": errors,
            "last_error": datetime.fromtimestamp(act.last_error, timezone.utc).isoformat() if act and act.last_error else None,
            "actions": {a: {"requests": s.requests, "errors": s.errors, "last_status": s.last_status}
                        for a, s in (act.actions.items() if act else [])},
            "running_jobs": c.get("running_jobs", 0),
            "queued_jobs": c.get("queued_jobs", 0),
            "pending_remediation": c.get("pending_remediation", 0),
            "running_remediation": c.get("running_remediation", 0),
        }

    def agents(self, counts: Dict[str, Dict[str, int]], q: str = "", status: str = "", sort: str = "hostname",
               direction: str = "asc", limit: int = 50, offset: int = 0, now: Optional[float] = None) -> Dict[str, Any]:
        now = time.time() if now is None else now
        keys = list(self.directory.nodes) + [k for k in self.activity if k.startswith("?")]
        rows = [self._agent_row(k, self.activity.get(k), now, counts) for k in keys]
        summary = {s: 0 for s in STATUSES}
        for r in rows:
            summary[r["status"]] += 1
        summary.update(total=len(rows), with_errors=sum(1 for r in rows if r["errors"]),
                       running_jobs=sum(r["running_jobs"] for r in rows),
                       remediation=sum(r["pending_remediation"] + r["running_remediation"] for r in rows))
        if q:
            pattern = q.lower() if any(ch in q for ch in "*?") else f"*{q.lower()}*"
            rows = [r for r in rows if fnmatch.fnmatchcase(r["hostname"].lower(), pattern)
                    or any(fnmatch.fnmatchcase(n.lower(), pattern) for n in r["reported_names"])]
        if status == "errors":
            rows = [r for r in rows if r["errors"]]
        elif status in STATUSES:
            rows = [r for r in rows if r["status"] == status]
        reverse = direction == "desc"
        if sort == "last_seen":
            # desc: most recently heard first; asc: longest silent first; never heard last either way
            heard = sorted((r for r in rows if r["seconds_ago"] is not None),
                           key=lambda r: (r["seconds_ago"] if reverse else -r["seconds_ago"], r["hostname"].lower()))
            rows = heard + sorted((r for r in rows if r["seconds_ago"] is None), key=lambda r: r["hostname"].lower())
        elif sort == "errors":
            rows.sort(key=lambda r: (-r["errors"], r["hostname"].lower()))
        else:
            rows.sort(key=lambda r: (r["hostname"].lower(), r["id"] or ""), reverse=reverse)
        total = len(rows)
        return {"agents": rows[offset:offset + limit], "total": total, "limit": limit, "offset": offset,
                "summary": summary}

    def events(self, node: str = "", action: str = "", errors_only: bool = False, since: Optional[float] = None,
               limit: int = 200) -> Dict[str, Any]:
        """Sampled requests, newest first. A node filter reads that node's own samples."""
        if node:
            key = self.directory.resolve(node) or (node if node in self.activity else f"?{node.lower()}")
            act = self.activity.get(key)
            n = self.directory.nodes.get(key)
            source = [{"timestamp": datetime.fromtimestamp(e[0], timezone.utc).isoformat(), "ts": e[0],
                       "hostname": n.hostname if n else e[5], "reported_name": e[5], "node_id": n.id if n else None,
                       "action": e[1], "detail": e[2], "ip": e[3], "status_code": e[4]}
                      for e in (act.events if act else [])]
            buffer, capacity = "node", PER_NODE_EVENTS
        elif errors_only:
            source, buffer, capacity = list(self.errors), "errors", ERROR_EVENTS
        else:
            source, buffer, capacity = list(self.recent), "recent", RECENT_EVENTS
        oldest = source[0]["timestamp"] if source else None
        out = [e for e in reversed(source)
               if (not action or e["action"] == action)
               and (not errors_only or e["status_code"] >= 400)
               and (since is None or e["ts"] >= since)]
        return {"events": out[:limit], "count": min(len(out), limit), "matched": len(out),
                "buffer": buffer, "buffer_size": capacity, "oldest": oldest,
                "total_requests": self.total_requests,
                "since_start": datetime.fromtimestamp(self.started, timezone.utc).isoformat()}


monitor = AgentMonitor()
