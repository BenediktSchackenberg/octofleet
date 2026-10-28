"""End-to-end checks for local account password controls (#161)."""

import os
import time

import requests

BASE = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ci-test-admin-password-2026")


def _login(username, password):
    return requests.post(f"{BASE}/auth/login", json={"username": username, "password": password}, timeout=10)


def test_password_policy_reset_and_revocation():
    admin = _login("admin", ADMIN_PASSWORD)
    assert admin.status_code == 200, admin.text
    assert admin.json()["user"]["must_change_password"] is False
    admin_token = admin.json()["access_token"]
    headers = {"Authorization": f"Bearer {admin_token}"}
    username = f"password-test-{int(time.time() * 1000)}"
    original = requests.get(f"{BASE}/security/password-policy", headers=headers, timeout=10).json()
    try:
        policy = {**original, "min_length": 12, "require_uppercase": True,
                  "require_lowercase": True, "require_digit": True,
                  "require_symbol": True, "history_count": 2}
        assert requests.put(f"{BASE}/security/password-policy", headers=headers, json=policy, timeout=10).status_code == 200
        assert requests.put(f"{BASE}/settings/password_policy", json={"value": "{}"}, timeout=10).status_code == 400

        weak = requests.post(f"{BASE}/users", headers=headers,
                             json={"username": username, "password": "alllowercasepassword"}, timeout=10)
        assert weak.status_code == 400, weak.text
        created = requests.post(f"{BASE}/users", headers=headers,
                                json={"username": username, "password": "StartPassword1!"}, timeout=10)
        assert created.status_code == 200, created.text
        user_id = created.json()["id"]
        assert _login(username, "wrong-password").status_code == 401

        reset = requests.post(f"{BASE}/users/{user_id}/password", headers=headers,
                              json={"new_password": "TemporaryPass2!", "must_change_password": True}, timeout=10)
        assert reset.status_code == 200, reset.text
        temporary = _login(username, "TemporaryPass2!")
        assert temporary.status_code == 200, temporary.text
        assert temporary.json()["user"]["must_change_password"] is True
        temporary_token = temporary.json()["access_token"]
        temp_headers = {"Authorization": f"Bearer {temporary_token}"}
        assert requests.get(f"{BASE}/auth/permissions", headers=temp_headers, timeout=10).status_code == 403
        assert requests.get(f"{BASE}/security/password-policy", headers=temp_headers, timeout=10).status_code == 403

        changed = requests.post(f"{BASE}/auth/me/password", headers=temp_headers,
                                json={"current_password": "TemporaryPass2!", "new_password": "FinalPassword3!"}, timeout=10)
        assert changed.status_code == 200, changed.text
        assert requests.get(f"{BASE}/auth/me", headers=temp_headers, timeout=10).status_code == 401
        final = _login(username, "FinalPassword3!")
        assert final.status_code == 200 and final.json()["user"]["must_change_password"] is False
        final_headers = {"Authorization": f"Bearer {final.json()['access_token']}"}
        reuse = requests.post(f"{BASE}/auth/me/password", headers=final_headers,
                              json={"current_password": "FinalPassword3!", "new_password": "TemporaryPass2!"}, timeout=10)
        assert reuse.status_code == 400, reuse.text
        assert requests.post(f"{BASE}/auth/logout", headers=final_headers, timeout=10).status_code == 200
        assert requests.get(f"{BASE}/auth/me", headers=final_headers, timeout=10).status_code == 401

        audit = requests.get(f"{BASE}/audit?action=auth.login_failed", headers=headers, timeout=10)
        assert audit.status_code == 200 and any(e["username"] == username for e in audit.json()["entries"])
    finally:
        requests.put(f"{BASE}/security/password-policy", headers=headers, json=original, timeout=10)
