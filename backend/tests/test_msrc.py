"""Microsoft's Security Update Guide (MSRC) for Windows itself: parsing a CVRF document, the release
mapping, the build state of a node, which documents a sync downloads and how revised or withdrawn
fixes change the stored data.

The fixture is the October 2026 document cut down to five Windows CVEs and one Linux CVE for
Windows 11 24H2 (12390), Windows Server 2025 (12436, the same build number 26100) and Windows
Server 2022 (11923). CVE-2026-69363 lost its affected products (withdrawn, edited for the test).
How the database matches node builds against these fixes is covered by
tests/api/test_msrc_windows.py."""
import asyncio
import copy
import json
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest import mock

import msrc

FIXTURE = Path(__file__).parent / "fixtures" / "msrc_2026_oct_trimmed.json"
NOW = datetime(2026, 11, 24, 20, 0, tzinfo=timezone.utc)


def document():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def rows_by(rows):
    return {(r["cve_id"], r["product_id"], r["kb"]): r for r in rows}


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.rows = msrc.parse_document(document())
        self.by = rows_by(self.rows)

    def test_one_row_per_cve_product_and_security_update(self):
        self.assertEqual(sorted(self.by), [
            ("CVE-2026-100200", "12390", "5127648"),
            ("CVE-2026-100200", "12436", "5126646"),
            ("CVE-2026-111497", "11923", "5131090"),
            ("CVE-2026-111497", "12390", "5132061"),
            ("CVE-2026-111497", "12436", "5131080"),
            ("CVE-2026-69354", "11923", "5122882"),
            ("CVE-2026-69354", "12390", "5124008"),
            ("CVE-2026-69354", "12436", "5122871"),
            ("CVE-2026-96951", "11923", "5126655"),
            ("CVE-2026-96951", "12390", "5127648"),
            ("CVE-2026-96951", "12436", "5126646"),
        ])

    def test_fixed_build_per_release(self):
        # Windows 11 24H2 and Server 2025 share build 26100 but have their own updates and revisions
        self.assertEqual(self.by[("CVE-2026-100200", "12390", "5127648")]["fixed_revision"], 9711)
        self.assertEqual(self.by[("CVE-2026-100200", "12436", "5126646")]["fixed_revision"], 33650)
        self.assertEqual(self.by[("CVE-2026-96951", "11923", "5126655")]["fixed_revision"], 5761)
        # fixed by the previous month's cumulative update, listed in this document
        self.assertEqual(self.by[("CVE-2026-69354", "12390", "5124008")]["fixed_revision"], 9445)

    def test_hotpatch_linux_and_withdrawn_cves_are_left_out(self):
        self.assertNotIn("5132043", {r["kb"] for r in self.rows})  # Security Hotpatch Update
        self.assertNotIn("5131077", {r["kb"] for r in self.rows})
        self.assertNotIn("CVE-2026-98318", {r["cve_id"] for r in self.rows})  # Linux
        self.assertNotIn("CVE-2026-69363", {r["cve_id"] for r in self.rows})  # no affected product

    def test_details(self):
        row = self.by[("CVE-2026-96951", "11923", "5126655")]
        self.assertTrue(row["exploited"])
        self.assertFalse(row["publicly_disclosed"])
        self.assertEqual(row["title"], "Windows Shell Security Feature Bypass Vulnerability")
        self.assertEqual(row["cvss_score"], 8.8)
        self.assertTrue(row["cvss_vector"].startswith("CVSS:3.1/"))
        self.assertEqual(row["severity"], "HIGH")  # from CVSS (NVD ranges), Microsoft says "Important"
        self.assertEqual(row["msrc_severity"], "Important")
        self.assertEqual(row["published"], datetime(2026, 10, 13, 7, 0, tzinfo=timezone.utc))
        disclosed = self.by[("CVE-2026-111497", "12390", "5132061")]
        self.assertTrue(disclosed["publicly_disclosed"])
        self.assertFalse(disclosed["exploited"])
        self.assertFalse(self.by[("CVE-2026-100200", "12390", "5127648")]["exploited"])

    def test_severity_without_cvss_uses_microsofts_rating(self):
        self.assertEqual(msrc._severity(None, "Critical"), "CRITICAL")
        self.assertEqual(msrc._severity(None, "Important"), "HIGH")
        self.assertEqual(msrc._severity(None, None), "UNKNOWN")
        self.assertEqual(msrc._severity(9.8, "Important"), "CRITICAL")
        self.assertEqual(msrc._severity(3.1, None), "LOW")

    def test_unmapped_products_and_foreign_builds_are_ignored(self):
        doc = document()
        vuln = doc["Vulnerability"][0]
        for remediation in vuln["Remediations"]:
            if remediation.get("FixedBuild") == "10.0.26100.9711":
                remediation["FixedBuild"] = "10.0.26200.9711"  # not the build of Windows 11 24H2
        self.assertNotIn(("CVE-2026-100200", "12390", "5127648"), rows_by(msrc.parse_document(doc)))

    def test_lowest_fixed_build_of_a_kb_counts(self):
        doc = document()
        vuln = doc["Vulnerability"][0]
        extra = copy.deepcopy(next(r for r in vuln["Remediations"] if r.get("FixedBuild") == "10.0.26100.9711"))
        extra["FixedBuild"] = "10.0.26100.9800"
        vuln["Remediations"].append(extra)
        self.assertEqual(rows_by(msrc.parse_document(doc))[("CVE-2026-100200", "12390", "5127648")]["fixed_revision"], 9711)


