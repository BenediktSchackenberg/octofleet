"""Job results from agents: the Windows agent reports `success`, the Linux agent `status`."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Content-Type": "application/json"}


@pytest.fixture
def node():
    """A node registered like an agent; returns (hostname, node uuid)."""
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"job-result-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname,
                            "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


@pytest.mark.parametrize("result, expected", [
    ({"success": True, "exitCode": 0}, "success"),            # Windows agent
    ({"success": False, "exitCode": 1}, "failed"),
    ({"status": "success", "exitCode": 0}, "success"),        # Linux agent before it sent `success`
    ({"status": "failed", "exitCode": 1}, "failed"),
    ({"success": True, "status": "success", "exitCode": 0}, "success"),  # Linux agent now
    ({"exitCode": 0}, "failed"),                               # no verdict at all
])
def test_job_result_status(node, result, expected):
    hostname, node_uuid = node
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json={
        "name": "job result test", "targetType": "device", "targetId": node_uuid,
        "commandType": "script", "commandData": {"script": "true"},
    })
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]

    r = requests.get(f"{API_URL}/api/v1/jobs/pending/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    jobs = body.get("jobs", body) if isinstance(body, dict) else body
    job = next(j for j in jobs if str(j.get("jobId")) == job_id)

    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{job['instanceId']}/result", headers=HEADERS,
                      timeout=10, json={**result, "stdout": "test"})
    assert r.status_code == 200, r.text

    r = requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["instances"][0]["status"] == expected
