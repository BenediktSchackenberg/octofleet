"""The security section of the agent's inventory is stored and returned for the node's Security tab."""
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from auth import CurrentUser, get_current_user
from dependencies import get_db
from main import app
from routers.inventory import store_security

# as the Windows agent sends it (SecurityCollector, camelCase)
AGENT_SECURITY = {
    "antivirus": {"products": [], "windowsDefender": {"available": True, "realTimeProtectionEnabled": True,
                                                      "antivirusEnabled": True, "signatureVersion": "1.2.3"}},
    "firewall": {"profiles": [{"name": "Domain", "enabled": True}, {"name": "Public", "enabled": False}]},
    "bitlocker": {"available": False, "reason": "BitLocker is not installed", "volumes": []},
    "tpm": {"present": False, "ready": False},
    "uac": {"enabled": True, "consentPromptBehavior": 5},
    "secureBoot": {"supported": True, "enabled": True},
    "localAdmins": {"count": 1, "members": [{"name": "Administrator", "isBuiltIn": True}]},
}


def _pool(conn):
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    return pool


class StoreSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_sections_go_to_their_columns(self):
        conn = AsyncMock()
        node_uuid = uuid4()
        with patch("routers.inventory.upsert_node", AsyncMock(return_value=node_uuid)):
            await store_security(_pool(conn), "HOST", "HOST", AGENT_SECURITY)
        args = conn.execute.call_args.args
        self.assertIn("INSERT INTO security_current", args[0])
        (uuid, antivirus, defender, firewall, tpm, uac, uac_enabled, bitlocker, secure_boot, local_admins) = args[1:]
        self.assertEqual(uuid, node_uuid)
        self.assertEqual(json.loads(defender)["signatureVersion"], "1.2.3")
        self.assertEqual(json.loads(antivirus)["products"], [])
        self.assertEqual(json.loads(firewall)["profiles"][1], {"name": "Public", "enabled": False})
        self.assertEqual((uac_enabled, secure_boot), (True, True))
        self.assertEqual(json.loads(local_admins)["count"], 1)


class GetSecurityTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_returns_what_the_agent_sent(self):
        node_uuid = uuid4()
        conn = AsyncMock()
        conn.fetchrow.side_effect = [
            {"id": node_uuid},
            {"antivirus": json.dumps(AGENT_SECURITY["antivirus"]),
             "defender": json.dumps(AGENT_SECURITY["antivirus"]["windowsDefender"]),
             "firewall": json.dumps(AGENT_SECURITY["firewall"]), "tpm": json.dumps(AGENT_SECURITY["tpm"]),
             "uac": json.dumps(AGENT_SECURITY["uac"]), "bitlocker": json.dumps(AGENT_SECURITY["bitlocker"]),
             "secure_boot": True, "local_admins": json.dumps(AGENT_SECURITY["localAdmins"]),
             "updated_at": datetime(2026, 11, 10, tzinfo=timezone.utc)},
        ]
        app.dependency_overrides[get_db] = lambda: _pool(conn)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "viewer", ["inventory:read"])
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            response = client.get(f"/api/v1/inventory/security/{node_uuid}")
        finally:
            client.close()
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        self.assertTrue(data["defender"]["realTimeProtectionEnabled"])
        self.assertEqual(data["antivirusProducts"], [])
        self.assertEqual(data["firewall"]["profiles"][0]["name"], "Domain")
        self.assertEqual(data["uac"]["consentPromptBehavior"], 5)
        self.assertIs(data["secureBoot"], True)
        self.assertEqual(data["bitlocker"]["reason"], "BitLocker is not installed")


if __name__ == "__main__":
    unittest.main()
