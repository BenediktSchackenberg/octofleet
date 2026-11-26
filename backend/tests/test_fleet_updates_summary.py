"""Dashboard Updates card: GET /patches/fleet/summary counts like the Fleet updates page, keeps the
value in memory and refreshes an old one in the background; by-node filters by critical or high."""
import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import vulnerability_cache
from routers import patches

NOW = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)


def row(os_family="linux", pending=0, security=0, reboot="none", search="succeeded", searched_days_ago=1, online=True):
    at = (NOW - timedelta(days=searched_days_ago)).isoformat() if searched_days_ago is not None else None
    return {"os_family": os_family, "pending": pending, "security": security, "reboot": reboot, "online": online,
            "last_search": {"status": search, "at": at}}


ROWS = [
    row(),                                          # up to date
    row(os_family="windows"),                       # up to date
    row(pending=3, security=1, reboot="needed"),    # pending, security, reboot
    row(search="failed"),                           # nothing pending, but the search failed
    row(searched_days_ago=9),                       # nothing pending, but no search for 9 days
    row(searched_days_ago=None, online=False),      # never searched, offline
]


class FleetCountsTests(unittest.TestCase):
    def test_counts_and_up_to_date(self):
        c = patches._fleet_counts(ROWS, NOW)
        self.assertEqual({k: c[k] for k in ("nodes", "current", "pending", "security", "reboot", "failed", "stale", "offline")},
                         {"nodes": 6, "current": 2, "pending": 1, "security": 1, "reboot": 1, "failed": 1, "stale": 2, "offline": 1})
        self.assertEqual((c["by_os"]["windows"]["nodes"], c["by_os"]["windows"]["current"]), (1, 1))
        self.assertEqual((c["by_os"]["linux"]["nodes"], c["by_os"]["linux"]["current"]), (5, 1))


class FleetSummaryCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        patches._summary.update({"counts": None, "at": None, "task": None})
        self.rows = AsyncMock(return_value=ROWS)
        pool = MagicMock()
        pool.acquire.return_value.__aenter__.return_value = AsyncMock()
        self.patches = [patch("routers.patches._fleet_rows", self.rows), patch("routers.patches.get_pool", return_value=pool)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        patches._summary.update({"counts": None, "at": None, "task": None})

    async def test_first_request_computes_later_ones_use_the_value(self):
        first = await patches.fleet_updates_summary()
        second = await patches.fleet_updates_summary()
        self.assertEqual(self.rows.await_count, 1)
        self.assertEqual((first["current"], first["refreshing"]), (2, False))
        self.assertEqual(second["as_of"], first["as_of"])

    async def test_concurrent_first_requests_compute_once(self):
        await asyncio.gather(*(patches.fleet_updates_summary() for _ in range(5)))
        self.assertEqual(self.rows.await_count, 1)

    async def test_old_value_is_returned_and_refreshed_in_the_background(self):
        await patches.fleet_updates_summary()
        old = datetime.now(timezone.utc) - patches.SUMMARY_MAX_AGE - timedelta(seconds=1)
        patches._summary["at"] = old
        answer = await patches.fleet_updates_summary()
        self.assertEqual(answer["as_of"], old.isoformat())  # not waiting for the new value
        self.assertTrue(answer["refreshing"])
        await patches._summary["task"]
        self.assertEqual(self.rows.await_count, 2)
        self.assertGreater(patches._summary["at"], old)


class NodesBySeverityTests(unittest.IsolatedAsyncioTestCase):
    async def _sql(self, **kwargs):
        conn = AsyncMock()
        conn.fetchval.return_value = 0
        conn.fetch.return_value = []
        await vulnerability_cache.nodes_page(conn, 10, 0, **kwargs)
        return conn.fetchval.call_args.args[0], conn.fetch.call_args.args[0]

    async def test_high_filters_and_sorts_by_high(self):
        count_sql, page_sql = await self._sql(severity="high")
        self.assertIn("c.high > 0", count_sql)
        self.assertIn("ORDER BY c.high DESC", page_sql)

    async def test_critical_only_still_works(self):
        count_sql, _ = await self._sql(critical_only=True)
        self.assertIn("c.critical > 0", count_sql)

    async def test_without_severity_all_nodes_with_findings(self):
        count_sql, _ = await self._sql()
        self.assertIn("c.total > 0", count_sql)


if __name__ == "__main__":
    unittest.main()
