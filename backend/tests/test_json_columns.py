"""JSON columns: decoded once on read; double-encoded rows repaired on startup; one audit query."""

import json
import os
import unittest
import uuid
from pathlib import Path

import asyncpg

import audit_query
import json_columns
from json_columns import decode_json


class DecodeJson(unittest.TestCase):
    def test_text_from_asyncpg_becomes_the_object(self):
        self.assertEqual(decode_json('{"at": "2026-11-23T21:42:23Z", "action": "reboot"}'),
                         {"at": "2026-11-23T21:42:23Z", "action": "reboot"})

    def test_double_encoded_object_is_decoded_once_more(self):
        inner = json.dumps({"action": "reboot", "message": None})
        self.assertEqual(decode_json(json.dumps(inner)), {"action": "reboot", "message": None})

    def test_plain_values_stay_as_they_are(self):
        self.assertEqual(decode_json('"hello"'), "hello")
        self.assertEqual(decode_json('"123"'), "123")  # a JSON string stays a string
        self.assertEqual(decode_json("42"), 42)
        self.assertIsNone(decode_json(None))
        self.assertEqual(decode_json({"a": 1}), {"a": 1})
        self.assertEqual(decode_json("not json"), "not json")
        self.assertEqual(decode_json(json.dumps("{broken")), "{broken")


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "requires isolated TimescaleDB")
class JsonColumnsDatabase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.admin = await asyncpg.connect(os.environ["TEST_DATABASE_URL"])
        self.name = "jsoncols_" + uuid.uuid4().hex
        await self.admin.execute(f'CREATE DATABASE "{self.name}"')
        self.pool = await asyncpg.create_pool(os.environ["TEST_DATABASE_URL"], database=self.name,
                                              min_size=1, max_size=2)
        async with self.pool.acquire() as conn:
            await conn.execute((Path(__file__).parents[1] / "schema-full.sql").read_text())

    async def asyncTearDown(self):
        await self.pool.close()
        await self.admin.execute(f'DROP DATABASE "{self.name}" WITH (FORCE)')
        await self.admin.close()

    async def test_startup_repairs_only_double_encoded_rows(self):
        reboot = {"at": "2026-11-23T21:42:23Z", "action": "reboot", "message": None}
        async with self.pool.acquire() as conn:
            # what an older writer stored: a JSON string holding the object
            await conn.execute("""INSERT INTO jobs (name, target_type, command_type, command_data)
                                  VALUES ('double', 'device', 'script', $1::jsonb),
                                         ('fine', 'device', 'script', $2::jsonb),
                                         ('text', 'device', 'run', $3::jsonb),
                                         ('broken', 'device', 'run', $4::jsonb)""",
                               json.dumps(json.dumps(reboot)), json.dumps(reboot),
                               json.dumps("plain text"), json.dumps("{not json"))
            await conn.execute("""INSERT INTO audit_log (action, resource_type, resource_id, details)
                                  VALUES ('node.reboot', 'node', 'x', $1::jsonb)""",
                               json.dumps(json.dumps({"by": "admin"})))

        await json_columns.ensure_schema(self.pool)
        await json_columns.ensure_schema(self.pool)  # idempotent

        async with self.pool.acquire() as conn:
            rows = {r["name"]: (r["t"], decode_json(r["command_data"])) for r in await conn.fetch(
                "SELECT name, jsonb_typeof(command_data) AS t, command_data FROM jobs")}
            details = await conn.fetchval("SELECT details FROM audit_log")
        self.assertEqual(rows["double"], ("object", reboot))
        self.assertEqual(rows["fine"], ("object", reboot))
        self.assertEqual(rows["text"], ("string", "plain text"))
        self.assertEqual(rows["broken"], ("string", "{not json"))
        self.assertEqual(json.loads(details), {"by": "admin"})

    async def test_audit_query_filters_and_names_resources(self):
        await audit_query.ensure_schema(self.pool)
        async with self.pool.acquire() as conn:
            node_uuid = await conn.fetchval(
                "INSERT INTO nodes (node_id, hostname) VALUES ('n1', 'app-server-01') RETURNING id")
            admin = await conn.fetchval(
                "INSERT INTO users (username, password_hash) VALUES ('auditadmin', 'x') RETURNING id")
            await conn.execute("""INSERT INTO audit_log (user_id, action, resource_type, resource_id, details) VALUES
                ($1, 'node.reboot', 'node', $2, '{"message": null}'),
                (NULL, 'node.deleted', 'node', 'gone', '{"hostname": "old-host"}'),
                ($1, 'user.password_changed', 'user', $1::text, '{}')""", admin, str(node_uuid))

            everything = await audit_query.fetch_audit_log(conn)
            self.assertEqual(everything["total"], 3)
            self.assertFalse(everything["total_capped"])
            names = {e["action"]: e["resource_name"] for e in everything["entries"]}
            self.assertEqual(names["node.reboot"], "app-server-01")
            self.assertEqual(names["node.deleted"], "old-host")  # deleted node: name from the entry
            self.assertEqual(names["user.password_changed"], "auditadmin")
            reboot = next(e for e in everything["entries"] if e["action"] == "node.reboot")
            self.assertEqual(reboot["details"], {"message": None})
            self.assertEqual(reboot["username"], "auditadmin")

            by_node = await audit_query.fetch_audit_log(conn, resource_type="node", resource_id=str(node_uuid))
            self.assertEqual([e["action"] for e in by_node["entries"]], ["node.reboot"])
            self.assertEqual(by_node["total"], 1)  # the total follows the filters

            users_roles = await audit_query.fetch_audit_log(conn, resource_type="user,role")
            self.assertEqual([e["action"] for e in users_roles["entries"]], ["user.password_changed"])

            by_name = await audit_query.fetch_audit_log(conn, user="AuditAdmin", action="REBOOT")
            self.assertEqual([e["action"] for e in by_name["entries"]], ["node.reboot"])
            by_id = await audit_query.fetch_audit_log(conn, user=str(admin))
            self.assertEqual(by_id["total"], 2)

            later = await audit_query.fetch_audit_log(conn, date_from="2999-01-01T00:00:00Z")
            self.assertEqual(later["total"], 0)
