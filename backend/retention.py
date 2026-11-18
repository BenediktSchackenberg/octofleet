"""Data retention: applies the Retention page (table retention_config) to the time-series tables.

Each data type maps to a TimescaleDB hypertable. Its settings become TimescaleDB background
jobs, so old data leaves by dropping whole chunks (no row-by-row DELETE) and older chunks are
compressed:

- keep_days            -> retention policy (add_retention_policy, drop_after)
- compress_after_days  -> compression policy (add_compression_policy, compress_after); NULL = off
- legal_hold           -> no retention policy, nothing is deleted

apply_retention() is idempotent: it compares the wanted settings with the jobs that exist
(also ones made by hand, e.g. a retention policy added in psql) and only changes what differs.
It runs at startup and whenever a setting is saved.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Serialises apply_retention() between backend instances / concurrent saves.
_LOCK_KEY = 0x0C70F1EE7


@dataclass(frozen=True)
class RetentionTarget:
    category: str
    table: str
    time_column: str
    keep_days: int
    compress_after_days: Optional[int]
    segment_by: str
    order_by: str
    # New chunks get this interval: retention drops whole chunks, so smaller chunks keep the
    # stored range close to keep_days and let compression work day by day.
    chunk_interval_days: int


TARGETS: dict[str, RetentionTarget] = {t.category: t for t in (
    RetentionTarget("security_events", "events_normalized", "ts", 30, 7,
                    "node_id, event_type", "ts DESC", 1),
    RetentionTarget("file_events", "file_events", "ts", 90, 7, "node_id", "ts DESC", 1),
    RetentionTarget("performance_metrics", "node_metrics", "time", 30, 7, "node_id", "time DESC", 1),
    RetentionTarget("hardware_changes", "hardware_changes", "time", 365, None, "node_id", "time DESC", 7),
)}

MIN_DAYS = 1
MAX_DAYS = 3650


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS retention_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category text UNIQUE NOT NULL,
    legal_hold boolean DEFAULT false,
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE retention_config ADD COLUMN IF NOT EXISTS keep_days integer;
ALTER TABLE retention_config ADD COLUMN IF NOT EXISTS compress_after_days integer;
"""


def validate(keep_days, compress_after_days) -> Optional[str]:
    """Error text for invalid settings, None if they are fine."""
    if not isinstance(keep_days, int) or isinstance(keep_days, bool) or not MIN_DAYS <= keep_days <= MAX_DAYS:
        return f"keep_days must be a whole number from {MIN_DAYS} to {MAX_DAYS}"
    if compress_after_days is None:
        return None
    if (not isinstance(compress_after_days, int) or isinstance(compress_after_days, bool)
            or compress_after_days < MIN_DAYS):
        return f"compress_after_days must be a whole number of at least {MIN_DAYS}, or null (off)"
    if compress_after_days >= keep_days:
        return "compress_after_days must be less than keep_days"
    return None


async def ensure_schema(pool) -> None:
    """New columns and the default rows; rows from older versions get the new defaults once.

    The old hot/warm/cold columns were never applied, so they are not carried over.
    """
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
        for t in TARGETS.values():
            await conn.execute(
                """
                INSERT INTO retention_config (category, keep_days, compress_after_days)
                VALUES ($1, $2, $3)
                ON CONFLICT (category) DO UPDATE
                    SET keep_days = EXCLUDED.keep_days,
                        compress_after_days = EXCLUDED.compress_after_days,
                        updated_at = now()
                    WHERE retention_config.keep_days IS NULL
                """,
                t.category, t.keep_days, t.compress_after_days,
            )


async def _hypertable(conn, table: str):
    return await conn.fetchrow(
        """
        SELECT h.compression_enabled,
               EXTRACT(EPOCH FROM d.time_interval)::bigint AS chunk_seconds
        FROM timescaledb_information.hypertables h
        LEFT JOIN timescaledb_information.dimensions d
               ON d.hypertable_schema = h.hypertable_schema AND d.hypertable_name = h.hypertable_name
              AND d.dimension_number = 1
        WHERE h.hypertable_schema = 'public' AND h.hypertable_name = $1
        """,
        table,
    )


async def _job(conn, table: str, proc: str, key: str, days: Optional[int]):
    """The policy job of a hypertable: id, its interval as text, and whether it equals `days`."""
    return await conn.fetchrow(
        """
        SELECT job_id, config->>$3 AS current,
               COALESCE((config->>$3)::interval = make_interval(days => $4), false) AS same
        FROM timescaledb_information.jobs
        WHERE proc_name = $2 AND hypertable_schema = 'public' AND hypertable_name = $1
        ORDER BY job_id LIMIT 1
        """,
        table, proc, key, days or 0,
    )


