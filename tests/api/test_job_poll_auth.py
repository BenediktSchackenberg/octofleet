"""The agent poll routes hand out job payloads and claim the jobs they return, so they need
`jobs:poll` (the agent key), like the result routes."""
import os
import uuid

import pytest
import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
KEY = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}
POLLS = ["/jobs/pending/poll-auth-node", "/remediation/jobs/pending/poll-auth-node"]


@pytest.mark.parametrize("path", POLLS)
def test_poll_without_credentials_is_rejected(path):
    assert requests.get(f"{API}{path}", timeout=10).status_code == 401


@pytest.mark.parametrize("path", POLLS)
def test_poll_with_a_wrong_key_is_rejected(path):
    r = requests.get(f"{API}{path}", headers={"X-API-Key": "not-a-valid-key"}, timeout=10)
    assert r.status_code == 401


@pytest.mark.parametrize("path", POLLS)
def test_poll_with_the_key_works(path):
    r = requests.get(f"{API}{path}", headers=KEY, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["jobs"] == []


def test_a_signed_in_viewer_cannot_poll():
    name = f"poll-viewer-{uuid.uuid4().hex[:8]}"
    password = f"Poll-{uuid.uuid4().hex[:10]}9!"
    r = requests.post(f"{API}/users", headers=KEY, json={"username": name, "password": password}, timeout=10)
    assert r.status_code in (200, 201), r.text
    user_id = r.json()["id"]
    try:
        assert requests.post(f"{API}/users/{user_id}/roles/viewer", headers=KEY, timeout=10).status_code == 200
        login = requests.post(f"{API}/auth/login", json={"username": name, "password": password}, timeout=10)
        assert login.status_code == 200, login.text
        viewer = {"Authorization": f"Bearer {login.json()['access_token']}"}
        for path in POLLS:
            assert requests.get(f"{API}{path}", headers=viewer, timeout=10).status_code == 403, path
    finally:
        requests.delete(f"{API}/users/{user_id}", headers=KEY, timeout=10)
