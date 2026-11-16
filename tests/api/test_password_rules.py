"""GET /auth/password-rules: the password rules for every signed-in user, also while a change is required.

The change-password dialog and page show the rules before the server rejects a password; the policy
itself (GET/PUT /security/password-policy) stays `settings:write`.
"""
import os
import uuid

import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
KEY = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}


def password(tag):
    return f"Rules-{tag}-{uuid.uuid4().hex[:10]}9!"


def login(name, pw):
    r = requests.post(f"{API}/auth/login", json={"username": name, "password": pw}, timeout=10)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_rules_need_a_login():
    assert requests.get(f"{API}/auth/password-rules", timeout=10).status_code == 401


def test_a_viewer_reads_the_rules_during_a_forced_change_but_not_the_policy():
    original = requests.get(f"{API}/security/password-policy", headers=KEY, timeout=10)
    assert original.status_code == 200, original.text
    original = original.json()
    changed = {**original, "min_length": 14, "require_digit": True, "history_count": 3}
    r = requests.put(f"{API}/security/password-policy", headers=KEY, json=changed, timeout=10)
    assert r.status_code == 200, r.text
    user_id = None
    try:
        p1, p2 = password("a"), password("b")
        name = f"rules-{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/users", headers=KEY, json={"username": name, "password": p1}, timeout=10)
        assert r.status_code in (200, 201), r.text
        user_id = r.json()["id"]
        assert requests.post(f"{API}/users/{user_id}/roles/viewer", headers=KEY, timeout=10).status_code == 200
        r = requests.post(f"{API}/users/{user_id}/password", headers=KEY,
                          json={"new_password": p2, "must_change_password": True}, timeout=10)
        assert r.status_code == 200, r.text
        viewer = login(name, p2)

        r = requests.get(f"{API}/auth/password-rules", headers=viewer, timeout=10)
        assert r.status_code == 200, r.text
        rules = r.json()
        assert rules["min_length"] == 14 and rules["require_digit"] is True and rules["history_count"] == 3
        assert rules["max_bytes"] == 72
        # the policy itself stays admin-only
        assert requests.get(f"{API}/security/password-policy", headers=viewer, timeout=10).status_code == 403
    finally:
        requests.put(f"{API}/security/password-policy", headers=KEY, json=original, timeout=10)
        if user_id:
            requests.delete(f"{API}/users/{user_id}", headers=KEY, timeout=10)
