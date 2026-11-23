"""Backend logging: one configuration for all modules, changeable at runtime (Admin -> Settings -> Logging).

- `level`: error / warning / info / debug for the backend's own loggers (the root logger).
- `access_log`: which HTTP requests get a line - `all` (default, as before), `errors_slow` (status
  >= 400 or slower than `slow_ms`) or `off`. Uvicorn's own access line has no duration, so it cannot
  tell slow requests; the AccessLogMiddleware below writes the line instead (method, path without the
  query string - tokens in URLs never reach the log -, status, duration).
- `queue`: lines are formatted and written by a background thread (logging.handlers.QueueListener), so
  a request never waits for stdout or Docker's log driver.

The setting lives in system_settings (key `logging`), is loaded at startup and applied in this process
when it is changed. The backend runs as one process; with several workers each would have to reload it.
"""
import json
import logging
import logging.handlers
import os
import queue
import sys
import time
from typing import Optional

KEY = "logging"
LEVELS = {"error": logging.ERROR, "warning": logging.WARNING, "info": logging.INFO, "debug": logging.DEBUG}
ACCESS_MODES = ("all", "errors_slow", "off")
# Today's behaviour stays the default: info, every request logged
DEFAULTS = {"level": "info", "access_log": "all", "slow_ms": 1000}
FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"

access_logger = logging.getLogger("octofleet.access")

# The current setting, read by the access middleware on every request (a dict lookup, no lock)
_current = dict(DEFAULTS)
_listener: Optional[logging.handlers.QueueListener] = None


def validate(data) -> dict:
    """The complete setting from a request body (missing fields keep their defaults); ValueError
    with the reason for the person."""
    if not isinstance(data, dict):
        raise ValueError("a JSON object with level, access_log and slow_ms")
    unknown = set(data) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"unknown fields: {', '.join(sorted(unknown))}")
    out = {**DEFAULTS, **data}
    if out["level"] not in LEVELS:
        raise ValueError("level: error, warning, info or debug")
    if out["access_log"] not in ACCESS_MODES:
        raise ValueError("access_log: all, errors_slow or off")
    slow = out["slow_ms"]
    if not isinstance(slow, int) or isinstance(slow, bool) or not 10 <= slow <= 600_000:
        raise ValueError("slow_ms: 10 to 600000")
    return out


def current() -> dict:
    return dict(_current)


def _formatter() -> logging.Formatter:
    f = logging.Formatter(FORMAT, datefmt="%Y-%m-%dT%H:%M:%S%z")
    return f


def setup(env_level: Optional[str] = None) -> None:
    """At startup, before the database is there: one stdout handler for everything (replacing the
    basicConfig handlers some modules set on import), behind a queue. LOG_LEVEL sets the level until
    the stored setting is loaded."""
    global _listener
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(_formatter())
    if os.environ.get("LOG_QUEUE", "1") != "0":
        q: queue.SimpleQueue = queue.SimpleQueue()
        root.addHandler(logging.handlers.QueueHandler(q))
        if _listener:
            _listener.stop()
        _listener = logging.handlers.QueueListener(q, stream, respect_handler_level=False)
        _listener.start()
    else:
        root.addHandler(stream)
    # uvicorn's loggers go through the same handler; its own access line is replaced by ours
    for name in ("uvicorn", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False
    access.disabled = True
    level = (env_level or os.environ.get("LOG_LEVEL") or DEFAULTS["level"]).lower()
    apply({**DEFAULTS, "level": level if level in LEVELS else DEFAULTS["level"]}, quiet=True)


def apply(setting: dict, quiet: bool = False) -> None:
    """Make the setting effective in this process right away."""
    global _current
    _current = dict(setting)
    level = LEVELS[setting["level"]]
    logging.getLogger().setLevel(level)
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).setLevel(level)
    # access lines are INFO: the access setting decides, not the level
    access_logger.setLevel(logging.INFO)
    access_logger.disabled = setting["access_log"] == "off"
    if not quiet:
        logging.getLogger(__name__).warning(
            "Logging: level %s, access log %s%s", setting["level"], setting["access_log"],
            f" (slow from {setting['slow_ms']} ms)" if setting["access_log"] == "errors_slow" else "")


async def load(pool) -> dict:
    """The stored setting (defaults when there is none or it is broken), applied."""
    setting = dict(DEFAULTS)
    try:
        async with pool.acquire() as conn:
            raw = await conn.fetchval("SELECT value FROM system_settings WHERE key = $1", KEY)
    except Exception:  # never let the log setting stop the start
        logging.getLogger(__name__).exception("Could not read the logging setting; using the defaults")
        raw = None
    if raw:
        try:
            setting = validate(json.loads(raw))
        except (ValueError, TypeError):
            logging.getLogger(__name__).warning("Stored logging setting is invalid; using the defaults")
    apply(setting, quiet=True)
    return setting


async def save(pool, setting: dict, username: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        """, KEY, json.dumps(setting), username)
    apply(setting)


def should_log(status: int, duration_ms: float, setting: Optional[dict] = None) -> bool:
    s = setting or _current
    mode = s["access_log"]
    if mode == "all":
        return True
    if mode == "off":
        return False
    return status >= 400 or duration_ms >= s["slow_ms"]


class AccessLogMiddleware:
    """Pure ASGI middleware (no BaseHTTPMiddleware: that wraps every response in an extra task). One
    line per request the setting asks for: `GET /api/v1/jobs/pending/<id> 200 3.1 ms 10.0.0.5`."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or _current["access_log"] == "off":
            await self.app(scope, receive, send)
            return
        start = time.perf_counter()
        status = 500  # an exception before the response counts as a server error

        async def send_wrapper(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            ms = (time.perf_counter() - start) * 1000
            if should_log(status, ms):
                client = scope.get("client")
                access_logger.info("%s %s %d %.1f ms %s", scope.get("method", "-"), scope.get("path", "-"), status, ms,
                                   client[0] if client else "-")
