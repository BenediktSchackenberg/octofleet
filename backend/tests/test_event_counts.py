"""Hourly event counts (event_counts.py): the continuous aggregates are created once, with a
refresh policy that starts at once and a retention policy; never twice."""

import unittest

import event_counts


class Conn:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.sql = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def transaction(self):
        return self

    def acquire(self):
        return self

    async def fetch(self, query, *args):
        return [{"view_name": v} for v in self.existing]

    async def execute(self, query, *args):
        self.sql.append((" ".join(query.split()), args))


class EnsureSchemaTests(unittest.IsolatedAsyncioTestCase):
    async def test_creates_both_aggregates_with_policies(self):
        conn = Conn()
        await event_counts.ensure_schema(conn)
        created = [s for s, _ in conn.sql if s.startswith("CREATE MATERIALIZED VIEW")]
        self.assertEqual(len(created), 2)
        for sql in created:
            self.assertIn("timescaledb.continuous", sql)
            self.assertIn("materialized_only = false", sql)  # current hour counted in real time
            self.assertIn("WITH NO DATA", sql)  # never fills at startup
        policies = [a for s, a in conn.sql if "add_continuous_aggregate_policy" in s]
        self.assertEqual(sorted(a[0] for a in policies), sorted(event_counts.VIEWS))
        retention = [a for s, a in conn.sql if "add_retention_policy" in s]
        self.assertEqual({a[1] for a in retention}, {event_counts.KEEP_DAYS})
        self.assertEqual(len([s for s, _ in conn.sql if "next_start => now()" in s]), 2)

    async def test_existing_aggregates_are_left_alone(self):
        conn = Conn(existing=event_counts.VIEWS)
        await event_counts.ensure_schema(conn)
        self.assertFalse([s for s, _ in conn.sql if "CREATE" in s or "add_" in s])

    async def test_only_the_missing_one_is_created(self):
        conn = Conn(existing={"event_counts_hourly"})
        await event_counts.ensure_schema(conn)
        created = [s for s, _ in conn.sql if s.startswith("CREATE MATERIALIZED VIEW")]
        self.assertEqual(len(created), 1)
        self.assertIn("file_event_counts_hourly", created[0])

    def test_counts_do_not_grow_with_nodes(self):
        for sql in event_counts.VIEWS.values():
            self.assertNotIn("node_id", sql)


if __name__ == "__main__":
    unittest.main()
