"""Read routes check a permission, not only that some key or session was sent.

`verify_api_key` accepts the shared agent key (stored on every managed machine) and any signed-in
user. A review found about 150 GET routes – exports, reports, job outputs, alert rules, security
and file events, metrics, the agent monitor, SQL Server, content lifecycle … – that checked nothing
else. They now need a read permission that the roles using those pages have; the routes the agents
read from need an agent permission, which the agent key has.
"""
import unittest
from unittest import mock
from uuid import uuid4

from fastapi.testclient import TestClient

import dependencies
from auth import ROLE_PERMISSIONS, CurrentUser, get_current_user
from dependencies import _permissions_for_scopes, verify_api_key
from main import app

ID = "00000000-0000-0000-0000-000000000000"
# Read routes with data the agent key must not see
SENSITIVE = (
    "/api/v1/export/nodes", "/api/v1/export/nodes/excel", "/api/v1/export/software", "/api/v1/export/jobs/excel",
    "/api/v1/export/vulnerabilities/excel", "/api/v1/export/compliance",
    "/api/v1/reports/fleet/pdf", "/api/v1/reports/security/pdf", "/api/v1/reports/executions",
    f"/api/v1/reports/executions/{ID}/download",
    "/api/v1/jobs", f"/api/v1/jobs/{ID}", "/api/v1/jobs/failures",
    "/api/v1/alert-rules", "/api/v1/alert-history",
    "/api/v1/security/events", "/api/v1/security/file-events", "/api/v1/security/evidence/export",
    "/api/v1/events", "/api/v1/events/files", "/api/v1/nodes/HOST/eventlog",
    "/api/v1/metrics/summary", "/api/v1/metrics/fleet", "/api/v1/nodes/HOST/metrics",
    "/api/v1/admin/agent-status", "/api/v1/admin/agent-activity",
    "/api/v1/mssql/configs", "/api/v1/mssql/instances", "/api/v1/content/repositories",
    "/api/v1/pending-nodes", "/api/v1/dashboard/summary", "/api/v1/services", "/api/v1/metering/catalog",
    "/api/v1/repo/files", "/api/v1/deployments", "/api/v1/remediation/summary",
)
# Read by the agents (src/OctofleetAgent.Service, linux-agent/agent.sh)
AGENT_READS = (
    "/api/v1/terminal/pending/HOST", "/api/v1/shell/pending/HOST", "/api/v1/screen/pending/HOST",
    f"/api/v1/packages/{ID}/versions/{ID}/detect", f"/api/v1/packages/{ID}/versions/{ID}/download-info",
    "/api/v1/nodes/HOST/deployments", "/api/v1/nodes/HOST/service-assignments",
    "/api/v1/monitoring/nodes/HOST/effective-policy",
)
# Pages and widgets of each role (sidebar, dashboard, tasks, notifications, export menu)
EVERY_ROLE = (
    "/api/v1/dashboard/summary", "/api/v1/alert-history", "/api/v1/jobs", "/api/v1/jobs/failures",
    "/api/v1/pending-nodes", "/api/v1/events/stats", "/api/v1/metrics/summary", "/api/v1/security/dashboard",
    "/api/v1/security/policies", "/api/v1/monitoring/profiles", "/api/v1/monitoring/assignments",
    "/api/v1/monitoring/defaults", "/api/v1/retention", "/api/v1/findings", "/api/v1/security/events",
    "/api/v1/events", "/api/v1/events/files", "/api/v1/compliance/summary", "/api/v1/baselines",
    "/api/v1/evidence/exports", "/api/v1/mssql/cumulative-updates", "/api/v1/metering/dashboard",
    "/api/v1/software/compare", "/api/v1/export/nodes", "/api/v1/export/vulnerabilities/excel",
    "/api/v1/export/compliance", "/api/v1/export/jobs/excel", "/api/v1/export/software",
    "/api/v1/remediation/summary", "/api/v1/nodes/HOST/eventlog", "/api/v1/inventory/browser/HOST/critical",
    f"/api/v1/agents/{ID}/capabilities",
)
REPORTS = ("/api/v1/reports/catalog", "/api/v1/reports/executions", "/api/v1/reports/executive-dashboard",
           "/api/v1/mssql/backup-ampel")
VIEWER_AND_OPERATOR = ("/api/v1/packages", "/api/v1/deployments", "/api/v1/repo/files", "/api/v1/alert-rules",
                       "/api/v1/nodes/HOST/metrics/history", "/api/v1/metrics/fleet")
STREAMS = ("/api/v1/admin/agent-live", "/api/v1/remediation/live", "/api/v1/live/HOST",
           f"/api/v1/patches/explorer/deploy-stream/{ID}")


def _agent_key():
    return CurrentUser("system", "system", _permissions_for_scopes(["agent"]))


def _role(name):
    return lambda: CurrentUser(str(uuid4()), name, ROLE_PERMISSIONS[name])


class ReadRoutePermissionTests(unittest.TestCase):
    def setUp(self):
        # Some routers still run verify_api_key first; let it pass so the permission check decides.
        app.dependency_overrides[verify_api_key] = lambda: {"sub": "user"}

    def tearDown(self):
        app.dependency_overrides.clear()

    def _get(self, path, **kwargs):
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            return client.get(path, **kwargs)
        finally:
            client.close()

    def test_agent_key_cannot_read_sensitive_routes(self):
        app.dependency_overrides[get_current_user] = _agent_key
        for path in SENSITIVE + STREAMS:
            response = self._get(path)
            self.assertEqual(response.status_code, 403, (path, response.text))

    def test_agent_key_reads_what_the_agents_read(self):
        app.dependency_overrides[get_current_user] = _agent_key
        for path in AGENT_READS:
            self.assertNotIn(self._get(path).status_code, (401, 403), path)

    def test_users_without_permissions_cannot_read(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "nobody", [])
        for path in SENSITIVE + AGENT_READS + STREAMS:
            self.assertEqual(self._get(path).status_code, 403, path)

    def test_roles_keep_the_pages_they_see(self):
        for role, paths in (("viewer", EVERY_ROLE + VIEWER_AND_OPERATOR),
                            ("operator", EVERY_ROLE + VIEWER_AND_OPERATOR + REPORTS),
                            ("auditor", EVERY_ROLE + REPORTS)):
            app.dependency_overrides[get_current_user] = _role(role)
            for path in paths:
                self.assertNotIn(self._get(path).status_code, (401, 403), (role, path))

    def test_viewer_cannot_read_reports(self):
        app.dependency_overrides[get_current_user] = _role("viewer")
        for path in REPORTS + ("/api/v1/reports/fleet/pdf",):
            self.assertEqual(self._get(path).status_code, 403, path)

    def test_streams_take_the_session_token_as_query_parameter(self):
        # EventSource cannot send headers: the token comes as ?token= and needs the permission too;
        # the agent key gets 403 even on the job stream (it has jobs:read)
        with mock.patch.object(dependencies, "API_KEY", "test-agent-key"):
            for path in STREAMS:
                self.assertEqual(self._get(path).status_code, 401, path)
                self.assertEqual(self._get(path, params={"token": "not-a-token"}).status_code, 401, path)
                self.assertEqual(self._get(path, params={"token": "test-agent-key"}).status_code, 403, path)


if __name__ == "__main__":
    unittest.main()
