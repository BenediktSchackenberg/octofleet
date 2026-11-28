"""A maintenance window scoped to a group applies to the group's members as the groups API keeps them
(device_groups). It read the legacy group_members table, which nothing writes, so such a window never
matched and Auto-Fix stayed blocked on those nodes."""

import unittest
from datetime import datetime, time
from uuid import uuid4

from remediation import is_in_maintenance_window

NODE = uuid4()
GROUP = uuid4()
OTHER = uuid4()
MONDAY_NOON = datetime(2026, 11, 16, 12, 0)


class Pool:
    def __init__(self, window, groups):
        self.window, self.groups, self.queries = window, groups, []

    def acquire(self):
        pool = self

        class Connection:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def fetch(self, query, *args):
                pool.queries.append(query)
                if "node_group_ids" in query:
                    return [{"group_id": g} for g in pool.groups]
                return [pool.window]

            async def fetchrow(self, query, *args):
                return {"node_id": "node-1", "hostname": "node-1"}
        return Connection()


def window(target_type, target_id=None, **extra):
    return {"days_of_week": [1], "start_time": time(8, 0), "end_time": time(18, 0), "is_active": True,
            "target_type": target_type, "target_id": target_id, "local_now": MONDAY_NOON, **extra}


class GroupScopedWindowTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_group_window_applies_to_its_members(self):
        pool = Pool(window("group", GROUP), [GROUP])
        self.assertTrue(await is_in_maintenance_window(pool, NODE))
        self.assertTrue(any("node_group_ids" in q for q in pool.queries))  # with the parents of its groups
        self.assertFalse(any("group_members" in q for q in pool.queries))

    async def test_not_to_other_nodes(self):
        self.assertFalse(await is_in_maintenance_window(Pool(window("group", GROUP), [OTHER]), NODE))

    async def test_windows_with_a_list_of_groups(self):
        pool = Pool(window("group", None, applies_to_all=False, group_ids=[OTHER, GROUP]), [GROUP])
        self.assertTrue(await is_in_maintenance_window(pool, NODE))


if __name__ == "__main__":
    unittest.main()
