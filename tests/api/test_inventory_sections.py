"""Inventory sections survive a full agent push, including two users with the same browser profile name."""

import os
import uuid

import requests


API_URL = os.getenv("API_URL", "http://localhost:8080")


def test_linux_security_and_multi_user_browser_round_trip():
    node_id = f"inventory-{uuid.uuid4().hex}"
    headers = {"X-API-Key": os.environ["INVENTORY_API_KEY"]}
    user_headers = {"Authorization": f"Bearer {os.environ['TEST_ADMIN_TOKEN']}"}
    payload = {
        "hostname": node_id,
        "nodeId": node_id,
        "security": {"ssh": {"port": "2222", "permitRootLogin": "no"}},
        "browser": {"users": [
            {"username": username, "edge": {"installed": True, "profiles": [
                {"name": "Default", "historyCount": count, "bookmarksCount": 0,
                 "cookiesCount": 0, "loginsCount": 0, "extensions": []},
            ]}} for username, count in (("alice", 3), ("bob", 7))
        ]},
    }
    pushed = requests.post(f"{API_URL}/api/v1/inventory/full", json=payload, headers=headers, timeout=15)
    assert pushed.status_code == 200, pushed.text
    assert set(pushed.json()["submitted"]) == {"security", "browser"}, pushed.text

    security = requests.get(f"{API_URL}/api/v1/inventory/security/{node_id}", headers=user_headers, timeout=10)
    assert security.status_code == 200, security.text
    assert security.json()["data"]["linux"]["ssh"]["port"] == "2222"

    browser = requests.get(f"{API_URL}/api/v1/inventory/browser/{node_id}", headers=user_headers, timeout=10)
    assert browser.status_code == 200, browser.text
    users = browser.json()["data"]["users"]
    assert users["alice"]["Edge"]["profiles"][0]["historyCount"] == 3
    assert users["bob"]["Edge"]["profiles"][0]["historyCount"] == 7

    cleared = requests.post(
        f"{API_URL}/api/v1/inventory/full", json={"hostname": node_id, "nodeId": node_id,
                                                    "browser": {"users": []}},
        headers=headers, timeout=15,
    )
    assert cleared.status_code == 200, cleared.text
    assert "browser" in cleared.json()["submitted"]
    browser = requests.get(f"{API_URL}/api/v1/inventory/browser/{node_id}", headers=user_headers, timeout=10)
    assert browser.status_code == 200, browser.text
    assert browser.json()["data"]["users"] == {}


def test_windows_app_control_applocker_and_vbs_round_trip():
    node_id = f"inventory-{uuid.uuid4().hex}"
    headers = {"X-API-Key": os.environ["INVENTORY_API_KEY"]}
    user_headers = {"Authorization": f"Bearer {os.environ['TEST_ADMIN_TOKEN']}"}
    security = {
        "firewall": {"profiles": [{"name": "Domain", "enabled": True}]},
        "deviceGuard": {"available": True, "codeIntegrityPolicyEnforcementStatus": 2,
                        "usermodeCodeIntegrityPolicyEnforcementStatus": 1, "virtualizationBasedSecurityStatus": 2,
                        "securityServicesConfigured": [1, 2], "securityServicesRunning": [2]},
        "appControl": {"policySource": "citool", "vulnerableDriverBlocklistEnable": 1, "policies": [
            {"policyId": "d2bda982-ccf6-4344-ac5b-0b44427b6816", "basePolicyId": "d2bda982-ccf6-4344-ac5b-0b44427b6816",
             "friendlyName": "Microsoft Windows Driver Policy", "isSystemPolicy": True, "isEnforced": True}]},
        "appLocker": {"available": True, "appIdSvcStatus": "Running",
                      "collections": [{"type": "Exe", "enforcementMode": "AuditOnly", "ruleCount": 3}]},
    }
    pushed = requests.post(f"{API_URL}/api/v1/inventory/full", json={"hostname": node_id, "nodeId": node_id,
                                                                      "security": security},
                           headers=headers, timeout=15)
    assert pushed.status_code == 200, pushed.text
    assert "security" in pushed.json()["submitted"], pushed.text

    response = requests.get(f"{API_URL}/api/v1/inventory/security/{node_id}", headers=user_headers, timeout=10)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["appControl"]["kernelMode"], data["appControl"]["userMode"]) == ("enforced", "audit")
    assert data["appControl"]["vulnerableDriverBlocklist"] == "on"
    assert data["appControl"]["policies"][0]["name"] == "Microsoft Windows Driver Policy"
    collections = {c["type"]: c["state"] for c in data["appLocker"]["collections"]}
    assert collections == {"exe": "audit", "msi": "off", "script": "off", "dll": "off", "appx": "off"}
    assert data["appLocker"]["appIdSvc"] == "running"
    assert data["vbs"]["status"] == "running"
    assert data["vbs"]["services"] == {"credentialGuard": "notRunning", "hvci": "running", "systemGuard": "off"}