class ReleaseMappingTests(unittest.TestCase):
    def test_two_releases_and_the_edition(self):
        self.assertEqual(msrc.release_for("Microsoft Windows 11 Pro", "26100.9445"), ((26100, 9445), "12390"))
        self.assertEqual(msrc.release_for("Microsoft Windows Server 2025 Datacenter", "26100.33650"), ((26100, 33650), "12436"))
        self.assertEqual(msrc.release_for("Microsoft Windows Server 2022 Standard", "10.0.20348.5000"), ((20348, 5000), "11923"))
        self.assertEqual(msrc.release_for("Microsoft Windows 10 Enterprise LTSC", "17763.9000"), ((17763, 9000), "11569"))
        self.assertEqual(msrc.release_for("Microsoft Windows Server 2019 Standard", "17763.9000"), ((17763, 9000), "11571"))

    def test_unknown_build_or_release(self):
        self.assertEqual(msrc.release_for("Microsoft Windows 11 Pro", None), (None, None))
        self.assertEqual(msrc.release_for("Microsoft Windows 11 Pro", "26100"), (None, None))  # no revision
        self.assertEqual(msrc.release_for("Ubuntu 26.04", "7.0.0-38-generic"), (None, None))
        self.assertEqual(msrc.release_for("Microsoft Windows 11 Pro", "22000.2538"), ((22000, 2538), None))

    def test_the_mapping_is_unambiguous(self):
        keys = [(build, server) for build, server, _, _ in msrc.WINDOWS_RELEASES]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(msrc.PRODUCTS), len(msrc.WINDOWS_RELEASES))
        names = {p["ProductID"]: p["Value"] for p in document()["ProductTree"]["FullProductName"]}
        for product_id, name in names.items():
            self.assertEqual(msrc.PRODUCTS[product_id][2], name)

    def test_node_build_pattern_matches_the_sql(self):
        for build in ("26100.33650", "10.0.26100.33650"):
            self.assertTrue(msrc.NODE_BUILD_RE.match(build))
        self.assertIn(r"'^(?:10\.0\.)?(\d{5}\.\d+)$'", "\n".join(msrc.SCHEMA))


def state_row(**overrides):
    row = {"windows": True, "os_build": "26100.9445", "windows_build": [26100, 9445], "product_id": "12390",
           "product": "Windows 11 Version 24H2 for x64-based Systems", "build": 26100,
           "latest_kb": "5132061", "latest_revision": 9974}
    return {**row, **overrides}


