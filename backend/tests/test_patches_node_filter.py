"""The node page's patch count and link: compliance and catalog limited to one node's open patches."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from routers.patches import OPEN_STATES, get_patch_compliance, list_patch_catalog


def _pool(conn):
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    return pool


def _conn():
    conn = AsyncMock()
    conn.fetchval.return_value = 0
    conn.fetch.return_value = []
    return conn


class ComplianceTests(unittest.IsolatedAsyncioTestCase):
    async def test_node_counts_only_its_own_entries(self):
        conn = _conn()
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            await get_patch_compliance(node_id="SRV-01")
        entry_queries = [c for c in conn.fetchval.call_args_list if "patch_catalog_nodes" in c.args[0]]
        self.assertTrue(entry_queries)
        for call in entry_queries:
            # every count over patch entries is limited to the node (by node_id or UUID)
            self.assertIn("n.node_id = $1 OR n.id::text = $1", call.args[0])
            self.assertEqual(call.args[1], "SRV-01")
        pending = next(c for c in entry_queries if "ANY($2::text[])" in c.args[0])
        self.assertEqual(pending.args[2], list(OPEN_STATES))

    async def test_without_node_the_whole_fleet(self):
        conn = _conn()
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            result = await get_patch_compliance(node_id=None)
        for call in conn.fetchval.call_args_list:
            self.assertNotIn("n.node_id = $1", call.args[0])
        self.assertEqual(result["pending"], 0)
        self.assertEqual(result["compliance_percent"], 100.0)


class CatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_node_filter_keeps_the_patches_open_on_the_node(self):
        conn = _conn()
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            await list_patch_catalog(node="SRV-01", severity="critical", limit=100, offset=0)
        query, *args = conn.fetch.call_args.args
        self.assertIn("id IN (SELECT patch_id FROM patch_catalog_nodes WHERE node_id IN", query)
        self.assertIn("status = ANY($2::text[])", query)
        self.assertIn("severity = $3", query)
        self.assertEqual(args[:3], ["SRV-01", list(OPEN_STATES), "critical"])

    async def test_no_node_filter_by_default(self):
        conn = _conn()
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            await list_patch_catalog(severity=None, category=None, approved=None, search=None, node=None, limit=100, offset=0)
        self.assertNotIn("patch_catalog_nodes", conn.fetch.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
