"""Event counters come from hourly counts (continuous aggregates) and still count new events
at once (real-time aggregation)."""

import os
import time

import requests

BASE = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
API_KEY = os.getenv("INVENTORY_API_KEY", "ci-test-api-key")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ci-test-admin-password-2026")


def _counts(headers, **params):
    r = requests.get(f"{BASE}/events/stats", headers=headers, params=params, timeout=10)
    assert r.status_code == 200, r.text
    return {s["event_type"]: s["count"] for s in r.json()["stats"]}


def test_new_events_are_counted_at_once():
    login = requests.post(f"{BASE}/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD}, timeout=10)
    assert login.status_code == 200, login.text
    admin = {"Authorization": f"Bearer {login.json()['access_token']}"}
    event_type = f"test.counted_{int(time.time() * 1000)}"
    before_all, before_week = _counts(admin), _counts(admin, days=7)
    batch = {"events": [{"event_type": event_type, "node_id": "COUNT-TEST"} for _ in range(5)]}
    stored = requests.post(f"{BASE}/ingest/events/normalized", headers={"X-API-Key": API_KEY}, json=batch, timeout=10)
    assert stored.status_code == 200, stored.text
    assert _counts(admin).get(event_type, 0) - before_all.get(event_type, 0) == 5
    assert _counts(admin, days=7).get(event_type, 0) - before_week.get(event_type, 0) == 5

    dashboard = requests.get(f"{BASE}/security/dashboard", headers=admin, timeout=10)
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["events_24h"] >= 5