class NodeStateTests(unittest.TestCase):
    def test_checked(self):
        state = msrc.node_state(state_row())
        self.assertEqual(state["status"], "checked")
        self.assertEqual((state["latest_kb"], state["latest_build"], state["up_to_date"]),
                         ("KB5132061", "10.0.26100.9974", False))
        self.assertTrue(msrc.node_state(state_row(windows_build=[26100, 9974]))["up_to_date"])

    def test_unknown_is_never_not_affected(self):
        self.assertEqual(msrc.node_state(state_row(os_build=None, windows_build=None, product_id=None, product=None,
                                                   latest_kb=None))["reason"], "no_build")
        self.assertEqual(msrc.node_state(state_row(windows_build=[22000, 1], product_id=None, product=None,
                                                   latest_kb=None))["reason"], "unsupported_release")
        unsynced = msrc.node_state(state_row(latest_kb=None, latest_revision=None))
        self.assertEqual((unsynced["status"], unsynced["reason"]), ("unknown", "no_data"))
        self.assertNotIn("up_to_date", unsynced)

    def test_other_nodes(self):
        self.assertIsNone(msrc.node_state(state_row(windows=False)))
        self.assertIsNone(msrc.node_state(None))


def update(doc_id, initial, current, title=None):
    month = datetime.strptime(doc_id, "%Y-%b").strftime("%B %Y")
    return {"ID": doc_id, "DocumentTitle": title or f"{month} Security Updates", "InitialReleaseDate": initial,
            "CurrentReleaseDate": current, "CvrfUrl": f"{msrc.MSRC_API_BASE}/cvrf/{doc_id}"}


UPDATES = [
    update("2026-Oct", "2026-10-13T07:00:00Z", "2026-11-24T01:27:08Z"),
    update("2026-Nov", "2026-11-10T08:00:00Z", "2026-11-24T01:41:42Z"),
    update("2026-Jan", "2026-01-13T08:00:00Z", "2026-11-21T01:15:28Z"),
    update("2000-Feb", "2000-02-02T00:00:00Z", "2026-11-16T22:14:35Z", "Mariner Release Notes"),
    {"ID": "bogus", "DocumentTitle": "x", "InitialReleaseDate": "2026-01-01T00:00:00Z"},
]


def stored(current, fetched_ago, products=None):
    return {"current_release": msrc._release_stamp(current), "fetched_at": NOW - fetched_ago,
            "products": sorted(msrc.PRODUCTS) if products is None else products}


class DocumentSelectionTests(unittest.TestCase):
    def test_monthly_security_documents_newest_first(self):
        self.assertEqual([u["ID"] for u in msrc.wanted_documents(UPDATES, 24)], ["2026-Nov", "2026-Oct", "2026-Jan"])
        self.assertEqual([u["ID"] for u in msrc.wanted_documents(UPDATES, 2)], ["2026-Nov", "2026-Oct"])

    def test_new_documents_are_due(self):
        wanted = msrc.wanted_documents(UPDATES, 24)
        self.assertEqual([u["ID"] for u in msrc.documents_due(wanted, {}, NOW)], ["2026-Nov", "2026-Oct", "2026-Jan"])

    def test_unchanged_documents_are_not_downloaded_again(self):
        wanted = msrc.wanted_documents(UPDATES, 24)
        known = {u["ID"]: stored(u["CurrentReleaseDate"], timedelta(days=30)) for u in wanted}
        self.assertEqual(msrc.documents_due(wanted, known, NOW), [])
        # the document's own date format ("...T01:27:08", no Z) is the same release
        known["2026-Oct"]["current_release"] = msrc._release_stamp("2026-11-24T01:27:08")
        self.assertEqual(msrc.documents_due(wanted, known, NOW), [])

    def test_revised_documents_are_throttled(self):
        wanted = msrc.wanted_documents(UPDATES, 24)
        old = "2026-11-01T00:00:00Z"
        # recent month: at most daily
        self.assertEqual(msrc.documents_due(wanted[:1], {"2026-Nov": stored(old, timedelta(hours=2))}, NOW), [])
        self.assertEqual(len(msrc.documents_due(wanted[:1], {"2026-Nov": stored(old, timedelta(days=1))}, NOW)), 1)
        # older month: at most weekly
        jan = wanted[2:]
        self.assertEqual(msrc.documents_due(jan, {"2026-Jan": stored(old, timedelta(days=3))}, NOW), [])
        self.assertEqual(len(msrc.documents_due(jan, {"2026-Jan": stored(old, timedelta(days=7))}, NOW)), 1)

    def test_another_release_mapping_downloads_again(self):
        wanted = msrc.wanted_documents(UPDATES, 24)[:1]
        known = {"2026-Nov": stored(wanted[0]["CurrentReleaseDate"], timedelta(hours=1), products=["12390"])}
        self.assertEqual(len(msrc.documents_due(wanted, known, NOW)), 1)


