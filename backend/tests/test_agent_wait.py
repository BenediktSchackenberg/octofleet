"""The agent long-poll (#283): one held request per agent instead of several idle pollers.

The request must come back empty after the hold time, at once when work for its node appears, never
for another node's work or for work the agent did not ask for, and a wake-up must not get lost while
the agent is between two requests.
"""
import asyncio
import time
import unittest
from unittest import mock

import agent_wait
from agent_wait import AgentWaitHub, hold_seconds
from routers import agent_wait as wait_route
from routers import terminal

ALL = agent_wait.KINDS


def run(coro):
    return asyncio.run(coro)


async def wait_and_notify(hub, keys, kinds, notify_args, timeout=5.0, delay=0.05):
    """Start a wait, notify after DELAY; returns (answer, seconds it took)."""
    async def later():
        await asyncio.sleep(delay)
        for nodes, kind in notify_args:
            hub.notify(nodes, kind)
    started = time.monotonic()
    task = asyncio.create_task(later())
    answer = await hub.wait(keys, kinds, timeout)
    await task
    return answer, time.monotonic() - started


class HubTest(unittest.TestCase):
    def test_empty_after_the_timeout(self):
        hub = AgentWaitHub()
        started = time.monotonic()
        self.assertEqual(run(hub.wait(["NODE-A"], ALL, 0.2)), [])
        self.assertGreaterEqual(time.monotonic() - started, 0.19)
        self.assertEqual(hub.waiting(), 0)

    def test_wakes_at_once_for_its_node(self):
        hub = AgentWaitHub()
        answer, took = run(wait_and_notify(hub, ["NODE-A"], ALL, [("NODE-A", "jobs")]))
        self.assertEqual(answer, ["jobs"])
        self.assertLess(took, 1)
        self.assertEqual(hub.waiting(), 0)

    def test_notify_from_a_worker_thread(self):
        import threading
        hub = AgentWaitHub()

        async def scenario():
            threading.Timer(0.1, lambda: hub.notify("NODE-A", "jobs")).start()  # a sync route
            started = time.monotonic()
            return await hub.wait(["NODE-A"], ALL, 10), time.monotonic() - started
        answer, took = run(scenario())
        self.assertEqual(answer, ["jobs"])
        self.assertLess(took, 1)

    def test_not_for_another_node(self):
        hub = AgentWaitHub()
        answer, took = run(wait_and_notify(hub, ["NODE-A"], ALL, [("NODE-B", "jobs")], timeout=0.3))
        self.assertEqual(answer, [])
        self.assertGreaterEqual(took, 0.29)

    def test_any_name_of_the_node_any_case(self):
        hub = AgentWaitHub()
        keys = ["web01", "6f1c0c8e-0000-4000-8000-000000000001", "WEB01.example"]
        answer, _ = run(wait_and_notify(hub, keys, ALL, [(["6F1C0C8E-0000-4000-8000-000000000001"], "jobs")]))
        self.assertEqual(answer, ["jobs"])
        answer, _ = run(wait_and_notify(hub, keys, ALL, [("WEB01", "terminal")]))
        self.assertEqual(answer, ["terminal"])

    def test_only_the_kinds_the_agent_handles(self):
        hub = AgentWaitHub()
        answer, _ = run(wait_and_notify(hub, ["NODE-A"], ["jobs", "terminal"], [("NODE-A", "shell")], timeout=0.3))
        self.assertEqual(answer, [])

    def test_answer_in_fixed_order(self):
        hub = AgentWaitHub()
        hub.notify("NODE-A", "screen")
        hub.notify("NODE-A", "jobs")
        hub.notify("NODE-A", "terminal")
        self.assertEqual(run(hub.wait(["NODE-A"], ALL, 1)), ["jobs", "terminal", "screen"])

    def test_wake_up_between_two_requests_is_kept(self):
        hub = AgentWaitHub()
        hub.notify("NODE-A", "terminal")  # no request held right now
        started = time.monotonic()
        self.assertEqual(run(hub.wait(["node-a"], ALL, 5)), ["terminal"])
        self.assertLess(time.monotonic() - started, 0.5)
        # handed out once
        self.assertEqual(run(hub.wait(["NODE-A"], ALL, 0.1)), [])

    def test_kept_wake_up_expires(self):
        now = [1000.0]
        hub = AgentWaitHub(pending_ttl=120, clock=lambda: now[0])
        hub.notify("NODE-A", "jobs")
        now[0] += 121
        self.assertEqual(run(hub.wait(["NODE-A"], ALL, 0.1)), [])

    def test_old_wake_ups_are_pruned(self):
        now = [1000.0]
        hub = AgentWaitHub(pending_ttl=120, clock=lambda: now[0])
        hub.notify([f"NODE-{i}" for i in range(100)], "jobs")
        self.assertEqual(len(hub._pending), 100)
        now[0] += 200
        hub.notify("NODE-X", "jobs")
        self.assertEqual(list(hub._pending), ["NODE-X"])

    def test_check_on_entry(self):
        hub = AgentWaitHub()

        async def check():
            return ["remediation", "shell"]
        started = time.monotonic()
        self.assertEqual(run(hub.wait(["NODE-A"], ["jobs", "remediation"], 5, check=check)), ["remediation"])
        self.assertLess(time.monotonic() - started, 0.5)

    def test_notify_during_the_check_is_not_lost(self):
        hub = AgentWaitHub()

        async def check():
            hub.notify("NODE-A", "jobs")  # e.g. a job created while the database answers
            return []
        self.assertEqual(run(hub.wait(["NODE-A"], ALL, 5, check=check)), ["jobs"])

    def test_agent_gone_keeps_the_wake_up(self):
        hub = AgentWaitHub()

        async def gone():
            return True
        answer, _ = run(wait_and_notify(hub, ["NODE-A"], ALL, [("NODE-A", "screen")]))
        self.assertEqual(answer, ["screen"])

        async def scenario():
            task = asyncio.create_task(hub.wait(["NODE-A"], ALL, 5, disconnected=gone))
            await asyncio.sleep(0.05)
            hub.notify("NODE-A", "screen")
            self.assertEqual(await task, [])  # the old request of a restarted agent
            return await hub.wait(["NODE-A"], ALL, 5)  # its new request
        self.assertEqual(run(scenario()), ["screen"])

    def test_agent_gone_ends_the_wait(self):
        hub = AgentWaitHub()

        async def gone():
            return True
        with mock.patch.object(agent_wait, "DISCONNECT_CHECK_SECONDS", 0.05):
            started = time.monotonic()
            self.assertEqual(run(hub.wait(["NODE-A"], ALL, 5, disconnected=gone)), [])
            self.assertLess(time.monotonic() - started, 1)
        self.assertEqual(hub.waiting(), 0)

    def test_two_requests_of_one_node_both_wake(self):
        hub = AgentWaitHub()

        async def scenario():
            a = asyncio.create_task(hub.wait(["NODE-A"], ALL, 5))
            b = asyncio.create_task(hub.wait(["NODE-A"], ALL, 5))
            await asyncio.sleep(0.05)
            self.assertEqual(hub.waiting(), 2)
            hub.notify("NODE-A", "jobs")
            return await a, await b
        self.assertEqual(run(scenario()), (["jobs"], ["jobs"]))

    def test_server_stop_releases_held_requests(self):
        hub = AgentWaitHub()

        async def scenario():
            task = asyncio.create_task(hub.wait(["NODE-A"], ALL, 30))
            await asyncio.sleep(0.05)
            hub.close()
            started = time.monotonic()
            answer = await task
            return answer, time.monotonic() - started, await hub.wait(["NODE-B"], ALL, 30)
        answer, took, later = run(scenario())
        self.assertEqual((answer, later), ([], []))
        self.assertLess(took, 0.5)

    def test_stop_signal_is_chained(self):
        import signal
        calls = []
        original = signal.getsignal(signal.SIGINT)
        signal.signal(signal.SIGINT, lambda signum, frame: calls.append(signum))
        hub = AgentWaitHub()
        try:
            async def scenario():
                with mock.patch.object(agent_wait, "hub", hub):
                    agent_wait.release_on_shutdown()
                    signal.getsignal(signal.SIGINT)(signal.SIGINT, None)  # as uvicorn would get it
                    await asyncio.sleep(0.05)
            run(scenario())
        finally:
            signal.signal(signal.SIGINT, original)
        self.assertEqual(calls, [signal.SIGINT])  # uvicorn's handler still runs
        self.assertTrue(hub._closing)

    def test_notify_never_fails_the_caller(self):
        with mock.patch.object(agent_wait.hub, "notify", side_effect=RuntimeError):
            agent_wait.notify("NODE-A", "jobs")


