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


def test_update_history_keeps_each_result():
    """An update installed a second time has the same update ID: its failed and its successful attempt
    are both kept; repeated successes of one update stay one row (the newest)"""
    hostname = f"hotfix-attempts-{uuid.uuid4().hex[:8]}"
    title = "2026-11 Cumulative Update for Microsoft server operating system (KB5136489)"
    r = requests.post(f"{API_URL}/api/v1/inventory/hotfixes", headers=HEADERS, timeout=30, json={
        "hostname": hostname, "nodeId": hostname,
        "hotfixes": [{"hotfixId": "KB5136489", "description": "Update", "installedOn": "2026-11-15"}],
        "updateHistory": [  # the agent sends the newest first
            {"updateId": "cu-1", "kbId": "KB5136489", "title": title, "installedOn": "2026-11-15T15:23:09Z",
             "operation": "Installation", "resultCode": "Succeeded"},
            {"updateId": "app-1", "kbId": None, "title": "9NRZT3Q9R3DL-Microsoft.WindowsAppRuntime", "installedOn": "2026-11-15T09:00:00Z",
             "operation": "Installation", "resultCode": "Succeeded"},
            {"updateId": "cu-1", "kbId": "KB5136489", "title": title, "installedOn": "2026-11-15T14:44:22Z",
             "operation": "Installation", "resultCode": "Failed"},
            {"updateId": "app-1", "kbId": None, "title": "9NRZT3Q9R3DL-Microsoft.WindowsAppRuntime", "installedOn": "2026-11-14T09:00:00Z",
             "operation": "Installation", "resultCode": "Succeeded"},
        ],
    })
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/inventory/hotfixes/{hostname}", headers=user_headers(), timeout=10)
    assert r.status_code == 200, r.text
    history = r.json()["data"]["updateHistory"]
    assert [(e["updateId"], e["resultCode"], e["installedOn"][:10]) for e in history] == [
        ("cu-1", "Succeeded", "2026-11-15"), ("cu-1", "Failed", "2026-11-15"), ("app-1", "Succeeded", "2026-11-15")]

