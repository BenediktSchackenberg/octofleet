"""Reboot button: POST /api/v1/nodes/reboot/preview and /nodes/reboot create one `reboot` job per node
(users with nodes:reboot only), the reboot state follows the job until the node reports after it, and
a cancel job withdraws it."""
import json
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
TOKEN = os.getenv("TEST_ADMIN_TOKEN", "")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
AGENT = {"X-API-Key": API_KEY or "", "Content-Type": "application/json"}


def push(hostname, body):
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, **body})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def reboot(body, headers=HEADERS):
    return requests.post(f"{API_URL}/api/v1/nodes/reboot", headers=headers, json=body, timeout=30)


def preview(ids):
    r = requests.post(f"{API_URL}/api/v1/nodes/reboot/preview", headers=HEADERS, json={"node_ids": ids}, timeout=30)
    assert r.status_code == 200, r.text
    return {n["id"]: n for n in r.json()["nodes"]}


def state(node_uuid):
    r = requests.get(f"{API_URL}/api/v1/nodes/{node_uuid}/reboot", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["reboot"]


def fleet_row(tag, node_uuid):
    r = requests.get(f"{API_URL}/api/v1/patches/fleet", headers=HEADERS, params={"q": tag, "limit": 100}, timeout=30)
    assert r.status_code == 200, r.text
    return next(n for n in r.json()["nodes"] if n["id"] == node_uuid)


def agent_runs(hostname, job_id, success=True, stdout="Reboot scheduled"):
    """Take the job like the agent and report its result."""
    r = requests.get(f"{API_URL}/api/v1/jobs/pending/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    jobs = body.get("jobs", body) if isinstance(body, dict) else body
    job = next(j for j in jobs if str(j.get("jobId")) == job_id)
    assert job.get("commandType") == "reboot"
    payload = job.get("commandPayload") or job.get("commandData")
    if isinstance(payload, str):
        payload = json.loads(payload)
    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{job['instanceId']}/result", headers=HEADERS, timeout=10,
                      json={"success": success, "status": "success" if success else "failed",
                            "exitCode": 0 if success else 1, "stdout": stdout})
    assert r.status_code == 200, r.text
    return payload


@pytest.fixture
def nodes():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    tag = uuid.uuid4().hex[:8]
    linux_host = f"reboot-linux-{tag}"
    linux = push(linux_host, {"system": {"os": {"name": "CachyOS Linux"}}, "updates": {
        "packageManager": "pacman", "totalUpdates": 1, "securityUpdates": 0, "rebootRequired": True,
        "updates": [{"name": "vim", "newVersion": "9.1"}]}})
    win_host = f"reboot-win-{tag}"
    win = push(win_host, {"system": {"os": {"name": "Microsoft Windows Server 2025 Standard"}}})
    return tag, (linux_host, linux), (win_host, win)


def test_only_users_with_the_permission(nodes):
    _, (_, linux), _ = nodes
    # the agent key alone is not a user
    assert reboot({"node_ids": [linux]}, headers=AGENT).status_code in (401, 403)
    r = requests.post(f"{API_URL}/api/v1/nodes/reboot/preview", headers=AGENT, json={"node_ids": [linux]}, timeout=10)
    assert r.status_code in (401, 403)


@pytest.mark.parametrize("body", [
    {"node_ids": []}, {"node_ids": ["SRV01"]}, {"node_ids": "x"},
    {"node_ids": [str(uuid.uuid4())], "when": "later"},
    {"node_ids": [str(uuid.uuid4())], "when": "in", "minutes": 0},
    {"node_ids": [str(uuid.uuid4())], "when": "at", "at": "2020-01-01T00:00:00Z"},
    {"node_ids": [str(uuid.uuid4())], "when": "now", "message": "x" * 201},
    {"node_ids": [str(uuid.uuid4()) for _ in range(501)]},
])
def test_invalid_requests(body):
    assert reboot(body).status_code == 400


def test_preview_names_what_a_reboot_interrupts(nodes):
    _, (linux_host, linux), (_, win) = nodes
    # the Linux agent reports who is logged on with its live data; the Windows node did not
    r = requests.post(f"{API_URL}/api/v1/live-data", headers=HEADERS, timeout=10, json={
        "nodeId": linux_host, "loggedOnUsers": [{"user": "anna", "session": "tty2", "since": None}]})
    assert r.status_code == 200, r.text
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json={
        "name": "long job", "targetType": "device", "targetId": linux, "commandType": "script", "commandData": {"script": "sleep 600"}})
    assert r.status_code == 200, r.text
    unknown = str(uuid.uuid4())
    p = preview([linux, win, unknown])
    lx, w = p[linux], p[win]
    assert (lx["os_family"], lx["blocker"]) == ("linux", None)
    assert lx["logged_on_users"] == [{"user": "anna", "session": "tty2", "since": None}]
    assert lx["running_job_count"] == 1 and lx["running_jobs"][0]["name"] == "long job"
    assert lx["sessions"] == {"terminal": 0, "screen": 0, "shell": 0}
    assert w["os_family"] == "windows" and w["logged_on_users"] is None and w["running_job_count"] == 0
    assert p[unknown] == {"id": unknown, "found": False}