class HoldTimeTest(unittest.TestCase):
    def test_server_limit(self):
        for _ in range(200):
            self.assertTrue(49.5 <= hold_seconds(None, 55) <= 55)
            self.assertTrue(49.5 <= hold_seconds(600, 55) <= 55)

    def test_agent_may_ask_for_less(self):
        self.assertTrue(18 <= hold_seconds(20, 55) <= 20)
        self.assertEqual(hold_seconds(-5, 55), 0)

    def test_spread(self):
        values = {round(hold_seconds(None, 55), 1) for _ in range(100)}
        self.assertGreater(len(values), 20)

    def test_default_below_proxy_limits(self):
        self.assertLessEqual(agent_wait.WAIT_SECONDS, 55)


class FakeConn:
    def __init__(self, node, work):
        self.node, self.work, self.queries = node, work, []

    async def fetchrow(self, query, *args):
        self.queries.append((query, args))
        return self.work if "EXISTS" in query else self.node


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return pool.conn

            async def __aexit__(self, *exc):
                return False
        return _Ctx()


class FakeRequest:
    async def is_disconnected(self):
        return False


NODE = {"id": "6f1c0c8e-0000-4000-8000-000000000001", "node_id": "web01", "hostname": "WEB01"}


def call_route(conn, node_id="web01", kinds=None, timeout=0.2):
    return wait_route.agent_wait_route(node_id, FakeRequest(), kinds=kinds, timeout=timeout, db=FakePool(conn))


