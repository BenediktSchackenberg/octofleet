"""Distribution advisories name their CVEs in `upstream`, often several (Rocky RLSA, Alma ALSA, Red Hat
RHSA have no CVE aliases): each of them is a finding. A CVE record keeps its own ID; `related` CVEs
are not fixed by the record and are left out."""

import unittest

from vulnerability import VulnerabilityScanner


def advisory(osv_id, upstream=None, aliases=None, related=None, withdrawn=False):
    record = {
        "id": osv_id, "summary": "Important: openssl security update", "published": "2026-05-01T00:00:00Z",
        "severity": [{"type": "CVSS_V3", "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"}],
        "affected": [{"package": {"name": "openssl", "ecosystem": "Rocky Linux:9"},
                      "ranges": [{"type": "ECOSYSTEM", "events": [{"introduced": "0"}, {"fixed": "1:3.5.1-1.el9_6"}]}]}],
    }
    if upstream is not None:
        record["upstream"] = upstream
    if aliases is not None:
        record["aliases"] = aliases
    if related is not None:
        record["related"] = related
    if withdrawn:
        record["withdrawn"] = "2026-05-02T00:00:00Z"
    return record


class AdvisoryCveTests(unittest.TestCase):
    def setUp(self):
        self.scanner = VulnerabilityScanner.__new__(VulnerabilityScanner)

    def test_every_upstream_cve(self):
        finding = self.scanner._osv_finding("RLSA-2026:1234", advisory(
            "RLSA-2026:1234", upstream=["CVE-2026-2002", "CVE-2026-1001", "not-a-cve"]))
        self.assertEqual(finding["cve_ids"], ["CVE-2026-1001", "CVE-2026-2002"])
        self.assertEqual(finding["cve_id"], "CVE-2026-1001")
        self.assertIn("Rocky Linux:9|openssl", finding["ranges"])

    def test_aliases_and_upstream_together(self):
        finding = self.scanner._osv_finding("ALSA-2026:5", advisory(
            "ALSA-2026:5", upstream=["CVE-2026-1001"], aliases=["CVE-2026-3003", "GHSA-xxxx"]))
        self.assertEqual(finding["cve_ids"], ["CVE-2026-1001", "CVE-2026-3003"])

    def test_cve_record_keeps_its_id(self):
        finding = self.scanner._osv_finding("UBUNTU-CVE-2026-4004", advisory(
            "UBUNTU-CVE-2026-4004", upstream=["CVE-2026-4004", "CVE-2025-1"]))
        self.assertEqual(finding["cve_ids"], ["CVE-2026-4004"])

    def test_related_only_and_withdrawn(self):
        self.assertIsNone(self.scanner._osv_finding("RHBA-2026:1", advisory("RHBA-2026:1", related=["CVE-2026-1001"])))
        self.assertIsNone(self.scanner._osv_finding("RLSA-2026:9", advisory("RLSA-2026:9", upstream=["CVE-2026-1001"], withdrawn=True)))


if __name__ == "__main__":
    unittest.main()
