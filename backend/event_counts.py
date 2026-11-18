"""Hourly event counts for the counters (Security -> Events, dashboard, security dashboard).

Counting raw events grows with the fleet (0.3-1.3 s for 8 M events on one test installation, on
every page refresh). Two TimescaleDB continuous aggregates keep hourly counts instead:

- event_counts_hourly       (bucket, event_type, events)  over events_normalized
- file_event_counts_hourly  (bucket, events)              over file_events

Their size depends on the number of event types and hours, not on nodes or events (about 25
types x 24 rows a day). TimescaleDB refreshes them in the background (refresh policy); with
real-time aggregation (materialized_only = false) a query also counts the events since the last
refresh, so the numbers are current. They keep KEEP_DAYS of history; the counters only count
hours that are still stored in the event table (see stored_since()), so they match the lists.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

KEEP_DAYS = 400
_LOCK_KEY = 0x0C70C0047

VIEWS = {
    "event_counts_hourly": """
        CREATE MATERIALIZED VIEW event_counts_hourly
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket(INTERVAL '1 hour', ts) AS bucket, event_type, count(*) AS events
        FROM events_normalized
        GROUP BY 1, 2
        WITH NO DATA
    """,
    "file_event_counts_hourly": """
        CREATE MATERIALIZED VIEW file_event_counts_hourly
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket(INTERVAL '1 hour', ts) AS bucket, count(*) AS events
        FROM file_events
        GROUP BY 1
        WITH NO DATA
    """,
}


async def ensure_schema(pool) -> None:
    """Create the aggregates and their policies once. The first refresh (all stored events)
    runs in the database's background workers, not at startup."""
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEY)
                existing = {r["view_name"] for r in await conn.fetch(
                    "SELECT view_name FROM timescaledb_information.continuous_aggregates "
                    "WHERE view_schema = 'public'")}
            for name, sql in VIEWS.items():
                if name in existing:
                    continue
                # CREATE MATERIALIZED VIEW ... continuous cannot run inside a transaction block
                await conn.execute(sql)
                # Whole range (start_offset NULL): only invalidated hours are recomputed, so later
                # runs cost what changed; end_offset leaves the current hour to real-time aggregation.
                await conn.execute(
                    "SELECT add_continuous_aggregate_policy($1::regclass, start_offset => NULL, "
                    "end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '30 minutes', "
                    "if_not_exists => true)", name)
                await conn.execute(
                    "SELECT add_retention_policy($1::regclass, drop_after => make_interval(days => $2), "
                    "if_not_exists => true)", name, KEEP_DAYS)
                # First fill right away, by the database's job scheduler (not at startup)
                await conn.execute(
                    "SELECT alter_job(job_id, next_start => now()) FROM timescaledb_information.jobs "
                    "WHERE proc_name = 'policy_refresh_continuous_aggregate' AND hypertable_name = ("
                    "SELECT materialization_hypertable_name FROM timescaledb_information.continuous_aggregates "
                    "WHERE view_schema = 'public' AND view_name = $1)", name)
                logger.info("event counts: created %s (filled in the background)", name)
    except Exception as exc:  # pragma: no cover - the counters fall back to counting events
        logger.error("event counts: creating the hourly aggregates failed: %s", exc)


async def available(conn) -> bool:
    return bool(await conn.fetchval(
        "SELECT count(*) = 2 FROM timescaledb_information.continuous_aggregates "
        "WHERE view_schema = 'public' AND view_name = ANY($1::text[])", list(VIEWS)))


async def stored_since(conn, hypertable: str):
    """Start of the oldest chunk still stored (catalog read): counts before it were deleted."""
    return await conn.fetchval(
        "SELECT min(range_start) FROM timescaledb_information.chunks "
        "WHERE hypertable_schema = 'public' AND hypertable_name = $1", hypertable)
