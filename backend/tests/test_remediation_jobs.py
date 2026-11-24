"""Remediation (#197): one job per node and update with the CVEs it closes, no duplicates on a
rescan, and the fix command (winget ID, --architecture x86, quoted display names)."""

import os
import unittest
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from unittest import mock

import asyncpg
from pydantic import ValidationError

import remediation
from routers import remediation as router
from routers.inventory import software_architecture


def finding(cve, software="7-Zip 15.14", version="15.14", node="n1", severity="HIGH", vid=None, arch=None):
    return {"vulnerability_id": vid if vid is not None else int(cve.rsplit("-", 1)[-1]), "node_id": node,
            "software_name": software, "software_version": version, "cve_id": cve,
            "severity": severity, "architecture": arch}


class GroupFindingsTests(unittest.TestCase):
    def test_one_group_per_node_and_application_version(self):
        rows = [finding(f"CVE-2026-{i}") for i in range(21)]  # 7-Zip with 21 CVEs
        rows += [finding("CVE-2026-100", node="n2"), finding("CVE-2026-101", software="Notepad++", version="8.1")]
        groups = remediation.group_findings(rows)
        self.assertEqual(len(groups), 3)
        seven_zip = groups[0]
        self.assertEqual(seven_zip["cve_ids"], [f"CVE-2026-{i}" for i in range(21)])
        self.assertEqual(seven_zip["vulnerability_ids"], list(range(21)))
        # the first row (highest CVSS) stays the job's main CVE
        self.assertEqual((seven_zip["cve_id"], seven_zip["vulnerability_id"]), ("CVE-2026-0", 0))

    def test_highest_severity_and_architecture_of_the_group(self):
        rows = [finding("CVE-2026-1", severity="MEDIUM"), finding("CVE-2026-2", severity="CRITICAL", arch="x86"),
                finding("CVE-2026-2"), finding("CVE-2026-3", severity="LOW")]
        [group] = remediation.group_findings(rows)
        self.assertEqual(group["severity"], "CRITICAL")
        self.assertEqual(group["architecture"], "x86")
        self.assertEqual(group["cve_ids"], ["CVE-2026-1", "CVE-2026-2", "CVE-2026-3"])  # no duplicates


class _Conn:
    def __init__(self, rows, existing):
        self.rows, self.existing = rows, existing
        self.inserted, self.updates, self.locks = [], [], []

    async def fetch(self, query, *args):
        if "verified_vulnerabilities" in query:
            return self.rows
        node, software, version, statuses = args
        return [j for j in self.existing if (j["node_id"], j["software_name"], j["software_version"]) ==
                (node, software, version) and j["status"] in statuses]

    async def fetchrow(self, query, *args):
        assert "INSERT INTO remediation_jobs" in query
        self.inserted.append(args)
        return {"id": 100 + len(self.inserted)}

    async def execute(self, query, *args):
        if "pg_advisory_xact_lock" in query:
            self.locks.append(args[0])
        else:
            self.updates.append(args)

    @asynccontextmanager
    async def transaction(self):
        yield


class _Pool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


FIX = {"id": 7, "name": "7-Zip (winget)", "fix_method": "winget"}
RULE = {"id": 3, "name": "high", "require_approval": True}


