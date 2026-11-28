"""Arch-based rolling distributions: curated packages get an NVD CPE from their upstream version
(pkgrel, epoch and snapshot suffixes dropped, NVD's patch-level and major-version conventions);
everything else gets none. Versions are real ones from a CachyOS node."""

import unittest
from datetime import datetime, timedelta, timezone

import inspect

import vulnerability
from vulnerability import ROLLING_DISTRO, ROLLING_KERNEL, VulnerabilityScanner, running_kernel, upstream_cpe


class UpstreamCpeTests(unittest.TestCase):
    def test_plain_versions(self):
        self.assertEqual(upstream_cpe("openssl", "4.1.0-1.1"), "cpe:2.3:a:openssl:openssl:4.1.0:*:*:*:*:*:*:*")
        self.assertEqual(upstream_cpe("curl", "8.23.0-2"), "cpe:2.3:a:haxx:curl:8.23.0:*:*:*:*:*:*:*")
        self.assertEqual(upstream_cpe("expat", "2.10.0-1.1"), "cpe:2.3:a:libexpat_project:libexpat:2.10.0:*:*:*:*:*:*:*")

    def test_epoch_snapshot_and_major_only(self):
        self.assertEqual(upstream_cpe("glibc", "2.44+r78+gfcfb867c58ab-1"), "cpe:2.3:a:gnu:glibc:2.44:*:*:*:*:*:*:*")
        self.assertEqual(upstream_cpe("systemd", "262.2-1"), "cpe:2.3:a:systemd_project:systemd:262:*:*:*:*:*:*:*")
        self.assertIsNone(upstream_cpe("lz4", "1:1.11.1-2"))  # not curated

    def test_patch_levels_go_to_the_update_field(self):
        self.assertEqual(upstream_cpe("openssh", "10.6p2-1.1"), "cpe:2.3:a:openbsd:openssh:10.6:p2:*:*:*:*:*:*")
        self.assertEqual(upstream_cpe("sudo", "1.9.17.p2-7.1"), "cpe:2.3:a:sudo_project:sudo:1.9.17:p2:*:*:*:*:*:*")
        self.assertEqual(upstream_cpe("openssh", "10.6-1"), "cpe:2.3:a:openbsd:openssh:10.6:-:*:*:*:*:*:*")

    def test_kernels(self):
        self.assertEqual(upstream_cpe("linux-cachyos", "7.3.5-2"), "cpe:2.3:o:linux:linux_kernel:7.3.5:*:*:*:*:*:*:*")
        self.assertEqual(upstream_cpe("linux", "6.12.10.arch1-1"), "cpe:2.3:o:linux:linux_kernel:6.12.10:*:*:*:*:*:*:*")
        self.assertEqual(upstream_cpe("linux-cachyos-lts", "6.18.64-1"), "cpe:2.3:o:linux:linux_kernel:6.18.64:*:*:*:*:*:*:*")
        for not_kernel in ("linux-cachyos-headers", "linux-firmware", "linux-api-headers", "linux-firmware-amd"):
            self.assertIsNone(ROLLING_KERNEL.fullmatch(not_kernel) and upstream_cpe(not_kernel, "7.3.5-2"), not_kernel)

    def test_unreadable_version_and_distributions(self):
        self.assertIsNone(upstream_cpe("vim", "9.2.1178.r12.gabc-1x y"))
        self.assertTrue(ROLLING_DISTRO.search("CachyOS Linux"))
        self.assertTrue(ROLLING_DISTRO.search("Arch Linux"))
        self.assertFalse(ROLLING_DISTRO.search("Rocky Linux"))
        self.assertFalse(ROLLING_DISTRO.search("Archcraft"))


