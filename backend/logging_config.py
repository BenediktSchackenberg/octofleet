"""Backend logging: one configuration for all modules, changeable at runtime (Admin -> Settings -> Logging).

- `level`: error / warning / info / debug for the backend's own loggers (the root logger).
- `components` (#330): every line carries its component - `[Jobs]`, `[Inventory]`, ... - with the names
  the agents use for their log files, plus server-only ones (`Api`, `Auth`, `Vulnerabilities`, ...).
  A component can get its own level (`{"Jobs": "debug"}`); the others follow `level`. Modules keep
  `logging.getLogger(__name__)`; MODULES assigns them to a component.
- `access_log`: which HTTP requests get a line - `all` (default, as before), `errors_slow` (status
  >= 400 or slower than `slow_ms`) or `off`. Uvicorn's own access line has no duration, so it cannot
  tell slow requests; the AccessLogMiddleware below writes the line instead (method, path without the
  query string - tokens in URLs never reach the log -, status, duration).
- `queue`: lines are formatted and written by a background thread (logging.handlers.QueueListener), so
  a request never waits for stdout or Docker's log driver.
- Rejected requests (RequestValidationError, e.g. an agent's inventory the server cannot read): one
  warning with route, node, reason and size - never the body -, at most one per node, route and reason
  in REJECT_WINDOW seconds (log_rejected).

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
# Today's behaviour stays the default: info, every request logged, no component with its own level
DEFAULTS = {"level": "info", "access_log": "all", "slow_ms": 1000, "components": {}}
FORMAT = "%(asctime)s %(levelname)s [%(component)s] %(source)s%(message)s"

# Components whose level can be set. The agents' names (Agent, Inventory, Jobs, Updates, Remediation,
# Security, RemoteTools, SelfUpdate) mean the same here; the others are server-only. Api is everything
# not assigned: main.py's routes, unhandled errors, rejected requests, uvicorn and libraries.
COMPONENTS = ("Api", "Agent", "Alerts", "Auth", "Inventory", "Jobs", "Remediation", "RemoteTools", "Retention",
              "Security", "SelfUpdate", "Updates", "Vulnerabilities")
# The request lines: switched by `access_log`, not by a level
ACCESS = "Access"
DEFAULT_COMPONENT = "Api"
# Module loggers (logging.getLogger(__name__)) and their component
MODULES = {
    "uvicorn": "Api", "uvicorn.error": "Api",
    "agent_monitor": "Agent", "agent_wait": "Agent", "node_status": "Agent", "node_removal": "Agent",
    "routers.agent_monitor": "Agent", "routers.agent_wait": "Agent",
    "alerting": "Alerts", "monitoring_defaults": "Alerts", "routers.alerting": "Alerts",
    "routers.monitoring_mgmt": "Alerts",
    "auth": "Auth", "password_policy": "Auth", "routers.auth": "Auth", "routers.rbac": "Auth",
    "routers.password_policy": "Auth",
    "routers.inventory": "Inventory", "routers.hardware": "Inventory",
    "job_failures": "Jobs", "job_types": "Jobs", "repo_module": "Jobs", "routers.jobs": "Jobs",
    "routers.deployments": "Jobs", "routers.packages_mgmt": "Jobs",
    "remediation": "Remediation", "routers.remediation": "Remediation",
    "routers.terminal": "RemoteTools", "screen_session": "RemoteTools", "shell_session": "RemoteTools",
    "retention": "Retention",
    "event_counts": "Security", "security_hardening": "Security", "routers.security": "Security",
    "routers.agent_releases": "SelfUpdate",
    "linux_rules": "Updates", "linux_updates": "Updates", "node_reboot": "Updates", "routers.patches": "Updates",
    "routers.patch_explorer": "Updates", "routers.linux_rules": "Updates", "routers.node_reboot": "Updates",
    "msrc": "Vulnerabilities", "vulnerability": "Vulnerabilities", "vulnerability_cache": "Vulnerabilities",
    "routers.vulnerabilities": "Vulnerabilities",
}


def component(name: str) -> logging.Logger:
    """The logger of a component: `component("Jobs").info(...)` writes `... INFO [Jobs] ...`."""
    if name not in COMPONENTS and name != ACCESS:
        raise ValueError(f"unknown log component {name}")
    return logging.getLogger(f"octofleet.{name}")


access_logger = component(ACCESS)
log = component("Api")

# The current setting, read by the access middleware on every request (a dict lookup, no lock)
_current = {**DEFAULTS, "components": {}}
_listener: Optional[logging.handlers.QueueListener] = None


def validate(data) -> dict:
    """The complete setting from a request body (missing fields keep their defaults); ValueError
    with the reason for the person."""
    if not isinstance(data, dict):
        raise ValueError("a JSON object with level, access_log, slow_ms and components")
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
    comps = out["components"]
    if not isinstance(comps, dict):
        raise ValueError('components: an object like {"Jobs": "debug"}')
    for name, level in comps.items():
        if name not in COMPONENTS:
            raise ValueError(f"components: unknown component {name} ({', '.join(COMPONENTS)})")
        if level not in LEVELS:
            raise ValueError(f"components.{name}: error, warning, info or debug")
    out["components"] = dict(comps)
    return out


def current() -> dict:
    return {**_current, "components": dict(_current["components"])}


_tags: dict = {}


def tag_of(name: str) -> tuple:
    """(component, source) for a logger name: `octofleet.Jobs` -> ("Jobs", ""), a module logger ->
    (its component, "module: "), anything else -> ("Api", "name: "). Cached: it runs for every line."""
    tag = _tags.get(name)
    if tag is None:
        short = name[10:] if name.startswith("octofleet.") else None
        if short in COMPONENTS or short == ACCESS:
            tag = (short, "")
        else:
            tag = (MODULES.get(name, DEFAULT_COMPONENT), f"{name}: ")
        _tags[name] = tag
    return tag


class ComponentFormatter(logging.Formatter):
    """`2026-11-24T10:00:00+0100 INFO [Jobs] message`; a module's lines also name the module."""

    def format(self, record):
        record.component, record.source = tag_of(record.name)
        return super().format(record)


