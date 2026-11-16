"""Remediation reads the maintenance windows from Settings -> Maintenance windows, whose
days_of_week are ISO weekdays (1 = Monday ... 7 = Sunday)."""

import unittest
from datetime import datetime, time

from remediation import is_in_maintenance_window


class Pool:
    def __init__(self, window):
        self.window = window

    def acquire(self):
        pool = self

        class Connection:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def fetch(self, query, *args):
                return [pool.window]
        return Connection()


def window(days, start, end, now):
    return {"days_of_week": days, "start_time": start, "end_time": end, "is_active": True,
            "target_type": "all", "target_id": None, "local_now": now}


SUNDAY = datetime(2026, 11, 15, 23, 0)      # 2026-11-15 is a Sunday
MONDAY_EARLY = datetime(2026, 11, 16, 2, 0)
MONDAY_NOON = datetime(2026, 11, 16, 12, 0)


class MaintenanceWindowDayTests(unittest.IsolatedAsyncioTestCase):
    async def open(self, days, start, end, now):
        return await is_in_maintenance_window(Pool(window(days, time(*start), time(*end), now)))

    async def test_a_sunday_window_is_open_on_sunday(self):
        self.assertTrue(await self.open([7], (22, 0), (23, 30), SUNDAY))

    async def test_a_sunday_window_is_closed_on_monday(self):
        self.assertFalse(await self.open([7], (0, 0), (23, 59), MONDAY_NOON))

    async def test_an_overnight_window_belongs_to_the_day_it_starts(self):
        self.assertTrue(await self.open([7], (22, 0), (4, 0), MONDAY_EARLY))   # started Sunday
        self.assertFalse(await self.open([1], (22, 0), (4, 0), MONDAY_EARLY))  # Monday's starts Monday night

    async def test_weekdays_monday_to_friday(self):
        self.assertTrue(await self.open([1, 2, 3, 4, 5], (8, 0), (18, 0), MONDAY_NOON))
        self.assertFalse(await self.open([1, 2, 3, 4, 5], (8, 0), (23, 59), SUNDAY))


if __name__ == "__main__":
    unittest.main()
