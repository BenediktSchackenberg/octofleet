"""Node removal (#160): uninstall the agent, confirmed by its removal script, optionally delete the node."""
import json
import os
import time
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Content-Type": "application/json"}
WAIT_SECONDS = 30  # CI runs the removal task every few seconds (NODE_REMOVAL_PROCESS_INTERVAL)


def _register(hostname: str) -> None:
    """Report like an agent so the node exists, including some inventory."""
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30, json={
        "hostname": hostname, "nodeId": hostname,
        "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}},
    })
    assert r.status_code == 200, r.text


def _node(hostname: str):
    return requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)


def _agent_reports_job_result(hostname: str, success: bool) -> dict:
    """Fetch the pending uninstall job like an agent and report its result; returns the job payload."""
    r = requests.get(f"{API_URL}/api/v1/jobs/pending/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    jobs = body.get("jobs", body) if isinstance(body, dict) else body
    job = next(j for j in jobs if j.get("commandType") == "uninstall-agent")
    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{job['instanceId']}/result", headers=HEADERS, timeout=10,
                      json={"success": success, "exitCode": 0 if success else 1, "stdout": "uninstall started"})
    assert r.status_code == 200, r.text
    payload = job.get("commandPayload") or {}
    return json.loads(payload) if isinstance(payload, str) else payload


def _signal(node_id: str, token: str, success: bool = True, details: dict = None):
    """Completion signal of the removal script (no API key: the one-time token authenticates it)."""
    return requests.post(f"{API_URL}/api/v1/agent/uninstall-complete", timeout=10,
                         json={"nodeId": node_id, "token": token, "success": success, "details": details or {}})


def _state(hostname: str):
    r = _node(hostname)
    return r.json()["removalState"] if r.status_code == 200 else None


def _started(hostname: str, delete_after: bool) -> dict:
    """Request the removal, let the agent report the job and wait for uninstall_running."""
    requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                  json={"deleteAfterUninstall": delete_after}, timeout=10).raise_for_status()
    payload = _agent_reports_job_result(hostname, success=True)
    assert payload.get("completionToken") and payload.get("nodeId") == hostname, payload
    _wait_for(lambda: _state(hostname) == "uninstall_running", "the removal to be running")
    return payload


def _wait_for(predicate, what: str):
    deadline = time.time() + WAIT_SECONDS
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(1)
    pytest.fail(f"Timed out waiting for {what}")


@pytest.fixture
def hostname():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    name = f"removal-test-{uuid.uuid4().hex[:8]}"
    _register(name)
    yield name


def test_requires_authentication(hostname):
    assert requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", json={}, timeout=10).status_code == 401
    assert requests.delete(f"{API_URL}/api/v1/nodes/{hostname}", timeout=10).status_code == 401


def test_unknown_node_returns_404():
    assert requests.post(f"{API_URL}/api/v1/nodes/does-not-exist-160/uninstall", headers=HEADERS,
                         json={}, timeout=10).status_code == 404


def test_delete_requires_uninstall_first(hostname):
    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 409
    assert "Uninstall the agent first" in r.json()["detail"]
    assert _node(hostname).status_code == 200


def test_request_and_cancel_uninstall(hostname):
    r = requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                      json={"deleteAfterUninstall": False}, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "uninstall_pending"
    node = _node(hostname).json()
    assert node["removalState"] == "uninstall_pending" and node["canDelete"] is False
    assert node["forceDeleteAfter"]

    # a second request and an early delete are refused
    assert requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                         json={}, timeout=10).status_code == 409
    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}?force=true", headers=HEADERS, timeout=10)
    assert r.status_code == 409 and "has not confirmed" in r.json()["detail"]

    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert _node(hostname).json()["removalState"] is None


def test_job_result_alone_does_not_uninstall(hostname):
    _started(hostname, delete_after=True)
    time.sleep(6)  # several runs of the background task (2 s in CI)
    assert _node(hostname).status_code == 200
    node = _node(hostname).json()
    assert node["removalState"] == "uninstall_running" and node["canDelete"] is False
    # running removals cannot be cancelled: the agent already has the job
    assert requests.delete(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                           timeout=10).status_code == 409


def test_completion_token_is_checked(hostname):
    payload = _started(hostname, delete_after=False)
    token = payload["completionToken"]
    assert _signal(hostname, "wrong-token").status_code == 403
    assert _signal("does-not-exist-160", token).status_code == 403
    assert _state(hostname) == "uninstall_running"
    assert _signal(hostname, token).status_code == 200
    assert _state(hostname) == "uninstalled"
    assert _signal(hostname, token).status_code == 403  # one-time


def test_uninstall_then_delete_and_reinstall(hostname):
    payload = _started(hostname, delete_after=False)
    assert _signal(hostname, payload["completionToken"]).status_code == 200
    node = _node(hostname).json()
    assert node["removalState"] == "uninstalled" and node["canDelete"] is True and node["uninstalledAt"]

    # the machine is set up again: the agent reports and the node is active again
    _register(hostname)
    assert _state(hostname) is None

    # uninstall again, then delete explicitly
    payload = _started(hostname, delete_after=False)
    assert _signal(hostname, payload["completionToken"]).status_code == 200
    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "deleted"
    assert _node(hostname).status_code == 404


def test_uninstall_and_delete(hostname):
    payload = _started(hostname, delete_after=True)
    assert _signal(hostname, payload["completionToken"], details={"warnings": []}).status_code == 200
    _wait_for(lambda: _node(hostname).status_code == 404, "the node to be deleted")


def test_report_after_signal_blocks_delete(hostname):
    payload = _started(hostname, delete_after=True)
    assert _signal(hostname, payload["completionToken"]).status_code == 200
    _register(hostname)  # the agent is still running and reports
    _wait_for(lambda: _state(hostname) == "uninstall_failed", "the delete to be refused")
    node = _node(hostname).json()
    assert "still reported" in node["removalError"]


def test_failure_signal_and_cancel(hostname):
    payload = _started(hostname, delete_after=True)
    assert _signal(hostname, payload["completionToken"], success=False,
                   details={"reason": "agent service still present"}).status_code == 200
    node = _node(hostname).json()
    assert node["removalState"] == "uninstall_failed" and node["removalError"] == "agent service still present"
    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert _state(hostname) is None


def test_failed_job_can_be_cancelled(hostname):
    requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                  json={"deleteAfterUninstall": True}, timeout=10).raise_for_status()
    _agent_reports_job_result(hostname, success=False)
    _wait_for(lambda: _state(hostname) == "uninstall_failed", "the failed state")
    assert "could not start" in _node(hostname).json()["removalError"]
    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert _state(hostname) is None


def test_missing_signal_times_out(hostname):
    _started(hostname, delete_after=True)  # CI: NODE_REMOVAL_COMPLETE_TIMEOUT_MINUTES = 0.2
    _wait_for(lambda: _state(hostname) == "uninstall_failed", "the timeout")
    assert "No completion signal" in _node(hostname).json()["removalError"]
    assert _node(hostname).status_code == 200  # not deleted
