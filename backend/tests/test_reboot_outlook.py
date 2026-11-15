"""Windows scan results: the reboot behavior per update and the pending reboot are stored."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from routers.patches import import_patches, reboot_behavior

NODE = str(uuid4())


class RebootOutlookTests(unittest.IsolatedAsyncioTestCase):
    def test_reboot_behavior_values(self):
        self.assertEqual(reboot_behavior({"reboot_behavior": "always"}), "always")
        self.assertEqual(reboot_behavior({"reboot_behavior": "can"}), "can")
        self.assertIsNone(reboot_behavior({"reboot_behavior": "bogus"}))
        self.assertIsNone(reboot_behavior({}))

    async def test_scan_stores_behavior_and_pending_reboot(self):
        conn = AsyncMock()
        conn.fetchrow.return_value = {"id": uuid4()}
        conn.fetchval.return_value = 1
        conn.execute.return_value = "DELETE 0"
        pool = MagicMock()
        pool.acquire.return_value.__aenter__.return_value = conn
        data = {"node_id": NODE, "scan": {"status": "succeeded", "source": "wsus", "reboot_pending": True},
                "patches": [{"kb_id": "KB5136489", "title": "2026-11 Cumulative Update", "severity": "critical",
                             "category": "security", "reboot_behavior": "always"},
                            {"kb_id": "KB890830", "title": "Malicious Software Removal Tool", "severity": "moderate",
                             "category": "security", "reboot_behavior": "never"}]}
        with patch("routers.patches.get_pool", return_value=pool):
            await import_patches(data)
        calls = [c.args for c in conn.execute.call_args_list]
        available = [c for c in calls if "INSERT INTO node_available_updates" in c[0]]
        self.assertEqual([(c[2], c[7], c[8]) for c in available],
                         [("KB5136489", True, "always"), ("KB890830", False, "never")])
        scan = next(c for c in calls if "INSERT INTO node_patch_scans" in c[0])
        self.assertIs(scan[-2], True)  # reboot_pending before the update count


if __name__ == "__main__":
    unittest.main()
