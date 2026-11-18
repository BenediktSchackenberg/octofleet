"""network.connect / network.close are off by default and dropped on ingest; listening ports
and other events are kept; the fleet default can turn them on (Security -> Profiles)."""

import os
import time

import requests

BASE = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
API_KEY = os.getenv("INVENTORY_API_KEY", "ci-test-api-key")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ci-test-admin-password-2026")
AGENT = {"X-API-Key": API_KEY}


def _admin():
    login = requests.post(f"{BASE}/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD}, timeout=10)
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _batch(node):
    def event(event_type):
        return {"event_type": event_type, "node_id": node, "timestamp": "2026-11-18T20:00:00Z",
                "process": {"name": "svc", "pid": 1}, "metadata": {"remote_address": "10.0.0.1", "remote_port": 443}}
    return {"events": [event("network.connect"), event("network.close"), event("network.listen"), event("logon.success")]}


def test_connection_events_are_off_by_default_and_can_be_turned_on():
    admin = _admin()
    node = f"NETTEST-{int(time.time() * 1000)}"
    defaults = requests.get(f"{BASE}/monitoring/defaults", headers=admin, timeout=10)
    assert defaults.status_code == 200 and defaults.json()["sensors"]["network_connections"] is False

    policy = requests.get(f"{BASE}/monitoring/nodes/{node}/effective-policy", headers=AGENT, timeout=10).json()
    assert policy["policy"] is None and policy["defaults"]["network_connections"] is False

    off = requests.post(f"{BASE}/ingest/events/normalized", headers=AGENT, json=_batch(node), timeout=10)
    assert off.status_code == 200, off.text
    assert (off.json()["inserted"], off.json()["dropped"]) == (2, 2)

    try:
        assert requests.put(f"{BASE}/monitoring/defaults", headers=admin,
                            json={"sensors": {"network_connections": "yes"}}, timeout=10).status_code == 400
        assert requests.put(f"{BASE}/monitoring/defaults", json={"sensors": {"network_connections": True}},
                            timeout=10).status_code in (401, 403)
        on = requests.put(f"{BASE}/monitoring/defaults", headers=admin,
                          json={"sensors": {"network_connections": True}}, timeout=10)
        assert on.status_code == 200 and on.json()["sensors"]["network_connections"] is True
        kept = requests.post(f"{BASE}/ingest/events/normalized", headers=AGENT, json=_batch(node), timeout=10)
        assert (kept.json()["inserted"], kept.json()["dropped"]) == (4, 0)
    finally:
        requests.put(f"{BASE}/monitoring/defaults", headers=admin,
                     json={"sensors": {"network_connections": False}}, timeout=10)

    events = requests.get(f"{BASE}/events", headers=admin, params={"node_id": node, "limit": 50}, timeout=10)
    assert events.status_code == 200, events.text
    types = sorted(e["event_type"] for e in events.json()["events"])
    assert types == sorted(["network.listen", "logon.success"] * 2 + ["network.connect", "network.close"])
