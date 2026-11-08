"""Field names of GET /api/v1/inventory/hotfixes/{node}, which the node page's Updates tab reads."""
import os
import uuid

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
HEADERS = {"X-API-Key": os.getenv("INVENTORY_API_KEY") or "", "Content-Type": "application/json"}


def user_headers():
    token = os.getenv("TEST_ADMIN_TOKEN")
    if not token:
        login = requests.post(f"{API_URL}/api/v1/auth/login", timeout=10, json={
            "username": os.getenv("TEST_USERNAME", "admin"),
            "password": os.getenv("TEST_PASSWORD", "Octofleet2026!"),
        })
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_update_history_returns_kb_date_and_result():
    hostname = f"hotfix-fields-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/hotfixes", headers=HEADERS, timeout=30, json={
        "hostname": hostname, "nodeId": hostname,
        "hotfixes": [{"hotfixId": "KB5000001", "description": "Security Update", "installedOn": "2026-10-16"}],
        "updateHistory": [{"updateId": "u-1", "kbId": "KB2267602", "title": "Security Intelligence Update (KB2267602)",
                           "installedOn": "2026-11-01T08:00:00Z", "operation": "Installation", "resultCode": "Succeeded"}],
    })
    assert r.status_code == 200, r.text

    r = requests.get(f"{API_URL}/api/v1/inventory/hotfixes/{hostname}", headers=user_headers(), timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    hotfix = data["hotfixes"][0]
    assert hotfix["hotfixId"] == "KB5000001"
    assert hotfix["installedOn"].startswith("2026-10-16")
    entry = data["updateHistory"][0]
    assert entry["kbId"] == "KB2267602"
    assert entry["installedOn"].startswith("2026-11-01")
    assert entry["resultCode"] == "Succeeded"
