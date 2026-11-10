"""The network and browser sections of the agent's inventory are stored and returned for their tabs."""
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from auth import CurrentUser, get_current_user
from dependencies import get_db
from main import app
from routers.inventory import store_browser, store_network

# as the Windows agent sends them (NetworkCollector / BrowserCollector, camelCase)
AGENT_NETWORK = {
    "openPorts": [{"protocol": "TCP", "address": "0.0.0.0", "port": 3389}],
    "connections": {"total": 1, "summary": [{"state": "Established", "count": 1}],
                    "connections": [{"localAddress": "10.0.0.5", "localPort": 50000, "remoteAddress": "10.0.0.1",
                                     "remotePort": 443, "state": "Established"}]},
    "networkInterfaces": [{"name": "Ethernet", "status": "Up", "ipv4Addresses": [{"address": "10.0.0.5", "prefixLength": 24}]}],
}
AGENT_BROWSER = {"users": [{
    "username": "alice", "userProfilePath": "C:\\Users\\alice",
    "edge": {"installed": True, "profileCount": 1, "profiles": [{
        "name": "Default", "historyCount": 120, "bookmarksCount": 7, "cookiesCount": 2, "loginsCount": 1,
        "extensions": [{"id": "ext1", "name": "Ext"}],
        "cookies": [{"domain": ".example.com", "name": "sid", "path": "/", "expiresUtc": "2027-01-01T00:00:00Z",
                     "isSecure": True, "isHttpOnly": True, "sameSite": "Lax"},
                    {"domain": "ERROR", "name": "x"}]}]},
    "chrome": {"installed": False, "profiles": []},
}]}


def _pool(conn):
    pool = MagicMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    conn.transaction = MagicMock()
    conn.transaction.return_value.__aenter__ = AsyncMock(return_value=None)
    conn.transaction.return_value.__aexit__ = AsyncMock(return_value=False)
    return pool


class StoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_network_sections_go_to_their_columns(self):
        conn = AsyncMock()
        with patch("routers.inventory.upsert_node", AsyncMock(return_value=uuid4())):
            await store_network(_pool(conn), "HOST", "HOST", AGENT_NETWORK)
        _, _, adapters, connections, ports = conn.execute.call_args.args
        self.assertEqual(json.loads(adapters)[0]["name"], "Ethernet")
        self.assertEqual(json.loads(connections)[0]["remotePort"], 443)  # the list, not the summary object
        self.assertEqual(json.loads(ports)[0]["port"], 3389)

    async def test_browser_profiles_and_cookie_names(self):
        conn = AsyncMock()
        with patch("routers.inventory.upsert_node", AsyncMock(return_value=uuid4())):
            await store_browser(_pool(conn), "HOST", "HOST", AGENT_BROWSER)
        profiles = conn.executemany.call_args_list[0].args[1]
        cookies = conn.executemany.call_args_list[1].args[1]
        self.assertEqual(len(profiles), 1)  # Chrome is not installed
        self.assertEqual(profiles[0][1:8], ("Edge", "Default", "alice", 120, 7, 2, 1))
        self.assertEqual(len(cookies), 1)  # the ERROR entry is skipped
        self.assertEqual(cookies[0][4:6], (".example.com", "sid"))
        self.assertEqual(cookies[0][7].year, 2027)

    async def test_values_longer_than_the_columns_are_cut(self):
        long_browser = {"users": [{"username": "bob", "chrome": {"installed": True, "profiles": [{
            "name": "Default", "cookies": [{"domain": "d" * 300, "name": "n" * 1000, "path": "/" * 600,
                                            "sameSite": "Unspecified-and-long"}]}]}}]}
        conn = AsyncMock()
        with patch("routers.inventory.upsert_node", AsyncMock(return_value=uuid4())):
            await store_browser(_pool(conn), "HOST", "HOST", long_browser)
        cookie = conn.executemany.call_args_list[1].args[1][0]
        self.assertEqual((len(cookie[4]), len(cookie[5]), len(cookie[6]), len(cookie[10])), (255, 255, 512, 20))


class FullPushTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_a_failing_section_does_not_fail_the_push(self):
        # the agent routes need inventory:write (the shared agent key has every permission)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser("system", "system", ["*"], True)
        app.dependency_overrides[get_db] = lambda: _pool(AsyncMock())
        with patch("routers.inventory.store_browser", AsyncMock(side_effect=RuntimeError("boom"))), \
             patch("routers.inventory.store_network", AsyncMock()) as network, \
             patch("routers.inventory.update_node_health", AsyncMock()):
            client = TestClient(app, raise_server_exceptions=False)
            try:
                response = client.post("/api/v1/inventory/full", json={
                    "hostname": "HOST", "network": AGENT_NETWORK, "browser": AGENT_BROWSER})
            finally:
                client.close()
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn("network", body["submitted"])
        self.assertEqual(body["failed"], ["browser"])
        network.assert_awaited_once()


class GetBrowserTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_grouped_by_user_and_browser(self):
        node_uuid = uuid4()
        conn = AsyncMock()
        conn.fetchrow.return_value = {"id": node_uuid}
        conn.fetch.side_effect = [
            [{"browser": "Edge", "profile": "Default", "username": "alice", "history_count": 120, "bookmark_count": 7,
              "cookies_count": 2, "logins_count": 1, "extensions": json.dumps([{"id": "ext1"}])}],
            [{"username": "alice", "browser": "Edge", "profile": "Default", "domain": ".example.com", "count": 1}],
        ]
        app.dependency_overrides[get_db] = lambda: _pool(conn)
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(str(uuid4()), "viewer", ["inventory:read"])
        client = TestClient(app, raise_server_exceptions=False)  # no "with": startup would connect to the database
        try:
            response = client.get(f"/api/v1/inventory/browser/{node_uuid}")
        finally:
            client.close()
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()["data"]
        edge = data["users"]["alice"]["Edge"]
        self.assertEqual(edge["extensionCount"], 1)
        self.assertEqual(edge["profiles"][0]["cookiesCount"], 2)
        self.assertEqual(data["cookies"]["alice"][0]["domain"], ".example.com")


if __name__ == "__main__":
    unittest.main()
