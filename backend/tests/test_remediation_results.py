"""Remediation: job results, deleting packages/rules that jobs use, dry-run counts."""

import unittest
from contextlib import asynccontextmanager
from unittest import mock

import asyncpg
from fastapi import HTTPException

import remediation
from routers import remediation as router


async def _job(*_, **kwargs):
    return {"id": 1, **kwargs}


class JobResultTests(unittest.IsolatedAsyncioTestCase):
    async def submit(self, exit_code, output):
        with mock.patch.object(router, "update_remediation_job_status", side_effect=_job) as update, \
                mock.patch.object(router, "get_pool") as pool:
            result = await router.submit_remediation_result(1, {"exitCode": exit_code, "output": output})
        return result, update.call_args.kwargs["status"], pool

    async def test_exit_code_0_is_success(self):
        result, status, _ = await self.submit(0, "Successfully installed")
        self.assertEqual(status, "success")
        self.assertTrue(result["success"])

    async def test_nothing_to_upgrade_is_skipped_not_success(self):
        for output in ("No available upgrade found.",
                       "No applicable upgrade found.",
                       "Es wurden keine neueren Paketversionen gefunden."):
            with self.subTest(output=output):
                result, status, pool = await self.submit(1, output)
                self.assertEqual(status, "skipped")
                self.assertFalse(result["success"])
                # findings are not marked as fixed
                pool.return_value.acquire.assert_not_called()

    async def test_other_errors_fail(self):
        for exit_code, output in ((1, "Installer failed"), (1, "Keine Berechtigung zum Installieren"),
                                  (2, "No available upgrade found."), (-1, "")):
            with self.subTest(exit_code=exit_code):
                _, status, pool = await self.submit(exit_code, output)
                self.assertEqual(status, "failed")
                pool.return_value.acquire.assert_not_called()


class DeleteInUseTests(unittest.IsolatedAsyncioTestCase):
    async def test_package_used_by_jobs_is_409(self):
        error = asyncpg.ForeignKeyViolationError("remediation_jobs refers to it")
        with mock.patch.object(router, "delete_remediation_package", side_effect=error), \
                mock.patch.object(router, "get_pool"):
            with self.assertRaises(HTTPException) as raised:
                await router.delete_remediation_package_endpoint(1, "test")
        self.assertEqual(raised.exception.status_code, 409)

    async def test_rule_used_by_jobs_is_409(self):
        error = asyncpg.ForeignKeyViolationError("remediation_jobs refers to it")
        with mock.patch.object(router, "delete_remediation_rule", side_effect=error), \
                mock.patch.object(router, "get_pool"):
            with self.assertRaises(HTTPException) as raised:
                await router.delete_remediation_rule_endpoint(1, "test")
        self.assertEqual(raised.exception.status_code, 409)

    async def test_unknown_package_is_still_404(self):
        async def not_found(*_):
            return False
        with mock.patch.object(router, "delete_remediation_package", side_effect=not_found), \
                mock.patch.object(router, "get_pool"):
            with self.assertRaises(HTTPException) as raised:
                await router.delete_remediation_package_endpoint(1, "test")
        self.assertEqual(raised.exception.status_code, 404)


class _Conn:
    def __init__(self, rows):
        self.rows = rows

    async def fetch(self, *_):
        return self.rows

    async def fetchrow(self, *_):
        return None  # no existing job


class _Pool:
    def __init__(self, rows):
        self.conn = _Conn(rows)

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class DryRunTests(unittest.IsolatedAsyncioTestCase):
    async def scan(self, dry_run):
        rows = [{"vulnerability_id": i, "node_id": "n1", "software_name": "7-Zip",
                 "software_version": "15.14", "cve_id": f"CVE-2026-{i}", "severity": "HIGH"}
                for i in range(3)]
        engine = remediation.RemediationEngine(_Pool(rows))
        fix = {"id": 1, "name": "7-Zip", "fix_method": "winget"}
        rule = {"id": 1, "name": "high", "require_approval": True}
        with mock.patch.object(engine, "find_fix_for_vulnerability", return_value=fix), \
                mock.patch.object(engine, "get_matching_rule", return_value=rule), \
                mock.patch.object(remediation, "create_remediation_job", side_effect=_job) as create:
            return await engine.scan_and_create_jobs(dry_run=dry_run), create

    async def test_dry_run_creates_nothing_and_says_so(self):
        result, create = await self.scan(dry_run=True)
        create.assert_not_called()
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["jobs_created"], 0)
        self.assertEqual(result["would_create"], 3)

    async def test_real_run_counts_created_jobs(self):
        result, create = await self.scan(dry_run=False)
        self.assertEqual(create.call_count, 3)
        self.assertFalse(result["dry_run"])
        self.assertEqual(result["jobs_created"], 3)
        self.assertEqual(result["would_create"], 0)


if __name__ == "__main__":
    unittest.main()
