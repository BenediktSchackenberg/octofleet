"""Failed jobs: GET /api/v1/jobs?status=failed lists only jobs with a failed instance, with the time and
error of the last failure; since_hours limits them to recent failures."""
import os
import uuid

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}


def make_node():
    hostname = f"jobs-failed-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def run_job(node_uuid, name, success, stderr=""):
    """A job for the node whose instance reports the given result"""
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10,
                      json={"name": name, "targetType": "device", "targetId": node_uuid,
                            "commandType": "script", "commandData": {"script": "true"}})
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    r = requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    instance = r.json()["instances"][0]["id"]
    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{instance}/result", headers=HEADERS, timeout=10,
                      json={"success": success, "status": "success" if success else "failed",
                            "exitCode": 0 if success else 1, "stdout": "", "stderr": stderr})
    assert r.status_code == 200, r.text
    return str(job_id)


def failed_jobs(**params):
    r = requests.get(f"{API_URL}/api/v1/jobs", headers=HEADERS, params={"status": "failed", "limit": 200, **params}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


def test_status_failed_lists_only_failed_jobs_with_their_last_failure():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    node = make_node()
    ok = run_job(node, "failed filter: ok", True)
    bad = run_job(node, "failed filter: bad", False, stderr="E: Could not get lock")

    data = failed_jobs()
    ids = [str(j["job_id"]) for j in data["jobs"]]
    assert bad in ids
    assert ok not in ids
    assert all(j["failed"] > 0 for j in data["jobs"])
    assert data["total"] >= 1
    job = next(j for j in data["jobs"] if str(j["job_id"]) == bad)
    assert job["last_failed_at"]
    assert "Could not get lock" in job["last_error"]
    # newest failure first
    times = [j["last_failed_at"] for j in data["jobs"] if j["last_failed_at"]]
    assert times == sorted(times, reverse=True)


def test_since_hours_and_node_combine():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    node = make_node()
    bad = run_job(node, "failed filter: recent", False, stderr="boom")
    assert bad in [str(j["job_id"]) for j in failed_jobs(since_hours=1)["jobs"]]
    assert bad in [str(j["job_id"]) for j in failed_jobs(node=node)["jobs"]]
    assert failed_jobs(node=make_node())["jobs"] == []


def test_unknown_status_is_rejected():
    r = requests.get(f"{API_URL}/api/v1/jobs", headers=HEADERS, params={"status": "bogus"}, timeout=10)
    assert r.status_code == 400
