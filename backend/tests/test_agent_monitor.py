"""Agent monitor: node names resolved from a cached directory, counters per node and action,
sampled requests, stable order, filters and paging (agent_monitor.py)."""
import asyncio
import time
from datetime import datetime, timezone

import agent_monitor as am

NOW = 1_800_000_000.0


def row(uuid, node_id, hostname, seen_ago=None, os_name="Ubuntu", version="0.5.34-linux"):
    seen = datetime.fromtimestamp(NOW - seen_ago, timezone.utc) if seen_ago is not None else None
    return {"id": uuid, "node_id": node_id, "hostname": hostname, "os_name": os_name,
            "agent_version": version, "last_seen": seen}


def make(rows=None):
    m = am.AgentMonitor()
    m.directory.load(rows if rows is not None else [
        row("u-win", "WINHOST01", "WINHOST01", 5, "Windows Server 2025", "0.8.26"),
        row("u-app", "appnode", "app-server-01", 5),
        row("u-b", "beta", "Beta", 400),
        row("u-a", "alpha", "alpha", 2000),
    ])
    m.directory.loaded_at = NOW
    return m


def test_names_resolve_to_one_node():
    d = make().directory
    assert d.resolve("win-winhost01") == "u-win"       # Windows job polls
    assert d.resolve("WINHOST01") == "u-win"           # hostname
    assert d.resolve("u-win") == "u-win"           # node UUID
    assert d.resolve("appnode") == "u-app"          # node ID differs from the hostname
    assert d.resolve("APP-SERVER-01") == "u-app"  # any case
    assert d.resolve("nobody") is None


def test_requests_count_per_node_and_action_with_the_node_name():
    m = make()
    m.record("win-winhost01", "job-poll", "/api/v1/jobs/pending/win-winhost01", "10.0.0.5", 200, now=NOW)
    m.record("WINHOST01", "terminal-poll", "/api/v1/terminal/pending/WINHOST01", "10.0.0.5", 200, now=NOW + 1)
    m.record("appnode", "job-poll", "/x", "10.0.0.6", 500, now=NOW + 2)
    win = m.activity["u-win"]
    assert win.actions["job-poll"].requests == 1 and win.actions["terminal-poll"].requests == 1
    assert win.names == {"win-winhost01"}            # the other name the agent used, for the search
    assert m.activity["u-app"].actions["job-poll"].errors == 1
    ev = list(m.recent)
    assert [e["hostname"] for e in ev] == ["WINHOST01", "WINHOST01", "app-server-01"]
    assert ev[0]["reported_name"] == "win-winhost01" and ev[0]["node_id"] == "u-win"
    assert len(m.errors) == 1 and m.errors[0]["status_code"] == 500
    assert m.total_requests == 3


def test_unknown_names_stay_visible_and_move_to_their_node_once_registered():
    m = make()
    m.record("newbox", "live-data", "/api/v1/live-data", "10.0.0.9", 404, now=NOW)
    assert "?newbox" in m.activity
    agents = m.agents({}, now=NOW + 1)["agents"]
    unreg = [a for a in agents if not a["registered"]]
    assert unreg and unreg[0]["hostname"] == "newbox" and unreg[0]["errors"] == 1

    class Conn:
        async def fetch(self, *_):
            return [row("u-a", "alpha", "alpha"), row("u-new", "newbox", "newbox")]

    class Pool:
        def acquire(self):
            class Ctx:
                async def __aenter__(self_inner):
                    return Conn()

                async def __aexit__(self_inner, *a):
                    return False
            return Ctx()

    asyncio.run(m.refresh_directory(Pool()))
    assert "?newbox" not in m.activity
    assert m.activity["u-new"].actions["live-data"].errors == 1
    assert len(m.activity["u-new"].events) == 1
    assert "u-win" not in m.activity  # removed nodes drop out


