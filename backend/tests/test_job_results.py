"""Routes #298 merged from the unused main.py copies into the routers that run: the agent's job
result (log, duration, alert, patch deployments, 404), smart-install, and the POST /jobs and
POST /deployments options and checks."""

import asyncio
import json
import os
import unittest
import uuid
from pathlib import Path
from unittest import mock

import asyncpg
from fastapi import HTTPException

import job_results
from auth import CurrentUser
from routers import deployments
from routers import jobs as router

ADMIN = CurrentUser("u-1", "admin", ["*"], True)


class OutputParsingTests(unittest.TestCase):
    def test_vm_mac_address(self):
        self.assertEqual(job_results.vm_mac_address('{"success": true, "macAddress": "00:15:5d:01:02:0a"}'),
                         "00:15:5D:01:02:0A")
        self.assertIsNone(job_results.vm_mac_address("VM created"))
        self.assertIsNone(job_results.vm_mac_address(None))

    def test_patch_install_output(self):
        out = job_results.patch_install_output('{"installed": ["KB1"], "failed": [], "reboot_required": true}')
        self.assertEqual(out["installed"], ["KB1"])
        self.assertEqual(job_results.patch_install_output("not json"), {})
        self.assertEqual(job_results.patch_install_output("[1, 2]"), {})
        self.assertEqual(job_results.patch_install_output(None), {})

    def test_patch_statuses(self):
        self.assertEqual(job_results.patch_statuses(["a", "b"], {"a"}, False), {"a": "installed", "b": "failed"})
        self.assertEqual(job_results.patch_statuses(["a", "b"], set(), True), {"a": "installed", "b": "installed"})


class SmartInstallCommandTests(unittest.TestCase):
    def test_command_bootstraps_chocolatey_then_installs(self):
        cmd = router.smart_install_command("notepadplusplus")
        self.assertIn("community.chocolatey.org/install.ps1", cmd)
        self.assertTrue(cmd.endswith(";& $c install notepadplusplus -y --no-progress"))

    def test_package_names(self):
        for ok in ("7zip", "nodejs-lts", "dotnet-8.0-runtime", "notepadplusplus.install", "a+b_c"):
            self.assertTrue(router.CHOCO_PACKAGE_NAME.match(ok), ok)
        for bad in ("x; Remove-Item C:\\", "x y", "$(calc)", "-force", "", "x`n"):
            self.assertFalse(router.CHOCO_PACKAGE_NAME.match(bad), bad)


class JobOptionTests(unittest.TestCase):
    def test_job_time(self):
        self.assertIsNone(router.job_time({}, "scheduledAt"))
        t = router.job_time({"scheduledAt": "2026-12-01T08:00:00Z"}, "scheduledAt")
        self.assertEqual((t.hour, t.utcoffset().total_seconds()), (8, 0))
        self.assertIsNotNone(router.job_time({"expiresAt": "2026-12-01T08:00:00"}, "expiresAt").tzinfo)
        with self.assertRaises(HTTPException) as e:
            router.job_time({"expiresAt": "tomorrow"}, "expiresAt")
        self.assertEqual(e.exception.status_code, 400)

    def test_job_int(self):
        self.assertEqual(router.job_int({}, "priority", 5, 0), 5)
        self.assertEqual(router.job_int({"priority": 1}, "priority", 5, 0), 1)
        for bad in (-1, "1", 1.5, True):
            with self.assertRaises(HTTPException):
                router.job_int({"priority": bad}, "priority", 5, 0)


class _NoPool:
    def acquire(self):
        raise AssertionError("checked before touching the database")


class RequestCheckTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_target_type_and_missing_tag(self):
        for body in ({"targetType": "node"}, {"targetType": "tag"}, {"targetType": "all", "priority": -1},
                     {"targetType": "all", "scheduledAt": "soon"}):
            with self.assertRaises(HTTPException) as e:
                await router.create_job(body, db=_NoPool(), _user=ADMIN)
            self.assertEqual(e.exception.status_code, 400, body)

    async def test_deployment_target_type_mode_and_target(self):
        base = {"name": "d", "packageVersionId": str(uuid.uuid4())}
        for body in ({"targetType": "device"}, {"targetType": "all", "mode": "optional"},
                     {"targetType": "node"}, {"targetType": "group", "targetId": ""}):
            with self.assertRaises(HTTPException) as e:
                await deployments.create_deployment({**base, **body}, db=_NoPool())
            self.assertEqual(e.exception.status_code, 400, body)

    async def test_invalid_instance_id_is_404(self):
        with self.assertRaises(HTTPException) as e:
            await router.submit_job_result("not-a-uuid", {"success": True}, db=_NoPool())
        self.assertEqual(e.exception.status_code, 404)

    async def test_invalid_package_name_is_400(self):
        with self.assertRaises(HTTPException) as e:
            await router.smart_install(router.SmartInstallRequest(package="git; calc", targets=["x"]),
                                       db=_NoPool(), user=ADMIN)
        self.assertEqual(e.exception.status_code, 400)


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "requires isolated TimescaleDB")
class JobResultDatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.admin = await asyncpg.connect(os.environ["TEST_DATABASE_URL"])
        self.name = "jobresult_" + uuid.uuid4().hex
        await self.admin.execute(f'CREATE DATABASE "{self.name}"')
        self.pool = await asyncpg.create_pool(os.environ["TEST_DATABASE_URL"], database=self.name,
                                              min_size=1, max_size=2)
        async with self.pool.acquire() as conn:
            await conn.execute((Path(__file__).parents[1] / "schema-full.sql").read_text())
            self.node = str(await conn.fetchval(
                "INSERT INTO nodes (node_id, hostname) VALUES ('win-a', 'HOST-A') RETURNING id"))

    async def asyncTearDown(self):
        await self.pool.close()
        await self.admin.execute(f'DROP DATABASE "{self.name}" WITH (FORCE)')
        await self.admin.close()

    async def instance(self, conn, command_type="run", command_data=None, name="job", started_secs_ago=None):
        job = await conn.fetchval("""INSERT INTO jobs (name, target_type, command_type, command_data)
                                     VALUES ($1, 'device', $2, $3::jsonb) RETURNING id""",
                                  name, command_type, json.dumps(command_data or {}))
        return str(await conn.fetchval("""
            INSERT INTO job_instances (job_id, node_id, status, started_at)
            VALUES ($1, $2, 'running', NOW() - make_interval(secs => $3)) RETURNING id
        """, job, self.node, started_secs_ago))

    async def test_unknown_instance_is_404(self):
        with self.assertRaises(HTTPException) as e:
            await router.submit_job_result(str(uuid.uuid4()), {"success": True}, db=self.pool)
        self.assertEqual(e.exception.status_code, 404)

    async def test_success_stores_output_duration_and_log(self):
        async with self.pool.acquire() as conn:
            inst = await self.instance(conn, started_secs_ago=2.5)
        with mock.patch.object(router.alert_notify, "trigger_alert") as alert:
            body = await router.submit_job_result(inst, {"success": True, "exitCode": 0, "stdout": "x" * 60000},
                                                  db=self.pool)
        self.assertEqual(body, {"status": "success", "instanceId": inst})
        alert.assert_not_called()
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM job_instances WHERE id = $1", uuid.UUID(inst))
            logs = await conn.fetch("SELECT level, message FROM job_logs WHERE instance_id = $1", uuid.UUID(inst))
        self.assertEqual((row["status"], row["exit_code"], len(row["stdout"])), ("success", 0, 50000))
        self.assertIsNone(row["stderr"])
        self.assertGreaterEqual(row["duration_ms"], 2500)
        self.assertEqual([tuple(r) for r in logs], [("info", "Job completed: exit_code=0")])

    async def test_failure_is_not_retried_and_alerts(self):
        async with self.pool.acquire() as conn:
            inst = await self.instance(conn, name="Nightly script")
        sent = []

        async def trigger_alert(pool, event_type, data):
            sent.append((event_type, data))
        with mock.patch.object(router.alert_notify, "trigger_alert", trigger_alert):
            body = await router.submit_job_result(inst, {"status": "failed", "exitCode": 2, "stderr": "boom",
                                                         "errorMessage": "script failed", "durationMs": 1234},
                                                  db=self.pool)
            await asyncio.gather(*router._alert_tasks)
        self.assertEqual(body["status"], "failed")
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM job_instances WHERE id = $1", uuid.UUID(inst))
        self.assertEqual((row["status"], row["attempt"], row["error_message"], row["duration_ms"]),
                         ("failed", 1, "script failed", 1234))
        self.assertEqual(sent, [("job_failed", {
            "message": "Job 'Nightly script' failed on HOST-A", "job_name": "Nightly script", "hostname": "HOST-A",
            "exit_code": 2, "error": "script failed"})])

    async def test_patch_deployment_results(self):
        async with self.pool.acquire() as conn:
            kb1, kb2 = [str(await conn.fetchval(
                "INSERT INTO patch_catalog (kb_id, title) VALUES ($1, $1) RETURNING id", kb)) for kb in ("KB1", "KB2")]
            dep = str(await conn.fetchval(
                "INSERT INTO patch_deployments (name, status) VALUES ('d', 'in_progress') RETURNING id"))
            for p in (kb1, kb2):
                await conn.execute("""INSERT INTO patch_deployment_results (deployment_id, node_id, patch_id)
                                      VALUES ($1, $2, $3)""", uuid.UUID(dep), self.node, uuid.UUID(p))
                await conn.execute("INSERT INTO patch_catalog_nodes (patch_id, node_id) VALUES ($1, $2)",
                                   uuid.UUID(p), self.node)
            inst = await self.instance(conn, "patch_install", {"deployment_id": dep, "patches": [kb1, kb2]})
        stdout = json.dumps({"installed": ["KB1"], "failed": ["KB2"], "reboot_required": True})
        with mock.patch.object(router.alert_notify, "trigger_alert"):
            await router.submit_job_result(inst, {"success": False, "exitCode": 1, "stdout": stdout}, db=self.pool)
            await asyncio.gather(*router._alert_tasks)
        async with self.pool.acquire() as conn:
            results = {str(r["patch_id"]): r["status"] for r in await conn.fetch(
                "SELECT patch_id, status FROM patch_deployment_results")}
            nodes = {str(r["patch_id"]): r["status"] for r in await conn.fetch(
                "SELECT patch_id, status FROM patch_catalog_nodes")}
            deployment = await conn.fetchval("SELECT status FROM patch_deployments")
        self.assertEqual(results, {kb1: "installed", kb2: "failed"})
        self.assertEqual(nodes, {kb1: "installed", kb2: "failed"})
        self.assertEqual(deployment, "completed")

    async def test_fleet_update_result_touches_no_deployment(self):
        """Fleet updates (kb_ids / packages without a deployment) are read from job_instances only."""
        async with self.pool.acquire() as conn:
            dep = await conn.fetchval("INSERT INTO patch_deployments (name, status) VALUES ('d', 'in_progress') RETURNING id")
            inst = await self.instance(conn, "patch_install", {"kb_ids": ["KB1"], "reboot_policy": "no_reboot"})
        await router.submit_job_result(inst, {"success": True, "exitCode": 0, "stdout": '{"installed": ["KB1"]}'},
                                       db=self.pool)
        async with self.pool.acquire() as conn:
            self.assertEqual(await conn.fetchval("SELECT status FROM patch_deployments WHERE id = $1", dep), "in_progress")
            self.assertEqual(await conn.fetchval("SELECT status FROM job_instances"), "success")

    async def test_smart_install_creates_a_job_per_node(self):
        with mock.patch.object(router.agent_wait, "notify") as notify:
            body = await router.smart_install(router.SmartInstallRequest(package="Notepad++", targets=["host-a", "nope"]),
                                              db=self.pool, user=ADMIN)
        self.assertEqual((body["chocoPackage"], body["jobsCreated"], body["totalTargets"]), ("notepadplusplus", 1, 2))
        self.assertEqual(body["results"][1]["status"], "error")
        notify.assert_called_once_with([self.node, "win-a"], "jobs")
        async with self.pool.acquire() as conn:
            job = await conn.fetchrow("SELECT * FROM jobs")
            inst = await conn.fetchrow("SELECT node_id, status FROM job_instances")
        self.assertEqual((job["command_type"], job["timeout_seconds"], job["created_by"]), ("run", 600, "admin"))
        self.assertIn("install notepadplusplus -y", json.loads(job["command_data"])["command"])
        self.assertEqual(tuple(inst), (self.node, "pending"))

    async def test_create_job_with_tag_and_options(self):
        async with self.pool.acquire() as conn:
            tag = await conn.fetchval("INSERT INTO tags (name) VALUES ('web') RETURNING id")
            await conn.execute("INSERT INTO device_tags (node_id, tag_id) VALUES ($1, $2)", uuid.UUID(self.node), tag)
        body = await router.create_job({"name": "j", "targetType": "tag", "targetTag": "web", "commandType": "run",
                                        "commandData": {"command": "hostname"}, "priority": 1,
                                        "scheduledAt": "2026-12-01T08:00:00Z", "expiresAt": "2026-12-02T08:00:00Z",
                                        "timeoutSeconds": 900}, db=self.pool, _user=ADMIN)
        self.assertEqual(body["instances"], 1)
        async with self.pool.acquire() as conn:
            job = await conn.fetchrow("SELECT * FROM jobs")
            self.assertEqual(await conn.fetchval("SELECT node_id FROM job_instances"), self.node)
        self.assertEqual((job["target_tag"], job["priority"], job["timeout_seconds"]), ("web", 1, 900))
        self.assertEqual((job["scheduled_at"].isoformat(), job["expires_at"].day), ("2026-12-01T08:00:00+00:00", 2))

    async def test_deployment_of_unknown_package_version_is_404(self):
        with self.assertRaises(HTTPException) as e:
            await deployments.create_deployment({"name": "d", "packageVersionId": str(uuid.uuid4()),
                                                 "targetType": "all"}, db=self.pool)
        self.assertEqual(e.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
