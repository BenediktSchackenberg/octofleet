"""Fleet updates: GET /api/v1/patches/fleet lists Windows and Linux nodes with their pending updates and
reboot state; POST /patches/fleet/search and /fleet/install create one job per node, the install payload
built by the server from the stored updates - on Windows only the updates approved in the catalog, on
Linux the versions the Linux approval rules approve (test_linux_approval_rules.py)."""
import json
import os
import random
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}
DEFENDER = {"kb_id": "KB2267602", "title": "Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.463.277.0)",
            "severity": "low", "category": "security", "reboot_behavior": "never"}
# A KB of its own per run: the catalog approval is global and must start unapproved
CU_KB = f"KB59{random.randint(10000, 99999)}"
CUMULATIVE = {"kb_id": CU_KB, "title": f"2026-11 Cumulative Update for Microsoft server operating system ({CU_KB})",
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


def approve(kb):
    r = requests.get(f"{API_URL}/api/v1/patches/catalog", headers=HEADERS, params={"search": kb}, timeout=10)
    assert r.status_code == 200, r.text
    patch_id = next(p["id"] for p in r.json()["items"] if p["kb_id"] == kb)
    r = requests.patch(f"{API_URL}/api/v1/patches/catalog/{patch_id}/approve", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text


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
    assert w["approved"] == 0  # not approved in the catalog yet
    # Linux: approval rules; this agent reports no release (older agent), so nothing can be approved
    assert lx["approved"] == 0 and lx["linux"]["approval"] == "agent_too_old"
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


def test_install_builds_the_payload_per_node(nodes):
    tag, win, linux, idle = nodes
    body = {"node_ids": [win, linux, idle, str(uuid.uuid4())], "reboot_policy": "schedule",
            "reboot_schedule_time": "2099-01-01T22:00:00Z"}
    # nothing approved yet: no job; the Linux nodes report no release (older agent): skipped
    r = requests.post(f"{API_URL}/api/v1/patches/fleet/install", headers=HEADERS, timeout=30, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["jobs"] == []
    assert {s["node"]: s["reason"] for s in r.json()["skipped"]} == {
        win: "not_approved", linux: "agent_too_old", idle: "agent_too_old", body["node_ids"][3]: "unknown node"}

    approve(CU_KB)
    assert row(fleet(q=tag), win)["approved"] == 1
    r = requests.post(f"{API_URL}/api/v1/patches/fleet/install", headers=HEADERS, timeout=30, json=body)
    assert r.status_code == 200, r.text
    result = r.json()
    jobs = {j["node"]: j["job_id"] for j in result["jobs"]}
    assert set(jobs) == {win}
    w = job(jobs[win])
    assert w["command_type"] == "patch_install"
    # the approved update, without the Defender signature update unless asked for
    assert w["command_data"]["kb_ids"] == [CU_KB]
    assert w["command_data"]["reboot_policy"] == "schedule"
    # the rows show the running installation
    assert row(fleet(q=tag), win)["running"] == "patch_install"
    assert row(fleet(q=tag), win)["last_job"]["id"] == jobs[win]


def test_search_and_validation(nodes):
    tag, win, linux, idle = nodes
    r = requests.post(f"{API_URL}/api/v1/patches/fleet/search", headers=HEADERS, timeout=30, json={"node_ids": [idle]})
    assert r.status_code == 200, r.text
    assert job(r.json()["jobs"][0]["job_id"])["command_type"] == "patch_scan"
    assert row(fleet(q=tag), idle)["running"] == "patch_scan"
    for body in ({"node_ids": []}, {"node_ids": [win], "reboot_policy": "later"},
                 {"node_ids": [win], "reboot_policy": "schedule", "reboot_schedule_time": "2099-01-01T22:00"},
                 {"node_ids": [win], "reboot_policy": "schedule", "reboot_schedule_time": "2000-01-01T22:00:00Z"},
                 {"node_ids": [str(uuid.uuid4()) for _ in range(501)]}):
        r = requests.post(f"{API_URL}/api/v1/patches/fleet/install", headers=HEADERS, timeout=10, json=body)
        assert r.status_code == 400, (body, r.text)


def test_parallel_install_requests_create_one_job(nodes):
    _, win, _, _ = nodes
    approve(CU_KB)

    def send(_):
        return requests.post(f"{API_URL}/api/v1/patches/fleet/install", headers=HEADERS, timeout=30,
                             json={"node_ids": [win], "reboot_policy": "no_reboot"})

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, range(2)))
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    assert sum(len(r.json()["jobs"]) for r in responses) == 1


def install(node_ids, **extra):
    r = requests.post(f"{API_URL}/api/v1/patches/fleet/install", headers=HEADERS, timeout=30,
                      json={"node_ids": node_ids, "reboot_policy": "force", **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_an_installation_in_progress_is_not_started_again(nodes):
    tag, win, linux, idle = nodes
    approve(CU_KB)
    first = install([win])
    assert len(first["jobs"]) == 1
    assert row(fleet(q=tag), win)["installation"]["state"] == "installing"
    # while the job runs: skipped
    assert install([win])["skipped"] == [{"node": win, "reason": "busy"}]

    # the agent installs; a reboot is required and was ordered: the node restarts, the update stays
    # listed until then - not again, and no search either
    r = requests.get(f"{API_URL}/api/v1/jobs/pending/fleet-win-{tag}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    pending = body.get("jobs", body) if isinstance(body, dict) else body
    instance = next(j for j in pending if str(j.get("jobId")) == first["jobs"][0]["job_id"])["instanceId"]
    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{instance}/result", headers=HEADERS, timeout=10, json={
        "success": True, "exitCode": 0,
        "stdout": '{"installed":["KB5900000"],"failed":[],"reboot_required":true,"error":null,"search_after":"succeeded"}'})
    assert r.status_code == 200, r.text
    state = row(fleet(q=tag), win)["installation"]
    assert state["state"] == "restarting" and state["restart_at"]
    assert install([win])["skipped"] == [{"node": win, "reason": "restarting"}]
    r = requests.post(f"{API_URL}/api/v1/patches/fleet/search", headers=HEADERS, timeout=30, json={"node_ids": [win]})
    assert r.json()["skipped"] == [{"node": win, "reason": "busy"}]

    # the node searches after its restart: finished; an explicit retry was possible before
    r = requests.post(f"{API_URL}/api/v1/patches/scan-results", headers=HEADERS, timeout=10, json={
        "node_id": f"fleet-win-{tag}", "scan": {"status": "succeeded", "source": "wsus", "reboot_pending": False},
        "patches": [DEFENDER, CUMULATIVE]})
    assert r.status_code == 200, r.text
    assert row(fleet(q=tag), win)["installation"] is None
    assert len(install([win], retry=True)["jobs"]) == 1
