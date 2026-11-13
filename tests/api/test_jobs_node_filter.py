"""The job list per node: GET /api/v1/jobs?node= returns the jobs that run on the node, with a total."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}


def make_node(prefix):
    hostname = f"{prefix}-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname,
                            "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


def create_job(name, target_type, target_id=None):
    body = {"name": name, "targetType": target_type, "commandType": "script", "commandData": {"script": "true"}}
    if target_id:
        body["targetId"] = target_id
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def jobs_for(node, limit=50):
    r = requests.get(f"{API_URL}/api/v1/jobs", headers=HEADERS, params={"node": node, "limit": limit}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def two_nodes():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    return make_node("jobs-filter-a"), make_node("jobs-filter-b")


def test_node_filter_returns_the_jobs_of_that_node(two_nodes):
    (host_a, uuid_a), (host_b, uuid_b) = two_nodes
    job_a = create_job("filter test a", "device", uuid_a)
    job_b = create_job("filter test b", "device", uuid_b)

    for key in (host_a, uuid_a):  # hostname / node_id or UUID
        data = jobs_for(key)
        ids = [j["job_id"] for j in data["jobs"]]
        assert str(job_a) in map(str, ids)
        assert str(job_b) not in map(str, ids)
        assert data["total"] >= 1

    # the total counts all of the node's jobs, not only the returned page
    create_job("filter test a2", "device", uuid_a)
    page = jobs_for(host_a, limit=1)
    assert len(page["jobs"]) == 1
    assert page["total"] >= 2


def test_a_job_for_all_nodes_appears_for_each_node(two_nodes):
    (host_a, _), (host_b, _) = two_nodes
    job_all = str(create_job("filter test all", "all"))
    assert job_all in [str(j["job_id"]) for j in jobs_for(host_a)["jobs"]]
    assert job_all in [str(j["job_id"]) for j in jobs_for(host_b)["jobs"]]


def test_unknown_node_and_target_id_alias(two_nodes):
    (host_a, uuid_a), _ = two_nodes
    unknown = jobs_for("no-such-node-xyz")
    assert unknown["jobs"] == [] and unknown["total"] == 0
    create_job("filter test alias", "device", uuid_a)
    r = requests.get(f"{API_URL}/api/v1/jobs", headers=HEADERS, params={"target_id": host_a}, timeout=10)
    assert r.status_code == 200 and r.json()["total"] >= 1
