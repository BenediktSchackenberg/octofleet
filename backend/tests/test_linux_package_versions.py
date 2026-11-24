"""Linux package versions and pending updates per node (#271): release key, repository key, the rows
taken from the agent's report, and what a push writes (nothing when the list did not change)."""
import unittest
from unittest.mock import AsyncMock, MagicMock

import asyncpg

import linux_updates as lu
from routers.inventory import store_linux_package_updates

UBUNTU = {"id": "ubuntu", "versionId": "24.04", "idLike": "debian", "name": "Ubuntu"}
ROCKY = {"id": "rocky", "versionId": "9.8", "idLike": "rhel centos fedora", "name": "Rocky Linux"}


def report(updates, release=UBUNTU):
    return {"packageManager": "apt", "release": release, "updates": updates}


class ReleaseKeyTests(unittest.TestCase):
    def test_keys(self):
        self.assertEqual(lu.release_key(UBUNTU), "ubuntu:24.04")
        self.assertEqual(lu.release_key({"id": "debian", "versionId": "13"}), "debian:13")
        # the full release, also on the RHEL family: a point release is a release of its own
        self.assertEqual(lu.release_key(ROCKY), "rocky:9.8")
        self.assertEqual(lu.release_key({"id": "rhel", "versionId": "9.6"}), "rhel:9.6")
        self.assertEqual(lu.release_key({"id": "centos", "versionId": "9"}), "centos:9")
        self.assertEqual(lu.release_key({"id": "fedora", "versionId": "43"}), "fedora:43")
        # rolling release without VERSION_ID
        self.assertEqual(lu.release_key({"id": "cachyos", "versionId": None, "idLike": "arch"}), "cachyos")
        self.assertEqual(lu.release_key({"id": " Ubuntu ", "versionId": "24.04"}), "ubuntu:24.04")

    def test_missing_or_implausible(self):
        for value in (None, "ubuntu", {}, {"id": ""}, {"id": 5}, {"id": "a b"}, {"id": "x" * 65},
                      {"id": "ubuntu", "versionId": "24.04; drop"}, {"id": "ubuntu", "versionId": "1" * 40}):
            self.assertIsNone(lu.release_key(value), value)


class RepositoryKeyTests(unittest.TestCase):
    def test_security_suite_wins_and_order_does_not_matter(self):
        self.assertEqual(lu.repository_key("noble-updates,noble-security"), "noble-security")
        self.assertEqual(lu.repository_key("noble-security,noble-updates"), "noble-security")
        self.assertEqual(lu.repository_key("noble-updates,noble-backports"), "noble-backports")
        self.assertEqual(lu.repository_key("baseos"), "baseos")
        self.assertEqual(lu.repository_key(None), "")
        self.assertEqual(lu.repository_key(" , "), "")


class NormalizeTests(unittest.TestCase):
    def test_rows(self):
        r = lu.normalize(report([
            {"name": "openssl", "newVersion": "3.0.13-0ubuntu3.6", "repository": "noble-security,noble-updates",
             "security": True, "arch": "amd64", "installedVersion": "3.0.13-0ubuntu3.5"},
            {"name": "openssl", "newVersion": "3.0.13-0ubuntu3.6", "repository": "noble-updates,noble-security",
             "security": False, "arch": "amd64"},  # same key: merged, the security flag stays
        ]))
        self.assertEqual(r["release"], "ubuntu:24.04")
        self.assertEqual(r["rows"], [(("openssl", "amd64", "3.0.13-0ubuntu3.6", "noble-security"),
                                      {"name": "openssl", "installed": "3.0.13-0ubuntu3.5",
                                       "security": True, "severity": None})])

    def test_dnf_name_arch(self):
        r = lu.normalize(report([
            {"name": "openssl-libs.x86_64", "package": "openssl-libs", "arch": "x86_64", "newVersion": "1:3.5.1-4.el9_8",
             "repository": "baseos", "security": True, "severity": "Moderate"},
            # without "package": split from name.arch; severity only from the known values
            {"name": "kernel.x86_64", "arch": "x86_64", "newVersion": "5.14.0-611.5.1.el9_8", "repository": "baseos",
             "security": True, "severity": "Bogus"},
        ], ROCKY))
        keys = [k for k, _ in r["rows"]]
        self.assertEqual(keys, [("kernel", "x86_64", "5.14.0-611.5.1.el9_8", "baseos"),
                                ("openssl-libs", "x86_64", "1:3.5.1-4.el9_8", "baseos")])
        self.assertEqual([v["name"] for _, v in r["rows"]], ["kernel.x86_64", "openssl-libs.x86_64"])
        self.assertEqual([v["severity"] for _, v in r["rows"]], [None, "Moderate"])

    def test_invalid_entries_are_skipped(self):
        r = lu.normalize(report(["x", None, {"name": "a"}, {"name": 1, "newVersion": "1"},
                                 {"name": "b", "newVersion": "1" * 300}, {"name": "c\n", "newVersion": "1"},
                                 {"name": "ok", "newVersion": "1.0", "arch": 7, "repository": ["x"]}]))
        self.assertEqual([k for k, _ in r["rows"]], [("ok", "", "1.0", "")])

    def test_no_list_or_no_release(self):
        self.assertIsNone(lu.normalize(None))
        self.assertIsNone(lu.normalize({"totalUpdates": 3}))
        r = lu.normalize(report([{"name": "a", "newVersion": "1"}], release=None))
        self.assertIsNone(r["release"])
        self.assertEqual(r["rows"], [])

    def test_hash(self):
        a = [{"name": "a", "newVersion": "1", "arch": "amd64"}, {"name": "b", "newVersion": "2", "arch": "amd64"}]
        self.assertEqual(lu.normalize(report(a))["hash"], lu.normalize(report(list(reversed(a))))["hash"])
        self.assertNotEqual(lu.normalize(report(a))["hash"], lu.normalize(report(a[:1]))["hash"])
        self.assertNotEqual(lu.normalize(report(a))["hash"],
                            lu.normalize(report(a, {"id": "ubuntu", "versionId": "26.04"}))["hash"])

    def test_cap(self):
        many = [{"name": f"p{i}", "newVersion": "1"} for i in range(lu.MAX_UPDATES + 5)]
        self.assertEqual(len(lu.normalize(report(many))["rows"]), lu.MAX_UPDATES)


