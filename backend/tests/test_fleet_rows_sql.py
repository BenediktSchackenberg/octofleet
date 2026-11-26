"""Fleet updates list (_fleet_rows) at 10,000 nodes: the newest jobs by run_kind, and each Linux
node's list summary stored at the push instead of reading its whole update list per request."""
import inspect
import unittest

import linux_rules
from routers import patches
from routers.patches import (
    _linux_counts,
    _linux_reboot,
    _newest_run,
    linux_reboot_behavior,
    linux_updates_for_list,
)

FULL = {"packageManager": "apt", "totalUpdates": 7, "securityUpdates": 2, "rebootRequired": False, "updates": [
    {"name": "vim", "newVersion": "1", "arch": "amd64", "repository": "noble-updates"},
    {"name": "curl", "newVersion": "1", "security": True},
    {"name": "linux-image-7.0.0-45-generic", "newVersion": "1"},
    {"name": "linux-headers-7.0.0-45-generic", "newVersion": "1"},
    {"name": "libsqlite3-0", "newVersion": "1", "phased": True, "phasedPercent": 10},
    {"name": "openssl", "newVersion": "1", "security": True, "phased": True},
    {"name": "libssl3t64", "newVersion": "1"},
    "not an entry", {"newVersion": "2"},
]}


def reboot_names(counts):
    return [n for n in counts["names"] if linux_reboot_behavior(n) != "never"]


class UpdatesForListTests(unittest.TestCase):
    def test_same_counts_and_reboot_estimate_as_the_whole_list(self):
        small = linux_updates_for_list(FULL)
        a, b = _linux_counts(FULL), _linux_counts(small)
        self.assertEqual((a["pending"], a["security"], a["phased"]), (b["pending"], b["security"], b["phased"]))
        self.assertEqual(reboot_names(a), reboot_names(b))
        self.assertEqual(_linux_reboot(a["names"], False), _linux_reboot(b["names"], False))

    def test_keeps_only_phased_and_reboot_entries(self):
        names = [u["name"] for u in linux_updates_for_list(FULL)["updates"]]
        self.assertEqual(names, ["linux-image-7.0.0-45-generic", "libsqlite3-0", "openssl", "libssl3t64"])

    def test_total_without_totalupdates_counts_the_named_entries(self):
        small = linux_updates_for_list({k: v for k, v in FULL.items() if k != "totalUpdates"})
        self.assertEqual(small["totalUpdates"], 7)
        self.assertEqual(_linux_counts(small)["pending"],
                         _linux_counts({k: v for k, v in FULL.items() if k != "totalUpdates"})["pending"])

    def test_reboot_flag_and_empty_list(self):
        self.assertIs(linux_updates_for_list({**FULL, "rebootRequired": True})["rebootRequired"], True)
        self.assertEqual(linux_updates_for_list({}), {"packageManager": None, "totalUpdates": 0, "securityUpdates": None,
                                                      "rebootRequired": None, "updates": []})
        self.assertEqual(linux_updates_for_list(FULL)["packageManager"], "apt")  # NODE_INFO reads it


class StatementTests(unittest.TestCase):
    def test_newest_run_uses_the_run_kind(self):
        sql = _newest_run("patch_scan", "patch_install")
        self.assertIn("unnest(ARRAY['patch_scan', 'patch_install'])", sql)
        # one probe per node key and kind: equality on both, newest first, one row
        self.assertIn("i.node_id = key.node_id AND i.run_kind = kind.run_kind", sql)
        self.assertIn("ORDER BY i.queued_at DESC LIMIT 1", sql)
        self.assertIn("ORDER BY x.queued_at DESC LIMIT 1", sql)
        self.assertNotIn("jobs", sql)  # no join to every run's job to find its type

    def test_the_list_reads_the_stored_summary(self):
        source = inspect.getsource(patches._fleet_rows)
        self.assertIn("COALESCE(l.updates_for_list, l.updates)", source)
        self.assertIn("COALESCE(l.updates_for_list, l.updates)->>'packageManager'", linux_rules.NODE_INFO)
        self.assertNotIn("l.updates->>", linux_rules.NODE_INFO)


if __name__ == "__main__":
    unittest.main()
