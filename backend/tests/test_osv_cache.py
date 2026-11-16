"""OSV advisories are cached between scans: an advisory is downloaded again only when OSV reports
a different "modified" date (or the cached finding was built by older code)."""

import json
import unittest

from vulnerability import OSV_CACHE_VERSION, VulnerabilityScanner


class FakeConnection:
    def __init__(self, rows):
        self.rows, self.written = rows, []

    async def fetch(self, query, ids, version):
        return [row for row in self.rows if row["id"] in ids and row["cache_version"] == version]

    async def executemany(self, query, rows):
        self.written.extend(rows)


class FakePool:
    def __init__(self, rows=()):
        self.connection = FakeConnection(list(rows))

    def acquire(self):
        pool = self

        class Context:
            async def __aenter__(self):
                return pool.connection

            async def __aexit__(self, *exc):
                return False
        return Context()


FINDING = {"cve_id": "CVE-2026-0001", "severity": "HIGH", "ranges": {}}


class OsvCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_batch_answers_record_the_modified_date(self):
        scanner = VulnerabilityScanner(None)

        async def post(_client, path, payload):
            return {"results": [{"vulns": [{"id": "UBUNTU-CVE-2026-0001", "modified": "2026-11-01T10:00:00Z"}]}]}

        scanner._osv_post = post
        await scanner._osv_query_batch(None, [{"package": {"name": "curl", "ecosystem": "Ubuntu:26.04:LTS"}, "version": "1"}])
        self.assertEqual(scanner._osv_modified, {"UBUNTU-CVE-2026-0001": "2026-11-01T10:00:00Z"})

    async def test_only_unchanged_advisories_come_from_the_cache(self):
        pool = FakePool([
            {"id": "A", "modified": "2026-11-01T10:00:00Z", "cache_version": OSV_CACHE_VERSION, "finding": json.dumps(FINDING)},
            {"id": "B", "modified": "2026-10-01T10:00:00Z", "cache_version": OSV_CACHE_VERSION, "finding": json.dumps(FINDING)},
            {"id": "C", "modified": "2026-11-01T10:00:00Z", "cache_version": OSV_CACHE_VERSION - 1, "finding": json.dumps(FINDING)},
            {"id": "D", "modified": "2026-11-01T10:00:00Z", "cache_version": OSV_CACHE_VERSION, "finding": "null"},
        ])
        scanner = VulnerabilityScanner(pool)
        scanner._osv_modified = {"A": "2026-11-01T10:00:00Z", "B": "2026-11-02T10:00:00Z",
                                 "C": "2026-11-01T10:00:00Z", "D": "2026-11-01T10:00:00Z"}
        cached = await scanner._cached_osv_findings({"A", "B", "C", "D", "E"})
        # A unchanged; B changed since; C built by older code; D cached as "no finding"; E unknown
        self.assertEqual(cached, {"A": FINDING, "D": None})

    async def test_downloaded_findings_are_stored_with_their_modified_date(self):
        pool = FakePool()
        scanner = VulnerabilityScanner(pool)
        scanner._osv_modified = {"A": "2026-11-01T10:00:00Z"}
        await scanner._cache_osv_findings({"A": FINDING, "X": FINDING})  # X: no date known, not stored
        self.assertEqual(pool.connection.written, [("A", "2026-11-01T10:00:00Z", OSV_CACHE_VERSION, json.dumps(FINDING))])

    async def test_a_scan_downloads_only_what_the_cache_lacks(self):
        scanner = VulnerabilityScanner(None)
        downloads, stored = [], {}

        async def query_batch(_client, packages):
            scanner._osv_modified.update({"UBUNTU-CVE-2026-0001": "m1", "UBUNTU-CVE-2026-0002": "m2"})
            return [{"UBUNTU-CVE-2026-0001", "UBUNTU-CVE-2026-0002"}]

        async def cached(ids):
            return {i: {"cve_id": "CVE-2026-0001", "severity": "LOW", "ranges": {}} for i in ids if i.endswith("0001")}

        async def record(_client, osv_id):
            downloads.append(osv_id)
            return {"id": osv_id, "aliases": [], "severity": [], "affected": []}

        async def cache(findings):
            stored.update(findings)

        async def nothing(*args):
            return None

        scanner._osv_query_batch = query_batch
        scanner._cached_osv_findings = cached
        scanner._cache_osv_findings = cache
        scanner._osv_record = record
        scanner._store_vulnerabilities = nothing
        scanner._record_check = nothing
        scanner._check_cancelled = nothing
        row = {"name": "curl", "version": "1.0-1", "publisher": "Ubuntu", "os_names": ["Ubuntu"],
               "os_versions": ["26.04 LTS (Resolute Raccoon)"], "source_packages": ["curl"], "source_versions": ["1.0-1"]}
        stats = await scanner._scan_linux_packages([row], [row], None)
        self.assertEqual(downloads, ["UBUNTU-CVE-2026-0002"])
        self.assertEqual(set(stored), {"UBUNTU-CVE-2026-0002"})
        self.assertEqual((stats["osv_cached"], stats["osv_downloaded"]), (1, 1))

    async def test_a_finding_with_a_date_survives_the_cache(self):
        from datetime import datetime, timezone
        finding = {**FINDING, "published": datetime(2026, 3, 4, 5, 6, 7, tzinfo=timezone.utc)}
        pool = FakePool()
        scanner = VulnerabilityScanner(pool)
        scanner._osv_modified = {"A": "m"}
        await scanner._cache_osv_findings({"A": finding})
        osv_id, modified, version, stored = pool.connection.written[0]
        pool.connection.rows.append({"id": osv_id, "modified": modified, "cache_version": version, "finding": stored})
        self.assertEqual(await scanner._cached_osv_findings({"A"}), {"A": finding})


if __name__ == "__main__":
    unittest.main()
