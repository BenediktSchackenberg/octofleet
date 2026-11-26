"""Remediation summary (Tasks page, Auto-Fix page): the fixable count starts from the enabled fix
packages and is skipped without one; it used to filter the whole findings view (~4.6 s)."""
import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import remediation


def _pool(package_count, fixable=7):
    conn = AsyncMock()
    conn.fetch.return_value = []

    async def fetchval(sql, *args):
        if "remediation_packages WHERE enabled" in sql:
            return package_count
        if "remediation_rules WHERE enabled" in sql:
            return 2
        if sql is remediation.FIXABLE_SQL:
            return fixable
        raise AssertionError(f"unexpected query: {sql[:80]}")

    conn.fetchval.side_effect = fetchval
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    return pool, conn


class RemediationSummaryTests(unittest.TestCase):
    def _summary(self, pool):
        with patch.object(remediation, "is_in_maintenance_window", AsyncMock(return_value=False)):
            return asyncio.run(remediation.get_remediation_summary(pool))

    def test_no_enabled_package_skips_the_fixable_count(self):
        pool, conn = _pool(package_count=0)
        summary = self._summary(pool)
        self.assertEqual(summary["fixable_vulnerabilities"], 0)
        self.assertNotIn(remediation.FIXABLE_SQL, [c.args[0] for c in conn.fetchval.call_args_list])

    def test_enabled_packages_count_through_the_packages(self):
        pool, conn = _pool(package_count=3, fixable=7)
        summary = self._summary(pool)
        self.assertEqual((summary["fixable_vulnerabilities"], summary["active_packages"], summary["active_rules"]), (7, 3, 2))

    def test_fixable_query_does_not_read_the_view(self):
        # the view evaluates its EXISTS checks for every finding before the filter applies
        self.assertNotIn("verified_vulnerabilities", remediation.FIXABLE_SQL)
        self.assertIn("FROM remediation_packages rp", remediation.FIXABLE_SQL)
        self.assertIn("match_source = 'nvd_cpe'", remediation.FIXABLE_SQL)
        self.assertIn("on_windows IS FALSE", remediation.FIXABLE_SQL)


if __name__ == "__main__":
    unittest.main()
