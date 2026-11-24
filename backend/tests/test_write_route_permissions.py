"""Every route that writes data checks a permission, not only that some key or session was sent.

`verify_api_key` accepts the shared agent key (stored on every managed machine) and any signed-in
user. A review found more than 150 write routes – deployments, the query engine, packages, the
repository, services, MSSQL, security policies, reports … – that checked nothing else. Admin
routes now need a user with the matching permission; the routes the agents push to need an agent
permission (inventory:write, jobs:poll), which the agent key has.
"""
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from route_table import api_routes
from test_route_authentication import OPEN_BY_DESIGN, _dependency_names

from auth import ROLE_PERMISSIONS, CurrentUser, get_current_user
from dependencies import _permissions_for_scopes, verify_api_key
from main import app

# The names of the dependencies that check a permission or an API key scope
PERMISSION_CHECKS = {"permission_checker", "scope_checker", "checker"}

# Any signed-in user, for their own account only
OWN_ACCOUNT_ROUTES = {
    ("POST", "/api/v1/auth/me/password"),
    ("POST", "/api/v1/auth/logout"),
}

ID = "00000000-0000-0000-0000-000000000000"
# (method, path, permission) – a route of each area that only checked for a key before
ADMIN_ROUTES = (
    ("POST", "/api/v1/deployments", "deployments:write"),
    ("PATCH", f"/api/v1/deployments/{ID}", "deployments:write"),
    ("DELETE", f"/api/v1/deployments/{ID}", "deployments:write"),
    ("POST", f"/api/v1/deployments/{ID}/rollout", "deployments:write"),
    ("POST", f"/api/v1/deployments/{ID}/rollout/advance", "deployments:write"),
    ("POST", "/api/v1/query/execute", "query:execute"),
    ("POST", "/api/v1/query/live", "query:execute"),
    ("POST", "/api/v1/query/saved", "query:execute"),
    ("POST", "/api/v1/query/dashboards", "query:execute"),
    ("POST", "/api/v1/query/schedules", "query:execute"),
    ("DELETE", "/api/v1/query/history", "query:execute"),
    ("POST", "/api/v1/mssql/install", "settings:write"),
    ("POST", "/api/v1/mssql/configs", "settings:write"),
    ("POST", "/api/v1/mssql/assignments", "settings:write"),
    ("POST", "/api/v1/mssql/sync-catalog", "settings:write"),
    ("POST", "/api/v1/packages", "packages:write"),
    ("PUT", f"/api/v1/packages/{ID}", "packages:write"),
    ("DELETE", f"/api/v1/packages/{ID}", "packages:write"),
    ("DELETE", f"/api/v1/packages/{ID}/versions/{ID}", "packages:write"),
    ("POST", f"/api/v1/packages/{ID}/versions/{ID}/rules", "packages:write"),
    ("POST", "/api/v1/repo/upload", "packages:write"),
    ("POST", "/api/v1/repo/cache", "packages:write"),
    ("DELETE", f"/api/v1/repo/files/{ID}", "packages:write"),
    ("POST", "/api/v1/services", "settings:write"),
    ("PUT", f"/api/v1/services/{ID}", "settings:write"),
    ("POST", f"/api/v1/services/{ID}/nodes", "settings:write"),
    ("POST", f"/api/v1/services/{ID}/reconcile", "settings:write"),
    ("POST", "/api/v1/service-classes", "settings:write"),
    ("DELETE", f"/api/v1/service-classes/{ID}", "settings:write"),
    ("POST", "/api/v1/security/policies", "settings:write"),
    ("POST", "/api/v1/security/monitoring/profiles", "settings:write"),
    ("POST", "/api/v1/security/monitoring/assignments", "settings:write"),
    ("POST", "/api/v1/security/detection-rules", "settings:write"),
    ("POST", "/api/v1/security/retention/policies", "settings:write"),
    ("POST", "/api/v1/security/retention/holds", "settings:write"),
    ("POST", "/api/v1/security/audit-log", "settings:write"),
    ("POST", "/api/v1/monitoring/profiles", "settings:write"),
    ("POST", "/api/v1/monitoring/assignments", "settings:write"),
    ("PUT", f"/api/v1/findings/{ID}", "alerts:write"),
    ("POST", "/api/v1/evidence/export", "compliance:read"),
    ("POST", "/api/v1/baselines", "settings:write"),
    ("POST", f"/api/v1/baselines/{ID}/evaluate", "settings:write"),
    ("POST", f"/api/v1/baselines/drift/{ID}/acknowledge", "alerts:write"),
    ("POST", f"/api/v1/baselines/drift/{ID}/remediate", "jobs:create"),
    ("POST", "/api/v1/content/repositories", "settings:write"),
    ("POST", f"/api/v1/content/promotion-requests/{ID}/approve", "settings:write"),
    ("POST", "/api/v1/metering/catalog", "packages:write"),
    ("POST", "/api/v1/metering/licenses", "packages:write"),
    ("POST", "/api/v1/reports/execute", "reports:read"),
    ("POST", "/api/v1/reports/schedules", "reports:write"),
    ("POST", f"/api/v1/reports/schedules/{ID}/run-now", "reports:write"),
    ("POST", "/api/v1/tags", "groups:write"),
    ("DELETE", f"/api/v1/tags/{ID}", "groups:write"),
    ("POST", "/api/v1/groups", "groups:write"),
    ("POST", f"/api/v1/groups/{ID}/members", "groups:write"),
    ("POST", f"/api/v1/devices/{ID}/tags", "groups:write"),
    ("POST", "/api/v1/alert-channels", "alerts:write"),
    ("POST", "/api/v1/alert-rules", "alerts:write"),
    ("POST", f"/api/v1/jobs/instances/{ID}/retry", "jobs:execute"),
    ("POST", f"/api/v1/jobs/{ID}/parse-eventlog", "jobs:create"),
    ("POST", "/api/v1/enrollment-tokens", "settings:write"),
    ("DELETE", f"/api/v1/live/{ID}", "nodes:read"),
    # read routes that answered the agent key
    ("GET", "/api/v1/query/history", "query:execute"),
    ("GET", "/api/v1/query/saved", "query:execute"),
    ("GET", "/api/v1/alert-channels", "alerts:read"),
    ("GET", "/api/v1/gateway/logs", "settings:read"),
    ("GET", f"/api/v1/roles/{ID}", "users:read"),
    ("GET", f"/api/v1/roles/{ID}/users", "users:read"),
    ("GET", f"/api/v1/users/{ID}/scopes", "users:read"),
    ("GET", "/api/v1/audit/ui-events", "eventlog:read"),
    ("GET", "/api/v1/security/audit-log", "eventlog:read"),
    ("GET", "/api/v1/live-sessions", "nodes:read"),
)
# Routes the agents (or scripts they start) push to: the agent key keeps working
AGENT_PUSH_ROUTES = (
    ("POST", "/api/v1/nodes/HOST/eventlog"),
    ("POST", "/api/v1/nodes/HOST/metrics"),
    ("POST", f"/api/v1/nodes/HOST/deployments/{ID}/status"),
    ("POST", f"/api/v1/nodes/{ID}/uninstall/complete"),
    ("POST", "/api/v1/posture/snapshots"),
    ("POST", "/api/v1/security/posture/snapshots"),
    ("POST", "/api/v1/security/agent/capabilities"),
    ("POST", "/api/v1/agents/HOST/capabilities"),
    ("POST", "/api/v1/ingest/events"),
    ("POST", "/api/v1/ingest/events/normalized"),
    ("POST", f"/api/v1/services/{ID}/nodes/HOST/status"),
    ("POST", "/api/v1/mssql/backup-history"),
    ("POST", "/api/v1/metering/usage/submit"),
    ("POST", f"/api/v1/jobs/instances/{ID}/start"),
    ("POST", "/api/v1/jobs/result"),
)
PERMISSIONS = sorted({p for _, _, p in ADMIN_ROUTES} | {"inventory:write", "jobs:poll"})


