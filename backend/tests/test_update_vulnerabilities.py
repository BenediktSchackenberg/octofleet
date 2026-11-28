"""One update's CVEs across the fleet (vulnerabilities page, "by software"): which CVEs and on how many
nodes come from the vulnerability cache, the details from the update's distinct package versions - not
one row per node and CVE (18 million for a kernel on 10,000 nodes). Its nodes come one page at a time."""
import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock

import vulnerability
from vulnerability import UPDATE_CVES_SQL, UPDATE_NODES_SQL, UPDATE_PACKAGES_SQL


def pool_with(conn):
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    return pool


class UpdateCvesSqlTest(unittest.TestCase):
    def test_cves_and_node_counts_come_from_the_cache(self):
        self.assertIn("FROM fleet_vulnerability_unit_cves WHERE fix_unit = $1 AND fix_unit_version = $2", UPDATE_CVES_SQL)
        self.assertIn("u.nodes AS affected_nodes", UPDATE_CVES_SQL)
        self.assertIn("FROM u LEFT JOIN d", UPDATE_CVES_SQL)

    def test_details_from_distinct_package_versions_not_per_node(self):
        packages = UPDATE_CVES_SQL.split("pv AS MATERIALIZED")[1].split("d AS (")[0]
        self.assertIn("SELECT DISTINCT s.name, s.version", packages)
        self.assertIn(UPDATE_PACKAGES_SQL, packages)
        # old (not running) kernels are left out before their CVEs are read
        self.assertIn("s.kernel_abi IS NULL OR n.kernel_abi IS NULL OR s.kernel_abi >= n.kernel_abi", packages)
        self.assertIn("FROM pv JOIN verified_vulnerabilities v", UPDATE_CVES_SQL)
        self.assertNotIn("node_id", UPDATE_CVES_SQL.split("d AS (")[1].split("UNION ALL")[0])
        self.assertIn("SELECT DISTINCT m.cve_id", UPDATE_CVES_SQL)
        self.assertNotIn("hostname", UPDATE_CVES_SQL)
        self.assertNotIn("node_vulnerability_findings", UPDATE_CVES_SQL)


class UpdatePackagesSqlTest(unittest.TestCase):
    def test_two_index_lookups_not_one_or(self):
        by_source, by_name = UPDATE_PACKAGES_SQL.split("UNION ALL")
        # by its source package, or by itself when it has none - an OR would read every package row
        self.assertIn("s.source_package = $1 AND COALESCE(NULLIF(s.source_version, ''), s.version) = $2", by_source)
        self.assertIn("s.name = $1 AND s.version = $2 AND NULLIF(s.source_package, '') IS NULL", by_name)
        self.assertNotIn(" OR ", UPDATE_PACKAGES_SQL)


class UpdateNodesSqlTest(unittest.TestCase):
    def test_one_page_of_nodes_with_a_cached_cve_of_the_update(self):
        # the update's CVE ids as a table: the check per node stops at the first cached one
        self.assertIn("EXISTS (SELECT 1 FROM uc JOIN node_vulnerability_cache c ON c.node_id = n.id AND c.unit_cve_id = uc.id)", UPDATE_NODES_SQL)
        self.assertNotIn("ANY(", UPDATE_NODES_SQL)
        self.assertIn(UPDATE_PACKAGES_SQL, UPDATE_NODES_SQL)
        self.assertIn("FROM msrc_node_findings m WHERE m.fix_unit = $1", UPDATE_NODES_SQL)
        self.assertIn("ORDER BY n.hostname, n.id LIMIT $3 OFFSET $4", UPDATE_NODES_SQL)


class GetUpdateTest(unittest.TestCase):
    def test_one_entry_per_cve_with_a_node_count(self):
        row = {"cve_id": "CVE-2026-1", "affected_nodes": 2, "packages": ["libfoo1"], "description": "d",
               "cvss_score": 7.5, "cvss_vector": None, "rank": 2, "published_date": None, "fixed_version": "1.1",
               "distribution_data": True, "exploited": False}
        conn = MagicMock()
        conn.fetch = AsyncMock(return_value=[row])
        result = asyncio.run(vulnerability.get_update_vulnerabilities(pool_with(conn), "foo", "1.0-1"))
        sql, *args = conn.fetch.call_args.args
        self.assertIs(sql, UPDATE_CVES_SQL)
        self.assertEqual(args, ["foo", "1.0-1"])
        self.assertEqual(result[0]["affected_nodes"], 2)
        self.assertEqual(result[0]["severity"], "HIGH")
        self.assertEqual(result[0]["fix_status"], "fixed")
        self.assertNotIn("nodes", result[0])

    def test_nodes_page_and_total(self):
        conn = MagicMock()
        conn.fetch = AsyncMock(return_value=[{"id": "u1", "hostname": "a", "os_name": "Ubuntu", "os_version": "24.04",
                                              "total": 7, "cves": 3}])
        result = asyncio.run(vulnerability.get_update_nodes(pool_with(conn), "foo", "1.0-1", 1, 2))
        self.assertEqual(conn.fetch.call_args.args[1:], ("foo", "1.0-1", 1, 2))
        self.assertEqual(result, {"total": 7, "nodes": [{"node_id": "u1", "hostname": "a", "os_name": "Ubuntu",
                                                          "os_version": "24.04", "cves": 3}]})

    def test_a_page_past_the_end_still_has_the_total(self):
        conn = MagicMock()
        conn.fetch = AsyncMock(return_value=[])
        conn.fetchval = AsyncMock(return_value=7)
        result = asyncio.run(vulnerability.get_update_nodes(pool_with(conn), "foo", "1.0-1", 10, 100))
        self.assertEqual(result, {"total": 7, "nodes": []})


if __name__ == "__main__":
    unittest.main()
