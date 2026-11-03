"""Labels of the node tree's OS level."""

import unittest

from routers.nodes import _os_product


class OsProductTests(unittest.TestCase):
    def test_windows_server_by_year_without_edition(self):
        self.assertEqual(_os_product("Microsoft Windows Server 2025 Datacenter", "10.0.26100", "24H2"), "Windows Server 2025")
        self.assertEqual(_os_product("Microsoft Windows Server 2012 R2 Standard", "6.3.9600", None), "Windows Server 2012 R2")
        self.assertEqual(_os_product("Microsoft Windows Server Datacenter", "10.0.25398", "23H2"), "Windows Server 23H2")

    def test_windows_client_with_feature_version(self):
        self.assertEqual(_os_product("Microsoft Windows 11 Enterprise", "10.0.26100", "24H2"), "Windows 11 24H2")
        self.assertEqual(_os_product("Microsoft Windows 10 Pro", "10.0.19045", None), "Windows 10")

    def test_linux_distribution_and_release(self):
        self.assertEqual(_os_product("Ubuntu", "26.04.1 LTS (Resolute Raccoon)"), "Ubuntu 26.04 LTS")
        self.assertEqual(_os_product("Debian GNU/Linux", "13 (trixie)"), "Debian GNU/Linux 13")
        self.assertEqual(_os_product("Ubuntu 26.04 LTS", "26.04.1 LTS"), "Ubuntu 26.04 LTS")

    def test_unknown(self):
        self.assertEqual(_os_product(None, None), "Unknown")
