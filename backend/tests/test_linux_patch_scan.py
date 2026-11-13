"""Linux agent: the result of a patch_scan job becomes the node's last update search."""
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from routers.inventory import submit_linux_data

UPDATES = {"packageManager": "apt", "totalUpdates": 2, "securityUpdates": 1, "rebootRequired": False,
           "updates": [{"name": "openssl", "newVersion": "3.5.1-1ubuntu2.1", "security": True},
                       {"name": "systemd", "newVersion": "259.2-1ubuntu3.1", "security": False}]}


async def _submit(updates):
    conn = AsyncMock()
    db = MagicMock()
    db.acquire.return_value.__aenter__.return_value = conn
    node_uuid = uuid4()
    with patch("routers.inventory.upsert_node", AsyncMock(return_value=node_uuid)):
        await submit_linux_data("ubuntu-vm", "ubuntu-vm", {"updates": updates}, db)
    calls = [c.args for c in conn.execute.call_args_list]
    stored = next(c for c in calls if "linux_data_current" in c[0])
    scans = [c for c in calls if "node_patch_scans" in c[0]]
    return node_uuid, json.loads(stored[4]), scans


class LinuxPatchScanTests(unittest.IsolatedAsyncioTestCase):
    async def test_scan_block_is_recorded_as_update_search(self):
        scan = {"status": "succeeded", "source": "apt", "error": None, "duration_seconds": 3}
        node_uuid, stored, scans = await _submit({**UPDATES, "scan": scan})
        self.assertEqual(len(scans), 1)
        args = scans[0]
        self.assertEqual(args[1], str(node_uuid))
        self.assertEqual((args[2], args[3]), ("succeeded", "apt"))
        self.assertEqual(args[-1], 2)  # update count = totalUpdates

    async def test_scan_block_is_not_stored_with_the_list(self):
        _, stored, _ = await _submit({**UPDATES, "scan": {"status": "succeeded", "source": "apt"}})
        self.assertNotIn("scan", stored)
        self.assertEqual(stored["totalUpdates"], 2)
        self.assertEqual(len(stored["updates"]), 2)

    async def test_failed_scan_is_recorded_with_its_error(self):
        scan = {"status": "failed", "source": "apt", "error": "E: Could not get lock"}
        _, _, scans = await _submit({**UPDATES, "scan": scan})
        self.assertEqual(scans[0][2], "failed")
        self.assertEqual(scans[0][6], "E: Could not get lock")

    async def test_scheduled_push_without_scan_records_nothing(self):
        _, stored, scans = await _submit(UPDATES)
        self.assertEqual(scans, [])
        self.assertEqual(stored["packageManager"], "apt")

    async def test_null_or_invalid_scan_records_nothing(self):
        for scan in (None, {"status": "unknown"}, "succeeded"):
            _, stored, scans = await _submit({**UPDATES, "scan": scan})
            self.assertEqual(scans, [], scan)
            self.assertNotIn("scan", stored)


if __name__ == "__main__":
    unittest.main()
