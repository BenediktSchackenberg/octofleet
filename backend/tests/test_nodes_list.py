"""Nodes list: a stable order (hostname, case-insensitive, then node_id) and alert counts in one query."""
import unittest
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from routers.nodes import NODE_LIST_ORDER, list_nodes


def _db(rows):
    conn = AsyncMock()
    conn.fetch.return_value = rows
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    return pool, conn


def _row(hostname, critical=0, warning=0):
    return {"id": uuid4(), "node_id": hostname, "hostname": hostname, "critical_count": critical, "tags": '[{"id": "t1", "name": "ring-1", "color": null}]',
            "warning_count": warning}


class NodeListTests(unittest.IsolatedAsyncioTestCase):
    async def test_stable_order_and_one_query(self):
        pool, conn = _db([_row("a"), _row("B")])
        await list_nodes(unassigned=False, group_id=None, db=pool)
        self.assertEqual(conn.fetch.await_count, 1)        # no query per node
        conn.fetchrow.assert_not_awaited()
        sql = conn.fetch.call_args.args[0]
        self.assertTrue(sql.rstrip().endswith(NODE_LIST_ORDER))
        self.assertEqual(NODE_LIST_ORDER, "ORDER BY lower(n.hostname), n.node_id")
        self.assertNotIn("last_seen DESC", sql)

    async def test_every_variant_has_the_same_order(self):
        for kwargs in ({"unassigned": True, "group_id": None}, {"unassigned": False, "group_id": str(uuid4())}):
            pool, conn = _db([])
            await list_nodes(db=pool, **kwargs)
            self.assertTrue(conn.fetch.call_args.args[0].rstrip().endswith(NODE_LIST_ORDER), kwargs)

    async def test_group_filter_lists_a_node_once(self):
        pool, conn = _db([])
        group = str(uuid4())
        await list_nodes(unassigned=False, group_id=group, db=pool)
        sql, arg = conn.fetch.call_args.args
        self.assertIn("WHERE EXISTS (SELECT 1 FROM device_groups dg", sql)   # not a JOIN: no duplicates
        self.assertEqual(str(arg), group)

    async def test_health_from_fired_alerts(self):
        pool, _ = _db([_row("a", critical=1, warning=2), _row("b", warning=1), _row("c")])
        nodes = (await list_nodes(unassigned=False, group_id=None, db=pool))["nodes"]
        self.assertEqual([(n["health_status"], n["alert_count"]) for n in nodes],
                         [("critical", 3), ("warning", 1), ("healthy", 0)])
        self.assertNotIn("critical_count", nodes[0])                         # internal columns removed


if __name__ == "__main__":
    unittest.main()


class NodeListTagsTests(unittest.IsolatedAsyncioTestCase):
    async def test_tags_in_one_grouped_pass_and_decoded(self):
        pool, conn = _db([_row("a")])
        result = await list_nodes(db=pool)
        self.assertEqual(result["nodes"][0]["tags"], [{"id": "t1", "name": "ring-1", "color": None}])
        sql = conn.fetch.call_args.args[0]
        self.assertIn("FROM device_tags dt JOIN tags t ON t.id = dt.tag_id GROUP BY dt.node_id", sql)

