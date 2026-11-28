"""Scan coverage: which releases the scan can check, so a node it cannot check does not look clean."""
import asyncio
import unittest

import vulnerability
from vulnerability import RELEASES_SQL, not_scanned_releases, scan_support


class ScanSupportTest(unittest.TestCase):
    def test_checked_releases(self):
        for os_name, version in (("Ubuntu", "24.04.3 LTS (Noble Numbat)"), ("Debian GNU/Linux", "13 (trixie)"),
                                 ("Alpine Linux", "3.20.3"), ("Microsoft Windows Server 2025 Datacenter", "10.0.26100")):
            self.assertTrue(scan_support(os_name, version)["supported"], os_name)

    def test_releases_without_an_advisory_source(self):
        self.assertEqual(scan_support("Arch Linux", "rolling"), {"supported": False, "os": "Arch Linux rolling"})
        self.assertFalse(scan_support("CachyOS Linux", "rolling")["supported"])
        self.assertFalse(scan_support("Ubuntu", None)["supported"])  # no release, no ecosystem

    def test_no_os_reported_yet_is_unknown(self):
        self.assertEqual(scan_support(None, None), {"supported": None, "os": None})


class NotScannedTest(unittest.TestCase):
    def test_grouped_by_release_most_nodes_first(self):
        class Conn:
            async def fetch(self, sql, *args):
                assert sql is RELEASES_SQL
                return [{"os_name": "Ubuntu", "os_version": "24.04", "nodes": 500},
                        {"os_name": "CachyOS Linux", "os_version": "rolling", "nodes": 1},
                        {"os_name": "openSUSE Leap", "os_version": "15.6", "nodes": 30}]
        self.assertEqual(asyncio.run(not_scanned_releases(Conn())),
                         [{"os": "openSUSE Leap 15.6", "nodes": 30}, {"os": "CachyOS Linux rolling", "nodes": 1}])
        self.assertIn("GROUP BY os_name, os_version", vulnerability.RELEASES_SQL)


if __name__ == "__main__":
    unittest.main()
