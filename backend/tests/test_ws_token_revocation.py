"""The terminal, shell and screen websockets check the session token like HTTP requests do: a token
revoked by a logout or password change (session_version) no longer opens a session."""
import asyncio
import unittest
from unittest import mock
from uuid import uuid4

import dependencies
from auth import create_access_token, create_refresh_token
from routers import terminal

USER_ID = str(uuid4())


class FakeConn:
    def __init__(self, row):
        self.row = row

    async def fetchrow(self, query, *args):
        return self.row


class FakePool:
    def __init__(self, row):
        self.conn = FakeConn(row)

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return pool.conn

            async def __aexit__(self, *exc):
                return False
        return _Ctx()


class FakeWebSocket:
    def __init__(self, token):
        self.query_params = {"token": token} if token else {}
        self.closed = None

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)


def user_row(session_version=0, is_active=True, must_change_password=False):
    return {"session_version": session_version, "is_active": is_active,
            "must_change_password": must_change_password, "password_changed_at": None}


class WebSocketTokenTests(unittest.TestCase):
    def _validate(self, token, row):
        websocket = FakeWebSocket(token)
        with mock.patch.object(dependencies, "db_pool", FakePool(row)), \
                mock.patch("password_policy.load_policy", mock.AsyncMock(return_value={})), \
                mock.patch("password_policy.password_expired", return_value=False):
            payload = asyncio.run(terminal._validate_ws_token(websocket))
        return payload, websocket

    def test_current_token_is_accepted(self):
        payload, websocket = self._validate(create_access_token(USER_ID, "alice", ["*"], 3), user_row(3))
        self.assertEqual(payload["sub"], USER_ID)
        self.assertIsNone(websocket.closed)

    def test_token_revoked_by_logout_or_password_change_is_rejected(self):
        payload, websocket = self._validate(create_access_token(USER_ID, "alice", ["*"], 3), user_row(4))
        self.assertIsNone(payload)
        self.assertEqual(websocket.closed[0], 1008)

    def test_token_of_a_deactivated_user_is_rejected(self):
        payload, websocket = self._validate(create_access_token(USER_ID, "alice", ["*"]), user_row(is_active=False))
        self.assertIsNone(payload)
        self.assertEqual(websocket.closed[0], 1008)

    def test_token_with_a_pending_password_change_is_rejected(self):
        payload, websocket = self._validate(create_access_token(USER_ID, "alice", ["*"]),
                                            user_row(must_change_password=True))
        self.assertIsNone(payload)
        self.assertEqual(websocket.closed[0], 1008)

    def test_refresh_token_missing_and_invalid_tokens_are_rejected(self):
        for token in (create_refresh_token(USER_ID), "", "not-a-token"):
            payload, websocket = self._validate(token, user_row())
            self.assertIsNone(payload, token)
            self.assertEqual(websocket.closed[0], 1008, token)


if __name__ == "__main__":
    unittest.main()
