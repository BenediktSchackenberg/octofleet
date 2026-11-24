"""Logging setting: validation, the access line per mode, runtime changes, one handler for all modules,
components with their own level, and rejected requests (#330)."""
import asyncio
import logging
import os
import unittest
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel

import logging_config as lc


class Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


def app(status=200, delay=0.0, fail=False):
    async def inner(scope, receive, send):
        if delay:
            await asyncio.sleep(delay)
        if fail:
            raise RuntimeError("boom")
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": b""})
    return inner


def request(mw, path="/api/v1/jobs/pending/n1", query=b"token=SECRET"):
    async def receive():
        return {"type": "http.request"}

    async def send(_):
        pass
    scope = {"type": "http", "method": "GET", "path": path, "query_string": query, "client": ("10.0.0.5", 5555)}
    return asyncio.run(mw(scope, receive, send))


class ValidateTests(unittest.TestCase):
    def test_defaults_keep_todays_behaviour(self):
        self.assertEqual(lc.DEFAULTS, {"level": "info", "access_log": "all", "slow_ms": 1000, "components": {}})
        self.assertEqual(lc.validate({}), lc.DEFAULTS)

    def test_valid(self):
        self.assertEqual(lc.validate({"level": "debug", "access_log": "errors_slow", "slow_ms": 250}),
                         {"level": "debug", "access_log": "errors_slow", "slow_ms": 250, "components": {}})
        self.assertEqual(lc.validate({"components": {"Jobs": "debug", "Api": "error"}})["components"],
                         {"Jobs": "debug", "Api": "error"})

    def test_a_setting_from_before_components_is_valid(self):
        self.assertEqual(lc.validate({"level": "warning", "access_log": "off", "slow_ms": 1000})["components"], {})

    def test_invalid(self):
        for bad in ("x", [], {"level": "trace"}, {"access_log": "some"}, {"slow_ms": 5}, {"slow_ms": "100"},
                    {"slow_ms": True}, {"slow_ms": 700_000}, {"colour": "red"}, {"components": []},
                    {"components": {"Nope": "debug"}}, {"components": {"Jobs": "trace"}},
                    {"components": {"Access": "debug"}}):
            with self.assertRaises(ValueError, msg=bad):
                lc.validate(bad)


class AccessLogTests(unittest.TestCase):
    def setUp(self):
        self.capture = Capture()
        lc.access_logger.addHandler(self.capture)
        lc.access_logger.propagate = False

    def tearDown(self):
        lc.access_logger.removeHandler(self.capture)
        lc.access_logger.propagate = True
        lc.apply(dict(lc.DEFAULTS), quiet=True)

    def lines(self):
        return [r.getMessage() for r in self.capture.records]

    def test_all_requests(self):
        lc.apply({**lc.DEFAULTS, "access_log": "all"}, quiet=True)
        request(lc.AccessLogMiddleware(app(200)))
        [line] = self.lines()
        self.assertRegex(line, r"^GET /api/v1/jobs/pending/n1 200 \d+\.\d ms 10\.0\.0\.5$")
        self.assertNotIn("SECRET", line)  # the query string (tokens) never reaches the log

    def test_errors_and_slow_only(self):
        lc.apply({**lc.DEFAULTS, "access_log": "errors_slow", "slow_ms": 50}, quiet=True)
        request(lc.AccessLogMiddleware(app(200)))
        request(lc.AccessLogMiddleware(app(404)))
        request(lc.AccessLogMiddleware(app(200, delay=0.08)))
        with self.assertRaises(RuntimeError):
            request(lc.AccessLogMiddleware(app(fail=True)))
        statuses = [line.split()[2] for line in self.lines()]
        self.assertEqual(statuses, ["404", "200", "500"])  # the slow one and the exception count

    def test_off_and_runtime_switch(self):
        lc.apply({**lc.DEFAULTS, "access_log": "off"}, quiet=True)
        mw = lc.AccessLogMiddleware(app(500))
        request(mw)
        self.assertEqual(self.lines(), [])
        lc.apply({**lc.DEFAULTS, "access_log": "all"}, quiet=True)  # the same app, no restart
        request(mw)
        self.assertEqual(len(self.lines()), 1)

    def test_access_lines_do_not_depend_on_the_level(self):
        lc.apply({"level": "error", "access_log": "all", "slow_ms": 1000}, quiet=True)
        request(lc.AccessLogMiddleware(app(200)))
        self.assertEqual(len(self.lines()), 1)

    def test_should_log(self):
        s = {"access_log": "errors_slow", "slow_ms": 100}
        self.assertFalse(lc.should_log(200, 99.9, s))
        self.assertTrue(lc.should_log(200, 100, s))
        self.assertTrue(lc.should_log(401, 1, s))
        self.assertFalse(lc.should_log(500, 1, {"access_log": "off", "slow_ms": 1}))