def test_unknown_names_are_capped(monkeypatch):
    monkeypatch.setattr(am, "UNREGISTERED_LIMIT", 3)
    m = make()
    for i in range(10):
        m.record(f"ghost{i}", "job-poll", now=NOW)
    assert len([k for k in m.activity if k.startswith("?")]) == 4  # 3 names + "?other"
    assert sum(s.requests for s in m.activity["?other"].actions.values()) == 7


def test_a_miss_asks_for_a_refresh_at_most_every_10_seconds():
    m = make()
    m.directory.loaded_at = NOW - 100
    m.record("ghost", "job-poll", now=NOW)
    assert m._refresh_requested
    m._refresh_requested = False
    m.record("ghost2", "job-poll", now=NOW + 5)
    assert not m._refresh_requested
    m.record("ghost3", "job-poll", now=NOW + 11)
    assert m._refresh_requested


def test_stable_order_by_hostname_not_by_activity():
    m = make()
    m.record("alpha", "job-poll", now=NOW)
    first = [a["hostname"] for a in m.agents({}, now=NOW)["agents"]]
    m.record("app-server-01", "job-poll", now=NOW + 1)
    m.record("Beta", "job-poll", now=NOW + 2)
    second = [a["hostname"] for a in m.agents({}, now=NOW + 3)["agents"]]
    assert first == second == ["alpha", "app-server-01", "Beta", "WINHOST01"]  # case-insensitive
    desc = [a["hostname"] for a in m.agents({}, direction="desc", now=NOW)["agents"]]
    assert desc == first[::-1]


def test_sort_by_last_seen_and_errors():
    m = make()
    m.record("Beta", "job-poll", "", "", 500, now=NOW)
    rows = m.agents({}, sort="last_seen", direction="desc", now=NOW + 1)["agents"]
    assert rows[0]["hostname"] == "Beta"  # newest first
    assert rows[-1]["hostname"] == "alpha"
    oldest_first = m.agents({}, sort="last_seen", direction="asc", now=NOW + 1)["agents"]
    assert oldest_first[0]["hostname"] == "alpha"
    assert m.agents({}, sort="errors", now=NOW)["agents"][0]["hostname"] == "Beta"


def test_status_from_the_latest_request_or_last_seen():
    m = make()
    rows = {a["hostname"]: a for a in m.agents({}, limit=10, now=NOW)["agents"]}
    assert rows["WINHOST01"]["status"] == "active"
    assert rows["Beta"]["status"] == "stale"
    assert rows["alpha"]["status"] == "offline"
    m.record("alpha", "job-poll", now=NOW)
    assert {a["hostname"]: a for a in m.agents({}, now=NOW)["agents"]}["alpha"]["status"] == "active"


def test_search_filter_paging_and_summary():
    m = make()
    m.record("Beta", "job-poll", "", "", 403, now=NOW)
    page = m.agents({}, q="0", now=NOW)
    assert [a["hostname"] for a in page["agents"]] == ["app-server-01", "WINHOST01"]
    assert [a["hostname"] for a in m.agents({}, q="win-winhost01", now=NOW)["agents"]] == []  # not used yet
    m.record("win-winhost01", "job-poll", now=NOW)
    assert [a["hostname"] for a in m.agents({}, q="win-*", now=NOW)["agents"]] == ["WINHOST01"]  # reported name
    assert [a["hostname"] for a in m.agents({}, q="w?nhost0?", now=NOW)["agents"]] == ["WINHOST01"]
    assert [a["hostname"] for a in m.agents({}, status="errors", now=NOW)["agents"]] == ["Beta"]
    assert [a["hostname"] for a in m.agents({}, status="offline", now=NOW)["agents"]] == ["alpha"]
    p = m.agents({}, limit=2, offset=2, now=NOW)
    assert p["total"] == 4 and [a["hostname"] for a in p["agents"]] == ["Beta", "WINHOST01"]
    s = p["summary"]
    assert s["total"] == 4 and s["with_errors"] == 1 and s["active"] == 3  # Beta active again after its request


