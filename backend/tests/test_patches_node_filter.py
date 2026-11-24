"""The node page's patch count and link: compliance and catalog limited to one node's open patches."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from routers.patches import OPEN_STATES, get_patch_compliance, list_patch_catalog

ENTRIES = {"pending": 0, "installed": 0, "failed": 0, "not_required": 0, "counted": 0, "mttp": None}
PATCHES = {"total": 0, "approved": 0, "excluded": 0, "required": 0, "awaiting_approval": 0}


def _pool(conn):
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    return pool


def _conn(entries=None, patches=None):
    conn = AsyncMock()
    conn.fetchval.return_value = 0
    conn.fetch.return_value = []
    conn.fetchrow.side_effect = [{**ENTRIES, **(entries or {})}, {**PATCHES, **(patches or {})}]
    return conn


class ComplianceTests(unittest.IsolatedAsyncioTestCase):
    async def test_node_counts_only_its_own_entries(self):
        conn = _conn()
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            await get_patch_compliance(node_id="SRV-01")
        queries = conn.fetchrow.call_args_list
        self.assertEqual(len(queries), 2)
        for call in queries:
            # the entry counts and the patch counts are limited to the node (by node_id or UUID)
            self.assertIn("n.node_id = $1 OR n.id::text = $1", call.args[0])
            self.assertEqual(call.args[1:], ("SRV-01", list(OPEN_STATES)))
            self.assertIn("ANY($2::text[])", call.args[0])
        self.assertIn("e.node_id IN", queries[1].args[0])
        self.assertIn("WHERE pc.id IN (SELECT patch_id FROM patch_catalog_nodes", queries[1].args[0])

    async def test_without_node_the_whole_fleet(self):
        conn = _conn()
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            result = await get_patch_compliance(node_id=None)
        for call in conn.fetchrow.call_args_list:
            self.assertNotIn("n.node_id = $1", call.args[0])
            self.assertEqual(call.args[1:], (list(OPEN_STATES),))
        self.assertEqual(result["pending"], 0)
        self.assertEqual(result["compliance_percent"], 100.0)

    async def test_installed_and_no_longer_needed_count_as_compliant(self):
        conn = _conn({"pending": 1, "installed": 2, "not_required": 1, "failed": 0, "counted": 4, "mttp": 5.04},
                     {"total": 3, "approved": 1, "excluded": 0, "required": 1, "awaiting_approval": 0})
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            result = await get_patch_compliance(node_id=None)
        self.assertEqual(result["compliance_percent"], 75.0)   # 3 of 4 counted entries
        self.assertEqual((result["total_patches"], result["approved"], result["required_patches"],
                          result["awaiting_approval"]), (3, 1, 1, 0))
        self.assertEqual((result["pending"], result["installed"], result["not_required"]), (1, 2, 1))
        self.assertEqual(result["mttp_hours"], 5.0)

    async def test_excluded_entries_are_left_out_of_compliance(self):
        conn = _conn()
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            await get_patch_compliance(node_id=None)
        self.assertIn("FILTER (WHERE status <> 'excluded') AS counted", conn.fetchrow.call_args_list[0].args[0])


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

    async def test_each_patch_lists_its_node_counts(self):
        counted, unseen = uuid4(), uuid4()
        conn = _conn()
        conn.fetch.side_effect = [
            [{"id": counted, "kb_id": "KB5136489"}, {"id": unseen, "kb_id": "KB890830"}],
            [{"patch_id": counted, "required": 0, "installed": 1, "failed": 0, "not_required": 0}],
        ]
        with patch("routers.patches.get_pool", return_value=_pool(conn)):
            result = await list_patch_catalog(severity=None, category=None, approved=None, search=None, node=None,
                                              limit=100, offset=0)
        query, ids, states = conn.fetch.call_args_list[1].args
        self.assertIn("WHERE patch_id = ANY($1::uuid[])", query)   # only the page's patches
        self.assertEqual((ids, states), ([counted, unseen], list(OPEN_STATES)))
        self.assertEqual(result["items"][0]["nodes"], {"required": 0, "installed": 1, "failed": 0, "not_required": 0})
        self.assertEqual(result["items"][1]["nodes"], {"required": 0, "installed": 0, "failed": 0, "not_required": 0})


if __name__ == "__main__":
    unittest.main()
