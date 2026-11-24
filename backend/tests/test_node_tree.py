"""Labels of the node tree's OS level."""

import unittest

from routers.nodes import _os_product, _tree_summary


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


def _row(node_id, os_name, os_version, online=True, groups=(), display_version=None):
    return {"node_id": node_id, "os_name": os_name, "os_version": os_version, "status": "online" if online else "away",
            "display_version": display_version,
            "group_ids": [g[0] for g in groups], "group_names": [g[1] for g in groups]}


class TreeSummaryTests(unittest.TestCase):
    """The Fleet workspace's tree: counts per group -> OS family -> release, node IDs per release."""

    def setUp(self):
        self.summary = _tree_summary([
            _row("u24", "Ubuntu", "24.04.2 LTS (Noble Numbat)", groups=[("g2", "servers"), ("g1", "Berlin")]),
            _row("u22", "Ubuntu", "22.04.5 LTS", online=False, groups=[("g2", "servers")]),
            _row("w11", "Microsoft Windows 11 Pro", "10.0.26100", display_version="24H2"),
            _row("u26", "Ubuntu", "26.04 LTS"),
            _row("u26b", "Ubuntu", "26.04.1 LTS", online=False),
        ])

    def test_totals_count_each_node_once(self):
        self.assertEqual((self.summary["total"], self.summary["online"]), (5, 3))

    def test_groups_by_name_and_a_node_in_two_groups_counts_in_both(self):
        groups = self.summary["groups"]
        self.assertEqual([(g["name"], g["total"], g["online"]) for g in groups], [("Berlin", 1, 1), ("servers", 2, 1)])
        releases = groups[1]["os"][0]["releases"]
        self.assertEqual([(r["name"], r["node_ids"]) for r in releases],
                         [("Ubuntu 22.04 LTS", ["u22"]), ("Ubuntu 24.04 LTS", ["u24"])])

    def test_unassigned_windows_first_and_point_releases_together(self):
        unassigned = self.summary["unassigned"]
        self.assertEqual((unassigned["total"], unassigned["online"]), (3, 2))
        self.assertEqual([f["family"] for f in unassigned["os"]], ["Windows", "Linux"])
        self.assertEqual(unassigned["os"][0]["releases"][0]["name"], "Windows 11 24H2")
        self.assertEqual(unassigned["os"][1]["releases"], [{"name": "Ubuntu 26.04 LTS", "total": 2, "online": 1, "node_ids": ["u26", "u26b"]}])

    def test_empty_fleet(self):
        self.assertEqual(_tree_summary([]), {"total": 0, "online": 0, "groups": [], "unassigned": {"total": 0, "online": 0, "os": []}})
