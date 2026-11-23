"""GET /api/v1/jobs/failures: failed runs per node and job type, resolved by a later success."""

import os
import unittest
import uuid
from pathlib import Path

import asyncpg

import job_failures
from job_failures import failure_reason
from routers.jobs import list_job_failures


class FailureReason(unittest.TestCase):
    def test_error_message_first_then_stderr_then_output_tail(self):
        self.assertEqual(failure_reason("boom", "err", "out"), "boom")
        self.assertEqual(failure_reason(" ", "err\n", "out"), "err")
        out = "\n".join(f"line {i}" for i in range(20))
        self.assertEqual(failure_reason(None, None, out), "\n".join(f"line {i}" for i in range(12, 20)))
        self.assertIsNone(failure_reason(None, "", "  \n"))


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "requires isolated TimescaleDB")
class JobFailures(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.admin = await asyncpg.connect(os.environ["TEST_DATABASE_URL"])
        self.name = "jobfail_" + uuid.uuid4().hex
        await self.admin.execute(f'CREATE DATABASE "{self.name}"')
        self.pool = await asyncpg.create_pool(os.environ["TEST_DATABASE_URL"], database=self.name,
                                              min_size=1, max_size=2)
        async with self.pool.acquire() as conn:
            await conn.execute((Path(__file__).parents[1] / "schema-full.sql").read_text())
        await job_failures.ensure_schema(self.pool)

    async def asyncTearDown(self):
        await self.pool.close()
        await self.admin.execute(f'DROP DATABASE "{self.name}" WITH (FORCE)')
        await self.admin.close()

    async def run_job(self, conn, node: str, command_type: str, status: str, hours_ago: float,
                      name: str = "job", stdout: str = "") -> str:
        job = await conn.fetchval("""INSERT INTO jobs (name, target_type, command_type, command_data)
                                     VALUES ($1, 'device', $2, '{}') RETURNING id""", name, command_type)
        await conn.execute("""INSERT INTO job_instances (job_id, node_id, status, completed_at, exit_code, stdout)
                              VALUES ($1, $2, $3, NOW() - make_interval(secs => $4), $5, $6)""",
                           job, node, status, hours_ago * 3600, 0 if status == "success" else 1, stdout)
        return str(job)

    async def test_failures_grouped_and_resolved_by_a_later_success(self):
        async with self.pool.acquire() as conn:
            a = str(await conn.fetchval("INSERT INTO nodes (node_id, hostname) VALUES ('a', 'app-server-01') RETURNING id"))
            await conn.execute("INSERT INTO nodes (node_id, hostname) VALUES ('legacy-b', 'db-server-02')")
            # node a: three failed update searches, then one that succeeded -> resolved
            for h in (5, 4, 3):
                await self.run_job(conn, a, "patch_scan", "failed", h, stdout="Package lists refreshed: failed\nno bus")
            await self.run_job(conn, a, "patch_scan", "success", 1)
            # node a: a failed inventory without a later success -> open
            last_inventory = await self.run_job(conn, a, "inventory", "failed", 2, stdout="inventory\nfailed: disk")
            # node b (instance holds its old text node ID): a failed script; another script succeeded later -> still open
            await self.run_job(conn, "legacy-b", "script", "failed", 6, name="fix services", stdout="denied")
            await self.run_job(conn, "legacy-b", "script", "success", 1, name="list files")
            # older than the window
            await self.run_job(conn, a, "restart-agent", "failed", 24 * 10)
            # a success before the failure does not resolve it
            await self.run_job(conn, "legacy-b", "patch_install", "success", 8)
            await self.run_job(conn, "legacy-b", "patch_install", "failed", 7)

        result = await list_job_failures(since_hours=168, include_resolved=False, limit=100, offset=0, db=self.pool)
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["resolved"], 1)
        entries = {(f["hostname"], f["command_type"]): f for f in result["failures"]}
        self.assertEqual(set(entries), {("app-server-01", "inventory"), ("db-server-02", "script"),
                                        ("db-server-02", "patch_install")})
        inventory = entries[("app-server-01", "inventory")]
        self.assertEqual(inventory["job_id"], last_inventory)
        self.assertEqual(inventory["node_id"], a)
        self.assertEqual(inventory["reason"], "inventory\nfailed: disk")
        self.assertFalse(inventory["resolved"])
        self.assertEqual(entries[("db-server-02", "script")]["job_name"], "fix services")
        # newest failure first
        self.assertEqual([f["command_type"] for f in result["failures"]], ["inventory", "script", "patch_install"])

        everything = await list_job_failures(since_hours=168, include_resolved=True, limit=100, offset=0, db=self.pool)
        scan = next(f for f in everything["failures"] if f["command_type"] == "patch_scan")
        self.assertTrue(scan["resolved"])
        self.assertEqual(scan["failures"], 3)
        self.assertLess(scan["first_failed_at"], scan["last_failed_at"])
        self.assertIsNotNone(scan["last_success_at"])
        self.assertEqual((everything["total"], everything["resolved"]), (3, 1))

        # paging keeps the totals
        page = await list_job_failures(since_hours=168, include_resolved=False, limit=1, offset=5, db=self.pool)
        self.assertEqual((page["failures"], page["total"], page["resolved"]), ([], 3, 1))

        # a shorter window
        recent = await list_job_failures(since_hours=3, include_resolved=False, limit=100, offset=0, db=self.pool)
        self.assertEqual([f["command_type"] for f in recent["failures"]], ["inventory"])

    async def test_instances_from_before_the_column_are_filled(self):
        async with self.pool.acquire() as conn:
            node = str(await conn.fetchval("INSERT INTO nodes (node_id, hostname) VALUES ('c', 'web-03') RETURNING id"))
            await self.run_job(conn, node, "patch_scan", "failed", 3)
            await self.run_job(conn, node, "patch_scan", "success", 2)
            await self.run_job(conn, node, "script", "failed", 1, name="fix services")
            # as after an upgrade: no kind yet
            await conn.execute("UPDATE job_instances SET run_kind = NULL")
        # until filled, failures group by the job's kind, but a success is not found yet
        before = await list_job_failures(since_hours=168, include_resolved=True, limit=100, offset=0, db=self.pool)
        self.assertEqual(sorted(f["command_type"] for f in before["failures"]), ["patch_scan", "script"])
        self.assertEqual(before["resolved"], 0)

        self.assertEqual(await job_failures.backfill_run_kind(self.pool), 3)
        async with self.pool.acquire() as conn:
            kinds = sorted(r[0] for r in await conn.fetch("SELECT run_kind FROM job_instances"))
        self.assertEqual(kinds, ["patch_scan", "patch_scan", "script:fix services"])
        after = await list_job_failures(since_hours=168, include_resolved=False, limit=100, offset=0, db=self.pool)
        self.assertEqual([f["command_type"] for f in after["failures"]], ["script"])
        self.assertEqual(after["resolved"], 1)
        self.assertEqual(await job_failures.backfill_run_kind(self.pool), 0)  # nothing left

    async def test_nothing_failed(self):
        result = await list_job_failures(since_hours=168, include_resolved=True, limit=100, offset=0, db=self.pool)
        self.assertEqual((result["failures"], result["total"], result["resolved"]), ([], 0, 0))
