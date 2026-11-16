"""OSV advisory cache: status for readers, clear and verify only with settings:write."""
import os
import uuid

import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
ADMIN = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}


def viewer_headers():
    name, password = f"cache-viewer-{uuid.uuid4().hex[:8]}", f"Cache-{uuid.uuid4().hex[:10]}9!"
    r = requests.post(f"{API}/users", headers=ADMIN, json={"username": name, "password": password}, timeout=10)
    assert r.status_code in (200, 201), r.text
    user_id = r.json()["id"]
    assert requests.post(f"{API}/users/{user_id}/roles/viewer", headers=ADMIN, timeout=10).status_code == 200
    token = requests.post(f"{API}/auth/login", json={"username": name, "password": password}, timeout=10).json()["access_token"]
    return user_id, {"Authorization": f"Bearer {token}"}


def test_status_clear_and_verify_on_an_empty_cache():
    r = requests.delete(f"{API}/vulnerabilities/osv-cache", headers=ADMIN, timeout=10)
    assert r.status_code == 200, r.text
    status = requests.get(f"{API}/vulnerabilities/osv-cache", headers=ADMIN, timeout=10)
    assert status.status_code == 200, status.text
    body = status.json()
    assert body["entries"] == 0 and body["outdated"] == 0 and body["max_age_days"] == 30
    assert "last_rebuilt" in body
    scans = requests.get(f"{API}/vulnerabilities/scans?limit=1", headers=ADMIN, timeout=10).json().get("scans", [])
    for scan in scans:  # the scan history carries the cache numbers (null for scans before the cache)
        assert {"osv_cached", "osv_downloaded", "cache_refresh"} <= scan.keys()
    r = requests.post(f"{API}/vulnerabilities/osv-cache/verify?sample=5", headers=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["checked"] == 0
    assert requests.post(f"{API}/vulnerabilities/osv-cache/verify?sample=0", headers=ADMIN, timeout=10).status_code == 422


def test_viewers_see_the_status_but_cannot_clear_or_verify():
    user_id, viewer = viewer_headers()
    try:
        assert requests.get(f"{API}/vulnerabilities/osv-cache", headers=viewer, timeout=10).status_code == 200
        assert requests.delete(f"{API}/vulnerabilities/osv-cache", headers=viewer, timeout=10).status_code == 403
        assert requests.post(f"{API}/vulnerabilities/osv-cache/verify", headers=viewer, timeout=10).status_code == 403
    finally:
        requests.delete(f"{API}/users/{user_id}", headers=ADMIN, timeout=10)


def test_the_cache_needs_a_login():
    assert requests.get(f"{API}/vulnerabilities/osv-cache", timeout=10).status_code == 401
