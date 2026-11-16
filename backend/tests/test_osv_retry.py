"""OSV answers transient errors now and then (e.g. 503 for one record). The scan retries them and,
if a record still fails, keeps the previous findings of the packages that need it instead of failing."""

import unittest

import httpx

from vulnerability import OSV_API_BASE, VulnerabilityScanner


def scanner_without_pauses() -> VulnerabilityScanner:
    scanner = VulnerabilityScanner(None)
    scanner.osv_retry_pauses = (0.0, 0.0)
    return scanner


def client(answers: list) -> tuple[httpx.AsyncClient, list]:
    """A client whose requests get the given answers in order (status code or exception)."""
    seen = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        answer = answers[min(len(seen), len(answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(answer, json={"id": "X"} if answer == 200 else {})

    return httpx.AsyncClient(transport=httpx.MockTransport(handle)), seen


class OsvRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_transient_503_is_retried(self):
        http, seen = client([503, 200])
        async with http:
            record = await scanner_without_pauses()._osv_record(http, "UBUNTU-CVE-2025-40170")
        self.assertEqual(record, {"id": "X"})
        self.assertEqual(len(seen), 2)

    async def test_connection_errors_and_429_are_retried(self):
        http, seen = client([httpx.ConnectError("refused"), 429, 200])
        async with http:
            data = await scanner_without_pauses()._osv_post(http, "querybatch", {"queries": []})
        self.assertEqual(data, {"id": "X"})
        self.assertEqual(len(seen), 3)

    async def test_it_gives_up_after_the_retries(self):
        http, seen = client([503])
        async with http:
            with self.assertRaises(httpx.HTTPStatusError):
                await scanner_without_pauses()._osv_record(http, "UBUNTU-CVE-2025-40170")
        self.assertEqual(len(seen), 3)  # first try + 2 retries

    async def test_a_404_is_not_retried(self):
        http, seen = client([404])
        async with http:
            with self.assertRaises(httpx.HTTPStatusError):
                await scanner_without_pauses()._osv_record(http, "UBUNTU-CVE-0000-0000")
        self.assertEqual(len(seen), 1)


async def no_cache(ids):
    return {}


async def keep_nothing(findings):
    return None


def linux_row(name: str, source: str) -> dict:
    return {"name": name, "version": "1.0-1", "publisher": "Ubuntu", "os_names": ["Ubuntu"],
            "os_versions": ["26.04 LTS (Resolute Raccoon)"], "source_packages": [source], "source_versions": ["1.0-1"]}


class OsvScanKeepsPreviousResultsTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_failed_record_keeps_the_package_and_the_scan_goes_on(self):
        scanner = scanner_without_pauses()
        stored, checks = {}, {}

        async def store(name, version, findings, *args):
            stored[name] = findings

        async def record_check(name, version, publisher, status, reason, matched):
            checks[name] = (status, reason)

        async def not_cancelled():
            return None

        async def query_batch(_client, packages):
            return [{"UBUNTU-CVE-2026-0001"} if p["package"]["name"] == "curl" else {"UBUNTU-CVE-2026-0002"}
                    for p in packages]

        async def record(_client, osv_id):
            if osv_id == "UBUNTU-CVE-2026-0001":
                raise httpx.HTTPStatusError("503", request=httpx.Request("GET", f"{OSV_API_BASE}/vulns/{osv_id}"),
                                            response=httpx.Response(503))
            return {"id": osv_id, "aliases": ["CVE-2026-0002"], "severity": [],
                    "affected": [{"package": {"name": "bash", "ecosystem": "Ubuntu:26.04:LTS"}, "ranges": []}]}

        scanner._store_vulnerabilities = store
        scanner._record_check = record_check
        scanner._check_cancelled = not_cancelled
        scanner._osv_query_batch = query_batch
        scanner._cached_osv_findings = no_cache
        scanner._cache_osv_findings = keep_nothing
        scanner._osv_record = record
        rows = [linux_row("curl", "curl"), linux_row("bash", "bash")]
        stats = await scanner._scan_linux_packages(rows, rows, None)

        self.assertEqual(stats["errors"], 1)
        self.assertEqual(stats["checked"], 1)
        self.assertNotIn("curl", stored)  # previous findings of curl are kept
        self.assertEqual(checks["curl"][0], "not_checked")
        self.assertIn("OSV request failed: UBUNTU-CVE-2026-0001", checks["curl"][1])
        self.assertIn("bash", stored)
        self.assertEqual(checks["bash"][0], "checked")

    async def test_a_failed_batch_keeps_its_packages(self):
        scanner = scanner_without_pauses()
        stored, checks = {}, {}

        async def store(name, *args):
            stored[name] = True

        async def record_check(name, version, publisher, status, reason, matched):
            checks[name] = status

        async def not_cancelled():
            return None

        async def query_batch(_client, packages):
            raise httpx.ConnectError("OSV unreachable")

        scanner._store_vulnerabilities = store
        scanner._record_check = record_check
        scanner._check_cancelled = not_cancelled
        scanner._osv_query_batch = query_batch
        scanner._cached_osv_findings = no_cache
        scanner._cache_osv_findings = keep_nothing
        rows = [linux_row("curl", "curl"), linux_row("bash", "bash")]
        stats = await scanner._scan_linux_packages(rows, rows, None)
        self.assertEqual(stats["errors"], 2)
        self.assertEqual(stored, {})
        self.assertEqual(checks, {"curl": "not_checked", "bash": "not_checked"})


if __name__ == "__main__":
    unittest.main()