def fake_conn(previous_hash=None, version_rows=()):
    conn = AsyncMock()
    conn.transaction = MagicMock()
    conn.fetchval.return_value = previous_hash
    conn.fetch.return_value = list(version_rows)
    return conn


def statements(conn):
    return [c.args[0] for c in conn.execute.call_args_list] + [c.args[0] for c in conn.fetch.call_args_list]


class StoreTests(unittest.IsolatedAsyncioTestCase):
    UPDATES = report([{"name": "openssl", "newVersion": "3.6", "arch": "amd64", "repository": "noble-security",
                       "security": True, "installedVersion": "3.5"}])

    async def test_unchanged_list_writes_nothing(self):
        digest = lu.normalize(self.UPDATES)["hash"]
        conn = fake_conn(previous_hash=digest)
        self.assertEqual(await lu.store_node_updates(conn, "n1", self.UPDATES), "unchanged")
        conn.execute.assert_not_called()
        conn.fetch.assert_not_called()

    async def test_changed_list(self):
        conn = fake_conn(version_rows=[{"id": 42, "name": "openssl", "arch": "amd64", "version": "3.6",
                                        "repository": "noble-security"}])
        self.assertEqual(await lu.store_node_updates(conn, "n1", self.UPDATES), "stored")
        upsert = conn.fetch.call_args_list[0].args
        self.assertIn("linux_package_versions", upsert[0])
        self.assertEqual(upsert[1:], ("ubuntu:24.04", ["openssl"], ["amd64"], ["3.6"], ["noble-security"], [True], [None]))
        node_rows = conn.execute.call_args_list[0].args
        self.assertIn("linux_node_updates", node_rows[0])
        self.assertEqual(node_rows[1:], ("n1", [42], ["openssl"], ["3.5"]))
        dirty = conn.execute.call_args_list[-2].args
        self.assertIn("linux_approval_dirty", dirty[0])  # the approval cache re-evaluates the node
        final = conn.execute.call_args_list[-1].args
        self.assertEqual(final[1:3], ("n1", "ubuntu:24.04"))

    async def test_version_inserted_concurrently_is_read_again(self):
        conn = fake_conn()
        conn.fetch.side_effect = [[], [{"id": 7, "name": "openssl", "arch": "amd64", "version": "3.6",
                                        "repository": "noble-security"}]]
        await lu.store_node_updates(conn, "n1", self.UPDATES)
        self.assertEqual(conn.fetch.call_count, 2)
        self.assertEqual(conn.execute.call_args_list[0].args[2], [7])

    async def test_older_agent_without_release_clears_the_rows(self):
        conn = fake_conn()
        result = await lu.store_node_updates(conn, "n1", report([{"name": "a", "newVersion": "1"}], release=None))
        self.assertEqual(result, "cleared")
        self.assertTrue(any("DELETE FROM linux_node_updates" in s for s in statements(conn)))
        self.assertTrue(any("linux_approval_dirty" in s for s in statements(conn)))
        conn.fetch.assert_not_called()

    async def test_empty_list_clears_the_rows(self):
        conn = fake_conn()
        self.assertEqual(await lu.store_node_updates(conn, "n1", report([])), "stored")
        self.assertTrue(any("DELETE FROM linux_node_updates" in s for s in statements(conn)))

    async def test_no_list_in_push_changes_nothing(self):
        conn = fake_conn()
        self.assertIsNone(await lu.store_node_updates(conn, "n1", {"totalUpdates": 1}))
        conn.fetchval.assert_not_called()

    async def test_database_error_does_not_fail_the_inventory(self):
        conn = fake_conn()
        conn.fetch.side_effect = asyncpg.exceptions.DeadlockDetectedError("deadlock detected")
        with self.assertLogs("routers.inventory", "WARNING"):
            await store_linux_package_updates(conn, "n1", self.UPDATES)


if __name__ == "__main__":
    unittest.main()
