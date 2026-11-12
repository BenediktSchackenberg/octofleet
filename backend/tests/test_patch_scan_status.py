"""Patch scan results: a failed search keeps the node's lists, a successful one resolves the catalog."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from routers.patches import UNRESOLVED_STATES, import_patches

NODE = str(uuid4())
PATCH_ID = uuid4()
PATCHES = [{"kb_id": "KB5070001", "title": "2026-11 Cumulative Update", "severity": "critical", "category": "security"}]


def _conn():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": PATCH_ID}  # the patch is already in the catalog
    conn.fetchval.return_value = 1                  # and linked to the node
    conn.execute.return_value = "DELETE 2"
    return conn


async def _import(data):
    conn = _conn()
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    with patch("routers.patches.get_pool", return_value=pool):
        result = await import_patches(data)
    return result, [c.args for c in conn.execute.call_args_list]


def _sql(calls, fragment):
    return [c for c in calls if fragment in c[0]]


def _scan(status, **extra):
    return {"status": status, "source": "wsus", "server": "https://wsus.example:8531", "result_code": 2, **extra}


class ScanStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_search_keeps_the_lists(self):
        result, calls = await _import({"node_id": NODE, "patches": [],
                                       "scan": _scan("failed", result_code=None, error="0x8024401C: no WSUS")})
        self.assertEqual(result["scan"], "failed")
        self.assertEqual(_sql(calls, "node_available_updates"), [])
        self.assertEqual(_sql(calls, "patch_catalog_nodes"), [])
        recorded = _sql(calls, "INSERT INTO node_patch_scans")
        self.assertEqual(len(recorded), 1)
        self.assertEqual(recorded[0][2], "failed")
        self.assertEqual(recorded[0][6], "0x8024401C: no WSUS")

    async def test_successful_search_resolves_entries_no_longer_offered(self):
        result, calls = await _import({"node_id": NODE, "patches": PATCHES, "scan": _scan("succeeded")})
        deletes = _sql(calls, "DELETE FROM patch_catalog_nodes")
        self.assertEqual(len(deletes), 1)
        sql, node, states, reported = deletes[0]
        self.assertIn("status = ANY($2::text[])", sql)
        self.assertIn("NOT (patch_id = ANY($3::uuid[]))", sql)
        self.assertEqual((node, states, reported), (NODE, list(UNRESOLVED_STATES), [PATCH_ID]))
        self.assertEqual(result["removed"], 2)
        # the Patch Explorer list is replaced, with the reported source
        self.assertEqual(len(_sql(calls, "DELETE FROM node_available_updates")), 1)
        self.assertEqual(_sql(calls, "INSERT INTO node_available_updates")[0][6], "wsus")
        self.assertEqual(_sql(calls, "INSERT INTO node_patch_scans")[0][-1], 1)

    async def test_empty_successful_search_resolves_all_waiting_entries(self):
        _, calls = await _import({"node_id": NODE, "patches": [], "scan": _scan("succeeded")})
        self.assertEqual(_sql(calls, "DELETE FROM patch_catalog_nodes")[0][3], [])

    async def test_partial_search_removes_nothing(self):
        _, calls = await _import({"node_id": NODE, "patches": PATCHES, "scan": _scan("partial", result_code=3)})
        self.assertEqual(_sql(calls, "DELETE FROM patch_catalog_nodes"), [])
        self.assertEqual(len(_sql(calls, "DELETE FROM node_available_updates")), 1)

    async def test_without_scan_block_as_before(self):
        result, calls = await _import({"node_id": NODE, "patches": PATCHES})
        self.assertEqual(_sql(calls, "DELETE FROM patch_catalog_nodes"), [])
        self.assertEqual(_sql(calls, "node_patch_scans"), [])
        self.assertEqual(_sql(calls, "INSERT INTO node_available_updates")[0][6], "windows_update")
        self.assertEqual(result["removed"], 0)


if __name__ == "__main__":
    unittest.main()