def _agent_key():
    return CurrentUser("system", "system", _permissions_for_scopes(["agent"]))


class WriteRoutePermissionTests(unittest.TestCase):
    def setUp(self):
        # Some routers still run verify_api_key first; let it pass so the permission check decides.
        app.dependency_overrides[verify_api_key] = lambda: {"sub": "user"}

    def tearDown(self):
        app.dependency_overrides.clear()

    def _request(self, method, path):
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            return client.request(method, path, json={})
        finally:
            client.close()

    def test_every_write_route_checks_a_permission(self):
        unchecked = sorted(
            (method, route.path)
            for route in api_routes(app)  # with the routes of the included routers
            for method in route.methods & {"POST", "PUT", "PATCH", "DELETE"}
            if not (_dependency_names(route.dependant, set()) & PERMISSION_CHECKS)
            and (method, route.path) not in OPEN_BY_DESIGN | OWN_ACCOUNT_ROUTES
        )
        self.assertEqual(unchecked, [], "write routes that only check for a key or a session")

    def test_shared_agent_key_cannot_use_admin_routes(self):
        app.dependency_overrides[get_current_user] = _agent_key
        app.dependency_overrides[verify_api_key] = lambda: "agent-key"
        for method, path, _ in ADMIN_ROUTES:
            response = self._request(method, path)
            self.assertEqual(response.status_code, 403, (method, path, response.text))

    def test_admin_routes_need_their_permission(self):
        for method, path, permission in ADMIN_ROUTES:
            app.dependency_overrides[get_current_user] = lambda p=permission: CurrentUser(str(uuid4()), "user", [p])
            self.assertNotIn(self._request(method, path).status_code, (401, 403), (method, path, permission))
            others = [p for p in PERMISSIONS if p != permission]
            app.dependency_overrides[get_current_user] = lambda o=others: CurrentUser(str(uuid4()), "user", o)
            self.assertEqual(self._request(method, path).status_code, 403, (method, path, permission))

    def test_agent_key_passes_the_agent_push_routes(self):
        app.dependency_overrides[get_current_user] = _agent_key
        app.dependency_overrides[verify_api_key] = lambda: "agent-key"
        for method, path in AGENT_PUSH_ROUTES:
            self.assertNotIn(self._request(method, path).status_code, (401, 403), (method, path))

    def test_viewer_cannot_push_agent_data(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "viewer", ROLE_PERMISSIONS["viewer"])
        for method, path in AGENT_PUSH_ROUTES:
            self.assertEqual(self._request(method, path).status_code, 403, (method, path))

    def test_operators_keep_the_pages_they_see(self):
        # Query engine and reports are in the operator's navigation; auditors see the reports.
        operator = set(ROLE_PERMISSIONS["operator"])
        for permission in ("query:execute", "reports:read", "reports:write", "groups:write", "packages:write",
                           "deployments:write", "alerts:write", "jobs:execute", "jobs:create", "compliance:read"):
            self.assertIn(permission, operator)
        self.assertIn("reports:read", ROLE_PERMISSIONS["auditor"])


if __name__ == "__main__":
    unittest.main()
