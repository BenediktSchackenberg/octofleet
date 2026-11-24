"""One long-poll per agent instead of several idle pollers (#283).

The agent asks `GET /api/v1/agent/wait/{node_id}` (routers/agent_wait.py). The server holds the
request until there is something for the node - a job, a remediation job, a terminal command or
session, a screen or shell session - or until the hold time is over, and then answers which polls the
agent should run now: `{"wake": ["jobs", "terminal"]}`, or `{"wake": []}`.

The routes that create work call `hub.notify(node, kind)`. A wake-up for a node whose agent is between
two requests is kept for PENDING_TTL seconds and handed to its next request. Work that is created
without a notify (scheduled jobs that become due, job paths that do not notify) is found by the check
when the agent's next request comes in, so it waits at most one hold time.

In-process: this works with one backend instance (the terminal, screen and shell sessions live in the
process anyway). With several instances a notify only reaches the requests held by its own instance;
the others pick the work up with the check on their agent's next request.
"""
import asyncio
import os
import random
import signal
import time
from typing import Awaitable, Callable, Iterable, Optional

# The kinds of work, in the order the answer lists them
KINDS = ("jobs", "remediation", "terminal", "screen", "shell")

# How long the server holds a request at most; below common proxy idle limits (60 s). The agent can
# ask for less (?timeout=), never more.
WAIT_SECONDS = float(os.getenv("AGENT_WAIT_SECONDS", "55"))
# The hold time is shortened by up to this share at random, so agents started together do not all
# come back in the same second.
WAIT_JITTER = 0.1
# A wake-up for a node without a waiting request is kept this long
PENDING_TTL = 120.0
# A held request checks this often whether the agent is still connected (agent restarted)
DISCONNECT_CHECK_SECONDS = 5.0


def node_keys(*ids) -> set:
    """The keys a node is known by: node id, hostname, UUID - upper case, empty ones left out."""
    return {str(i).strip().upper() for i in ids if i is not None and str(i).strip()}


def hold_seconds(requested: Optional[float] = None, limit: Optional[float] = None) -> float:
    """The hold time for one request: the agent's wish capped at the server's limit, minus jitter."""
    limit = WAIT_SECONDS if limit is None else limit
    seconds = limit if requested is None else max(0.0, min(float(requested), limit))
    return seconds * (1 - WAIT_JITTER * random.random())


class _Waiter:
    __slots__ = ("keys", "kinds", "reasons", "event", "loop")

    def __init__(self, keys: set, kinds: set):
        self.keys = keys
        self.kinds = kinds
        self.reasons: set = set()
        self.event = asyncio.Event()
        self.loop = asyncio.get_running_loop()

    def wake(self) -> None:
        # notify may come from a worker thread (a sync route): the event belongs to the loop
        try:
            same_loop = asyncio.get_running_loop() is self.loop
        except RuntimeError:
            same_loop = False
        if same_loop:
            self.event.set()
        else:
            self.loop.call_soon_threadsafe(self.event.set)