class BoundedProductMatchTests(unittest.TestCase):
    """Rolling distributions run the newest upstream version: an NVD entry counts only when it names
    that version or a range containing it; "every version" entries and stale open ranges do not."""

    CPE = "cpe:2.3:a:mozilla:firefox:160.0.1:*:*:*:*:*:*:*"

    @staticmethod
    def cve(published, *matches):
        return {"published": published, "configurations": [{"nodes": [{"operator": "OR", "cpeMatch": list(matches)}]}]}

    @staticmethod
    def match(version="*", **bounds):
        return {"vulnerable": True, "criteria": f"cpe:2.3:a:mozilla:firefox:{version}:*:*:*:*:*:*:*", **bounds}

    def check(self, cve):
        from vulnerability import VulnerabilityScanner
        return VulnerabilityScanner._bounded_product_match(cve, self.CPE)

    def test_every_version_entry_is_left_out(self):
        self.assertFalse(self.check(self.cve("2003-12-31T05:00:00", self.match())))

    def test_old_bounded_entry_next_to_every_version_entry_is_left_out(self):
        self.assertFalse(self.check(self.cve("2008-09-24T20:37:00", self.match(), self.match("3.0.1"),
                                             self.match(versionEndExcluding="3.0.2"))))

    def test_range_containing_our_version_counts(self):
        self.assertTrue(self.check(self.cve("2026-10-01T00:00:00", self.match(versionStartIncluding="150.0", versionEndExcluding="161.0"))))
        self.assertFalse(self.check(self.cve("2026-10-01T00:00:00", self.match(versionEndExcluding="160.0.1"))))
        self.assertTrue(self.check(self.cve("2026-10-01T00:00:00", self.match(versionEndIncluding="160.0.1"))))
        self.assertTrue(self.check(self.cve("2020-01-01T00:00:00", self.match("160.0.1"))))

    def test_open_range_only_while_recent(self):
        recent = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        self.assertTrue(self.check(self.cve(recent, self.match(versionStartIncluding="100.0"))))
        self.assertFalse(self.check(self.cve("2019-02-01T00:00:00", self.match(versionStartIncluding="100.0"))))
        self.assertFalse(self.check(self.cve(recent, self.match(versionStartIncluding="161.0"))))


class RunningKernelTests(unittest.TestCase):
    """uname -r writes the first dot before letters of the Arch pkgver as a dash (review on #365)."""

    def test_arch_kernels(self):
        self.assertTrue(running_kernel("6.12.10.arch1-1", ["6.12.10-arch1-1"]))
        self.assertTrue(running_kernel("6.12.10.zen1-1", ["6.12.10-zen1-1-zen"]))
        self.assertTrue(running_kernel("6.12.10.arch1-1", ["6.12.10-arch1-1", "6.12.10-arch1-1"]))
        self.assertFalse(running_kernel("6.12.10.arch1-1", ["6.12.11-arch1-1"]))

    def test_cachyos_and_lts(self):
        self.assertTrue(running_kernel("7.3.5-2", ["7.3.5-2-cachyos"]))
        self.assertFalse(running_kernel("6.18.64-1", ["7.3.5-2-cachyos"]))  # linux-cachyos-lts installed, not running
        self.assertFalse(running_kernel("7.3.5-2", [None]))                   # no uname reported
        self.assertFalse(running_kernel("7.3.5-2", []))


class UpstreamSourceTests(unittest.TestCase):
    """The findings have their own source: nvd_cpe is shown only for versions on Windows nodes alone
    (and feeds the Windows remediation) - stored as nvd_cpe, Arch findings were never shown (review on #365)."""

    def test_stored_as_nvd_upstream(self):
        self.assertIn('"nvd_upstream"', inspect.getsource(VulnerabilityScanner._scan_upstream_packages))

    def test_view_shows_them_for_linux_nodes(self):
        source = inspect.getsource(vulnerability.ensure_schema)
        view = source[source.index("CREATE OR REPLACE VIEW verified_vulnerabilities"):source.index("node_vulnerability_findings AS")]
        rule = view[view.index("v.match_source = 'nvd_upstream'"):view.index("v.match_source = 'nvd_cpe'")]
        self.assertIn("s.on_windows IS FALSE", rule)


if __name__ == "__main__":
    unittest.main()
