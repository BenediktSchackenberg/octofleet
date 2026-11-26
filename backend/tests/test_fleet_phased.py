"""Fleet updates: Ubuntu phased updates are listed but not counted as pending (#339 follow-up)."""
import unittest

from routers.patches import _linux_counts


def _update(name, security=False, phased=None):
    u = {"name": name, "newVersion": "1", "security": security}
    if phased is not None:
        u["phased"] = phased
    return u


class LinuxCountsTests(unittest.TestCase):
    def test_phased_updates_are_not_pending(self):
        linux = {"totalUpdates": 3, "securityUpdates": 1, "updates": [
            _update("libsqlite3-0", phased=True), _update("openssl", security=True, phased=True), _update("fwupd")]}
        c = _linux_counts(linux)
        self.assertEqual((c["pending"], c["security"], c["phased"]), (1, 0, 2))
        self.assertEqual(c["names"], ["fwupd"])

    def test_older_agent_without_phasing_is_unchanged(self):
        linux = {"totalUpdates": 2, "securityUpdates": 1, "updates": [_update("a", security=True), _update("b")]}
        self.assertEqual(_linux_counts(linux), {"names": ["a", "b"], "pending": 2, "security": 1, "phased": 0})

    def test_without_totals_counts_the_list(self):
        c = _linux_counts({"updates": [_update("a"), _update("b", phased=True), {"newVersion": "x"}]})
        self.assertEqual((c["pending"], c["security"], c["phased"]), (1, 0, 1))

    def test_empty(self):
        self.assertEqual(_linux_counts({}), {"names": [], "pending": 0, "security": 0, "phased": 0})


if __name__ == "__main__":
    unittest.main()
