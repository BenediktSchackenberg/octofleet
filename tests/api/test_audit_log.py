"""Job command data and audit details come back as JSON objects; one audit log with filters."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}


@pytest.fixture
def node():
    """A node registered like an agent; returns (hostname, node uuid). Deleted afterwards."""
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"audit-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname,
                            "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    yield hostname, r.json()["id"]
    requests.delete(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS, timeout=10)
    requests.delete(f"{API_URL}/api/v1/nodes/{hostname}?force=true", headers=HEADERS, timeout=10)


def test_job_command_data_is_an_object(node):
    _, node_uuid = node
    data = {"at": "2026-11-23T21:42:23Z", "action": "reboot", "message": None}
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json={
        "name": "audit test", "targetType": "device", "targetId": node_uuid,
        "commandType": "script", "commandData": data})
    assert r.status_code == 200, r.text
    job = requests.get(f"{API_URL}/api/v1/jobs/{r.json()['id']}", headers=HEADERS, timeout=10).json()
    assert job["command_data"] == data  # not the JSON text "{\"at\": …}"
    requests.delete(f"{API_URL}/api/v1/jobs/{job['id']}", headers=HEADERS, timeout=10)


def test_audit_entry_has_details_object_and_resource_name(node):
    hostname, node_uuid = node
    r = requests.post(f"{API_URL}/api/v1/nodes/{hostname}/uninstall", headers=HEADERS,
                      json={"deleteAfterUninstall": False}, timeout=10)
    assert r.status_code == 200, r.text

    params = {"resource_type": "node", "resource_id": node_uuid, "action": "uninstall_requested"}
    for path in ("/api/v1/audit", "/api/v1/audit-log"):  # the same log under both paths
        r = requests.get(f"{API_URL}{path}", headers=HEADERS, params=params, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 1 and len(body["entries"]) == 1
        entry = body["entries"][0]
        assert entry["action"] == "node.uninstall_requested"
        assert entry["resource_name"] == hostname
        assert isinstance(entry["details"], dict) and entry["details"]["hostname"] == hostname


def test_audit_filters(node):
    r = requests.get(f"{API_URL}/api/v1/audit", headers=HEADERS,
                     params={"resource_type": "node,user", "limit": 5}, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["entries"]) <= 5 and body["total"] >= len(body["entries"])
    assert all(e["resource_type"] in ("node", "user") for e in body["entries"])
    assert "total_capped" in body

    r = requests.get(f"{API_URL}/api/v1/audit", headers=HEADERS, params={"date_from": "yesterday"}, timeout=10)
    assert r.status_code == 400


def test_audit_requires_authentication():
    for path in ("/api/v1/audit", "/api/v1/audit-log", "/api/v1/audit-log/stats"):
        assert requests.get(f"{API_URL}{path}", timeout=10).status_code == 401
