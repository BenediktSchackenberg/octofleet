"""Catalog entries marked installed from the node's update history, and the status check on upgrade."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from routers.inventory import submit_hotfixes
from routers.patches import (
    ENTRY_STATES,
    ENTRY_STATUS_CHECK_DDL,
    INSTALLED_FROM_HISTORY_SQL,
    INSTALLED_RESULTS,
    ensure_schema,
    record_installed_from_history,
)

NODE = uuid4()


def _db(conn):
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    return pool


class HistoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_parameters(self):
        conn = AsyncMock()
        await record_installed_from_history(conn, str(NODE))
        sql, node_uuid, results, node_text = conn.execute.call_args.args
        self.assertIs(sql, INSTALLED_FROM_HISTORY_SQL)
        self.assertEqual((node_uuid, node_text), (str(NODE), str(NODE)))
        self.assertEqual(results, ["Succeeded", "SucceededWithErrors"])
        self.assertEqual(list(INSTALLED_RESULTS), results)

    def test_rules(self):
        sql = INSTALLED_FROM_HISTORY_SQL
        # only entries no longer offered, and only installs after the entry was detected
        self.assertIn("e.status = 'not_required'", sql)
        self.assertIn("d.installed_on >= e.detected_at", sql)
        # missing entries only for installs after Octofleet first saw the KB (MSRT reuses its KB)
        self.assertIn("d.installed_on >= d.created_at", sql)
        self.assertIn("NOT EXISTS", sql)

    async def test_history_push_marks_installed_entries(self):
        conn = AsyncMock()
        with patch("routers.inventory.upsert_node", AsyncMock(return_value=NODE)):
            await submit_hotfixes({"nodeId": "n1", "hotfixes": [], "updateHistory": [
                {"updateId": "u1", "kbId": "KB5136489", "title": "2026-11 CU", "resultCode": "Succeeded",
                 "installedOn": "2026-11-15T15:23:09Z"}]}, _db(conn))
        last = conn.execute.call_args_list[-1].args
        self.assertIs(last[0], INSTALLED_FROM_HISTORY_SQL)
        self.assertEqual(last[1], str(NODE))

    async def test_no_history_no_query(self):
        conn = AsyncMock()
        with patch("routers.inventory.upsert_node", AsyncMock(return_value=NODE)):
            await submit_hotfixes({"nodeId": "n1", "hotfixes": [], "updateHistory": []}, _db(conn))
        self.assertNotIn(INSTALLED_FROM_HISTORY_SQL, [c.args[0] for c in conn.execute.call_args_list])


class SchemaTests(unittest.IsolatedAsyncioTestCase):
    def test_status_check_is_replaced_once_and_keeps_rows(self):
        ddl = ENTRY_STATUS_CHECK_DDL
        self.assertIn("LIKE '%not_required%'", ddl)          # skipped when already replaced
        self.assertIn("to_regclass('public.patch_catalog_nodes') IS NOT NULL", ddl)
        self.assertNotIn("DELETE", ddl.upper())
        self.assertNotIn("UPDATE", ddl.upper())
        for state in ENTRY_STATES:
            self.assertIn(f"'{state}'", ddl)

    async def test_ensure_schema_adds_check_and_index(self):
        conn = AsyncMock()
        await ensure_schema(_db(conn))
        sql = [c.args[0] for c in conn.execute.call_args_list]
        self.assertIn(ENTRY_STATUS_CHECK_DDL, sql)
        self.assertTrue(any("idx_pcn_patch_status ON patch_catalog_nodes(patch_id, status)" in q for q in sql))


if __name__ == "__main__":
    unittest.main()
