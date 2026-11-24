"""Self-registration of new agents: the configuration (with the agent key) goes only to the agent
that registered, once, with the server's configured address."""
import asyncio
import unittest
from unittest import mock

from fastapi import HTTPException

import pending_registration
from routers import nodes


class FakeConn:
    def __init__(self, row):
        self.row = dict(row) if row else None
        self.updates = []

    async def fetchrow(self, query, *args):
        return self.row

    async def fetchval(self, query, *args):
        # UPDATE ... SET secret_hash = NULL WHERE id = $1 AND secret_hash = $2 RETURNING id
        self.updates.append((query, args))
        if self.row and self.row["secret_hash"] == args[1]:
            self.row["secret_hash"] = None
            return self.row["id"]
        return None


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return pool.conn

            async def __aexit__(self, *exc):
                return False
        return _Ctx()


SECRET = "s3cr3t-from-register"


def pending_row(status="pending", secret=SECRET):
    return {"id": 7, "hostname": "WS01", "status": status,
            "secret_hash": pending_registration.hash_secret(secret) if secret else None}


class SecretTests(unittest.TestCase):
    def test_secrets_are_random_and_only_the_hash_is_compared(self):
        a, b = pending_registration.new_secret(), pending_registration.new_secret()
        self.assertNotEqual(a, b)
        self.assertGreaterEqual(len(a), 40)
        stored = pending_registration.hash_secret(a)
        self.assertNotIn(a, stored)
        self.assertTrue(pending_registration.secret_matches(stored, a))
        self.assertFalse(pending_registration.secret_matches(stored, b))

    def test_no_secret_or_no_stored_hash_never_matches(self):
        self.assertFalse(pending_registration.secret_matches(None, SECRET))
        self.assertFalse(pending_registration.secret_matches(pending_registration.hash_secret(SECRET), None))
        self.assertFalse(pending_registration.secret_matches(pending_registration.hash_secret(""), ""))


class ConfigRouteTests(unittest.TestCase):
    def _config(self, conn, secret):
        with mock.patch.object(nodes, "server_url", mock.AsyncMock(return_value="https://fleet.example.com")), \
                mock.patch.object(nodes, "API_KEY", "shared-agent-key"):
            return asyncio.run(nodes.get_pending_node_config("7", request=None, db=FakePool(conn), secret=secret))

    def _status(self, conn, secret):
        with self.assertRaises(HTTPException) as caught:
            self._config(conn, secret)
        return caught.exception.status_code

    def test_without_or_with_a_wrong_secret_nothing_is_handed_out(self):
        for status in ("pending", "approved", "rejected"):
            self.assertEqual(self._status(FakeConn(pending_row(status)), None), 403, status)
            self.assertEqual(self._status(FakeConn(pending_row(status)), "guessed"), 403, status)

    def test_registrations_of_older_agents_have_no_secret(self):
        self.assertEqual(self._status(FakeConn(pending_row("approved", secret=None)), None), 403)
        self.assertEqual(self._status(FakeConn(pending_row("approved", secret=None)), ""), 403)

    def test_unknown_id(self):
        self.assertEqual(self._status(FakeConn(None), SECRET), 404)

    def test_pending_and_rejected(self):
        self.assertEqual(self._config(FakeConn(pending_row("pending")), SECRET), {"status": "pending"})
        self.assertEqual(self._config(FakeConn(pending_row("rejected")), SECRET), {"status": "rejected"})

    def test_approved_configuration_is_handed_out_once(self):
        conn = FakeConn(pending_row("approved"))
        result = self._config(conn, SECRET)
        self.assertEqual(result["status"], "approved")
        self.assertEqual(result["config"]["InventoryApiUrl"], "https://fleet.example.com")
        self.assertEqual(result["config"]["InventoryApiKey"], "shared-agent-key")
        self.assertEqual(result["config"]["DisplayName"], "WS01")
        self.assertIsNone(conn.row["secret_hash"])  # the secret is invalid now
        self.assertEqual(self._status(conn, SECRET), 403)

    def test_concurrent_poll_gets_nothing_once_the_secret_was_used(self):
        conn = FakeConn(pending_row("approved"))
        stale = dict(conn.row)
        conn.row["secret_hash"] = "used-by-the-other-request"
        # the row was read before the other request invalidated the secret
        conn.fetchrow = mock.AsyncMock(return_value=stale)
        self.assertEqual(self._status(conn, SECRET), 403)


if __name__ == "__main__":
    unittest.main()
