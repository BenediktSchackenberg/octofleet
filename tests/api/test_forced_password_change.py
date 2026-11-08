"""While a password change is required, data routes answer 403 "Password change required" – not 401.

The frontend treats 401 as an expired session and signs out, so a 401 here would end the session
before the user can change the password. Revoked sessions must still answer 401.
"""
import os
import uuid

import requests

from user_auth import user_headers

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
KEY = user_headers()


def password(tag):
    return f"Forced-{tag}-{uuid.uuid4().hex[:10]}9!"


def login(name, pw):
    r = requests.post(f"{API}/auth/login", json={"username": name, "password": pw}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_forced_change_answers_403_until_the_password_is_changed():
    p1, p2, p3 = password("a"), password("b"), password("c")
    name = f"forced-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/users", headers=KEY, json={"username": name, "password": p1}, timeout=10)
    assert r.status_code in (200, 201), r.text
    user_id = r.json()["id"]
    # reading fleet data needs a role; viewer is read-only
    assert requests.post(f"{API}/users/{user_id}/roles/viewer", headers=KEY, timeout=10).status_code == 200
    old = login(name, p1)
    r = requests.post(f"{API}/users/{user_id}/password", headers=KEY,
                      json={"new_password": p2, "must_change_password": True}, timeout=10)
    assert r.status_code == 200, r.text

    # the session from before the reset is revoked: still 401
    assert requests.get(f"{API}/nodes", headers=bearer(old), timeout=10).status_code == 401

    token = login(name, p2)
    for path in ("/nodes", "/vulnerabilities/by-node", "/groups"):
        r = requests.get(f"{API}{path}", headers=bearer(token), timeout=10)
        assert r.status_code == 403, (path, r.status_code, r.text)
        assert "Password change required" in r.text, (path, r.text)
    assert requests.get(f"{API}/auth/me", headers=bearer(token), timeout=10).status_code == 200

    r = requests.post(f"{API}/auth/me/password", headers=bearer(token),
                      json={"current_password": p2, "new_password": p3}, timeout=10)
    assert r.status_code == 200, r.text
    assert requests.get(f"{API}/nodes", headers=bearer(login(name, p3)), timeout=10).status_code == 200
