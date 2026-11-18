"""Retention settings become TimescaleDB policies (retention.py): existing jobs, also ones
made by hand, are adopted or replaced, never duplicated."""

import unittest

import retention

EVENTS = retention.TARGETS["security_events"]
HARDWARE = retention.TARGETS["hardware_changes"]


class FakeConn:
    """Answers the catalog reads of retention.py and records every policy change."""

    def __init__(self, hypertable=True, compression_enabled=False, chunk_days=7, jobs=None):
        self.hypertable = hypertable
        self.compression_enabled = compression_enabled
        self.chunk_days = chunk_days
        self.jobs = dict(jobs or {})  # proc -> days
        self.calls = []

    async def fetchrow(self, query, *args):
        if "timescaledb_information.hypertables" in query:
            if not self.hypertable:
                return None
            return {"compression_enabled": self.compression_enabled, "chunk_seconds": self.chunk_days * 86400}
        if "timescaledb_information.jobs" in query:
            _table, proc, _key, days = args
            if proc not in self.jobs:
                return None
            return {"job_id": 1000, "current": f"{self.jobs[proc]} days", "same": self.jobs[proc] == days}
        raise AssertionError(query)

    async def execute(self, query, *args):
        self.calls.append((" ".join(query.split()), args))
        if "remove_retention_policy" in query:
            self.jobs.pop("policy_retention", None)
        if "add_retention_policy" in query:
            assert "policy_retention" not in self.jobs, "second retention policy"
            self.jobs["policy_retention"] = args[1]
        if "remove_compression_policy" in query:
            self.jobs.pop("policy_compression", None)
        if "add_compression_policy" in query:
            assert "policy_compression" not in self.jobs, "second compression policy"
            self.jobs["policy_compression"] = args[1]
        if "timescaledb.compress," in query:
            self.compression_enabled = True

    def called(self, name):
        return [c for c in self.calls if name in c[0]]


class ApplyTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_install_gets_retention_compression_and_daily_chunks(self):
        conn = FakeConn()
        result = await retention.apply_target(conn, EVENTS, 30, 7, False)
        self.assertTrue(result["applied"])
        self.assertEqual(conn.jobs, {"policy_retention": 30, "policy_compression": 7})
        self.assertTrue(conn.compression_enabled)
        self.assertEqual(len(conn.called("set_chunk_time_interval")), 1)
        self.assertIn("compress_segmentby = 'node_id, event_type'", conn.called("timescaledb.compress,")[0][0])

    async def test_existing_hand_made_policy_is_replaced_not_duplicated(self):
        conn = FakeConn(chunk_days=1, compression_enabled=True, jobs={"policy_retention": 14})
        result = await retention.apply_target(conn, EVENTS, 30, 7, False)
        self.assertEqual(conn.jobs["policy_retention"], 30)
        self.assertEqual(len(conn.called("remove_retention_policy")), 1)
        self.assertIn("retention 30 d (was 14 days)", result["changes"])
        self.assertEqual(conn.called("timescaledb.compress,"), [])  # already enabled

    async def test_matching_policies_are_left_alone(self):
        conn = FakeConn(chunk_days=1, compression_enabled=True,
                        jobs={"policy_retention": 30, "policy_compression": 7})
        result = await retention.apply_target(conn, EVENTS, 30, 7, False)
        self.assertEqual(result["changes"], [])
        self.assertEqual(conn.calls, [])

    async def test_changed_keep_days_replaces_the_job(self):
        conn = FakeConn(chunk_days=1, compression_enabled=True,
                        jobs={"policy_retention": 30, "policy_compression": 7})
        await retention.apply_target(conn, EVENTS, 60, 14, False)
        self.assertEqual(conn.jobs, {"policy_retention": 60, "policy_compression": 14})

    async def test_legal_hold_removes_retention_and_keeps_compression(self):
        conn = FakeConn(chunk_days=1, compression_enabled=True,
                        jobs={"policy_retention": 30, "policy_compression": 7})
        result = await retention.apply_target(conn, EVENTS, 30, 7, True)
        self.assertEqual(conn.jobs, {"policy_compression": 7})
        self.assertIn("retention removed (legal hold)", result["changes"])
        await retention.apply_target(conn, EVENTS, 30, 7, False)  # hold lifted
        self.assertEqual(conn.jobs["policy_retention"], 30)

    async def test_compression_off_removes_only_the_policy(self):
        conn = FakeConn(chunk_days=1, compression_enabled=True,
                        jobs={"policy_retention": 30, "policy_compression": 7})
        await retention.apply_target(conn, EVENTS, 30, None, False)
        self.assertEqual(conn.jobs, {"policy_retention": 30})

    async def test_hardware_changes_keep_weekly_chunks_without_compression(self):
        conn = FakeConn(chunk_days=7)
        await retention.apply_target(conn, HARDWARE, 365, None, False)
        self.assertEqual(conn.jobs, {"policy_retention": 365})
        self.assertEqual(conn.called("set_chunk_time_interval"), [])
        self.assertFalse(conn.compression_enabled)

    async def test_plain_table_is_reported_not_deleted_row_by_row(self):
        conn = FakeConn(hypertable=False)
        result = await retention.apply_target(conn, EVENTS, 30, 7, False)
        self.assertFalse(result["applied"])
        self.assertEqual(conn.calls, [])


class ValidateTests(unittest.TestCase):
    def test_valid(self):
        self.assertIsNone(retention.validate(30, 7))
        self.assertIsNone(retention.validate(30, None))

    def test_invalid(self):
        for keep, compress in [(0, None), (3651, None), ("30", None), (True, None), (30.5, None),
                               (30, 0), (30, 30), (30, 31), (30, "7")]:
            with self.subTest(keep=keep, compress=compress):
                self.assertIsNotNone(retention.validate(keep, compress))

    def test_defaults(self):
        self.assertEqual(retention.TARGETS["security_events"].keep_days, 30)
        self.assertEqual(retention.TARGETS["security_events"].table, "events_normalized")
        for target in retention.TARGETS.values():
            self.assertIsNone(retention.validate(target.keep_days, target.compress_after_days))


if __name__ == "__main__":
    unittest.main()
