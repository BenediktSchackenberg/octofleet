"""Cancelling and deleting jobs: the state comes from the job's instances."""
import os
import uuid

import pytest
import requests

from user_auth import user_headers

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = user_headers({"Content-Type": "application/json"})


@pytest.fixture
def node():
    """A node registered like an agent; returns (hostname, node uuid)."""
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"job-delete-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname,
                            "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


def create_job(node_uuid):
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json={
        "name": "job delete test", "targetType": "device", "targetId": node_uuid,
        "commandType": "script", "commandData": {"script": "true"},
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def instance_statuses(job_id):
    r = requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return [i["status"] for i in r.json()["instances"]]


def test_pending_job_is_cancelled_then_deleted(node):
    _, node_uuid = node
    job_id = create_job(node_uuid)

    r = requests.delete(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"
    assert instance_statuses(job_id) == ["cancelled"]

    # a cancelled job is finished: deleting it again removes it
    r = requests.delete(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "deleted"
    assert requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10).status_code == 404


def test_finished_job_is_deleted(node):
    hostname, node_uuid = node
    job_id = create_job(node_uuid)
    r = requests.get(f"{API_URL}/api/v1/jobs/pending/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    jobs = body.get("jobs", body) if isinstance(body, dict) else body
    job = next(j for j in jobs if str(j.get("jobId")) == job_id)
    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{job['instanceId']}/result", headers=HEADERS,
                      timeout=10, json={"success": True, "exitCode": 0, "stdout": "test"})
    assert r.status_code == 200, r.text

    r = requests.delete(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "deleted"
    assert requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10).status_code == 404


def test_unknown_job_is_404():
    r = requests.delete(f"{API_URL}/api/v1/jobs/{uuid.uuid4()}", headers=HEADERS, timeout=10)
    assert r.status_code == 404, r.text