class ChangeTests(unittest.TestCase):
    def setUp(self):
        self.rows = msrc.parse_document(document())

    def stored_rows(self):
        # as asyncpg returns them: scores as Decimal
        return [{**r, "cvss_score": Decimal(str(r["cvss_score"])) if r["cvss_score"] is not None else None}
                for r in self.rows]

    def test_same_fixes_change_nothing(self):
        self.assertEqual(msrc.changed_products(self.stored_rows(), self.rows), set())

    def test_withdrawn_product_and_revised_fix(self):
        doc = document()
        for vuln in doc["Vulnerability"]:
            if vuln["CVE"] == "CVE-2026-96951":  # Microsoft withdraws Server 2022 from this CVE
                for status in vuln["ProductStatuses"]:
                    status["ProductID"] = [p for p in status["ProductID"] if p != "11923"]
        revised = msrc.parse_document(doc)
        self.assertNotIn(("CVE-2026-96951", "11923", "5126655"), rows_by(revised))
        self.assertEqual(msrc.changed_products(self.stored_rows(), revised), {"11923"})

        rescored = [dict(r, cvss_score=9.9) if r["cve_id"] == "CVE-2026-100200" and r["product_id"] == "12436" else r
                    for r in self.rows]
        self.assertEqual(msrc.changed_products(self.stored_rows(), rescored), {"12436"})

    def test_withdrawn_cve_disappears(self):
        doc = document()
        doc["Vulnerability"] = [v for v in doc["Vulnerability"] if v["CVE"] != "CVE-2026-100200"]
        self.assertEqual(msrc.changed_products(self.stored_rows(), msrc.parse_document(doc)), {"12390", "12436"})


class FakeConn:
    def __init__(self, stored_rows=()):
        self.stored_rows = list(stored_rows)
        self.queries = []
        self.inserted = []

    def transaction(self):
        @asynccontextmanager
        async def tx():
            yield
        return tx()

    async def fetch(self, sql, *args):
        self.queries.append(sql)
        if sql == msrc.STORED_ROWS_SQL:
            return self.stored_rows
        if "FROM msrc_documents" in sql:
            return []
        return []

    async def execute(self, sql, *args):
        self.queries.append(sql)
        return "OK"

    async def executemany(self, sql, rows):
        self.queries.append(sql)
        self.inserted.extend(rows)


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        @asynccontextmanager
        async def acquire():
            yield self.conn
        return acquire()


class StoreTests(unittest.TestCase):
    def test_a_document_replaces_its_rows(self):
        rows = msrc.parse_document(document())
        conn = FakeConn()
        changed = asyncio.run(msrc.store_document(conn, UPDATES[0], rows))
        self.assertEqual(changed, {"11923", "12390", "12436"})
        self.assertTrue(any(q.startswith("DELETE FROM msrc_windows_fixes WHERE document_id") for q in conn.queries))
        self.assertEqual(len(conn.inserted), len(rows))
        self.assertTrue(all(row[0] == "2026-Oct" for row in conn.inserted))

    def test_rebuild_marks_the_nodes_of_changed_products(self):
        conn = FakeConn()
        with mock.patch("vulnerability_cache.request_fleet_refresh") as refresh:
            asyncio.run(msrc.rebuild_products(conn, {"12390"}))
        self.assertIn(msrc.REBUILD_CVES_SQL, conn.queries)
        self.assertIn(msrc.LATEST_UPDATE_SQL, conn.queries)
        self.assertIn(msrc.MARK_NODES_SQL, conn.queries)
        refresh.assert_called_once_with(correct=True)
        conn = FakeConn()
        asyncio.run(msrc.rebuild_products(conn, set()))
        self.assertEqual(conn.queries, [])

    def test_import_needs_a_monthly_document(self):
        doc = document()
        doc["DocumentTracking"]["Identification"]["ID"]["Value"] = "../etc"
        with self.assertRaises(ValueError):
            asyncio.run(msrc.import_document(FakeConn(), doc))


