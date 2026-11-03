"""Vulnerabilities of one node: by id or hostname, with total count and an optional limit, and grouped by update."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Content-Type": "application/json"}


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
