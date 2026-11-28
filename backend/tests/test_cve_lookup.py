"""Looking up one CVE across the fleet: input normalization, the answer's assembly and the routes."""

import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

import vulnerability
from routers import vulnerabilities as routes
from vulnerability import (
    COUNTED,
    CVE_DETAILS_SQL,
    CVE_FINDINGS,
    CVE_SUGGESTIONS_SQL,
    format_cve_lookup,
    normalize_cve_id,
    normalize_cve_prefix,
)

SCAN = {"running_scan": None,
        "last_completed_scan": {"completed_at": "2026-11-04T21:56:00+00:00", "status": "completed",
                                "packages_scanned": 10, "error_packages": 0}}


def details(**overrides):
    row = {"matches": 2, "rank": 2, "cvss_score": 7.5, "cvss_vector": "CVSS:3.1/AV:N",
           "published_date": datetime(2026, 10, 1, tzinfo=timezone.utc), "description": "Heap overflow"}
    return {**row, **overrides}


def finding(node_id, hostname, name, version, fixed=None, source="osv_distro", kernel_state=None):
    return {"node_id": node_id, "hostname": hostname, "os_name": "Ubuntu", "os_version": "26.04",
            "software_name": name, "software_version": version, "fix_unit": "linux",
            "fix_unit_version": "7.0.0-38.38", "fixed_version": fixed, "match_source": source,
            "kernel_state": kernel_state}


class NormalizeTests(unittest.TestCase):
    def test_cve_id(self):
        self.assertEqual(normalize_cve_id(" cve-2026-12345 "), "CVE-2026-12345")
        for bad in ("", "CVE-2026-123", "CVE-26-1234", "CVE-2026-1234x", "2026-1234", "CVE-2026-1234' OR 1=1"):
            self.assertIsNone(normalize_cve_id(bad), bad)

    def test_prefix_needs_the_year_and_adds_cve(self):
        self.assertEqual(normalize_cve_prefix("cve-2026-987"), "CVE-2026-987")
        self.assertEqual(normalize_cve_prefix("2026-987"), "CVE-2026-987")
        self.assertEqual(normalize_cve_prefix("CVE-2026"), "CVE-2026")
        self.assertEqual(normalize_cve_prefix("CVE-2026-"), "CVE-2026-")
        for bad in ("", "CVE", "CVE-20", "202", "CVE-2026-98a", "CVE-2026%", "CVE-2026_1"):
            self.assertIsNone(normalize_cve_prefix(bad), bad)


class QueryTests(unittest.TestCase):
    def test_counts_like_the_other_vulnerability_views(self):
        # old, not running kernels and findings marked as fixed (in the view) are left out
        self.assertIn("FROM node_vulnerability_findings f", CVE_FINDINGS)
        self.assertIn(COUNTED, CVE_FINDINGS)

    def test_known_means_a_version_match_of_a_scan(self):
        self.assertIn("match_source <> 'legacy_keyword'", CVE_DETAILS_SQL)
        self.assertIn("match_source <> 'legacy_keyword'", CVE_SUGGESTIONS_SQL)

    def test_suggestions_are_a_bounded_prefix_range(self):
        self.assertIn('cve_id COLLATE "C" >= $1', CVE_SUGGESTIONS_SQL)
        self.assertIn("LIMIT $2", CVE_SUGGESTIONS_SQL)
        self.assertNotIn("LIKE", CVE_SUGGESTIONS_SQL)

    def test_suggestions_take_the_ids_first_then_their_details(self):
        # the first `limit` distinct IDs come from the index and stop there; severity and score are
        # read only for them (grouping every match of "CVE-2024" first read the whole prefix)
        ids, details = CVE_SUGGESTIONS_SQL.split("LATERAL")
        self.assertIn("SELECT DISTINCT cve_id", ids)
        self.assertEqual(ids.count("LIMIT $2"), 3)  # each source, and the merged list
        self.assertIn('cve_id COLLATE "C" = ids.cve_id', details)
        self.assertNotIn("LIMIT", details)