def _formatter() -> logging.Formatter:
    return ComponentFormatter(FORMAT, datefmt="%Y-%m-%dT%H:%M:%S%z")


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
    setting = {**DEFAULTS, **setting}
    _current = {**setting, "components": dict(setting["components"])}
    level = LEVELS[setting["level"]]
    logging.getLogger().setLevel(level)
    # Each component's loggers get its own level or the global one - set explicitly, so a component
    # that is set back to the global level does not keep its old one
    levels = {c: LEVELS[setting["components"].get(c, setting["level"])] for c in COMPONENTS}
    for c in COMPONENTS:
        logging.getLogger(f"octofleet.{c}").setLevel(levels[c])
    for name, c in MODULES.items():
        logging.getLogger(name).setLevel(levels[c])
    # access lines are INFO: the access setting decides, not the level
    access_logger.setLevel(logging.INFO)
    access_logger.disabled = setting["access_log"] == "off"
    if not quiet:
        own = ", ".join(f"{c} {lv}" for c, lv in sorted(setting["components"].items()))
        log.warning(
            "Logging: level %s%s, access log %s%s", setting["level"], f" ({own})" if own else "",
            setting["access_log"],
            f" (slow from {setting['slow_ms']} ms)" if setting["access_log"] == "errors_slow" else "")


async def load(pool) -> dict:
    """The stored setting (defaults when there is none or it is broken), applied."""
    setting = dict(DEFAULTS)
    try:
        async with pool.acquire() as conn:
            raw = await conn.fetchval("SELECT value FROM system_settings WHERE key = $1", KEY)
    except Exception:  # never let the log setting stop the start
        log.exception("Could not read the logging setting; using the defaults")
        raw = None
    if raw:
        try:
            setting = validate(json.loads(raw))
        except (ValueError, TypeError):
            log.warning("Stored logging setting is invalid; using the defaults")
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


# --- Rejected requests -------------------------------------------------------------------------------

REJECT_WINDOW = 600.0  # seconds: one line per node, route and reason, then a count with the next line
# Routes in main.py (component Api by module) that belong to a component
_PATH_COMPONENTS = (
    ("/api/v1/jobs", "Jobs"), ("/api/v1/inventory", "Inventory"), ("/api/v1/live-data", "Inventory"),
    ("/api/v1/events", "Inventory"), ("/api/v1/agents", "Agent"), ("/api/v1/agent/", "Agent"),
    ("/api/v1/nodes/register", "Agent"),
)


