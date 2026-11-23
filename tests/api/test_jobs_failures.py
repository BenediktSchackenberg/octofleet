"""GET /api/v1/jobs/failures: open job failures per node and job type (the Tasks page)."""
import os
import uuid

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}


def _node():
    hostname = f"failures-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname,
                            "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


def _run(node_uuid, command_type, success, stdout=""):
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json={
        "name": f"failures test {command_type}", "targetType": "device", "targetId": node_uuid,
        "commandType": command_type, "commandData": {}})
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    instance = requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10).json()["instances"][0]
    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{instance['id']}/result", headers=HEADERS, timeout=10,
                      json={"success": success, "exitCode": 0 if success else 1, "stdout": stdout})
    assert r.status_code == 200, r.text
    return job_id


def _entries(**params):
    r = requests.get(f"{API_URL}/api/v1/jobs/failures", headers=HEADERS, params=params, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


def test_failure_listed_until_a_later_run_succeeds():
    hostname, node_uuid = _node()
    _run(node_uuid, "patch_scan", False, "Package lists refreshed with apt: failed\nFailed to connect to bus")
    last = _run(node_uuid, "patch_scan", False, "Package lists refreshed with apt: failed\nFailed to connect to bus")

    body = _entries(limit=1000)
    mine = [f for f in body["failures"] if f["node_id"] == node_uuid]
    assert len(mine) == 1
    assert mine[0]["hostname"] == hostname and mine[0]["command_type"] == "patch_scan"
    assert mine[0]["failures"] == 2 and mine[0]["job_id"] == last and not mine[0]["resolved"]
    assert "Failed to connect to bus" in mine[0]["reason"]
    assert body["total"] >= 1 and "resolved" in body

    _run(node_uuid, "patch_scan", True)
    assert not [f for f in _entries(limit=1000)["failures"] if f["node_id"] == node_uuid]
    resolved = [f for f in _entries(limit=1000, include_resolved="true")["failures"] if f["node_id"] == node_uuid]
    assert len(resolved) == 1 and resolved[0]["resolved"] and resolved[0]["last_success_at"]
    requests.delete(f"{API_URL}/api/v1/nodes/{hostname}?force=true", headers=HEADERS, timeout=10)


def test_requires_authentication():
    assert requests.get(f"{API_URL}/api/v1/jobs/failures", timeout=10).status_code == 401