class ScanTests(unittest.IsolatedAsyncioTestCase):
    async def scan(self, rows, existing=(), dry_run=False):
        conn = _Conn(rows, list(existing))
        engine = remediation.RemediationEngine(_Pool(conn))
        with mock.patch.object(engine, "find_fix_for_vulnerability", return_value=FIX), \
                mock.patch.object(engine, "get_matching_rule", return_value=RULE) as rule:
            result = await engine.scan_and_create_jobs(dry_run=dry_run)
        return result, conn, rule

    async def test_21_cves_of_one_update_give_one_job(self):
        rows = [finding(f"CVE-2026-{i}", arch="x86") for i in range(21)]
        result, conn, rule = await self.scan(rows)
        self.assertEqual(result["jobs_created"], 1)
        self.assertEqual(result["with_fix_available"], 21)
        self.assertEqual(len(conn.inserted), 1)
        args = conn.inserted[0]
        # vulnerability_id, package, rule, node, software, version, cve_id, status, requires_approval,
        # cve_ids, vulnerability_ids, architecture
        self.assertEqual(args[:9], (0, 7, 3, "n1", "7-Zip 15.14", "15.14", "CVE-2026-0", "pending", True))
        self.assertEqual(args[9], [f"CVE-2026-{i}" for i in range(21)])
        self.assertEqual(args[10], list(range(21)))
        self.assertEqual(args[11], "x86")
        detail = result["details"][0]
        self.assertEqual((detail["cve"], detail["cve_count"], detail["job_id"]), ("CVE-2026-0", 21, 101))
        self.assertEqual(len(detail["cves"]), 21)
        rule.assert_called_once()  # once per update, not per CVE
        self.assertEqual(conn.locks, ["remediation:n1:7-Zip 15.14:15.14"])

    async def test_approval_stays_required_by_default(self):
        self.assertTrue(remediation.RemediationRuleCreate(name="r", min_severity="HIGH").require_approval)
        _, conn, _ = await self.scan([finding("CVE-2026-1")])
        self.assertEqual(conn.inserted[0][7:9], ("pending", True))

    async def test_dry_run_counts_updates_and_writes_nothing(self):
        rows = [finding(f"CVE-2026-{i}") for i in range(5)] + [finding("CVE-2026-9", node="n2")]
        result, conn, _ = await self.scan(rows, dry_run=True)
        self.assertEqual((result["would_create"], result["jobs_created"]), (2, 0))
        self.assertEqual(conn.inserted, [])

    async def test_rescan_while_a_job_waits_creates_no_second_job(self):
        existing = [{"id": 5, "node_id": "n1", "software_name": "7-Zip 15.14", "software_version": "15.14",
                     "status": "pending", "cve_ids": ["CVE-2026-1", "CVE-2026-2"]}]
        rows = [finding("CVE-2026-1"), finding("CVE-2026-2")]
        result, conn, _ = await self.scan(rows, existing)
        self.assertEqual((result["jobs_created"], result["jobs_skipped_existing"], result["cves_added"]), (0, 1, 0))
        self.assertEqual((conn.inserted, conn.updates), ([], []))

    async def test_a_new_cve_is_added_to_the_waiting_job(self):
        existing = [{"id": 5, "node_id": "n1", "software_name": "7-Zip 15.14", "software_version": "15.14",
                     "status": "approved", "cve_ids": ["CVE-2026-1"]}]
        rows = [finding("CVE-2026-1"), finding("CVE-2026-2")]
        result, conn, _ = await self.scan(rows, existing)
        self.assertEqual((result["jobs_created"], result["cves_added"]), (0, 1))
        self.assertEqual(conn.updates, [(5, ["CVE-2026-2"], [2])])
        # a dry run only counts it
        result, conn, _ = await self.scan(rows, existing, dry_run=True)
        self.assertEqual((result["cves_added"], conn.updates), (1, []))

    async def test_older_jobs_one_per_cve_block_a_new_job(self):
        existing = [{"id": i, "node_id": "n1", "software_name": "7-Zip 15.14", "software_version": "15.14",
                     "status": "pending", "cve_ids": [f"CVE-2026-{i}"]} for i in range(3)]
        result, conn, _ = await self.scan([finding(f"CVE-2026-{i}") for i in range(3)], existing)
        self.assertEqual((result["jobs_created"], result["jobs_skipped_existing"]), (0, 1))
        self.assertEqual(conn.inserted, [])

    async def test_done_job_blocks_but_gets_no_new_cves(self):
        existing = [{"id": 5, "node_id": "n1", "software_name": "7-Zip 15.14", "software_version": "15.14",
                     "status": "success", "cve_ids": ["CVE-2026-1"]}]
        result, conn, _ = await self.scan([finding("CVE-2026-1"), finding("CVE-2026-2")], existing)
        self.assertEqual((result["jobs_created"], result["cves_added"], conn.updates), (0, 0, []))

    async def test_failed_job_allows_a_new_one(self):
        # failed and rolled-back jobs are not looked up (status filter), so a new job is created
        self.assertNotIn("failed", remediation.OPEN_OR_DONE_JOB_STATUSES)
        self.assertNotIn("rolled_back", remediation.OPEN_OR_DONE_JOB_STATUSES)
        existing = [{"id": 5, "node_id": "n1", "software_name": "7-Zip 15.14", "software_version": "15.14",
                     "status": "failed", "cve_ids": ["CVE-2026-1"]}]
        result, _, _ = await self.scan([finding("CVE-2026-1")], existing)
        self.assertEqual(result["jobs_created"], 1)

    async def test_another_version_gets_its_own_job(self):
        existing = [{"id": 5, "node_id": "n1", "software_name": "7-Zip 15.14", "software_version": "15.14",
                     "status": "success", "cve_ids": ["CVE-2026-1"]}]
        rows = [finding("CVE-2026-7", software="7-Zip 23.01", version="23.01")]
        result, _, _ = await self.scan(rows, existing)
        self.assertEqual(result["jobs_created"], 1)


