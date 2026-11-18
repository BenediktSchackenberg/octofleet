"""Security -> Events node filter: the computer account HOST$ and the exact name find the node's
events; the total is counted up to a cap."""

import os
import time

import requests

BASE = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
API_KEY = os.getenv("INVENTORY_API_KEY", "ci-test-api-key")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ci-test-admin-password-2026")


def test_node_filter_takes_the_computer_account_and_counts_with_a_cap():
    login = requests.post(f"{BASE}/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD}, timeout=10)
    assert login.status_code == 200, login.text
    admin = {"Authorization": f"Bearer {login.json()['access_token']}"}
    node = f"FILTER-{int(time.time() * 1000)}"
    batch = {"events": [{"event_type": "logon.success", "node_id": node, "user": {"username": f"{node}$"}},
                        {"event_type": "service.start", "node_id": node}]}
    stored = requests.post(f"{BASE}/ingest/events/normalized", headers={"X-API-Key": API_KEY}, json=batch, timeout=10)
    assert stored.status_code == 200, stored.text

    for value in (node, f"{node}$", f" {node}$ "):
        r = requests.get(f"{BASE}/events", headers=admin, params={"node_id": value}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert sorted(e["event_type"] for e in body["events"]) == ["logon.success", "service.start"], value
        assert body["total"] == 2 and body["total_capped"] is False

    typed = requests.get(f"{BASE}/events", headers=admin,
                         params={"node_id": f"{node}$", "event_type": "service.start"}, timeout=10).json()
    assert [e["event_type"] for e in typed["events"]] == ["service.start"] and typed["total"] == 1

    none = requests.get(f"{BASE}/events", headers=admin, params={"node_id": "no-such-node-*"}, timeout=10).json()
    assert none["events"] == [] and none["total"] == 0