class AgentWaitHub:
    """Held agent requests per node, and the wake-ups for nodes whose agent is not waiting."""

    def __init__(self, pending_ttl: float = PENDING_TTL, clock: Callable[[], float] = time.monotonic):
        self._waiters: dict = {}   # key -> set of _Waiter
        self._pending: dict = {}   # key -> {kind: time of the notify}
        self._ttl = pending_ttl
        self._clock = clock
        self._pruned = clock()
        self._closing = False

    def waiting(self) -> int:
        """Number of held requests."""
        return len({w for ws in self._waiters.values() for w in ws})

    def close(self) -> None:
        """The server stops: every held request answers empty now, new ones at once."""
        self._closing = True
        for waiters in self._waiters.values():
            for waiter in waiters:
                waiter.wake()

    def notify(self, nodes, kind: str) -> None:
        """There is work of KIND for NODES (one id or a list of ids, any form a node is known by)."""
        keys = node_keys(nodes) if isinstance(nodes, str) else node_keys(*nodes)
        now = self._clock()
        self._prune(now)
        for key in keys:
            delivered = False
            for waiter in self._waiters.get(key, ()):
                if kind in waiter.kinds:
                    waiter.reasons.add(kind)
                    waiter.wake()
                    delivered = True
            if not delivered:
                self._pending.setdefault(key, {})[kind] = now

    def _prune(self, now: float) -> None:
        # At most every 10 s: a job for all nodes notifies each node, and old agents never collect theirs
        if now - self._pruned < 10:
            return
        self._pruned = now
        for key in list(self._pending):
            kinds = {k: t for k, t in self._pending[key].items() if now - t <= self._ttl}
            if kinds:
                self._pending[key] = kinds
            else:
                del self._pending[key]

    def _take_pending(self, waiter: _Waiter) -> None:
        now = self._clock()
        for key in waiter.keys:
            kinds = self._pending.get(key)
            if not kinds:
                continue
            for kind in list(kinds):
                if kind in waiter.kinds:
                    if now - kinds[kind] <= self._ttl:
                        waiter.reasons.add(kind)
                    del kinds[kind]
            if not kinds:
                del self._pending[key]

    def _put_back(self, waiter: _Waiter) -> None:
        now = self._clock()
        for key in waiter.keys:
            for kind in waiter.reasons:
                self._pending.setdefault(key, {})[kind] = now

    async def wait(
        self,
        keys: Iterable[str],
        kinds: Iterable[str],
        timeout: float,
        check: Optional[Callable[[], Awaitable[Iterable[str]]]] = None,
        disconnected: Optional[Callable[[], Awaitable[bool]]] = None,
    ) -> list:
        """Wait up to TIMEOUT seconds for work of KINDS for the node known by KEYS.

        CHECK returns the kinds of work that are there already (database, terminal commands); it runs
        after the request is registered, so a notify during the check is not lost. DISCONNECTED tells
        whether the agent went away; the wake-ups it would have got are kept for its next request.
        Returns the kinds of work, in KINDS order; empty after the timeout.
        """
        waiter = _Waiter(node_keys(*keys), set(kinds))
        for key in waiter.keys:
            self._waiters.setdefault(key, set()).add(waiter)
        try:
            self._take_pending(waiter)
            if check is not None and not waiter.reasons:
                waiter.reasons.update(k for k in await check() if k in waiter.kinds)
            loop = asyncio.get_running_loop()
            deadline = loop.time() + timeout
            while not waiter.reasons and not self._closing:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    await asyncio.wait_for(waiter.event.wait(), min(remaining, DISCONNECT_CHECK_SECONDS))
                except asyncio.TimeoutError:
                    pass
                waiter.event.clear()
                if disconnected is not None and not waiter.reasons and await disconnected():
                    return []
            if waiter.reasons and disconnected is not None and await disconnected():
                self._put_back(waiter)
                return []
            return [k for k in KINDS if k in waiter.reasons]
        finally:
            for key in waiter.keys:
                waiters = self._waiters.get(key)
                if waiters is not None:
                    waiters.discard(waiter)
                    if not waiters:
                        del self._waiters[key]


hub = AgentWaitHub()


def release_on_shutdown() -> None:
    """Let held requests answer when the server is told to stop.

    uvicorn waits for open requests before it stops; without this a restart would wait for the
    agents' held requests (up to WAIT_SECONDS, longer than Docker's stop timeout). Called from the
    app's startup, where uvicorn's signal handlers are installed: they are chained, not replaced.
    """
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            previous = signal.getsignal(sig)
            if not callable(previous):
                continue

            def handler(signum, frame, previous=previous):
                loop.call_soon_threadsafe(hub.close)
                previous(signum, frame)
            signal.signal(sig, handler)
        except (ValueError, OSError):  # not in the main thread (tests), or not on this platform
            pass


def notify(nodes, kind: str) -> None:
    """Shortcut for the routes that create work: hub.notify, never failing the caller."""
    try:
        hub.notify(nodes, kind)
    except Exception:  # a missed wake-up only delays the work until the agent's next request
        pass