class FixCommandTests(unittest.TestCase):
    def test_winget_id_and_architecture(self):
        self.assertEqual(remediation.build_fix_command("winget", None, "7zip.7zip", "7-Zip 15.14"),
                         "winget upgrade --id 7zip.7zip --exact --silent --accept-source-agreements")
        self.assertEqual(remediation.build_fix_command("winget", None, "Notepad++.Notepad++", "Notepad++ (32-bit x86)", "x86"),
                         "winget upgrade --id Notepad++.Notepad++ --exact --architecture x86 --silent --accept-source-agreements")

    def test_without_winget_id_the_display_name_is_used_quoted(self):
        self.assertEqual(remediation.build_fix_command("winget", None, None, "7-Zip 15.14"),
                         "winget upgrade --name '7-Zip 15.14' --silent --accept-source-agreements")
        self.assertEqual(remediation.build_fix_command("winget", "", None, "App", "x86"),
                         "winget upgrade --name 'App' --architecture x86 --silent --accept-source-agreements")

    def test_names_from_the_inventory_cannot_break_out_of_the_quotes(self):
        name = "Evil'; Remove-Item C:\\ -Recurse; '\u2019x"
        cmd = remediation.build_fix_command("winget", None, None, name)
        self.assertEqual(cmd, "winget upgrade --name 'Evil''; Remove-Item C:\\ -Recurse; ''\u2019\u2019x'"
                              " --silent --accept-source-agreements")
        self.assertEqual(remediation.build_fix_command("choco", None, None, "a'b"), "choco upgrade 'a''b' -y")
        self.assertEqual(remediation.build_fix_command("script", None, None, "a'b"), "echo 'No fix command for a''b'")

    def test_a_fix_command_is_used_as_it_is(self):
        cmd = "winget upgrade --id 7zip.7zip --silent"
        self.assertEqual(remediation.build_fix_command("winget", cmd, "Other.Id", "7-Zip", "x86"), cmd)

    def test_winget_id_is_validated(self):
        ok = remediation.RemediationPackageCreate(name="n", target_software="7-Zip", fix_method="winget",
                                                  winget_id="Notepad++.Notepad++")
        self.assertEqual(ok.winget_id, "Notepad++.Notepad++")
        self.assertIsNone(remediation.RemediationPackageCreate(name="n", target_software="t", fix_method="winget").winget_id)
        for bad in ("", "7zip.7zip; calc", "a b", "'x'", "-flag", "x" * 129):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                remediation.RemediationPackageUpdate(winget_id=bad)

    def test_one_click_command_matches_the_agent_command(self):
        engine = remediation.RemediationEngine(None)
        job = {"software_name": "Notepad++", "architecture": "x86"}
        pkg = {"fix_method": "winget", "fix_command": None, "winget_id": "Notepad++.Notepad++"}

        async def run():
            return await engine.generate_fix_command(job, pkg)
        import asyncio
        self.assertEqual(asyncio.run(run()), remediation.build_fix_command("winget", None, "Notepad++.Notepad++",
                                                                           "Notepad++", "x86"))


class ArchitectureTests(unittest.TestCase):
    def test_32_bit_programs(self):
        wow = "LocalMachine\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Notepad++"
        self.assertEqual(software_architecture({"registryKey": wow}), "x86")
        self.assertEqual(software_architecture({"installPath": "C:\\Program Files (x86)\\Notepad++"}), "x86")
        self.assertEqual(software_architecture({"installLocation": "C:\\Program Files (x86)"}), "x86")

    def test_64_bit_and_unknown(self):
        key = "LocalMachine\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7-Zip"
        self.assertIsNone(software_architecture({"registryKey": key, "installPath": "C:\\Program Files\\7-Zip\\"}))
        self.assertIsNone(software_architecture({"name": "openssl"}))  # Linux packages


class _PollConn:
    def __init__(self, jobs):
        self.jobs = jobs

    async def fetchrow(self, *_):
        return {"id": "node-uuid"}

    async def fetch(self, *_):
        return self.jobs

    async def fetchval(self, _query, job_id):
        return job_id  # claimed


class PendingJobsTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_gets_the_cve_list_and_the_built_command(self):
        base = {"cve_id": "CVE-2026-1", "software_name": "Notepad++", "software_version": "8.1",
                "fix_method": "winget", "fix_command": None, "package_name": "npp", "maintenance_window_only": False}
        jobs = [{**base, "id": 1, "winget_id": "Notepad++.Notepad++", "architecture": "x86",
                 "cve_ids": ["CVE-2026-1", "CVE-2026-2"]},
                # a job from before: no CVE list, package without winget ID
                {**base, "id": 2, "winget_id": None, "architecture": None, "cve_ids": None}]
        conn = _PollConn(jobs)
        pool = mock.Mock()

        @asynccontextmanager
        async def acquire():
            yield conn
        pool.acquire = acquire
        with mock.patch.object(router, "get_pool", return_value=pool):
            result = await router.get_pending_remediation_jobs("win-host")
        self.assertEqual(result["count"], 2)
        first, second = result["jobs"]
        self.assertEqual(first["cveId"], "CVE-2026-1")
        self.assertEqual(first["cveIds"], ["CVE-2026-1", "CVE-2026-2"])
        self.assertEqual(first["fixCommand"], "winget upgrade --id Notepad++.Notepad++ --exact --architecture x86 "
                                              "--silent --accept-source-agreements")
        self.assertEqual(second["cveIds"], ["CVE-2026-1"])
        self.assertEqual(second["fixCommand"], "winget upgrade --name 'Notepad++' --silent --accept-source-agreements")


class _OneClickConn:
    async def fetchrow(self, *_):
        return {"id": 1, "software_name": "Notepad++", "software_version": "8.1", "cve_id": "CVE-2026-1"}

    async def fetch(self, *_):
        return [{"id": 2, "cve_id": "CVE-2026-2"}, {"id": 3, "cve_id": "CVE-2026-3"}]

    async def fetchval(self, *_):
        return "x86"


