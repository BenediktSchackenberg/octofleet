"""The Windows node's available updates for the Updates tab; Defender signatures are marked."""
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from routers.patches import get_available_updates, is_definition_update


class AvailableUpdatesTests(unittest.IsolatedAsyncioTestCase):
    async def test_rows_with_definition_flag(self):
        conn = AsyncMock()
        found = datetime(2026, 11, 13, 9, 44, tzinfo=timezone.utc)
        conn.fetch.return_value = [
            {"kb_id": "KB2267602", "title": "Security Intelligence Update for Microsoft Defender Antivirus - KB2267602",
             "severity": "unknown", "category": "definition", "source": "wsus", "is_reboot_required": None,
             "discovered_at": found},
            {"kb_id": "KB5130001", "title": "2026-11 Cumulative Update for Microsoft server operating system",
             "severity": "critical", "category": "security", "source": "wsus", "is_reboot_required": True,
             "discovered_at": None},
        ]
        pool = MagicMock()
        pool.acquire.return_value.__aenter__.return_value = conn
        with patch("routers.patches.get_pool", return_value=pool):
            result = await get_available_updates("SRV-TEST")
        defender, cumulative = result["updates"]
        self.assertTrue(defender["definition"])
        self.assertFalse(defender["is_reboot_required"])
        self.assertEqual(defender["discovered_at"], found.isoformat())
        self.assertFalse(cumulative["definition"])
        self.assertTrue(cumulative["is_reboot_required"])
        self.assertIsNone(cumulative["discovered_at"])
        self.assertEqual(conn.fetch.call_args.args[1], "SRV-TEST")

    def test_definition_update_by_kb_or_title(self):
        self.assertTrue(is_definition_update("KB2267602", ""))
        self.assertTrue(is_definition_update(None, "Security Intelligence Update for Microsoft Defender Antivirus"))
        self.assertFalse(is_definition_update("KB4052623", "Update for Microsoft Defender Antivirus antimalware platform"))
        self.assertFalse(is_definition_update(None, None))


if __name__ == "__main__":
    unittest.main()
