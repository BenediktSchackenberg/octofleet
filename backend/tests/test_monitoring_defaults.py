"""Sensor settings: profile first, then the fleet default, then on (monitoring_defaults.py).
network.connect / network.close are off by default and dropped on ingest where off."""

import unittest

import monitoring_defaults as md


class Conn:
    def __init__(self, profile_sensors=None, defaults=None):
        self.profile_sensors = profile_sensors
        self.defaults = defaults if defaults is not None else {"network_connections": False}
        self.queries = 0

    async def fetchval(self, query, *args):
        self.queries += 1
        if "monitoring_defaults" in query:
            return self.defaults
        return None  # node not found by hostname / id

    async def fetchrow(self, query, *args):
        self.queries += 1
        if "target_type = 'node'" in query and self.profile_sensors is not None:
            return {"sensors": self.profile_sensors}
        return None


class SensorTests(unittest.TestCase):
    def test_profile_wins_then_default_then_on(self):
        defaults = {"network_connections": False}
        self.assertTrue(md.sensor_enabled({"network_connections": True}, defaults, "network_connections"))
        self.assertFalse(md.sensor_enabled({}, defaults, "network_connections"))
        self.assertFalse(md.sensor_enabled(None, defaults, "network_connections"))
        self.assertFalse(md.sensor_enabled('{"network_connections": false}', {}, "network_connections"))
        self.assertTrue(md.sensor_enabled({}, defaults, "process_monitor"))  # set nowhere: on
        self.assertTrue(md.sensor_enabled({}, {}, "network_connections"))

    def test_default_is_off_and_only_connect_close_are_filtered(self):
        self.assertIs(md.SENSOR_DEFAULTS["network_connections"], False)
        self.assertEqual(md.NETWORK_CONNECTION_EVENTS, {"network.connect", "network.close"})

    def test_validate(self):
        self.assertIsNone(md.validate_sensors({"network_connections": True, "file_audit": False}))
        self.assertIsNotNone(md.validate_sensors({"network_connections": "no"}))
        self.assertIsNotNone(md.validate_sensors({"unknown": True}))
        self.assertIsNotNone(md.validate_sensors(["network_connections"]))


class CacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        md._cache.clear()

    async def test_lookup_is_cached_per_node(self):
        conn = Conn(profile_sensors={"network_connections": True})
        now = [100.0]
        self.assertTrue(await md.network_connections_enabled(conn, "WIN1", clock=lambda: now[0]))
        queries = conn.queries
        self.assertTrue(await md.network_connections_enabled(conn, "WIN1", clock=lambda: now[0]))
        self.assertEqual(conn.queries, queries)  # cached: no query
        conn.profile_sensors = {"network_connections": False}
        now[0] += md.CACHE_SECONDS + 1
        self.assertFalse(await md.network_connections_enabled(conn, "WIN1", clock=lambda: now[0]))

    async def test_node_without_profile_uses_default(self):
        self.assertFalse(await md.network_connections_enabled(Conn(), "WIN2"))
        md._cache.clear()
        self.assertTrue(await md.network_connections_enabled(Conn(defaults={"network_connections": True}), "WIN2"))


if __name__ == "__main__":
    unittest.main()
