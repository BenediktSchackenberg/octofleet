import unittest
from uuid import uuid4
from unittest.mock import AsyncMock

from fastapi import HTTPException
from fastapi.testclient import TestClient

from auth import CurrentUser, get_current_user, require_user_permission
from dependencies import get_db, verify_api_key
from main import app, create_api_key, create_role
from auth import APIKeyCreate, RoleCreate
from routers.auth import assert_manageable_user


class SecurityAuthorizationTests(unittest.IsolatedAsyncioTestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_shared_agent_key_cannot_read_private_data_or_create_jobs(self):
        app.dependency_overrides[get_current_user] = lambda: CurrentUser("system", "system", ["*"], True)
        app.dependency_overrides[verify_api_key] = lambda: True
        app.dependency_overrides[get_db] = lambda: object()
        client = TestClient(app, raise_server_exceptions=False)
        try:
            for method, path, body in (
                ("GET", "/api/v1/nodes", None),
                ("GET", "/api/v1/groups", None),
                ("GET", "/api/v1/inventory/hardware/fleet", None),
                ("GET", "/api/v1/hardware/fleet", None),
                ("GET", "/api/v1/vulnerabilities/summary", None),
                ("GET", "/api/v1/onboarding/install-command", None),
                ("GET", "/api/v1/settings/api_key", None),
                ("POST", "/api/v1/jobs", {}),
                ("POST", "/api/v1/remediation/scan", {}),
                ("POST", "/api/v1/api-keys", {"name": "bad", "scopes": ["admin"]}),
                ("POST", "/api/v1/maintenance-windows", {}),
            ):
                response = client.request(method, path, json=body)
                self.assertEqual(response.status_code, 403, (method, path, response.text))
        finally:
            client.close()

    async def test_user_permission_checks(self):
        checker = require_user_permission("jobs:create")
        with self.assertRaises(HTTPException) as context:
            await checker(CurrentUser("system", "system", ["*"], True))
        self.assertEqual(context.exception.status_code, 403)
        with self.assertRaises(HTTPException) as context:
            await checker(CurrentUser(str(uuid4()), "viewer", ["jobs:read"]))
        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual((await checker(CurrentUser(str(uuid4()), "operator", ["jobs:create"]))).username, "operator")

    async def test_admin_account_cannot_be_modified_by_users_write(self):
        account_id = uuid4()
        conn = type("Conn", (), {"fetchrow": AsyncMock(return_value={"is_superuser": True, "has_admin_role": False})})()
        with self.assertRaises(HTTPException) as context:
            await assert_manageable_user(conn, account_id, CurrentUser(str(uuid4()), "manager", ["users:write"]))
        self.assertEqual(context.exception.status_code, 403)
        await assert_manageable_user(conn, account_id, CurrentUser(str(uuid4()), "admin", ["*"], True))

    async def test_custom_role_cannot_grant_wildcard(self):
        with self.assertRaises(HTTPException) as context:
            await create_role(RoleCreate(name="escalated", permissions=["*"]),
                              CurrentUser(str(uuid4()), "manager", ["roles:write"]))
        self.assertEqual(context.exception.status_code, 403)

    async def test_api_key_scope_cannot_exceed_owner_permissions(self):
        with self.assertRaises(HTTPException) as context:
            await create_api_key(APIKeyCreate(name="bad", scopes=["admin"]),
                                 CurrentUser(str(uuid4()), "manager", ["api-keys:write"]))
        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
