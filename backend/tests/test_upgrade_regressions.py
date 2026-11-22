"""Real TimescaleDB regressions. TEST_DATABASE_URL must permit CREATE DATABASE."""

import asyncio
import os
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import asyncpg

import node_removal
import retention
import vulnerability
import vulnerability_cache as cache
from routers import monitoring_mgmt


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "requires isolated TimescaleDB")
class UpgradeRegressions(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.admin = await asyncpg.connect(os.environ["TEST_DATABASE_URL"])
        self.name = "upgrade_" + uuid.uuid4().hex
        await self.admin.execute(f'CREATE DATABASE "{self.name}"')
        self.pool = await asyncpg.create_pool(os.environ["TEST_DATABASE_URL"], database=self.name,
                                              min_size=1, max_size=4)
        async with self.pool.acquire() as conn:
            await conn.execute((Path(__file__).parents[1] / "schema-full.sql").read_text())
        cache._wake = None
        cache._fleet_requested = cache._correction_requested = False
        cache._last_fleet_refresh = None
        self.worker = None

    async def asyncTearDown(self):
        if self.worker:
            self.worker.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await self.worker
        await self.pool.close()
        await self.admin.execute(f'DROP DATABASE "{self.name}" WITH (FORCE)')
        await self.admin.close()
        cache._wake = None
        cache._fleet_requested = cache._correction_requested = False

    async def test_upgrade_preserves_paused_retention_until_explicit_activation(self):
        async with self.pool.acquire() as conn:
            await conn.execute("""DROP TABLE retention_config;
                CREATE TABLE retention_config (
                    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category text UNIQUE NOT NULL,
                    hot_days integer DEFAULT 90, warm_days integer DEFAULT 365, cold_days integer DEFAULT 2555,
                    legal_hold boolean DEFAULT false, updated_at timestamptz DEFAULT now());
                INSERT INTO retention_config(category) VALUES ('security_events');
                INSERT INTO events_normalized(node_id,event_type,ts)
                    VALUES ('UPGRADE-TEST','logon.success',now()-interval '60 days');""")
            job = await conn.fetchval("SELECT add_retention_policy('events_normalized',interval '365 days')")
            await conn.execute("SELECT alter_job($1,scheduled=>false)", job)
        # Repeat startup too: protection must survive the migration's first run.
        for _ in range(2):
            await retention.ensure_schema(self.pool)
            await retention.apply_on_startup(self.pool)
        async with self.pool.acquire() as conn:
            policy = await conn.fetchrow("SELECT job_id,scheduled,config->>'drop_after' AS keep "
                                         "FROM timescaledb_information.jobs WHERE job_id=$1", job)
            self.assertEqual((policy["scheduled"], policy["keep"]), (False, "365 days"))
            self.assertEqual(await conn.fetchval("SELECT count(*) FROM events_normalized"), 1)
            self.assertFalse(await conn.fetchval("SELECT bool_or(management_enabled) FROM retention_config"))

        async def save(body):
            req = SimpleNamespace(json=unittest.mock.AsyncMock(return_value=body))
            with patch.object(monitoring_mgmt, "get_pool", return_value=self.pool):
                return await monitoring_mgmt.update_retention_config(
                    "security_events", req, SimpleNamespace(username="test-admin"))

        result = await save({"keep_days": 45, "compress_after_days": None})
        self.assertFalse(result["management_enabled"])
        async with self.pool.acquire() as conn:
            self.assertFalse(await conn.fetchval("SELECT scheduled FROM timescaledb_information.jobs WHERE job_id=$1", job))
        result = await save({"management_enabled": True})
        self.assertTrue(result["management_enabled"])
        async with self.pool.acquire() as conn:
            policy = await conn.fetchrow("SELECT scheduled,config->>'drop_after' AS keep "
                                         "FROM timescaledb_information.jobs WHERE hypertable_name='events_normalized' "
                                         "AND proc_name='policy_retention'")
            self.assertEqual((policy["scheduled"], policy["keep"]), (True, "45 days"))

    async def test_fresh_install_activates_defaults(self):
        await retention.ensure_schema(self.pool)
        await retention.apply_on_startup(self.pool)
        async with self.pool.acquire() as conn:
            self.assertTrue(await conn.fetchval("SELECT bool_and(management_enabled) FROM retention_config"))
            items = await retention.status(conn)
            self.assertTrue(all(item["applied"] for item in items))
            self.assertEqual(sorted(j["type"] for j in items[0]["jobs"]), ["compression", "retention"])

    async def test_source_columns_migrate_before_scope_backfill(self):
        async with self.pool.acquire() as conn:
            await conn.execute("ALTER TABLE software_current DROP COLUMN source_package CASCADE")
            await conn.execute("ALTER TABLE software_current DROP COLUMN source_version CASCADE")
            node = await conn.fetchval("INSERT INTO nodes(node_id,hostname,os_name,os_version) "
                                      "VALUES ('UPGRADE-LINUX','UPGRADE-LINUX','Ubuntu','24.04') RETURNING id")
            await conn.execute("INSERT INTO software_current(node_id,name,version) VALUES($1,'openssl','3.0')", node)
        await vulnerability.ensure_schema(self.pool)
        async with self.pool.acquire() as conn:
            self.assertIsNotNone(await conn.fetchval("SELECT match_scope FROM software_current WHERE node_id=$1", node))

    async def test_node_delete_refreshes_top_lists_without_pending_nodes(self):
        await node_removal.ensure_schema_on(self.pool)
        await vulnerability.ensure_schema(self.pool)
        async with self.pool.acquire() as conn:
            ids = []
            for name in ("CACHE-A", "CACHE-B"):
                node = await conn.fetchval("INSERT INTO nodes(node_id,hostname,os_name,os_version) "
                                          "VALUES($1,$1,'Windows 11','10') RETURNING id", name)
                ids.append(node)
                await conn.execute("INSERT INTO software_current(node_id,name,version) VALUES($1,'CacheTestApp','1.0')", node)
            await conn.execute("INSERT INTO vulnerabilities(software_name,software_version,cve_id,severity,cvss_score,match_source) "
                               "VALUES('CacheTestApp','1.0','CVE-TEST-DELETE','HIGH',8.0,'nvd_cpe')")
            await cache.mark_nodes(conn, ids)
        await cache.process_batch(self.pool)
        await cache.refresh_fleet(self.pool, correct=True)
        cache._fleet_requested = cache._correction_requested = False
        async with self.pool.acquire() as conn:
            self.assertEqual((await cache.fleet_summary(conn))["top_cves"][0]["affected_nodes"], 2)
            node = await conn.fetchrow("SELECT * FROM nodes WHERE id=$1", ids[0])
            await node_removal.delete_node(conn, node, node_removal._System)
            self.assertEqual(await conn.fetchval("SELECT count(*) FROM node_vulnerability_dirty"), 0)
        self.worker = asyncio.create_task(cache.worker(self.pool))

        async def refreshed():
            while True:
                async with self.pool.acquire() as conn:
                    summary = await cache.fleet_summary(conn)
                if summary["top_cves"][0]["affected_nodes"] == 1:
                    self.assertEqual(summary["top_vulnerable_software"][0]["node_count"], 1)
                    return
                await asyncio.sleep(0.05)
        await asyncio.wait_for(refreshed(), timeout=10)