class SyncTests(unittest.TestCase):
    def test_downloads_only_due_documents_and_removes_old_ones(self):
        body = FIXTURE.read_bytes()
        requested = []

        class Client:
            async def get(self, url, headers=None):
                requested.append(url)
                content = json.dumps({"value": UPDATES}).encode() if url.endswith("/updates") else body
                return mock.Mock(content=content, raise_for_status=lambda: None)

        conn = FakeConn()
        known = {"2026-Nov": stored("2026-11-24T01:41:42Z", timedelta(hours=1)),
                 "2026-Jan": stored("2026-11-21T01:15:28Z", timedelta(days=1)),
                 "2024-Jan": stored("2024-02-01T00:00:00Z", timedelta(days=1))}

        async def fetch(sql, *args):
            if "FROM msrc_documents" in sql:
                return [{"id": k, **v} for k, v in known.items()]
            if "SELECT DISTINCT product_id" in sql:
                return [{"product_id": "12390"}]
            return []
        conn.fetch = fetch
        with mock.patch.object(msrc, "rebuild_products", mock.AsyncMock()) as rebuild, \
                mock.patch.object(msrc, "HISTORY_MONTHS", 3):
            result = asyncio.run(msrc.sync(FakePool(conn), Client(), now=NOW))
        self.assertEqual(requested, [f"{msrc.MSRC_API_BASE}/updates", f"{msrc.MSRC_API_BASE}/cvrf/2026-Oct"])
        self.assertEqual(result["downloaded"], ["2026-Oct"])
        self.assertEqual(result["removed"], ["2024-Jan"])
        self.assertEqual(result["changed_products"], ["11923", "12390", "12436"])
        rebuild.assert_awaited_once()

    def test_the_document_url_stays_on_the_api(self):
        updates = [dict(UPDATES[0], CvrfUrl="https://example.com/x")]
        requested = []

        class Client:
            async def get(self, url, headers=None):
                requested.append(url)
                content = json.dumps({"value": updates}).encode() if url.endswith("/updates") else b'{"Vulnerability": []}'
                return mock.Mock(content=content, raise_for_status=lambda: None)

        conn = FakeConn()
        with mock.patch.object(msrc, "rebuild_products", mock.AsyncMock()):
            asyncio.run(msrc.sync(FakePool(conn), Client(), now=NOW))
        self.assertEqual(requested[1], f"{msrc.MSRC_API_BASE}/cvrf/2026-Oct")

    def test_disabled_worker_returns(self):
        with mock.patch.object(msrc, "SYNC_ENABLED", False):
            asyncio.run(asyncio.wait_for(msrc.worker(None), 1))


class CveLookupTests(unittest.TestCase):
    def test_msrc_cves_are_known(self):
        import vulnerability
        self.assertIn("FROM msrc_windows_cves WHERE cve_id = $1", vulnerability.CVE_DETAILS_SQL)
        self.assertIn("FROM msrc_windows_cves", vulnerability.CVE_SUGGESTIONS_SQL)
        details = {"matches": 1, "rank": 2, "cvss_score": 8.8, "cvss_vector": None, "published_date": None,
                   "description": "Windows Shell Security Feature Bypass Vulnerability", "exploited": True}
        result = vulnerability.format_cve_lookup("CVE-2026-96951", details, [], 0, {})
        self.assertTrue(result["exploited"])


if __name__ == "__main__":
    unittest.main()