def test_job_counts_are_attached():
    m = make()
    counts = {"u-app": {"running_jobs": 2, "queued_jobs": 1, "pending_remediation": 3}}
    r = {a["hostname"]: a for a in m.agents(counts, now=NOW)["agents"]}["app-server-01"]
    assert (r["running_jobs"], r["queued_jobs"], r["pending_remediation"], r["running_remediation"]) == (2, 1, 3, 0)
    assert m.agents(counts, now=NOW)["summary"]["running_jobs"] == 2


def test_events_filters_and_buffers():
    m = make()
    for i in range(15):
        m.record("WINHOST01", "job-poll" if i % 2 else "terminal-poll", f"/p{i}", "", 500 if i == 3 else 200, now=NOW + i)
    m.record("alpha", "live-data", now=NOW + 20)
    allev = m.events()
    assert allev["buffer"] == "recent" and allev["events"][0]["hostname"] == "alpha"  # newest first
    node = m.events(node="win-winhost01")
    assert node["buffer"] == "node" and node["count"] == am.PER_NODE_EVENTS
    assert {e["hostname"] for e in node["events"]} == {"WINHOST01"}
    assert node["events"][0]["detail"] == "/p14"
    assert [e["detail"] for e in m.events(errors_only=True)["events"]] == ["/p3"]
    assert all(e["action"] == "job-poll" for e in m.events(action="job-poll")["events"])
    assert m.events(since=NOW + 14)["count"] == 2
    assert m.events(limit=3)["count"] == 3 and m.events(limit=3)["matched"] == 16
    assert m.events(node="nobody")["events"] == []


def test_recent_buffer_is_bounded_and_feeds_the_live_stream_format():
    m = make()
    for i in range(am.RECENT_EVENTS + 50):
        m.record("WINHOST01", "job-poll", now=NOW + i)
    assert len(m.recent) == am.RECENT_EVENTS
    e = m.recent[-1]
    assert {"timestamp", "hostname", "action", "detail", "ip", "status_code", "ts"} <= set(e)


def test_job_counts_query_is_cached():
    calls = []

    class Conn:
        async def fetch(self, sql):
            calls.append(sql)
            if "job_instances" in sql:
                return [{"node_id": "u-a", "running": 1, "queued": 2}]
            return [{"node_id": "u-a", "pending": 3, "running": 0}]

    class Pool:
        def acquire(self):
            class Ctx:
                async def __aenter__(self_inner):
                    return Conn()

                async def __aexit__(self_inner, *a):
                    return False
            return Ctx()

    m = make()

    async def go():
        a = await m.job_counts(Pool())
        b = await m.job_counts(Pool())
        return a, b

    a, b = asyncio.run(go())
    assert a == b == {"u-a": {"running_jobs": 1, "queued_jobs": 2, "pending_remediation": 3, "running_remediation": 0}}
    assert len(calls) == 2  # one query per table, then from the cache


def test_10000_nodes_record_and_page_timing():
    rows = [row(f"u{i}", f"node{i}", f"host-{i:05d}", i % 900) for i in range(10_000)]
    m = make(rows)
    names = [f"host-{i:05d}" for i in range(10_000)]
    start = time.perf_counter()
    n = 50_000
    for i in range(n):
        m.record(names[i % 10_000], "job-poll", "/api/v1/jobs/pending/x", "10.0.0.1", 200, now=NOW + i / 1000)
    per_request_us = (time.perf_counter() - start) / n * 1e6
    start = time.perf_counter()
    page = m.agents({}, q="host-09", status="active", limit=50, now=NOW + 60)
    page_ms = (time.perf_counter() - start) * 1000
    print(f"record: {per_request_us:.1f} us/request; status page over 10,000 nodes: {page_ms:.0f} ms")
    assert page["summary"]["total"] == 10_000
    assert per_request_us < 100
    assert page_ms < 1000
