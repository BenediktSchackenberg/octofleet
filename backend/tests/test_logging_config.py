"""Logging setting: validation, the access line per mode, runtime changes, one handler for all modules."""
import asyncio
import logging
import unittest

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
        self.assertEqual(lc.DEFAULTS, {"level": "info", "access_log": "all", "slow_ms": 1000})
        self.assertEqual(lc.validate({}), lc.DEFAULTS)

    def test_valid(self):
        self.assertEqual(lc.validate({"level": "debug", "access_log": "errors_slow", "slow_ms": 250}),
                         {"level": "debug", "access_log": "errors_slow", "slow_ms": 250})

    def test_invalid(self):
        for bad in ("x", [], {"level": "trace"}, {"access_log": "some"}, {"slow_ms": 5}, {"slow_ms": "100"},
                    {"slow_ms": True}, {"slow_ms": 700_000}, {"colour": "red"}):
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


if __name__ == "__main__":
    unittest.main()
