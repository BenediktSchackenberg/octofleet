"""Windows OS build with update revision: from the inventory and from posture snapshots."""
import os
import uuid

import requests

from user_auth import user_headers

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = user_headers({"Content-Type": "application/json"})


def node_build(hostname):
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json().get("os_build")


def submit_system(hostname, os_info):
    r = requests.post(f"{API_URL}/api/v1/inventory/system", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, "os": {"name": "Microsoft Windows Server 2025 Datacenter",
                                                                             "version": "10.0.26100", **os_info}})
    assert r.status_code == 200, r.text


def test_build_from_inventory_and_posture_snapshot():
    hostname = f"os-build-test-{uuid.uuid4().hex[:8]}"
    submit_system(hostname, {"buildNumber": "26100", "build": "26100.33650"})
    assert node_build(hostname) == "26100.33650"

    # an older agent sends only buildNumber: the known build stays
    submit_system(hostname, {"buildNumber": "26100"})
    assert node_build(hostname) == "26100.33650"

    # an agent that could not read the UBR and sends a bare build: the known build stays
    submit_system(hostname, {"buildNumber": "26100", "build": "26100"})
    assert node_build(hostname) == "26100.33650"

    # the daily posture snapshot carries buildNumber and UBR
    r = requests.post(f"{API_URL}/api/v1/posture/snapshots", headers=HEADERS, timeout=30,
                      json={"nodeId": hostname, "osInfo": {"buildNumber": "26100", "ubr": "33700"}})
    assert r.status_code == 200, r.text
    assert node_build(hostname) == "26100.33700"
