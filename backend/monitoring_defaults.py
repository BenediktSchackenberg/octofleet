"""Fleet-wide sensor defaults and the effective monitoring settings of a node.

A node's sensors come from its monitoring profile (node assignment first, then group). A sensor
the profile does not set falls back to the fleet default (table monitoring_defaults, one row),
and a sensor set nowhere is on. The agent gets both in GET /monitoring/nodes/{id}/effective-policy.

network_connections (network.connect / network.close events) is off by default: on one Windows
server it produced ~400,000 events a day (98 % of all security events) that no rule, finding or
alert used. network.listen (open ports) belongs to network_monitor and stays on.

The ingest endpoint drops connect/close events of nodes where network_connections is off, so
agents that do not know the setting yet are covered too. It looks the setting up per node and
keeps it CACHE_SECONDS, so a batch costs no query in the steady state.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Callable, Optional

SENSORS = ("file_audit", "process_monitor", "network_monitor", "network_connections",
           "registry_monitor", "logon_events", "service_changes")
SENSOR_DEFAULTS = {"network_connections": False}
NETWORK_CONNECTION_EVENTS = frozenset({"network.connect", "network.close"})
CACHE_SECONDS = 60.0

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS monitoring_defaults (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    sensors jsonb NOT NULL DEFAULT '{}',
    updated_by text,
    updated_at timestamptz DEFAULT now()
);
"""

# Node assignment first (highest priority), then group assignment; same rules as before.
# Both lookups use indexes (nodes.hostname / nodes.id, device_groups.node_id).
EFFECTIVE_PROFILE_SQL = {
    "node": """
        SELECT a.*, p.name as profile_name, p.sensors, p.sampling, p.include_paths, p.exclude_paths
        FROM monitoring_assignments a
        JOIN monitoring_profiles p ON p.id = a.profile_id
        WHERE a.target_type = 'node' AND a.target_id = ANY($1::text[]) AND a.status = 'active'
            AND (a.end_time IS NULL OR a.end_time > now())
        ORDER BY a.priority DESC LIMIT 1
    """,
    "group": """
        SELECT a.*, p.name as profile_name, p.sensors, p.sampling, p.include_paths, p.exclude_paths
        FROM monitoring_assignments a
        JOIN monitoring_profiles p ON p.id = a.profile_id
        JOIN device_groups dg ON dg.group_id = a.target_id::uuid
        WHERE a.target_type = 'group' AND dg.node_id = $1::uuid AND a.status = 'active'
            AND (a.end_time IS NULL OR a.end_time > now())
        ORDER BY a.priority DESC LIMIT 1
    """,
}


def _as_dict(value) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


async def ensure_schema(pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
        await conn.execute(
            "INSERT INTO monitoring_defaults (id, sensors) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING",
            json.dumps(SENSOR_DEFAULTS))


async def get_defaults(conn) -> dict:
    sensors = await conn.fetchval("SELECT sensors FROM monitoring_defaults WHERE id = 1")
    return {**SENSOR_DEFAULTS, **_as_dict(sensors)}


def validate_sensors(sensors) -> Optional[str]:
    if not isinstance(sensors, dict):
        return "sensors must be an object"
    for key, value in sensors.items():
        if key not in SENSORS:
            return f"unknown sensor {key!r}"
        if not isinstance(value, bool):
            return f"sensor {key!r} must be true or false"
    return None


async def set_defaults(conn, sensors: dict, user: Optional[str]) -> dict:
    merged = {**await get_defaults(conn), **sensors}
    await conn.execute(
        "UPDATE monitoring_defaults SET sensors = $1::jsonb, updated_by = $2, updated_at = now() WHERE id = 1",
        json.dumps(merged), user)
    _cache.clear()
    return merged


async def effective_profile(conn, node_id: str):
    """The node's monitoring profile row (node assignment, else group), or None."""
    resolved = await conn.fetchval("SELECT id::text FROM nodes WHERE hostname = $1", node_id)
    if not resolved and _is_uuid(node_id):
        resolved = await conn.fetchval("SELECT id::text FROM nodes WHERE id = $1::uuid", node_id)
    row = await conn.fetchrow(EFFECTIVE_PROFILE_SQL["node"], [node_id, resolved or node_id])
    if row is None and resolved:
        row = await conn.fetchrow(EFFECTIVE_PROFILE_SQL["group"], resolved)
    return row


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def sensor_enabled(profile_sensors, defaults: dict, sensor: str) -> bool:
    """Profile setting, else fleet default, else on."""
    sensors = _as_dict(profile_sensors)
    if isinstance(sensors.get(sensor), bool):
        return sensors[sensor]
    if isinstance(defaults.get(sensor), bool):
        return defaults[sensor]
    return True


_cache: dict[str, tuple[float, bool]] = {}


async def network_connections_enabled(conn, node_id: str,
                                      clock: Callable[[], float] = time.monotonic) -> bool:
    now = clock()
    hit = _cache.get(node_id)
    if hit and hit[0] > now:
        return hit[1]
    profile = await effective_profile(conn, node_id)
    enabled = sensor_enabled(profile["sensors"] if profile else None, await get_defaults(conn),
                             "network_connections")
    if len(_cache) > 50_000:  # bounded: far above any fleet size, cleared rather than grown
        _cache.clear()
    _cache[node_id] = (now + CACHE_SECONDS, enabled)
    return enabled
