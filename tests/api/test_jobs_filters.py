"""The jobs list: status, type, name and time filters, and counts across all matching jobs."""
import os
import uuid

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}


def make_node():
    hostname = f"jobs-filters-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
    assert r.status_code == 200, r.text
    return requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10).json()["id"]


def job(node, name, command_type="script", result=None):
    """A job for the node; result True/False reports a result, None leaves it pending"""
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10,
                      json={"name": name, "targetType": "device", "targetId": node,
                            "commandType": command_type, "commandData": {"script": "true"}})
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    if result is not None:
        instance = requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10).json()["instances"][0]["id"]
        r = requests.post(f"{API_URL}/api/v1/jobs/instances/{instance}/result", headers=HEADERS, timeout=10,
                          json={"success": result, "status": "success" if result else "failed",
                                "exitCode": 0 if result else 1, "stdout": "", "stderr": "" if result else "boom"})
        assert r.status_code == 200, r.text
    return str(job_id)


def jobs(**params):
    r = requests.get(f"{API_URL}/api/v1/jobs", headers=HEADERS, params={"limit": 200, **params}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


def ids(data):
    return {str(j["job_id"]) for j in data["jobs"]}


def test_status_type_and_search_filters_with_counts():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    node = make_node()
    tag = uuid.uuid4().hex[:6]
    ok = job(node, f"filters {tag} ok", result=True)
    bad = job(node, f"filters {tag} bad", result=False)
    waiting = job(node, f"filters {tag} waiting", command_type="inventory")

    assert ids(jobs(node=node, status="success")) == {ok}
    assert ids(jobs(node=node, status="failed")) == {bad}
    assert ids(jobs(node=node, status="pending")) == {waiting}
    assert ids(jobs(node=node, command_type="inventory")) == {waiting}
    assert ids(jobs(q=f"{tag} ba")) == {bad}

    data = jobs(node=node, since_hours=168)
    assert data["total"] == 3
    assert data["counts"] == {"total": 3, "running": 0, "success": 1, "failed": 1}
    assert "inventory" in data["command_types"] and "script" in data["command_types"]
    # counts ignore the status filter (the cards show the breakdown), the list follows it
    filtered = jobs(node=node, status="failed", since_hours=168)
    assert filtered["total"] == 1 and filtered["counts"]["total"] == 3


def test_total_counts_beyond_the_page():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    node = make_node()
    for i in range(3):
        job(node, f"page {i}")
    data = jobs(node=node, limit=2)
    assert len(data["jobs"]) == 2 and data["total"] == 3
    rest = jobs(node=node, limit=2, offset=2)
    assert len(rest["jobs"]) == 1


def test_unknown_status_is_rejected():
    r = requests.get(f"{API_URL}/api/v1/jobs", headers=HEADERS, params={"status": "bogus"}, timeout=10)
    assert r.status_code == 400