class SetupTests(unittest.TestCase):
    def tearDown(self):
        if lc._listener:
            lc._listener.stop()
            lc._listener = None
        lc.apply(dict(lc.DEFAULTS), quiet=True)

    def test_one_handler_and_no_uvicorn_access_line(self):
        logging.basicConfig(level=logging.INFO)  # what modules did on import
        logging.getLogger("uvicorn.access").addHandler(logging.StreamHandler())
        lc.setup("warning")
        root = logging.getLogger()
        self.assertEqual(len(root.handlers), 1)
        self.assertIsInstance(root.handlers[0], logging.handlers.QueueHandler)
        self.assertEqual(root.level, logging.WARNING)
        self.assertTrue(logging.getLogger("uvicorn.access").disabled)
        self.assertEqual(logging.getLogger("uvicorn.access").handlers, [])
        self.assertTrue(logging.getLogger("uvicorn.error").propagate)

    def test_level_changes_at_runtime(self):
        lc.setup("info")
        log = logging.getLogger("some.module")
        self.assertFalse(log.isEnabledFor(logging.DEBUG))
        lc.apply({**lc.DEFAULTS, "level": "debug"}, quiet=True)
        self.assertTrue(log.isEnabledFor(logging.DEBUG))
        lc.apply({**lc.DEFAULTS, "level": "error"}, quiet=True)
        self.assertFalse(log.isEnabledFor(logging.WARNING))

    def test_unknown_env_level_falls_back(self):
        lc.setup("verbose")
        self.assertEqual(lc.current()["level"], "info")


