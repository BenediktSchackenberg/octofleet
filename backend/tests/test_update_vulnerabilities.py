"""One update's CVEs across the fleet (vulnerabilities page, "by software"): the update's packages are
found first and only their vulnerabilities read, not every finding of every node through the view."""
import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock

import vulnerability
from vulnerability import UPDATE_FINDINGS_SQL


class UpdateFindingsSqlTest(unittest.TestCase):
    def test_the_update_packages_come_first(self):
        packages, findings = UPDATE_FINDINGS_SQL.split("f AS MATERIALIZED")
        # built from that source package, or the package itself when it has none
        self.assertIn("NULLIF(s.source_package, '') = $1", packages)
        self.assertIn("COALESCE(NULLIF(s.source_version, ''), s.version) = $2", packages)
        self.assertIn("NULLIF(s.source_package, '') IS NULL AND s.name = $1 AND s.version = $2", packages)
        self.assertNotIn("verified_vulnerabilities", packages)
        self.assertIn("FROM p JOIN verified_vulnerabilities v", findings)

    def test_old_kernels_are_left_out_before_their_cves_are_read(self):
        packages = UPDATE_FINDINGS_SQL.split("f AS MATERIALIZED")[0]
        # the view's kernel_state 'old' (s.kernel_abi < n.kernel_abi) is excluded in the packages
        self.assertIn("s.kernel_abi IS NULL OR n.kernel_abi IS NULL OR s.kernel_abi >= n.kernel_abi", packages)

    def test_fixed_findings_and_windows_like_the_view(self):
        self.assertIn("nv.status = 'fixed'", UPDATE_FINDINGS_SQL)
        self.assertIn("FROM msrc_node_findings m WHERE m.fix_unit = $1 AND m.fix_unit_version = $2", UPDATE_FINDINGS_SQL)
        self.assertNotIn("node_vulnerability_findings", UPDATE_FINDINGS_SQL)


class GetUpdateVulnerabilitiesTest(unittest.TestCase):
    def test_passes_the_update_and_returns_one_entry_per_cve(self):
        row = {"cve_id": "CVE-2026-1", "nodes": ["a", "b"], "packages": ["libfoo1"], "description": "d",
               "cvss_score": 7.5, "cvss_vector": None, "rank": 2, "published_date": None, "fixed_version": "1.1",
               "distribution_data": True, "exploited": False}
        conn = MagicMock()
        conn.fetch = AsyncMock(return_value=[row])
        pool = MagicMock()
        pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
        pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
        result = asyncio.run(vulnerability.get_update_vulnerabilities(pool, "foo", "1.0-1"))
        sql, *args = conn.fetch.call_args.args
        self.assertTrue(sql.lstrip().startswith("WITH p AS MATERIALIZED"))
        self.assertEqual(args, ["foo", "1.0-1"])
        self.assertEqual([e["cve_id"] for e in result], ["CVE-2026-1"])


if __name__ == "__main__":
    unittest.main()
