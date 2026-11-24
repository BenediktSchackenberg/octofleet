"""Every route that reads data needs credentials too, not only the write routes.

A review of the route table found GET routes (provisioning, security findings and activity, event
log, posture, software baselines …) that answered without any authentication. This test fails as
soon as a GET route has no authentication dependency and is not listed as public below.
"""
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from route_table import api_routes, websocket_routes
from starlette.websockets import WebSocketDisconnect
from test_route_authentication import AUTH_DEPENDENCIES, _dependency_names
from test_write_route_permissions import PERMISSION_CHECKS

from auth import CurrentUser, get_current_user
from main import app

# Open on purpose, with the caller that has no credentials.
PUBLIC_READ_ROUTES = {
    # Health checks (Docker, load balancers)
    ("GET", "/health"),
    ("GET", "/api/v1/health"),
    # Agent installs and self-updates: the installer has no key yet, releases contain no secrets
    ("GET", "/api/v1/agent/version"),
    ("GET", "/api/v1/agent/releases/latest"),
    ("GET", "/api/v1/agent/releases/download/{filename}"),
    ("GET", "/api/v1/agent/releases/linux/latest"),
    ("GET", "/api/v1/agent/releases/linux/{filename}"),
    ("GET", "/api/v1/onboarding/install-script"),
    # PXE boot and unattended installs: machines being installed have no credentials
    ("GET", "/api/v1/pxe"),
    ("GET", "/api/v1/pxe/{mac}"),
    ("GET", "/api/v1/pxe/autoinstall/{mac}/user-data"),
    ("GET", "/api/v1/pxe/autoinstall/{mac}/meta-data"),
    ("GET", "/api/v1/provisioning/linux-agent"),
    ("GET", "/api/v1/provisioning/autoinstall/{hostname}"),
    # A node that registered itself polls here until an admin approves it; it only knows its
    # pending ID (PendingNodeRegistration.cs)
    ("GET", "/api/v1/pending-nodes/{pending_id}/config"),
    # The Windows agent downloads repository files without a key (PackageManager.cs); the file ID
    # is part of the package source URL
    ("GET", "/api/v1/repo/download/{file_id}"),
}

# Any signed-in user, for their own account only (the frontend asks before it knows the permissions)
OWN_ACCOUNT_READ_ROUTES = {
    ("GET", "/api/v1/auth/me"),
    ("GET", "/api/v1/auth/permissions"),
    ("GET", "/api/v1/auth/password-rules"),
}

# Websockets check credentials in the handler: viewers send the session token as ?token=, agents
# the agent key as ?api_key= (routers/terminal.py).
WEBSOCKETS_CHECKING_CREDENTIALS = {
    "/api/v1/terminal/ws/{session_id}",
    "/api/v1/shell/ws/{session_id}",
    "/api/v1/shell/ws/agent/{session_id}",
    "/api/v1/screen/ws/{session_id}",
    "/api/v1/screen/ws/agent/{session_id}",
}

ID = "00000000-0000-0000-0000-000000000000"
READ_PERMISSIONS = ("nodes:read", "eventlog:read", "alerts:read", "settings:read",
                    "vulnerabilities:read", "packages:read", "compliance:read")