class OneClickTests(unittest.IsolatedAsyncioTestCase):
    async def test_one_click_job_lists_all_cves_of_the_update(self):
        conn = _OneClickConn()
        pool = mock.Mock()

        @asynccontextmanager
        async def acquire():
            yield conn
        pool.acquire = acquire
        pkg = {"id": 7, "fix_method": "winget", "fix_command": None, "winget_id": "Notepad++.Notepad++"}
        with mock.patch.object(router, "get_pool", return_value=pool), \
                mock.patch.object(remediation.RemediationEngine, "find_fix_for_vulnerability", return_value=pkg), \
                mock.patch.object(router, "create_remediation_job",
                                  side_effect=lambda *_, **kw: {"id": 9, **kw}) as create:
            result = await router.one_click_fix(1, "node-uuid", "test")
        kwargs = create.call_args.kwargs
        self.assertEqual(kwargs["cve_ids"], ["CVE-2026-1", "CVE-2026-2", "CVE-2026-3"])
        self.assertEqual(kwargs["vulnerability_ids"], [1, 2, 3])
        self.assertFalse(kwargs["requires_approval"])
        self.assertEqual(result["command"], "winget upgrade --id Notepad++.Notepad++ --exact --architecture x86 "
                                            "--silent --accept-source-agreements")


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "requires isolated TimescaleDB")
class RemediationDatabaseTests(unittest.IsolatedAsyncioTestCase):
    """The SQL of the scan, the upgrade of older jobs and the agent poll on a real database."""

    async def asyncSetUp(self):
        self.admin = await asyncpg.connect(os.environ["TEST_DATABASE_URL"])
        self.name = "remediation_" + uuid.uuid4().hex
        await self.admin.execute(f'CREATE DATABASE "{self.name}"')
        self.pool = await asyncpg.create_pool(os.environ["TEST_DATABASE_URL"], database=self.name,
                                              min_size=1, max_size=4)
        async with self.pool.acquire() as conn:
            await conn.execute((Path(__file__).parents[1] / "schema-full.sql").read_text())
            # an installation from before #197
            await conn.execute("ALTER TABLE remediation_jobs DROP COLUMN cve_ids, DROP COLUMN vulnerability_ids, "
                               "DROP COLUMN architecture")
            await conn.execute("ALTER TABLE remediation_packages DROP COLUMN winget_id")

    async def asyncTearDown(self):
        await self.pool.close()
        await self.admin.execute(f'DROP DATABASE "{self.name}" WITH (FORCE)')
        await self.admin.close()

    async def test_one_job_per_update_from_scan_to_agent_poll(self):
        async with self.pool.acquire() as conn:
            node = await conn.fetchval("INSERT INTO nodes (node_id, hostname, os_name) "
                                       "VALUES ('REMED-1', 'REMED-1', 'Windows Server 2025') RETURNING id")
            await conn.execute("INSERT INTO software_current (node_id, name, version) VALUES ($1, 'Notepad++', '8.1')",
                               node)
            old_vuln = await conn.fetchval("""INSERT INTO vulnerabilities (software_name, software_version, cve_id,
                severity, cvss_score, match_source) VALUES ('Notepad++', '8.1', 'CVE-2026-0001', 'HIGH', 8.0, 'nvd_cpe')
                RETURNING id""")
            # a job from before, one per CVE
            await conn.execute("""INSERT INTO remediation_jobs (vulnerability_id, node_id, software_name,
                software_version, cve_id, status) VALUES ($1, $2, 'Notepad++', '8.1', 'CVE-2026-0001', 'failed')""",
                               old_vuln, node)
        await remediation.ensure_schema(self.pool)
        async with self.pool.acquire() as conn:
            self.assertEqual(await conn.fetchval("SELECT cve_ids FROM remediation_jobs"), ["CVE-2026-0001"])
            await conn.execute("UPDATE software_current SET architecture = 'x86'")
            for i, score in ((2, 9.8), (3, 5.0)):
                await conn.execute("""INSERT INTO vulnerabilities (software_name, software_version, cve_id, severity,
                    cvss_score, match_source) VALUES ('Notepad++', '8.1', $1, $2, $3, 'nvd_cpe')""",
                                   f"CVE-2026-000{i}", "CRITICAL" if score > 9 else "MEDIUM", score)
            await conn.execute("""INSERT INTO remediation_packages (name, target_software, fix_method, winget_id)
                VALUES ('Notepad++ (winget)', 'Notepad++', 'winget', 'Notepad++.Notepad++')""")
            await conn.execute("""INSERT INTO remediation_rules (name, min_severity, maintenance_window_only)
                VALUES ('high', 'HIGH', false)""")

        engine = remediation.RemediationEngine(self.pool)
        result = await engine.scan_and_create_jobs()
        self.assertEqual(result["jobs_created"], 1)
        async with self.pool.acquire() as conn:
            job = await conn.fetchrow("SELECT * FROM remediation_jobs WHERE status != 'failed'")
        self.assertEqual(job["status"], "pending")  # the rule's default: approval required
        self.assertEqual(job["cve_id"], "CVE-2026-0002")  # highest CVSS
        self.assertEqual(job["cve_ids"], ["CVE-2026-0002", "CVE-2026-0001", "CVE-2026-0003"])
        self.assertEqual(job["architecture"], "x86")

        # a rescan while the job waits: no second job; a new CVE is added to it
        self.assertEqual((await engine.scan_and_create_jobs())["jobs_created"], 0)
        async with self.pool.acquire() as conn:
            await conn.execute("""INSERT INTO vulnerabilities (software_name, software_version, cve_id, severity,
                cvss_score, match_source) VALUES ('Notepad++', '8.1', 'CVE-2026-0004', 'HIGH', 7.5, 'nvd_cpe')""")
        again = await engine.scan_and_create_jobs()
        self.assertEqual((again["jobs_created"], again["jobs_skipped_existing"], again["cves_added"]), (0, 1, 1))
        self.assertEqual(len(await remediation.get_remediation_jobs(self.pool)), 2)

        # the agent gets nothing before the approval, then one job with all CVEs and the winget ID
        with mock.patch.object(router, "get_pool", return_value=self.pool):
            self.assertEqual((await router.get_pending_remediation_jobs("win-remed-1"))["count"], 0)
            self.assertEqual(await remediation.approve_remediation_jobs(self.pool, [job["id"]], "admin"), 1)
            polled = await router.get_pending_remediation_jobs("win-remed-1")
        self.assertEqual(polled["count"], 1)
        self.assertEqual(polled["jobs"][0]["cveIds"], ["CVE-2026-0002", "CVE-2026-0001", "CVE-2026-0003",
                                                       "CVE-2026-0004"])
        self.assertEqual(polled["jobs"][0]["fixCommand"], "winget upgrade --id Notepad++.Notepad++ --exact "
                                                          "--architecture x86 --silent --accept-source-agreements")


if __name__ == "__main__":
    unittest.main()