class RateLimiter:
    """At most one line per key and window; the hits in between are counted for the next line.

    Memory is bounded: past MAX_KEYS keys the expired ones are dropped, and if that is not enough
    (a flood of distinct keys) the table starts over - the worst case is a few extra lines."""

    def __init__(self, window: float = REJECT_WINDOW, max_keys: int = 10_000):
        self.window = window
        self.max_keys = max_keys
        self._seen: dict = {}

    def hit(self, key, now: Optional[float] = None) -> Optional[int]:
        """None: stay quiet; otherwise log, with the number of hits left out since the last line."""
        now = time.monotonic() if now is None else now
        entry = self._seen.get(key)
        if entry is not None and now - entry[0] < self.window:
            entry[1] += 1
            return None
        if entry is None and len(self._seen) >= self.max_keys:
            self._seen = {k: v for k, v in self._seen.items() if now - v[0] < self.window}
            if len(self._seen) >= self.max_keys:
                self._seen.clear()
        self._seen[key] = [now, 0]
        return entry[1] if entry else 0


rejected_limiter = RateLimiter()


def _clean(value, limit: int = 64) -> str:
    """A value from the request for the log: short, one line."""
    text = str(value)[:limit]
    return "".join(ch if ch.isprintable() else "?" for ch in text)


def _node_of(request, body) -> str:
    params = getattr(request, "path_params", None) or {}
    for key in ("node_id", "hostname"):
        if params.get(key):
            return _clean(params[key])
    if isinstance(body, dict):
        for key in ("nodeId", "node_id", "hostname"):
            if isinstance(body.get(key), str) and body[key]:
                return _clean(body[key])
    return "-"


def _reason(errors) -> tuple:
    """(key, text) for the first error: where and what, without the rejected value. The key leaves out
    list indexes and JSON positions, so one bug in many items counts as one reason."""
    if not errors:
        return "invalid", "invalid request"
    first = errors[0]
    loc = [p for p in first.get("loc", ())]
    where = ".".join(str(p) for p in loc) or "request"
    what = _clean(first.get("msg", "invalid"), 160)
    if first.get("type") == "json_invalid" and isinstance(first.get("ctx"), dict):
        what += f" ({_clean(first['ctx'].get('error', ''), 80)})"
    more = f" (+{len(errors) - 1} more)" if len(errors) > 1 else ""
    key = f"{first.get('type', '')}:{'.'.join('*' if isinstance(p, int) else str(p) for p in loc)}"
    return key, f"{where}: {what}{more}"


def _component_of_route(request, path: str) -> str:
    route = request.scope.get("route")
    module = getattr(getattr(route, "endpoint", None), "__module__", "") or ""
    comp = MODULES.get(module, DEFAULT_COMPONENT)
    if comp == DEFAULT_COMPONENT:
        for prefix, c in _PATH_COMPONENTS:
            if path.startswith(prefix):
                return c
    return comp


def log_rejected(request, exc, status: int = 422, now: Optional[float] = None) -> None:
    """One warning for a request FastAPI rejected before the route ran (wrong field types, broken JSON):
    `Rejected POST /api/v1/inventory/full from node WEB01 (10.0.0.5, 48213 bytes): 422 body.hardware.cpu.cores:
    Input should be a valid integer`, or `... from 10.0.0.5 (48213 bytes): 422 body.1234: JSON decode error
    (Expecting ',' delimiter)` when the node is not known. Never the body or the rejected values; rate-limited per node (or
    client address), route and reason. Never raises."""
    try:
        path = request.url.path
        route = getattr(request.scope.get("route"), "path", None) or path
        body = getattr(exc, "body", None)
        node = _node_of(request, body)
        client = request.client.host if request.client else "-"
        key, reason = _reason(exc.errors())
        left_out = rejected_limiter.hit((node if node != "-" else client, request.method, route, key), now)
        if left_out is None:
            return
        logger = component(_component_of_route(request, path))
        size = _clean(request.headers.get("content-length") or "-", 12)
        sender = f"node {node} ({client}, {size} bytes)" if node != "-" else f"{client} ({size} bytes)"
        logger.warning("Rejected %s %s from %s: %d %s%s", request.method, path, sender, status, reason,
                       f" [{left_out} more like this since the last line]" if left_out else "")
    except Exception:  # logging must never turn a 422 into a 500
        log.debug("Could not log a rejected request", exc_info=True)