class FormatTests(unittest.TestCase):
    def test_unknown_cve(self):
        self.assertIsNone(format_cve_lookup("CVE-2026-1", None, [], 0, SCAN))
        self.assertIsNone(format_cve_lookup("CVE-2026-1", details(matches=0), [], 0, SCAN))

    def test_known_cve_without_affected_nodes(self):
        result = format_cve_lookup("CVE-2026-1234", details(), [], 0, SCAN)
        self.assertEqual(result["affected_nodes"], 0)
        self.assertEqual(result["nodes"], [])
        self.assertEqual(result["scan"], SCAN)
        self.assertEqual(result["severity"], "HIGH")
        self.assertEqual(result["cvss_score"], 7.5)
        self.assertEqual(result["published_date"], "2026-10-01T00:00:00+00:00")
        self.assertEqual(result["nvd_url"], "https://nvd.nist.gov/vuln/detail/CVE-2026-1234")

    def test_unknown_severity(self):
        result = format_cve_lookup("CVE-2026-1234", details(rank=None, cvss_score=None, published_date=None), [], 0, SCAN)
        self.assertEqual(result["severity"], "UNKNOWN")
        self.assertIsNone(result["cvss_score"])
        self.assertIsNone(result["published_date"])

    def test_nodes_with_their_packages(self):
        a, b = uuid4(), uuid4()
        rows = [
            finding(a, "alpha", "linux-image-7.0.0-38-generic", "7.0.0-38.38", fixed="7.0.0-40.40", kernel_state="running"),
            finding(a, "alpha", "linux-image-7.0.0-41-generic", "7.0.0-41.41", kernel_state="pending"),
            finding(b, "beta", "Contoso App", "1.0", source="nvd_cpe"),
        ]
        result = format_cve_lookup("CVE-2026-1234", details(), rows, 2, SCAN)
        self.assertEqual(result["affected_nodes"], 2)
        self.assertEqual([n["hostname"] for n in result["nodes"]], ["alpha", "beta"])
        alpha, beta = result["nodes"]
        self.assertEqual(alpha["id"], str(a))
        self.assertEqual((alpha["os_name"], alpha["os_version"]), ("Ubuntu", "26.04"))
        self.assertEqual(alpha["link"], f"/nodes/{a}?tab=vulnerabilities&view=cves&q=CVE-2026-1234")
        running, pending = alpha["packages"]
        self.assertEqual((running["name"], running["version"]), ("linux-image-7.0.0-38-generic", "7.0.0-38.38"))
        self.assertEqual((running["fixed_version"], running["fix_status"]), ("7.0.0-40.40", "fixed"))
        self.assertEqual((running["kernel_state"], running["running_kernel"]), ("running", True))
        # distribution data without a fixed version: no fix yet
        self.assertEqual((pending["fix_status"], pending["running_kernel"]), ("none", False))
        # NVD without a fixed version: unknown; no kernel package: no kernel flag
        self.assertEqual((beta["packages"][0]["fix_status"], beta["packages"][0]["running_kernel"]), ("unknown", None))


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_id_is_400(self):
        with self.assertRaises(HTTPException) as context:
            await routes.cve_lookup("CVE-2026", 500, 0)
        self.assertEqual(context.exception.status_code, 400)

    async def test_unknown_cve_is_404(self):
        with patch.object(routes, "get_cve_lookup", AsyncMock(return_value=None)) as lookup, \
                patch.object(routes, "get_pool", lambda: "pool"):
            with self.assertRaises(HTTPException) as context:
                await routes.cve_lookup("cve-2026-1234", 500, 0)
        self.assertEqual(context.exception.status_code, 404)
        lookup.assert_awaited_once_with("pool", "CVE-2026-1234", 500, 0)

    async def test_suggestions(self):
        with self.assertRaises(HTTPException) as context:
            await routes.cve_suggestions("CVE-2", 10)
        self.assertEqual(context.exception.status_code, 400)
        items = [{"cve_id": "CVE-2026-9870", "severity": "HIGH", "cvss_score": 7.5}]
        with patch.object(routes, "get_cve_suggestions", AsyncMock(return_value=items)) as suggest, \
                patch.object(routes, "get_pool", lambda: "pool"):
            self.assertEqual(await routes.cve_suggestions("2026-987", 10), {"items": items})
        suggest.assert_awaited_once_with("pool", "CVE-2026-987", 10)

    async def test_lookup_skips_the_node_query_when_nothing_is_affected(self):
        conn = type("Conn", (), {})()
        conn.fetchrow = AsyncMock(return_value=details())
        conn.fetchval = AsyncMock(return_value=0)
        conn.fetch = AsyncMock(return_value=[])

        class Pool:
            def acquire(self):
                class Ctx:
                    async def __aenter__(self):
                        return conn

                    async def __aexit__(self, *exc):
                        return False
                return Ctx()

        with patch.object(vulnerability, "get_scan_status", AsyncMock(return_value=SCAN)):
            result = await vulnerability.get_cve_lookup(Pool(), "CVE-2026-1234", 500, 0)
        self.assertEqual((result["affected_nodes"], result["nodes"], result["limit"]), (0, [], 500))
        conn.fetch.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
