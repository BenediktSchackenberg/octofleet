"""Vulnerabilities of one node: by id or hostname, with total count and an optional limit, and grouped by update."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def node():
    """A node registered like an agent; returns (hostname, node uuid)."""
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"node-vulns-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname,
                            "hardware": {"cpu": {"name": "Test CPU", "cores": 2}, "ram": {"totalGB": 4}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


@pytest.mark.parametrize("by", ["hostname", "id"])
def test_node_vulnerabilities_by_hostname_or_id(node, by):
    hostname, node_id = node
    ref = hostname if by == "hostname" else node_id
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/node/{ref}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["node"] == {"id": node_id, "hostname": hostname}
    assert isinstance(body["vulnerabilities"], list)
    assert body["count"] == len(body["vulnerabilities"])


def test_limit_keeps_the_total_count(node):
    hostname, _ = node
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/node/{hostname}?limit=1", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["vulnerabilities"]) <= 1
    assert body["count"] >= len(body["vulnerabilities"])


def test_unknown_node_is_404():
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/node/no-such-node-{uuid.uuid4().hex[:8]}", headers=HEADERS, timeout=10)
    assert r.status_code == 404, r.text


@pytest.mark.parametrize("by", ["hostname", "id"])
def test_groups_by_hostname_or_id(node, by):
    hostname, node_id = node
    ref = hostname if by == "hostname" else node_id
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/node/{ref}/groups", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["node"] == {"id": node_id, "hostname": hostname}
    assert body["groups"] == [] and body["count"] == 0


def test_cves_of_one_update(node):
    hostname, _ = node
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/node/{hostname}?unit=linux&unit_version=7.0.0-38.38",
                     headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["vulnerabilities"] == []


def test_groups_of_unknown_node_is_404():
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/node/no-such-node-{uuid.uuid4().hex[:8]}/groups", headers=HEADERS, timeout=10)
    assert r.status_code == 404, r.text


def test_cves_of_an_update_across_nodes():
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/by-software/cves?unit=linux&unit_version=7.0.0-42.42",
                     headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == len(body["vulnerabilities"])


def test_cancel_of_a_scan_that_is_not_running_is_409():
    r = requests.post(f"{API_URL}/api/v1/vulnerabilities/scans/999999999/cancel", headers=HEADERS, timeout=10)
    assert r.status_code == 409, r.text


def test_by_node_names_the_source_of_the_max_cvss():
    r = requests.get(f"{API_URL}/api/v1/vulnerabilities/by-node", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    for node in r.json()["nodes"]:
        for key in ("max_cvss_cve", "max_cvss_unit", "max_cvss_severity", "max_cvss_vector"):
            assert key in node
        if node["max_cvss"] is not None:
            assert node["max_cvss_cve"], node


def test_scores_come_with_their_cvss_vector():
    """Every score the UI shows can be labelled with its CVSS version."""
    summary = requests.get(f"{API_URL}/api/v1/vulnerabilities/summary", headers=HEADERS, timeout=10).json()
    assert all("cvss_vector" in c for c in summary["top_cves"])
    assert all("max_cvss_vector" in s for s in summary["top_vulnerable_software"])
    software = requests.get(f"{API_URL}/api/v1/vulnerabilities/by-software", headers=HEADERS, timeout=10).json()
    assert all("max_cvss_vector" in s for s in software["software"])
    for node in requests.get(f"{API_URL}/api/v1/vulnerabilities/by-node", headers=HEADERS, timeout=10).json()["nodes"]:
        listed = requests.get(f"{API_URL}/api/v1/vulnerabilities/node/{node['id']}?limit=5", headers=HEADERS, timeout=10).json()
        assert all("cvss_vector" in v for v in listed["vulnerabilities"])
