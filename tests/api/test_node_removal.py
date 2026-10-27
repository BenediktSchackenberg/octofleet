"""Node removal (#160): uninstall the agent, optionally delete the node."""
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
    """Fetch the pending uninstall job like an agent and report its result."""
    r = requests.get(f"{API_URL}/api/v1/jobs/pending/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    jobs = body.get("jobs", body) if isinstance(body, dict) else body
    job = next(j for j in jobs if j.get("commandType") == "uninstall-agent")
    payload = json.loads(job["commandPayload"])
    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{job['instanceId']}/result", headers=HEADERS, timeout=10,
                      json={"success": success, "exitCode": 0 if success else 1, "stdout": "uninstall started"})
    assert r.status_code == 200, r.text
    return payload


def _confirm_uninstall(payload: dict) -> None:
    url = f"{API_URL}/api/v1/nodes/{payload['confirmationNodeId']}/uninstall/complete"
    # A scheduled job alone cannot delete the node; only the detached script's
    # one-time token confirms that the service and files were removed.
    assert requests.post(url, json={"confirmationToken": payload["confirmationToken"]}, timeout=10).status_code == 401
    assert requests.post(url, headers=HEADERS, json={"confirmationToken": "wrong" * 9}, timeout=10).status_code == 403
    r = requests.post(url, headers=HEADERS, json={"confirmationToken": payload["confirmationToken"]}, timeout=10)
    assert r.status_code == 200, r.text
    assert requests.post(url, headers=HEADERS, json={"confirmationToken": payload["confirmationToken"]}, timeout=10).status_code == 403


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


def test_uninstall_then_delete_and_reinstall(hostname):
    requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                  json={"deleteAfterUninstall": False}, timeout=10).raise_for_status()
    payload = _agent_reports_job_result(hostname, success=True)
    time.sleep(3)
    assert _node(hostname).json()["removalState"] == "uninstall_pending"
    _confirm_uninstall(payload)
    _wait_for(lambda: _node(hostname).json()["removalState"] == "uninstalled", "the node to be marked uninstalled")
    node = _node(hostname).json()
    assert node["canDelete"] is True and node["uninstalledAt"]

    # the machine is set up again: the agent reports and the node is active again
    _register(hostname)
    assert _node(hostname).json()["removalState"] is None

    # uninstall again, then delete explicitly
    requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                  json={"deleteAfterUninstall": False}, timeout=10).raise_for_status()
    _confirm_uninstall(_agent_reports_job_result(hostname, success=True))
    _wait_for(lambda: _node(hostname).json()["removalState"] == "uninstalled", "the second uninstall")
    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "deleted"
    assert _node(hostname).status_code == 404


def test_uninstall_and_delete(hostname):
    requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                  json={"deleteAfterUninstall": True}, timeout=10).raise_for_status()
    payload = _agent_reports_job_result(hostname, success=True)
    time.sleep(3)
    assert _node(hostname).status_code == 200
    _confirm_uninstall(payload)
    _wait_for(lambda: _node(hostname).status_code == 404, "the node to be deleted")


def test_failed_uninstall_can_be_cancelled(hostname):
    requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                  json={"deleteAfterUninstall": True}, timeout=10).raise_for_status()
    _agent_reports_job_result(hostname, success=False)
    _wait_for(lambda: _node(hostname).json()["removalState"] == "uninstall_failed", "the failed state")
    assert _node(hostname).status_code == 200  # not deleted
    r = requests.delete(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert _node(hostname).json()["removalState"] is None