def test_reboot_job_until_the_node_reports(nodes):
    tag, (linux_host, linux), (win_host, win) = nodes
    r = reboot({"node_ids": [linux, win, str(uuid.uuid4())], "when": "in", "minutes": 30, "message": "Updates\nnow"})
    assert r.status_code == 200, r.text
    res = r.json()
    assert {j["node"] for j in res["jobs"]} == {linux, win}
    assert [s["reason"] for s in res["skipped"]] == ["unknown node"]
    job_id = next(j["job_id"] for j in res["jobs"] if j["node"] == linux)

    s = state(linux)
    assert s["state"] == "scheduled" and s["job_id"] == job_id and s["restart_at"]
    row = fleet_row(tag, linux)
    assert row["reboot_job"]["state"] == "scheduled"
    assert row["reboot"] == "pending"  # the node's own report is untouched

    payload = agent_runs(linux_host, job_id)
    assert payload["action"] == "reboot" and payload["message"] == "Updates now" and payload["at"].endswith("Z")
    assert state(linux)["state"] == "restarting"
    # a report from before the reboot time does not clear it, nor the node's "reboot required"
    push(linux_host, {"system": {"os": {"name": "CachyOS Linux"}}, "updates": {
        "packageManager": "pacman", "totalUpdates": 1, "rebootRequired": True, "updates": [{"name": "vim", "newVersion": "9.1"}]}})
    row = fleet_row(tag, linux)
    assert row["reboot_job"]["state"] == "restarting" and row["reboot"] == "pending"

    # cancel: only nodes with a scheduled reboot get a cancel job
    r = reboot({"node_ids": [linux], "action": "cancel"})
    assert r.status_code == 200, r.text
    assert len(r.json()["jobs"]) == 1
    assert state(linux) is None
    r = reboot({"node_ids": [linux], "action": "cancel"})
    assert r.json()["skipped"] == [{"node": linux, "reason": "no_reboot_scheduled"}]


def test_failed_reboot_shows_until_the_node_reports(nodes):
    _, (linux_host, linux), _ = nodes
    r = reboot({"node_ids": [linux], "when": "now"})
    job_id = r.json()["jobs"][0]["job_id"]
    agent_runs(linux_host, job_id, success=False, stdout="Scheduling the reboot failed")
    s = state(linux)
    assert s["state"] == "failed" and "failed" in (s["error"] or "")
    push(linux_host, {"system": {"os": {"name": "CachyOS Linux"}}, "updates": {
        "packageManager": "pacman", "totalUpdates": 0, "rebootRequired": True, "updates": []}})
    assert state(linux) is None


def test_reboot_is_audited(nodes):
    _, (_, linux), _ = nodes
    r = reboot({"node_ids": [linux], "when": "in", "minutes": 60})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/audit", headers=HEADERS, params={"action": "node.reboot", "limit": 50}, timeout=10)
    if r.status_code == 404:
        pytest.skip("no audit log endpoint")
    assert r.status_code == 200, r.text
    body = r.json()
    entries = body.get("entries") or body.get("items") or body.get("logs") or (body if isinstance(body, list) else [])
    assert any(str(e.get("resource_id") or e.get("resourceId")) == linux for e in entries), body


def system_info(hostname):
    r = requests.get(f"{API_URL}/api/v1/inventory/system/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("data", body)


def reboot_status(node_uuid):
    r = requests.get(f"{API_URL}/api/v1/nodes/{node_uuid}/reboot", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


def test_boot_time_and_report_time_for_the_node_page(nodes):
    """The Linux agent reports its boot time like the Windows agent (os.lastBootTime, uptimeHours,
    uptimeFormatted); GET /nodes/{id}/reboot gives it with the time of the last update report, so
    the node page notices a reboot with the poll it makes anyway."""
    _, (linux_host, linux), _ = nodes
    before = reboot_status(linux)
    assert before["reboot"] is None and before["reported_at"] and before["last_boot_time"] is None

    push(linux_host, {"system": {"os": {"name": "CachyOS Linux", "lastBootTime": "2026-11-24T17:50:40",
                                        "uptimeHours": 0.02, "uptimeFormatted": "1m"}},
                      "updates": {"packageManager": "pacman", "totalUpdates": 1, "rebootRequired": False,
                                  "updates": [{"name": "vim", "newVersion": "9.1"}]}})
    info = system_info(linux_host)
    assert info["lastBootTime"] == "2026-11-24T17:50:40"
    assert (info["uptimeHours"], info["uptimeFormatted"]) == (0.02, "1m")
    after = reboot_status(linux)
    assert after["last_boot_time"] == "2026-11-24T17:50:40"
    assert after["reported_at"] > before["reported_at"]

    # a boot time with an offset is stored in UTC (it failed the whole system section before)
    push(linux_host, {"system": {"os": {"name": "CachyOS Linux", "lastBootTime": "2026-11-25T08:00:00+01:00"}}})
    assert system_info(linux_host)["lastBootTime"] == "2026-11-25T07:00:00"
    assert reboot_status(linux)["last_boot_time"] == "2026-11-25T07:00:00"
