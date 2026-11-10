"""Patch management routes: agent routes need the agent key, everything else a user with the matching permission."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

from auth import CurrentUser, get_current_user
from dependencies import verify_api_key
from main import app
from routers.patches import import_patches

ID = "00000000-0000-0000-0000-000000000000"
# (method, path, body, permission)
USER_ROUTES = (
    ("GET", "/api/v1/patches/catalog", None, "packages:read"),
    ("GET", f"/api/v1/patches/catalog/{ID}", None, "packages:read"),
    ("POST", "/api/v1/patches/catalog", {}, "packages:write"),
    ("POST", "/api/v1/patches/catalog/import", {}, "packages:write"),
    ("PATCH", f"/api/v1/patches/catalog/{ID}/approve", None, "packages:write"),
    ("PATCH", f"/api/v1/patches/catalog/{ID}/exclude", None, "packages:write"),
    ("GET", "/api/v1/patches/compliance", None, "compliance:read"),
    ("GET", "/api/v1/patches/compliance/nodes", None, "compliance:read"),
    ("GET", "/api/v1/patches/rings", None, "packages:read"),
    ("POST", "/api/v1/patches/rings", {}, "packages:write"),
    ("PUT", f"/api/v1/patches/rings/{ID}", {}, "packages:write"),
    ("DELETE", f"/api/v1/patches/rings/{ID}", None, "packages:write"),
    ("GET", "/api/v1/patches/deployments", None, "packages:read"),
    ("GET", f"/api/v1/patches/deployments/{ID}", None, "packages:read"),
    ("POST", "/api/v1/patches/deployments", {}, "packages:deploy"),
    ("POST", f"/api/v1/patches/deployments/{ID}/pause", None, "packages:deploy"),
    ("POST", f"/api/v1/patches/deployments/{ID}/resume", None, "packages:deploy"),
    ("POST", f"/api/v1/patches/deployments/{ID}/cancel", None, "packages:deploy"),
    ("GET", "/api/v1/patches/explorer/tree", None, "packages:read"),
    ("GET", "/api/v1/patches/explorer/nodes", None, "packages:read"),
    ("GET", f"/api/v1/patches/explorer/node/{ID}/software", None, "packages:read"),
    ("GET", "/api/v1/patches/explorer/search?q=x", None, "packages:read"),
    ("GET", "/api/v1/patches/explorer/stats", None, "packages:read"),
    ("GET", "/api/v1/patches/explorer/by-update", None, "packages:read"),
    ("GET", f"/api/v1/patches/explorer/deployment-status/{ID}", None, "packages:read"),
    ("GET", "/api/v1/patches/explorer/deployment-history", None, "packages:read"),
    ("POST", "/api/v1/patches/explorer/deploy", {"updates": [], "reboot_policy": "force"}, "packages:deploy"),
    ("POST", "/api/v1/patches/explorer/scan", {"node_ids": [ID]}, "packages:deploy"),
    ("POST", f"/api/v1/patches/explorer/verify/{ID}", None, "packages:deploy"),
)
AGENT_ROUTES = (
    ("POST", "/api/v1/patches/scan-results", {"node_id": ID, "patches": []}),
    ("GET", f"/api/v1/patches/pending/{ID}", None),
    ("POST", "/api/v1/patches/results", {"results": []}),
    ("POST", "/api/v1/patches/explorer/agent-updates", {"hostname": "does-not-exist", "updates": []}),
)


class PatchRouteAuthorizationTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _request(self, method, path, body):
        # no "with": the app startup would connect to the database
        client = TestClient(app, raise_server_exceptions=False)
        try:
            return client.request(method, path, json=body)
        finally:
            client.close()

    def test_no_credentials_are_rejected(self):
        for method, path, body, *_ in USER_ROUTES + AGENT_ROUTES:
            response = self._request(method, path, body)
            self.assertEqual(response.status_code, 401, (method, path, response.text))

    def test_shared_agent_key_cannot_use_user_routes(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser("system", "system", ["*"], True)
        app.dependency_overrides[verify_api_key] = lambda: True
        for method, path, body, _ in USER_ROUTES:
            response = self._request(method, path, body)
            self.assertEqual(response.status_code, 403, (method, path, response.text))

    def test_each_route_needs_its_permission(self):
        for method, path, body, permission in USER_ROUTES:
            others = [p for p in ("packages:read", "packages:write", "packages:deploy", "compliance:read")
                      if p != permission]
            app.dependency_overrides[get_current_user] = lambda o=others: CurrentUser(str(uuid4()), "user", o)
            response = self._request(method, path, body)
            self.assertEqual(response.status_code, 403, (method, path, permission, response.text))

    def test_viewer_cannot_deploy_or_change_patches(self):
        viewer = ["nodes:read", "groups:read", "jobs:read", "packages:read", "compliance:read", "settings:read"]
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "viewer", viewer)
        for method, path, body, permission in USER_ROUTES:
            response = self._request(method, path, body)
            if permission in viewer:
                self.assertNotIn(response.status_code, (401, 403), (method, path, response.text))
            else:
                self.assertEqual(response.status_code, 403, (method, path, response.text))

    def test_viewer_cannot_submit_agent_results(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "viewer", ["packages:read"])
        for method, path, body in AGENT_ROUTES:
            response = self._request(method, path, body)
            self.assertEqual(response.status_code, 403, (method, path, response.text))

    def test_agent_key_can_use_agent_routes(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser("system", "system", ["*"], True)
        for method, path, body in AGENT_ROUTES:
            response = self._request(method, path, body)
            self.assertNotIn(response.status_code, (401, 403), (method, path, response.text))



class ScanResultsNodeTests(unittest.IsolatedAsyncioTestCase):
    """Agents send their hostname when they cannot look up their node UUID (the agent key cannot read /nodes)."""

    def _pool(self, conn):
        pool = MagicMock()
        pool.acquire.return_value.__aenter__.return_value = conn
        return pool

    async def test_hostname_is_resolved_to_the_node_uuid(self):
        node_uuid = uuid4()
        conn = AsyncMock()
        conn.fetchrow.return_value = {"id": node_uuid}
        with patch("routers.patches.get_pool", return_value=self._pool(conn)):
            await import_patches({"node_id": "WIN-HOST01", "patches": []})
        self.assertIn("OR node_id = $1", conn.fetchrow.call_args.args[0])
        conn.execute.assert_any_call("DELETE FROM node_available_updates WHERE node_id = $1::uuid", str(node_uuid))

    async def test_unknown_hostname_is_404(self):
        conn = AsyncMock()
        conn.fetchrow.return_value = None
        with patch("routers.patches.get_pool", return_value=self._pool(conn)):
            with self.assertRaises(HTTPException) as context:
                await import_patches({"node_id": "does-not-exist", "patches": []})
        self.assertEqual(context.exception.status_code, 404)
        conn.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
