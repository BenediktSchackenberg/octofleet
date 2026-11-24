"""Failed job runs per node and kind of run, resolved by a later success (the Tasks page).

A run's kind is its job's command type - and for commands, scripts and packages also the job's
name, since another script succeeding does not fix this one. It is stored on the instance
(`job_instances.run_kind`, set by an insert trigger from its job), so that

- the failed runs of a window group by node and kind without reading `jobs`, and
- "did a later run of the same kind succeed on that node?" is one index probe per entry
  (`idx_job_instances_run_kind`), instead of joining every successful run of the week to its job.

Instances from before the column existed are filled in the background, newest first; until then
their kind is looked up from the job.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import asyncpg

logger = logging.getLogger(__name__)

# Job types whose jobs differ by what they run: the kind includes the job name
VARIANT_COMMAND_TYPES = ("run", "script", "install_package", "uninstall_package", "update_package")

# The longest window the API accepts; older instances are not backfilled
MAX_WINDOW_HOURS = 24 * 90

_VARIANTS_SQL = "ARRAY[" + ", ".join(f"'{t}'" for t in VARIANT_COMMAND_TYPES) + "]"
RUN_KIND_OF_JOB = (f"CASE WHEN j.command_type = ANY({_VARIANTS_SQL}) "
                   "THEN j.command_type || ':' || COALESCE(j.name, '') ELSE j.command_type END")

FINISHED = "COALESCE(ji.completed_at, ji.updated_at)"


async def ensure_schema(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute("ALTER TABLE job_instances ADD COLUMN IF NOT EXISTS run_kind text")
        await conn.execute(f"""
            CREATE OR REPLACE FUNCTION job_instances_set_run_kind() RETURNS trigger AS $$
            BEGIN
                IF NEW.run_kind IS NULL THEN
                    SELECT {RUN_KIND_OF_JOB} INTO NEW.run_kind FROM jobs j WHERE j.id = NEW.job_id;
                END IF;
                RETURN NEW;
            END $$ LANGUAGE plpgsql""")
        await conn.execute("DROP TRIGGER IF EXISTS job_instances_run_kind ON job_instances")
        await conn.execute("""CREATE TRIGGER job_instances_run_kind BEFORE INSERT ON job_instances
                              FOR EACH ROW EXECUTE FUNCTION job_instances_set_run_kind()""")
        # the last success of a kind on a node after a time: one probe
        await conn.execute(f"""CREATE INDEX IF NOT EXISTS idx_job_instances_run_kind
                               ON job_instances (node_id, run_kind, status, ({FINISHED.replace('ji.', '')}))""")
        # the failed runs of a window
        await conn.execute(f"""CREATE INDEX IF NOT EXISTS idx_job_instances_status_finished
                               ON job_instances (status, ({FINISHED.replace('ji.', '')}))""")


async def backfill_run_kind(pool: asyncpg.Pool, slice_hours: int = 24) -> int:
    """Set run_kind on instances from before the column: open ones, then finished ones of the
    longest window, one day at a time from the newest. Returns the number of rows set."""
    total = 0
    try:
        async with pool.acquire() as conn:
            total += int((await conn.execute(f"""
                UPDATE job_instances ji SET run_kind = {RUN_KIND_OF_JOB} FROM jobs j
                WHERE j.id = ji.job_id AND ji.run_kind IS NULL
                  AND ji.status NOT IN ('failed', 'success', 'cancelled')""")).split()[-1])
            end = datetime.now(timezone.utc) + timedelta(minutes=5)
            oldest = end - timedelta(hours=MAX_WINDOW_HOURS + slice_hours)
            while end > oldest:
                start = end - timedelta(hours=slice_hours)
                total += int((await conn.execute(f"""
                    UPDATE job_instances ji SET run_kind = {RUN_KIND_OF_JOB} FROM jobs j
                    WHERE j.id = ji.job_id AND ji.run_kind IS NULL AND ji.status IN ('failed', 'success')
                      AND {FINISHED} >= $1 AND {FINISHED} < $2""", start, end)).split()[-1])
                end = start
                await asyncio.sleep(0)
    except Exception:
        logger.exception("Filling job_instances.run_kind failed")
    if total:
        logger.info("Filled run_kind for %d job instance(s)", total)
    return total


def failure_reason(error_message: Optional[str], stderr: Optional[str], stdout_tail: Optional[str]) -> Optional[str]:
    """Why an instance failed: the error message, else stderr, else the last lines of the output."""
    for text in (error_message, stderr):
        if text and text.strip():
            return text.strip()[:1000]
    lines = [line for line in (stdout_tail or "").strip().splitlines() if line.strip()]
    return "\n".join(lines[-8:])[:1000] or None


async def list_failures(conn: asyncpg.Connection, since_hours: int, include_resolved: bool,
                        limit: int, offset: int) -> dict:
    """See GET /api/v1/jobs/failures."""
    # Failed runs of the window per node and kind (rows not backfilled yet: kind from the job)
    groups = await conn.fetch(f"""
        SELECT node_id, run_kind, count(*) AS failures,
               min(finished) AS first_failed_at, max(finished) AS last_failed_at,
               (array_agg(id ORDER BY finished DESC))[1] AS instance_id,
               (array_agg(job_id ORDER BY finished DESC))[1] AS job_id
        FROM (SELECT ji.id, ji.job_id, ji.node_id, {FINISHED} AS finished,
                     COALESCE(ji.run_kind, (SELECT {RUN_KIND_OF_JOB} FROM jobs j WHERE j.id = ji.job_id)) AS run_kind
              FROM job_instances ji
              WHERE ji.status = 'failed' AND {FINISHED} >= NOW() - make_interval(hours => $1)) f
        GROUP BY node_id, run_kind
    """, since_hours)

    # A later success of the same kind on the same node: one index probe per entry
    last_success = {}
    if groups:
        rows = await conn.fetch(f"""
            SELECT g.i, s.last_success_at
            FROM unnest($1::text[], $2::text[], $3::timestamptz[]) WITH ORDINALITY AS g(node_id, run_kind, after, i)
            CROSS JOIN LATERAL (
                SELECT max({FINISHED}) AS last_success_at FROM job_instances ji
                WHERE ji.node_id = g.node_id AND ji.run_kind = g.run_kind AND ji.status = 'success'
                  AND {FINISHED} > g.after
            ) s
            WHERE s.last_success_at IS NOT NULL
        """, [g["node_id"] for g in groups], [g["run_kind"] for g in groups],
            [g["last_failed_at"] for g in groups])
        last_success = {r["i"] - 1: r["last_success_at"] for r in rows}

    entries = [(g, last_success.get(i)) for i, g in enumerate(groups)]
    resolved_total = sum(1 for _, s in entries if s)
    listed = [e for e in entries if include_resolved or not e[1]]
    listed.sort(key=lambda e: (e[0]["last_failed_at"], e[0]["node_id"], e[0]["run_kind"] or ""), reverse=True)
    page = listed[offset:offset + limit]

    details = {}
    if page:
        rows = await conn.fetch("""
            SELECT ji.id, j.command_type, j.name AS job_name, COALESCE(n1.id, n2.id) AS node_uuid,
                   COALESCE(n1.hostname, n2.hostname) AS hostname,
                   ji.error_message, ji.stderr, RIGHT(ji.stdout, 2000) AS stdout_tail
            FROM job_instances ji
            LEFT JOIN jobs j ON j.id = ji.job_id
            LEFT JOIN nodes n1 ON n1.id::text = ji.node_id
            LEFT JOIN nodes n2 ON n2.node_id = ji.node_id AND n1.id IS NULL
            WHERE ji.id = ANY($1::uuid[])
        """, [g["instance_id"] for g, _ in page])
        details = {r["id"]: r for r in rows}

    failures = []
    for g, success in page:
        d = details.get(g["instance_id"])
        failures.append({
            "node_id": str(d["node_uuid"]) if d and d["node_uuid"] else g["node_id"],
            "hostname": d["hostname"] if d else None,
            "command_type": d["command_type"] if d else (g["run_kind"] or "").split(":")[0],
            "job_id": str(g["job_id"]),
            "job_name": d["job_name"] if d else None,
            "failures": g["failures"],
            "first_failed_at": g["first_failed_at"].isoformat(),
            "last_failed_at": g["last_failed_at"].isoformat(),
            "last_success_at": success.isoformat() if success else None,
            "resolved": success is not None,
            "reason": failure_reason(d["error_message"], d["stderr"], d["stdout_tail"]) if d else None,
        })
    return {"failures": failures, "total": len(entries) - resolved_total, "resolved": resolved_total,
            "since_hours": since_hours}
