"""The jobs command_type check allows every type the server creates (e.g. service_reconcile)."""
import unittest
from unittest.mock import AsyncMock, MagicMock

from job_types import JOB_COMMAND_TYPES, ensure_command_types

OLD_CHECK = ("CHECK ((command_type = ANY (ARRAY['run'::text, 'script'::text, 'inventory'::text, "
             "'restart-agent'::text, 'patch_scan'::text, 'uninstall-agent'::text])))")


def _conn(definition):
    conn = AsyncMock()
    conn.fetchval.return_value = definition
    conn.transaction = MagicMock()
    conn.transaction.return_value.__aenter__ = AsyncMock()
    conn.transaction.return_value.__aexit__ = AsyncMock(return_value=False)
    return conn


class EnsureCommandTypesTests(unittest.IsolatedAsyncioTestCase):
    async def test_adds_missing_types_and_keeps_existing_ones(self):
        conn = _conn(OLD_CHECK)
        await ensure_command_types(conn)
        statements = [c.args[0] for c in conn.execute.call_args_list]
        self.assertEqual(statements[0], "ALTER TABLE jobs DROP CONSTRAINT jobs_command_type_check")
        added = statements[1]
        for command_type in ("run", "uninstall-agent", "service_reconcile", "patch_install", "install_package"):
            self.assertIn(f"'{command_type}'", added)
        self.assertEqual(added.count("'run'"), 1)

    async def test_nothing_to_do_when_all_are_allowed(self):
        allowed = ", ".join(f"'{t}'::text" for t in JOB_COMMAND_TYPES)
        conn = _conn(f"CHECK ((command_type = ANY (ARRAY[{allowed}])))")
        await ensure_command_types(conn)
        conn.execute.assert_not_called()

    async def test_no_constraint_no_change(self):
        conn = _conn(None)
        await ensure_command_types(conn)
        conn.execute.assert_not_called()

    def test_service_reconcile_is_listed(self):
        # services_mgmt.py creates service_reconcile jobs; both agents handle them
        self.assertIn("service_reconcile", JOB_COMMAND_TYPES)


if __name__ == "__main__":
    unittest.main()
