"""The Patch Explorer counts CVEs from the vulnerability scan's findings."""

import unittest

from routers.patch_explorer import SOFTWARE_CVE_COUNT
from vulnerability import COUNTED


class SoftwareCveCountTests(unittest.TestCase):
    def test_counts_distinct_cves_of_the_scan_findings(self):
        # node_vulnerabilities is not filled by anything; the scan writes node_vulnerability_findings
        self.assertIn("FROM node_vulnerability_findings f", SOFTWARE_CVE_COUNT)
        self.assertIn("COUNT(DISTINCT f.cve_id)", SOFTWARE_CVE_COUNT)

    def test_leaves_out_old_kernels_like_the_vulnerability_pages(self):
        self.assertIn(COUNTED, SOFTWARE_CVE_COUNT)


if __name__ == "__main__":
    unittest.main()
