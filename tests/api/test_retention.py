"""Retention settings are applied as TimescaleDB jobs (Security -> Retention)."""

import os

import requests

BASE = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ci-test-admin-password-2026")


def _headers():
    login = requests.post(f"{BASE}/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD}, timeout=10)
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _items(headers):
    response = requests.get(f"{BASE}/retention", headers=headers, timeout=10)
    assert response.status_code == 200, response.text
    return {i["category"]: i for i in response.json()["retention"]}


def _job_types(item):
    return sorted(j["type"] for j in item["jobs"])


def test_defaults_are_applied_at_startup():
    items = _items(_headers())
    assert set(items) == {"security_events", "file_events", "performance_metrics", "hardware_changes"}
    events = items["security_events"]
    assert events["table"] == "events_normalized"
    assert events["applied"] is True
    assert (events["keep_days"], events["compress_after_days"], events["legal_hold"]) == (30, 7, False)
    assert _job_types(events) == ["compression", "retention"]
    assert _job_types(items["hardware_changes"]) == ["retention"]


def test_change_legal_hold_and_restore():
    headers = _headers()
    url = f"{BASE}/retention/security_events"
    try:
        assert requests.put(url, headers=headers, json={"keep_days": 30, "compress_after_days": 30},
                            timeout=10).status_code == 400
        assert requests.put(url, headers=headers, json={"keep_days": 0}, timeout=10).status_code == 400
        assert requests.put(f"{BASE}/retention/no_such_data", headers=headers, json={}, timeout=10).status_code == 404

        changed = requests.put(url, headers=headers, json={"keep_days": 45, "compress_after_days": None}, timeout=10)
        assert changed.status_code == 200, changed.text
        assert (changed.json()["keep_days"], changed.json()["compress_after_days"]) == (45, None)
        assert _job_types(changed.json()) == ["retention"]

        held = requests.put(url, headers=headers, json={"legal_hold": True}, timeout=10)
        assert held.status_code == 200, held.text
        assert held.json()["legal_hold"] is True and _job_types(held.json()) == []

        stats = requests.get(f"{BASE}/events/stats", headers=headers, timeout=10).json()
        assert stats["retention"]["retention_days"] == 45 and stats["retention"]["legal_hold"] is True
    finally:
        restored = requests.put(url, headers=headers,
                                json={"keep_days": 30, "compress_after_days": 7, "legal_hold": False}, timeout=10)
        assert restored.status_code == 200, restored.text
    assert _job_types(restored.json()) == ["compression", "retention"]


def test_changes_need_a_login():
    response = requests.put(f"{BASE}/retention/security_events", json={"keep_days": 1}, timeout=10)
    assert response.status_code in (401, 403)
