"""The node's Linux update list carries each update's reboot estimate (the same as the fleet view's)."""
import json
import unittest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from routers.inventory import get_linux_data


def _db(updates):
    conn = AsyncMock()
    conn.fetchrow.side_effect = [{"id": uuid4()}, {"performance": None, "services": None, "updates": json.dumps(updates),
                                                   "disk_health": None, "updated_at": None}]
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    return pool


class LinuxRebootListTests(unittest.IsolatedAsyncioTestCase):
    async def test_each_update_has_its_reboot_behavior(self):
        result = await get_linux_data("n1", db=_db({"packageManager": "apt", "updates": [
            {"name": "linux-image-generic"}, {"name": "libc6"}, {"name": "vim"}, "not-an-object"]}))
        updates = result["data"]["updates"]["updates"]
        self.assertEqual([u.get("reboot_behavior") for u in updates[:3]], ["always", "can", "never"])
        self.assertEqual(updates[3], "not-an-object")

    async def test_without_updates_unchanged(self):
        result = await get_linux_data("n1", db=_db({"packageManager": "apt"}))
        self.assertEqual(result["data"]["updates"], {"packageManager": "apt"})


if __name__ == "__main__":
    unittest.main()
