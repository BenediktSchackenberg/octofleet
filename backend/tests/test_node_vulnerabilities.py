"""One node's vulnerabilities (node page tab): the packages are narrowed before their findings are
read, and the CVE list is counted, filtered and paged in one pass."""

import asyncio
import unittest
from uuid import uuid4

import vulnerability
from vulnerability import (
    COUNTED_PACKAGES,
    NODE_CVES_SELECT,
    NODE_GROUPS_SQL,
    NODE_OLD_KERNELS_SQL,
    UNIT_MSRC,
    UNIT_PACKAGES,
    get_node_vulnerabilities,
    node_findings_sql,
)

NODE = {"id": uuid4(), "hostname": "app-server-01"}


def cve(cve_id, rank, unit="openssl", packages=("libssl3",), fixed=None, exploited=False):
    return {"cve_id": cve_id, "software_name": unit, "software_version": "3.0.13", "packages": list(packages),
            "description": None, "cvss_score": None, "cvss_vector": None, "rank": rank, "published_date": None,
            "reference_urls": None, "fixed_version": fixed, "distribution_data": True, "exploited": exploited}


class FakeConn:
    def __init__(self, rows):
        self.rows, self.queries = rows, []

    async def fetchrow(self, query, *args):
        return NODE

    async def fetch(self, query, *args):
        self.queries.append((query, args))
        return self.rows


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        conn = self.conn

        class Context:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False
        return Context()


def run(rows, **kwargs):
    conn = FakeConn(rows)
    return asyncio.run(get_node_vulnerabilities(FakePool(conn), "app-server-01", **kwargs)), conn


class QueryTests(unittest.TestCase):
    def test_packages_first_then_their_findings(self):
        sql = node_findings_sql(COUNTED_PACKAGES)
        # old kernels are left out among the node's packages, before verified_vulnerabilities is joined
        self.assertLess(sql.index("p.kernel_state IS DISTINCT FROM 'old'"), sql.index("JOIN verified_vulnerabilities"))
        self.assertIn("WHERE s.node_id = $1", sql)
        self.assertIn("nv.status = 'fixed'", sql)  # findings marked as fixed, as in the view
        self.assertIn("FROM msrc_node_findings m WHERE m.node_id = $1", sql)

    def test_one_update_includes_an_old_kernel(self):
        sql = node_findings_sql(UNIT_PACKAGES, UNIT_MSRC)
        self.assertNotIn("kernel_state IS DISTINCT FROM 'old'", sql)
        self.assertIn("p.fix_unit = $2 AND p.fix_unit_version = $3", sql)
        self.assertIn("m.fix_unit = $2 AND m.fix_unit_version = $3", sql)

    def test_groups_and_old_kernels_do_not_read_old_kernel_findings(self):
        self.assertIn(COUNTED_PACKAGES, NODE_GROUPS_SQL)
        self.assertNotIn("node_vulnerability_findings", NODE_GROUPS_SQL + NODE_OLD_KERNELS_SQL + NODE_CVES_SELECT)
        # an old kernel is listed when one of its packages has a finding: one probe, no count
        self.assertIn("p.kernel_state = 'old' AND EXISTS", NODE_OLD_KERNELS_SQL)


class ListTests(unittest.TestCase):
    ROWS = [cve("CVE-2026-0001", 1), cve("CVE-2026-0002", 2, unit="linux", packages=("linux-image-7.0.0-38-generic",)),
            cve("CVE-2026-0003", 2), cve("CVE-2026-0004", 3), cve("CVE-2026-0005", None)]

    def test_counts_every_cve_by_severity(self):
        result, conn = run(self.ROWS)
        self.assertEqual(result["count"], 5)
        self.assertEqual(result["severity_counts"], {"CRITICAL": 1, "HIGH": 2, "MEDIUM": 1, "LOW": 0, "UNKNOWN": 1})
        self.assertEqual(result["matching"], 5)
        self.assertEqual(len(conn.queries), 1)  # one statement

    def test_severity_and_search_filter_counts_stay(self):
        result, _ = run(self.ROWS, severity="high", query=" LINUX-image ")
        self.assertEqual([v["cve_id"] for v in result["vulnerabilities"]], ["CVE-2026-0002"])
        self.assertEqual((result["matching"], result["count"]), (1, 5))
        self.assertEqual(result["severity_counts"]["HIGH"], 2)
        result, _ = run(self.ROWS, query="cve-2026-000")
        self.assertEqual(result["matching"], 5)

    def test_pages(self):
        result, _ = run(self.ROWS, limit=2, offset=1)
        self.assertEqual([v["cve_id"] for v in result["vulnerabilities"]], ["CVE-2026-0002", "CVE-2026-0003"])
        self.assertEqual((result["matching"], result["offset"]), (5, 1))

    def test_unknown_node(self):
        class NoNode(FakeConn):
            async def fetchrow(self, query, *args):
                return None
        self.assertIsNone(asyncio.run(get_node_vulnerabilities(FakePool(NoNode([])), "missing")))

    def test_unit_passes_the_update(self):
        _, conn = run([], unit="linux", unit_version="7.0.0-38.38")
        query, args = conn.queries[0]
        self.assertIn(vulnerability.UNIT_PACKAGES, query)
        self.assertEqual(args[1:], ("linux", "7.0.0-38.38"))


if __name__ == "__main__":
    unittest.main()