class RouteTest(unittest.TestCase):
    def setUp(self):
        terminal._terminal_sessions.clear()
        self.hub = agent_wait.hub
        agent_wait.hub = AgentWaitHub()

    def tearDown(self):
        terminal._terminal_sessions.clear()
        agent_wait.hub = self.hub

    def test_nothing_there(self):
        conn = FakeConn(NODE, {"jobs": False, "remediation": False})
        self.assertEqual(run(call_route(conn)), {"wake": []})

    def test_pending_job_answers_at_once(self):
        conn = FakeConn(NODE, {"jobs": True, "remediation": False})
        started = time.monotonic()
        self.assertEqual(run(call_route(conn, timeout=5)), {"wake": ["jobs"]})
        self.assertLess(time.monotonic() - started, 1)
        # the job poll looks the jobs up by the node's UUID: so does the check
        query, args = conn.queries[-1]
        self.assertEqual(args, ("web01", NODE["id"]))

    def test_kinds_the_agent_does_not_handle(self):
        conn = FakeConn(NODE, {"jobs": False, "remediation": True})
        self.assertEqual(run(call_route(conn, kinds="jobs,terminal,screen")), {"wake": []})

    def test_no_database_check_without_jobs(self):
        conn = FakeConn(NODE, {"jobs": True, "remediation": True})
        self.assertEqual(run(call_route(conn, kinds="terminal")), {"wake": []})
        self.assertFalse(any("EXISTS" in q for q, _ in conn.queries))

    def test_queued_terminal_command(self):
        session = terminal.TerminalSession("s-1", "web01", "bash")
        session.pending_commands.append("hostname")
        terminal._terminal_sessions["s-1"] = session
        conn = FakeConn(NODE, {"jobs": False, "remediation": False})
        self.assertEqual(run(call_route(conn, timeout=5)), {"wake": ["terminal"]})
        # same match as the terminal poll: another node's commands do not count
        self.assertEqual(run(call_route(conn, node_id="db01")), {"wake": []})

    def test_job_created_while_waiting(self):
        conn = FakeConn(NODE, {"jobs": False, "remediation": False})

        async def scenario():
            task = asyncio.create_task(call_route(conn, timeout=5))
            await asyncio.sleep(0.05)
            agent_wait.notify(NODE["id"], "jobs")  # routers/jobs.py notifies the node's UUID
            return await task
        started = time.monotonic()
        self.assertEqual(run(scenario()), {"wake": ["jobs"]})
        self.assertLess(time.monotonic() - started, 1)

    def test_unknown_node(self):
        conn = FakeConn(None, {"jobs": False, "remediation": False})
        self.assertEqual(run(call_route(conn, node_id="new-node")), {"wake": []})
        self.assertEqual(conn.queries[-1][1], ("new-node", "new-node"))

    def test_terminal_routes_notify(self):
        class InputRequest:
            async def json(self):
                return {"command": "uptime"}

        async def scenario():
            session = terminal.TerminalSession("s-2", "web01", "bash")
            terminal._terminal_sessions["s-2"] = session
            task = asyncio.create_task(agent_wait.hub.wait(["WEB01"], ALL, 5))
            await asyncio.sleep(0.05)
            await terminal.send_terminal_input("s-2", InputRequest(), None)
            return await task
        self.assertEqual(run(scenario()), ["terminal"])

    def test_route_needs_the_agent_key(self):
        from fastapi.testclient import TestClient

        from auth import CurrentUser, get_current_user
        from main import app
        client = TestClient(app, raise_server_exceptions=False)  # no "with": no database
        try:
            self.assertEqual(client.get("/api/v1/agent/wait/web01?timeout=0").status_code, 401)
            app.dependency_overrides[get_current_user] = lambda: CurrentUser("u-1", "viewer", ["nodes:read"])
            self.assertEqual(client.get("/api/v1/agent/wait/web01?timeout=0").status_code, 403)
        finally:
            app.dependency_overrides.clear()
            client.close()

if __name__ == "__main__":
    unittest.main()
