"""os.lastBootTime of the agents -> system_current.last_boot_time (timestamp without time zone)."""

import unittest
from datetime import datetime

from routers.inventory import last_boot_from


class LastBootTimeTests(unittest.TestCase):
    def test_without_offset_as_given(self):
        # Windows: the node's local time; Linux: UTC - both without offset
        self.assertEqual(last_boot_from("2026-11-24T17:50:40"), datetime(2026, 11, 24, 17, 50, 40))

    def test_with_offset_in_utc_without_tzinfo(self):
        # asyncpg rejects an aware datetime for the column, which failed the whole system section
        self.assertEqual(last_boot_from("2026-11-24T18:50:40+01:00"), datetime(2026, 11, 24, 17, 50, 40))
        self.assertEqual(last_boot_from("2026-11-24T17:50:40Z"), datetime(2026, 11, 24, 17, 50, 40))
        self.assertIsNone(last_boot_from("2026-11-24T17:50:40Z").tzinfo)

    def test_missing_or_invalid(self):
        for value in (None, "", "yesterday", 1732470640, {"t": 1}):
            self.assertIsNone(last_boot_from(value), value)


if __name__ == "__main__":
    unittest.main()