class ComponentTests(unittest.TestCase):
    def tearDown(self):
        lc.apply(dict(lc.DEFAULTS), quiet=True)

    def test_tags(self):
        self.assertEqual(lc.tag_of("octofleet.Jobs"), ("Jobs", ""))
        self.assertEqual(lc.tag_of("octofleet.Access"), ("Access", ""))
        self.assertEqual(lc.tag_of("routers.inventory"), ("Inventory", "routers.inventory: "))
        self.assertEqual(lc.tag_of("vulnerability_cache"), ("Vulnerabilities", "vulnerability_cache: "))
        self.assertEqual(lc.tag_of("asyncpg.pool"), ("Api", "asyncpg.pool: "))
        self.assertEqual(lc.tag_of("octofleet.Nope"), ("Api", "octofleet.Nope: "))

    def test_line_format(self):
        f = lc._formatter()
        rec = logging.LogRecord("octofleet.Jobs", logging.INFO, __file__, 1, "Job %s handed out", ("i1",), None)
        self.assertRegex(f.format(rec), r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d{4} INFO \[Jobs\] Job i1 handed out$")
        rec = logging.LogRecord("routers.remediation", logging.WARNING, __file__, 1, "x", (), None)
        self.assertTrue(f.format(rec).endswith("WARNING [Remediation] routers.remediation: x"))

    def test_component_logger(self):
        self.assertEqual(lc.component("Jobs").name, "octofleet.Jobs")
        with self.assertRaises(ValueError):
            lc.component("Nope")

    def test_the_mapping_names_existing_modules_and_components(self):
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for module, comp in lc.MODULES.items():
            self.assertIn(comp, lc.COMPONENTS, module)
            if not module.startswith("uvicorn"):
                self.assertTrue(os.path.exists(os.path.join(here, *module.split(".")) + ".py"), module)

    def test_level_per_component(self):
        lc.apply({**lc.DEFAULTS, "components": {"Jobs": "debug", "Remediation": "error"}}, quiet=True)
        self.assertTrue(lc.component("Jobs").isEnabledFor(logging.DEBUG))
        self.assertTrue(logging.getLogger("routers.jobs").isEnabledFor(logging.DEBUG))  # module of the component
        self.assertFalse(lc.component("Api").isEnabledFor(logging.DEBUG))
        self.assertFalse(logging.getLogger("some.library").isEnabledFor(logging.DEBUG))
        self.assertFalse(logging.getLogger("routers.remediation").isEnabledFor(logging.WARNING))
        self.assertTrue(lc.component("Inventory").isEnabledFor(logging.INFO))
        self.assertEqual(lc.current()["components"], {"Jobs": "debug", "Remediation": "error"})
        # back to the global level, without a restart
        lc.apply({**lc.DEFAULTS, "level": "warning"}, quiet=True)
        self.assertFalse(lc.component("Jobs").isEnabledFor(logging.INFO))
        self.assertTrue(logging.getLogger("routers.remediation").isEnabledFor(logging.WARNING))
        self.assertFalse(logging.getLogger("routers.jobs").isEnabledFor(logging.INFO))

    def test_a_debug_component_reaches_the_handler_below_the_global_level(self):
        capture = Capture()
        root = logging.getLogger()
        root.addHandler(capture)
        try:
            lc.apply({**lc.DEFAULTS, "level": "warning", "components": {"Jobs": "debug"}}, quiet=True)
            lc.component("Jobs").debug("seen")
            lc.component("Inventory").info("not seen")
        finally:
            root.removeHandler(capture)
        self.assertEqual([r.getMessage() for r in capture.records], ["seen"])

    def test_access_has_no_level(self):
        lc.apply({**lc.DEFAULTS, "level": "error", "components": {"Api": "error"}}, quiet=True)
        self.assertTrue(lc.access_logger.isEnabledFor(logging.INFO))


class RateLimiterTests(unittest.TestCase):
    def test_one_line_per_window_then_the_count(self):
        rl = lc.RateLimiter(window=600)
        self.assertEqual(rl.hit("a", now=0), 0)
        self.assertIsNone(rl.hit("a", now=1))
        self.assertIsNone(rl.hit("a", now=599))
        self.assertEqual(rl.hit("b", now=2), 0)  # another key has its own window
        self.assertEqual(rl.hit("a", now=600), 2)
        self.assertIsNone(rl.hit("a", now=601))
        self.assertEqual(rl.hit("a", now=5000), 1)

    def test_memory_is_bounded(self):
        rl = lc.RateLimiter(window=600, max_keys=100)
        for i in range(1000):
            self.assertEqual(rl.hit(i, now=0), 0)
        self.assertLessEqual(len(rl._seen), 100)
        rl.hit("new", now=10_000)  # the expired keys go first
        self.assertEqual(len(rl._seen), 1)


class Push(BaseModel):
    hostname: str
    cores: int


def rejecting_app():
    app = FastAPI()

    @app.exception_handler(RequestValidationError)
    async def handler(request: Request, exc: RequestValidationError):
        lc.log_rejected(request, exc)
        return await request_validation_exception_handler(request, exc)

    @app.post("/api/v1/inventory/full")
    async def push(data: Push):
        return {"ok": True}

    @app.post("/api/v1/jobs/{node_id}/thing")
    async def thing(node_id: str, data: Dict[str, Any], n: int = 0):
        return {"ok": True}

    @app.get("/api/v1/agent/wait/{node_id}")
    async def wait(node_id: str, timeout: float = 0):
        return {"ok": True}
    return app


class RejectedTests(unittest.TestCase):
    def setUp(self):
        lc.rejected_limiter = lc.RateLimiter()
        self.capture = Capture()
        self.logger = logging.getLogger("octofleet")
        self.logger.addHandler(self.capture)
        self.client = TestClient(rejecting_app())

    def tearDown(self):
        self.logger.removeHandler(self.capture)

    def lines(self):
        return [(r.name, r.levelno, r.getMessage()) for r in self.capture.records]

    def test_reason_node_size_and_no_values(self):
        r = self.client.post("/api/v1/inventory/full", json={"hostname": "WEB01", "cores": "SECRET-7"})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["detail"][0]["loc"], ["body", "cores"])  # FastAPI's answer as before
        [(name, level, line)] = self.lines()
        self.assertEqual((name, level), ("octofleet.Inventory", logging.WARNING))
        self.assertRegex(line, r"^Rejected POST /api/v1/inventory/full from node WEB01 \(testclient, \d+ bytes\): "
                               r"422 body\.cores: Input should be a valid integer")
        self.assertNotIn("SECRET", line)

    def test_broken_json_names_the_parser_error(self):
        r = self.client.post("/api/v1/inventory/full", content=b'{"hostname": "WEB01", "cores": 1,5}',
                             headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 422)
        [(_, _, line)] = self.lines()
        self.assertIn("POST /api/v1/inventory/full from testclient (", line)
        self.assertIn("JSON decode error (", line)

    def test_rate_limited_per_node_route_and_reason(self):
        for _ in range(5):
            self.client.post("/api/v1/jobs/n1/thing", json=[1])
        self.client.post("/api/v1/jobs/n2/thing", json=[1])          # another node
        self.client.post("/api/v1/jobs/n1/thing?n=x", json={})       # another reason
        lines = self.lines()
        self.assertEqual(len(lines), 3, lines)
        self.assertEqual({name for name, _, _ in lines}, {"octofleet.Jobs"})
        self.assertIn("from node n1", lines[0][2])
        self.assertIn("from node n2", lines[1][2])
        self.assertIn("query.n:", lines[2][2])
        # after the window: one line with the count of the ones left out
        key = next(k for k in lc.rejected_limiter._seen if k[0] == "n1" and k[3].startswith("dict_type"))
        lc.rejected_limiter._seen[key][0] -= lc.REJECT_WINDOW
        self.client.post("/api/v1/jobs/n1/thing", json=[1])
        self.assertIn("[4 more like this since the last line]", self.lines()[-1][2])

    def test_node_from_the_path_on_a_query_error(self):
        self.client.get("/api/v1/agent/wait/LNX-1?timeout=soon")
        [(name, _, line)] = self.lines()
        self.assertEqual(name, "octofleet.Agent")
        self.assertIn("GET /api/v1/agent/wait/LNX-1 from node LNX-1", line)

    def test_the_app_logs_rejected_requests_and_unhandled_errors(self):
        import main
        self.assertIs(main.app.exception_handlers[RequestValidationError], main.validation_exception_handler)
        scope = {"type": "http", "method": "GET", "path": "/api/v1/x", "headers": [], "query_string": b""}
        response = asyncio.run(main.global_exception_handler(Request(scope), ValueError("bad value")))
        self.assertEqual(response.status_code, 500)
        [(name, level, line)] = self.lines()  # through the logger, not printed
        self.assertEqual((name, level), ("octofleet.Api", logging.ERROR))
        self.assertEqual(line, "Unhandled ValueError on GET /api/v1/x: bad value")

    def test_never_raises(self):
        class Broken:
            def errors(self):
                raise RuntimeError("boom")
        lc.log_rejected(object(), Broken())  # no exception


if __name__ == "__main__":
    unittest.main()
