"""Agent long-poll (#283): GET /api/v1/agent/wait/{node_id} holds the request until there is work for
the node, or answers empty after the hold time. Needs `jobs:poll` (the agent key)."""
import os
import threading
import time
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API = API_URL + "/api/v1"
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}


def wait(node, timeout=1, kinds=None, headers=HEADERS):
    params = {"timeout": timeout}
    if kinds:
        params["kinds"] = kinds
    started = time.monotonic()
    r = requests.get(f"{API}/agent/wait/{node}", headers=headers, params=params, timeout=timeout + 15)
    return r, time.monotonic() - started


def wait_in_background(node, timeout=20):
    """Start a long-poll; returns a function that waits for its (response, seconds)."""
    result = {}
    thread = threading.Thread(target=lambda: result.update(answer=wait(node, timeout)))
    thread.start()
    time.sleep(1)  # the request is held now

    def finish():
        thread.join(timeout + 20)
        return result["answer"]
    return finish


@pytest.fixture
def node():
    """A node registered like an agent; returns (hostname, node uuid)."""
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"wait-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname,
                            "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API}/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


def test_empty_after_the_hold_time():
    r, took = wait(f"wait-idle-{uuid.uuid4().hex[:8]}", timeout=2)
    assert r.status_code == 200, r.text
    assert r.json() == {"wake": []}
    assert 1.7 <= took < 10  # 2 s minus up to 10 % jitter


def test_wakes_at_once_for_a_new_job(node):
    hostname, node_uuid = node
    finish = wait_in_background(hostname)
    created = time.monotonic()
    r = requests.post(f"{API}/jobs", headers=HEADERS, timeout=10, json={
        "name": "long-poll test", "targetType": "device", "targetId": node_uuid,
        "commandType": "script", "commandData": {"script": "true"},
    })
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    try:
        answer, _ = finish()
        assert answer.status_code == 200, answer.text
        assert "jobs" in answer.json()["wake"]
        assert time.monotonic() - created < 5

        # still pending: the next request answers at once
        r, took = wait(hostname, timeout=10)
        assert "jobs" in r.json()["wake"] and took < 5
        # the job poll hands it out; then there is nothing left
        r = requests.get(f"{API}/jobs/pending/{hostname}", headers=HEADERS, timeout=10)
        assert r.status_code == 200 and r.json()["jobs"], r.text
        r, _ = wait(hostname, timeout=1)
        assert r.json() == {"wake": []}
    finally:
        requests.delete(f"{API}/jobs/{job_id}", headers=HEADERS, timeout=10)


def test_wakes_at_once_for_a_terminal_command():
    node = f"wait-term-{uuid.uuid4().hex[:8]}"
    finish = wait_in_background(node)
    r = requests.post(f"{API}/terminal/start/{node}", headers=HEADERS, json={"shell": "bash"}, timeout=10)
    assert r.status_code == 200, r.text
    session_id = r.json()["sessionId"]
    try:
        answer, took = finish()
        assert answer.json() == {"wake": ["terminal"]}  # a terminal page opened
        assert took < 6

        finish = wait_in_background(node)
        sent = time.monotonic()
        r = requests.post(f"{API}/terminal/session/{session_id}/input", headers=HEADERS,
                          json={"command": "hostname"}, timeout=10)
        assert r.status_code == 200, r.text
        answer, _ = finish()
        assert answer.json() == {"wake": ["terminal"]}
        assert time.monotonic() - sent < 5

        r = requests.get(f"{API}/terminal/pending/{node}", headers=HEADERS, timeout=10)
        assert r.json()["commands"], r.text
        r, _ = wait(node, timeout=1)
        assert r.json() == {"wake": []}
    finally:
        requests.delete(f"{API}/terminal/session/{session_id}", headers=HEADERS, timeout=10)


def test_only_the_kinds_asked_for():
    node = f"wait-kinds-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/terminal/start/{node}", headers=HEADERS, json={"shell": "bash"}, timeout=10)
    session_id = r.json()["sessionId"]
    try:
        requests.post(f"{API}/terminal/session/{session_id}/input", headers=HEADERS, json={"command": "x"}, timeout=10)
        r, _ = wait(node, timeout=1, kinds="jobs")
        assert r.json() == {"wake": []}
    finally:
        requests.delete(f"{API}/terminal/session/{session_id}", headers=HEADERS, timeout=10)


def test_without_credentials_is_rejected():
    r, _ = wait("wait-auth-node", timeout=0, headers={})
    assert r.status_code == 401


def test_with_a_wrong_key_is_rejected():
    r, _ = wait("wait-auth-node", timeout=0, headers={"X-API-Key": "not-a-valid-key"})
    assert r.status_code == 401


def test_a_signed_in_viewer_cannot_wait():
    name = f"wait-viewer-{uuid.uuid4().hex[:8]}"
    password = f"Wait-{uuid.uuid4().hex[:10]}9!"
    r = requests.post(f"{API}/users", headers=HEADERS, json={"username": name, "password": password}, timeout=10)
    assert r.status_code in (200, 201), r.text
    user_id = r.json()["id"]
    try:
        assert requests.post(f"{API}/users/{user_id}/roles/viewer", headers=HEADERS, timeout=10).status_code == 200
        login = requests.post(f"{API}/auth/login", json={"username": name, "password": password}, timeout=10)
        assert login.status_code == 200, login.text
        r, _ = wait("wait-auth-node", timeout=0, headers={"Authorization": f"Bearer {login.json()['access_token']}"})
        assert r.status_code == 403
    finally:
        requests.delete(f"{API}/users/{user_id}", headers=HEADERS, timeout=10)