async def apply_target(conn, target: RetentionTarget, keep_days: int,
                       compress_after_days: Optional[int], legal_hold: bool) -> dict:
    """Bring the TimescaleDB jobs of one table in line with its settings; returns what changed."""
    table = target.table
    changes: list[str] = []
    info = await _hypertable(conn, table)
    if info is None:
        logger.warning("retention: %s is not a hypertable, %s not applied", table, target.category)
        return {"category": target.category, "applied": False, "changes": [],
                "error": f"{table} is not a TimescaleDB hypertable"}

    wanted_chunk = target.chunk_interval_days * 86400
    if info["chunk_seconds"] != wanted_chunk:
        await conn.execute(
            "SELECT set_chunk_time_interval($1::regclass, make_interval(days => $2))",
            table, target.chunk_interval_days)
        changes.append(f"chunk interval {target.chunk_interval_days} d (new chunks)")

    # Retention: one policy per hypertable (TimescaleDB allows no second one).
    job = await _job(conn, table, "policy_retention", "drop_after", keep_days)
    if legal_hold:
        if job:
            await conn.execute("SELECT remove_retention_policy($1::regclass, if_exists => true)", table)
            changes.append("retention removed (legal hold)")
    elif job is None or not job["same"]:
        if job:
            await conn.execute("SELECT remove_retention_policy($1::regclass, if_exists => true)", table)
        await conn.execute(
            "SELECT add_retention_policy($1::regclass, drop_after => make_interval(days => $2))",
            table, keep_days)
        changes.append(f"retention {keep_days} d" + (f" (was {job['current']})" if job else ""))

    # Compression of older chunks.
    job = await _job(conn, table, "policy_compression", "compress_after", compress_after_days)
    if compress_after_days is None:
        if job:
            await conn.execute("SELECT remove_compression_policy($1::regclass, if_exists => true)", table)
            changes.append("compression policy removed")
    elif job is None or not job["same"]:
        if not info["compression_enabled"]:
            # Identifiers come from TARGETS (code), never from the request.
            await conn.execute(
                f"ALTER TABLE {table} SET (timescaledb.compress, "
                f"timescaledb.compress_segmentby = '{target.segment_by}', "
                f"timescaledb.compress_orderby = '{target.order_by}')")
            changes.append("compression enabled")
        if job:
            await conn.execute("SELECT remove_compression_policy($1::regclass, if_exists => true)", table)
        await conn.execute(
            "SELECT add_compression_policy($1::regclass, compress_after => make_interval(days => $2))",
            table, compress_after_days)
        changes.append(f"compression after {compress_after_days} d" + (f" (was {job['current']})" if job else ""))

    if changes:
        logger.info("retention %s (%s): %s", target.category, table, ", ".join(changes))
    return {"category": target.category, "applied": True, "changes": changes}


async def apply_retention(conn, category: Optional[str] = None) -> list[dict]:
    """Apply the stored settings (all data types, or one). Call inside a transaction."""
    await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEY)
    rows = await conn.fetch(
        "SELECT category, keep_days, compress_after_days, COALESCE(legal_hold, false) AS legal_hold "
        "FROM retention_config WHERE category = ANY($1::text[])",
        [category] if category else list(TARGETS))
    results = []
    for row in rows:
        target = TARGETS[row["category"]]
        keep = row["keep_days"] or target.keep_days
        results.append(await apply_target(conn, target, keep, row["compress_after_days"], row["legal_hold"]))
    return results


async def apply_on_startup(pool) -> None:
    """Startup: never block the API when the database refuses (e.g. no TimescaleDB)."""
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await apply_retention(conn)
    except Exception as exc:  # pragma: no cover - logged, retried on the next start or save
        logger.error("retention: applying the settings failed: %s", exc)


async def status(conn) -> list[dict]:
    """Settings plus what is in effect: jobs, stored size, oldest chunk, compression savings."""
    rows = await conn.fetch(
        "SELECT category, keep_days, compress_after_days, COALESCE(legal_hold, false) AS legal_hold, "
        "updated_at FROM retention_config WHERE category = ANY($1::text[])", list(TARGETS))
    by_category = {r["category"]: dict(r) for r in rows}
    out = []
    for target in TARGETS.values():
        item = {"category": target.category, "table": target.table,
                "keep_days": target.keep_days, "compress_after_days": target.compress_after_days,
                "legal_hold": False, "updated_at": None}
        item.update(by_category.get(target.category, {}))
        item["default_keep_days"] = target.keep_days
        item["default_compress_after_days"] = target.compress_after_days
        if await _hypertable(conn, target.table) is None:
            item.update(applied=False, size_bytes=None, oldest=None, jobs=[])
            out.append(item)
            continue
        # Catalog reads only: cost does not grow with the number of rows.
        stats = await conn.fetchrow(
            """
            SELECT hypertable_size(format('public.%I', $1::text)::regclass) AS size_bytes,
                   (SELECT min(range_start) FROM timescaledb_information.chunks
                     WHERE hypertable_schema = 'public' AND hypertable_name = $1) AS oldest,
                   (SELECT count(*) FROM timescaledb_information.chunks
                     WHERE hypertable_schema = 'public' AND hypertable_name = $1) AS chunks,
                   (SELECT count(*) FROM timescaledb_information.chunks
                     WHERE hypertable_schema = 'public' AND hypertable_name = $1 AND is_compressed) AS compressed_chunks
            """,
            target.table)
        jobs = await conn.fetch(
            """
            SELECT j.job_id, j.proc_name, s.last_run_status, s.last_successful_finish,
                   COALESCE(s.next_start, j.next_start) AS next_start
            FROM timescaledb_information.jobs j
            LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
            WHERE j.hypertable_schema = 'public' AND j.hypertable_name = $1
              AND j.proc_name IN ('policy_retention', 'policy_compression')
            ORDER BY j.job_id
            """,
            target.table)
        item.update(applied=True, size_bytes=stats["size_bytes"], oldest=stats["oldest"],
                    chunks=stats["chunks"], compressed_chunks=stats["compressed_chunks"],
                    jobs=[{"job_id": j["job_id"], "type": j["proc_name"].removeprefix("policy_"),
                           "last_run_status": j["last_run_status"],
                           "last_successful_finish": j["last_successful_finish"],
                           "next_start": j["next_start"]} for j in jobs])
        out.append(item)
    return out