# (path, permission) of the routes that answered without credentials before
FIXED_ROUTES = (
    ("/api/v1/discovered-systems", "nodes:read"),
    (f"/api/v1/discovered-systems/{ID}", "nodes:read"),
    ("/api/v1/eventlog/summary", "eventlog:read"),
    ("/api/v1/eventlog/important-events", "eventlog:read"),
    ("/api/v1/security/activity/files", "eventlog:read"),
    ("/api/v1/security/activity/users", "eventlog:read"),
    ("/api/v1/security/activity/export", "eventlog:read"),
    ("/api/v1/security/findings", "alerts:read"),
    ("/api/v1/security/findings/summary", "alerts:read"),
    ("/api/v1/security/rules", "settings:read"),
    ("/api/v1/security/vulnerabilities/fleet", "vulnerabilities:read"),
    ("/api/v1/smart-install/packages", "packages:read"),
    ("/api/v1/software-baselines", "packages:read"),
    (f"/api/v1/software-baselines/{ID}", "packages:read"),
    ("/api/v1/package-sources", "packages:read"),
    ("/api/v1/posture/snapshots/node", "compliance:read"),
    ("/api/v1/posture/snapshots/node/latest", "compliance:read"),
    ("/api/v1/posture/diffs/node", "compliance:read"),
    ("/api/v1/posture/compare/node", "compliance:read"),
    ("/api/v1/provisioning/images", "settings:read"),
    ("/api/v1/provisioning/templates", "settings:read"),
    ("/api/v1/provisioning/tasks", "nodes:read"),
    (f"/api/v1/provisioning/tasks/{ID}", "nodes:read"),
    (f"/api/v1/provisioning/tasks/{ID}/events", "nodes:read"),
    ("/api/v1/provisioning/iso/scan", "settings:read"),
    ("/api/v1/provisioning/iso/mounts", "settings:read"),
    ("/api/v1/provisioning/iso/wim-info?wim_path=x", "settings:read"),
    ("/api/v1/provisioning/iso/nfs/list", "settings:read"),
)
AGENT_KEY_PERMISSIONS = ["inventory:write", "jobs:read", "jobs:poll", "terminal:pending", "nodes:heartbeat"]


class ReadRouteAuthenticationTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _get(self, path):
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            return client.get(path)
        finally:
            client.close()

    def test_every_read_route_needs_credentials(self):
        open_routes = sorted(
            ("GET", route.path)
            for route in api_routes(app)  # with the routes of the included routers
            if "GET" in route.methods
            and not (_dependency_names(route.dependant, set()) & AUTH_DEPENDENCIES)
            and ("GET", route.path) not in PUBLIC_READ_ROUTES
        )
        self.assertEqual(open_routes, [], "read routes without authentication")

    def test_every_read_route_checks_a_permission(self):
        # verify_api_key alone accepts the shared agent key (on every managed machine) and any user
        unchecked = sorted(
            ("GET", route.path)
            for route in api_routes(app)  # with the routes of the included routers
            if "GET" in route.methods
            and not (_dependency_names(route.dependant, set()) & PERMISSION_CHECKS)
            and ("GET", route.path) not in PUBLIC_READ_ROUTES | OWN_ACCOUNT_READ_ROUTES
        )
        self.assertEqual(unchecked, [], "read routes that only check for a key or a session")

    def test_own_account_read_routes_exist(self):
        paths = {("GET", route.path) for route in api_routes(app) if "GET" in route.methods}
        self.assertEqual(OWN_ACCOUNT_READ_ROUTES - paths, set(), "stale entries in OWN_ACCOUNT_READ_ROUTES")

    def test_public_read_routes_exist(self):
        paths = {("GET", route.path) for route in api_routes(app) if "GET" in route.methods}
        self.assertEqual(PUBLIC_READ_ROUTES - paths, set(), "stale entries in PUBLIC_READ_ROUTES")

    def test_every_websocket_checks_credentials(self):
        self.assertEqual({route.path for route in websocket_routes(app)}, WEBSOCKETS_CHECKING_CREDENTIALS)
        client = TestClient(app)
        try:
            for path in WEBSOCKETS_CHECKING_CREDENTIALS:
                with self.assertRaises(WebSocketDisconnect, msg=path):
                    with client.websocket_connect(path.replace("{session_id}", ID)):
                        pass
        finally:
            client.close()

    def test_fixed_routes_reject_requests_without_credentials(self):
        for path, _ in FIXED_ROUTES:
            self.assertEqual(self._get(path).status_code, 401, path)

    def test_fixed_routes_reject_the_agent_key(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser("system", "system", AGENT_KEY_PERMISSIONS)
        for path, _ in FIXED_ROUTES:
            self.assertEqual(self._get(path).status_code, 403, path)

    def test_fixed_routes_need_their_permission(self):
        for path, permission in FIXED_ROUTES:
            app.dependency_overrides[get_current_user] = lambda p=permission: CurrentUser(str(uuid4()), "user", [p])
            self.assertNotIn(self._get(path).status_code, (401, 403), (path, permission))
            others = [p for p in READ_PERMISSIONS if p != permission]
            app.dependency_overrides[get_current_user] = lambda o=others: CurrentUser(str(uuid4()), "user", o)
            self.assertEqual(self._get(path).status_code, 403, (path, permission))


if __name__ == "__main__":
    unittest.main()
