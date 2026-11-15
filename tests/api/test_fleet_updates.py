"""Fleet updates: GET /api/v1/patches/fleet lists Windows and Linux nodes with their pending updates and
reboot state."""
import json
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}
DEFENDER = {"kb_id": "KB2267602", "title": "Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.463.277.0)",
            "severity": "low", "category": "security", "reboot_behavior": "never"}
CUMULATIVE = {"kb_id": "KB5130001", "title": "2026-11 Cumulative Update for Microsoft server operating system",
              "severity": "moderate", "category": "security", "reboot_behavior": "always"}  # moderate: counted by category


def push(hostname, body):
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, **body})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def fleet(**params):
    r = requests.get(f"{API_URL}/api/v1/patches/fleet", headers=HEADERS, params={"limit": 1000, **params}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def row(data, node_uuid):
    return next(n for n in data["nodes"] if n["id"] == node_uuid)


def job(job_id):
    r = requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    if isinstance(data.get("command_data"), str):
        data["command_data"] = json.loads(data["command_data"])
    return data


@pytest.fixture
def nodes():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    tag = uuid.uuid4().hex[:8]
    win_host = f"fleet-win-{tag}"
    win = push(win_host, {"system": {"os": {"name": "Microsoft Windows Server 2025 Standard"}}})
    r = requests.post(f"{API_URL}/api/v1/patches/scan-results", headers=HEADERS, timeout=10, json={
        "node_id": win_host, "scan": {"status": "succeeded", "source": "wsus", "reboot_pending": False},
        "patches": [DEFENDER, CUMULATIVE]})
    assert r.status_code == 200, r.text
    linux = push(f"fleet-linux-{tag}", {"system": {"os": {"name": "Ubuntu 26.04 LTS"}}, "updates": {
        "packageManager": "apt", "totalUpdates": 2, "securityUpdates": 1, "rebootRequired": False,
        "updates": [{"name": "openssl", "newVersion": "3.5.1", "security": True},
                    {"name": "linux-image-7.0.0-44-generic", "newVersion": "7.0.0-44", "security": False}]}})
    idle = push(f"fleet-idle-{tag}", {"system": {"os": {"name": "Debian GNU/Linux 13 (trixie)"}},
                                      "updates": {"packageManager": "apt", "totalUpdates": 0, "updates": []}})
    push(f"fleet-unknown-{tag}", {"system": {"os": {"name": "Unknown"}}})
    return tag, win, linux, idle


def test_rows_for_windows_and_linux(nodes):
    tag, win, linux, idle = nodes
    data = fleet(q=tag)
    assert data["total"] == 3
    w, lx, i = row(data, win), row(data, linux), row(data, idle)
    # Windows: the Defender signature update counts separately; the cumulative update needs a reboot
    assert (w["os_family"], w["pending"], w["security"], w["definitions"], w["reboot"]) == ("windows", 1, 1, 1, "needed")
    assert w["last_search"]["status"] == "succeeded" and w["last_search"]["source"] == "wsus"
    # Linux: a kernel package means a reboot will be needed
    assert (lx["os_family"], lx["pending"], lx["security"], lx["reboot"]) == ("linux", 2, 1, "needed")
    assert (i["pending"], i["reboot"]) == (0, "none")
    # sorted by pending updates, the most first
    assert [n["id"] for n in data["nodes"]][-1] == idle
    assert data["counts"]["nodes"] >= 3


def test_filters_and_sort(nodes):
    tag, win, linux, idle = nodes
    assert {n["id"] for n in fleet(q=tag, os="linux")["nodes"]} == {linux, idle}
    assert {n["id"] for n in fleet(q=tag, pending="true")["nodes"]} == {win, linux}
    assert {n["id"] for n in fleet(q=tag, reboot="true")["nodes"]} == {win, linux}
    names = [n["hostname"] for n in fleet(q=tag, sort="hostname", dir="asc")["nodes"]]
    assert names == sorted(names)
    reboot_order = [n["reboot"] for n in fleet(q=tag, sort="reboot", dir="asc")["nodes"]]
    assert reboot_order == ["needed", "needed", "none"]
    r = requests.get(f"{API_URL}/api/v1/patches/fleet", headers=HEADERS, params={"sort": "bogus"}, timeout=10)
    assert r.status_code == 400
