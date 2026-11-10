"""Every route that writes data needs credentials: the agent key or a user with a permission.

The router refactor in February dropped the agent key from the inventory routes without anyone
noticing; this test fails as soon as a write route has no authentication dependency.
"""
import unittest
from uuid import uuid4

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from auth import CurrentUser, get_current_user
from dependencies import verify_api_key
from main import app

AUTH_DEPENDENCIES = {"verify_api_key", "verify_api_key_or_query", "require_auth", "permission_checker", "scope_checker"}

# Open on purpose. Machine callbacks during provisioning have no agent key yet – a per-task token
# would be the next step; auth/setup only works while no user exists; registration creates pending
# nodes that need approval.
OPEN_BY_DESIGN = {
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/setup"),
    ("POST", "/api/v1/nodes/register"),
    ("POST", "/api/v1/discovered-systems/register"),
    ("POST", "/api/v1/pxe/callback"),
    ("POST", "/api/v1/provisioning/tasks/{mac}/status"),
    ("POST", "/api/v1/provisioning/tasks/{task_id}/events"),
}

ID = "00000000-0000-0000-0000-000000000000"
AGENT_ROUTES = (
    ("POST", "/api/v1/inventory/full"), ("POST", "/api/v1/inventory/hardware"), ("POST", "/api/v1/inventory/software"),
    ("POST", "/api/v1/inventory/hotfixes"), ("POST", "/api/v1/inventory/system"),
    ("POST", f"/api/v1/jobs/instances/{ID}/result"), ("POST", f"/api/v1/remediation/jobs/{ID}/result"),
    ("POST", "/api/v1/agents/HOST/health"), ("POST", "/api/v1/live-data"),
)
# (method, path, permission)
ADMIN_ROUTES = (
    ("PATCH", f"/api/v1/discovered-systems/{ID}", "nodes:write"),
    ("DELETE", f"/api/v1/discovered-systems/{ID}", "nodes:write"),
    ("POST", f"/api/v1/discovered-systems/{ID}/provision", "nodes:write"),
    ("POST", "/api/v1/security/rules", "settings:write"),
    ("PUT", f"/api/v1/security/rules/{ID}", "settings:write"),
    ("DELETE", f"/api/v1/security/rules/{ID}", "settings:write"),
    ("POST", "/api/v1/security/rules/evaluate", "settings:write"),
    ("POST", "/api/v1/security/findings", "alerts:write"),
    ("PUT", f"/api/v1/security/findings/{ID}", "alerts:write"),
    ("DELETE", f"/api/v1/detection-rules/{ID}", "settings:write"),
    ("POST", "/api/v1/software-baselines", "packages:write"),
    ("DELETE", f"/api/v1/software-baselines/{ID}", "packages:write"),
    ("POST", f"/api/v1/software-baselines/{ID}/assign", "packages:write"),
    ("POST", "/api/v1/software-baselines/reconcile", "packages:write"),
    ("POST", "/api/v1/package-sources", "packages:write"),
    ("DELETE", f"/api/v1/package-sources/{ID}", "packages:write"),
    ("POST", "/api/v1/provisioning/images", "settings:write"),
    ("PUT", f"/api/v1/provisioning/images/{ID}", "settings:write"),
    ("DELETE", f"/api/v1/provisioning/images/{ID}", "settings:write"),
    ("POST", "/api/v1/provisioning/templates", "settings:write"),
    ("PUT", "/api/v1/provisioning/templates/windows", "settings:write"),
    ("DELETE", "/api/v1/provisioning/templates/windows", "settings:write"),
    ("POST", "/api/v1/provisioning/tasks", "nodes:write"),
    ("DELETE", f"/api/v1/provisioning/tasks/{ID}", "nodes:write"),
    ("POST", "/api/v1/provisioning/iso/mount", "settings:write"),
    ("POST", "/api/v1/provisioning/iso/unmount", "settings:write"),
    ("POST", "/api/v1/provisioning/iso/extract-kernel", "settings:write"),
    ("POST", "/api/v1/provisioning/iso/auto-setup", "settings:write"),
    ("POST", "/api/v1/provisioning/iso/nfs/mount", "settings:write"),
    ("POST", "/api/v1/provisioning/iso/nfs/unmount", "settings:write"),
    ("POST", "/api/v1/provisioning/iso/nfs/fstab/add", "settings:write"),
    ("DELETE", "/api/v1/provisioning/iso/nfs/fstab/remove", "settings:write"),
    ("POST", "/api/v1/provisioning/vm/create", "nodes:write"),
)


def _dependency_names(dependant, names):
    for dep in dependant.dependencies:
        names.add(getattr(dep.call, "__name__", ""))
        _dependency_names(dep, names)
    return names


class RouteAuthenticationTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _request(self, method, path):
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            return client.request(method, path, json={})
        finally:
            client.close()

    def test_every_write_route_needs_credentials(self):
        open_routes = sorted(
            (method, route.path)
            for route in app.routes if isinstance(route, APIRoute)
            for method in route.methods & {"POST", "PUT", "PATCH", "DELETE"}
            if not (_dependency_names(route.dependant, set()) & AUTH_DEPENDENCIES)
            and (method, route.path) not in OPEN_BY_DESIGN
        )
        self.assertEqual(open_routes, [], "write routes without authentication")

    def test_agent_and_admin_routes_reject_requests_without_credentials(self):
        for method, path in AGENT_ROUTES + tuple((m, p) for m, p, _ in ADMIN_ROUTES):
            self.assertEqual(self._request(method, path).status_code, 401, (method, path))

    def test_shared_agent_key_cannot_use_admin_routes(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser("system", "system", ["*"], True)
        app.dependency_overrides[verify_api_key] = lambda: True
        for method, path, _ in ADMIN_ROUTES:
            response = self._request(method, path)
            self.assertEqual(response.status_code, 403, (method, path, response.text))

    def test_admin_routes_need_their_permission(self):
        for method, path, permission in ADMIN_ROUTES:
            others = [p for p in ("nodes:write", "settings:write", "alerts:write", "packages:write")
                      if p != permission]
            app.dependency_overrides[get_current_user] = lambda o=others: CurrentUser(str(uuid4()), "user", o)
            response = self._request(method, path)
            self.assertEqual(response.status_code, 403, (method, path, permission, response.text))

    def test_agent_key_passes_the_agent_routes(self):
        app.dependency_overrides[verify_api_key] = lambda: True
        for method, path in AGENT_ROUTES:
            self.assertNotIn(self._request(method, path).status_code, (401, 403), (method, path))


if __name__ == "__main__":
    unittest.main()
