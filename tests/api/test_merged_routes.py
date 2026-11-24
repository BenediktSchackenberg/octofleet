"""Routes that were registered twice until #298: the version that runs now does the work of the
unused main.py / router copy (smart-install, job results, package list, compliance summary)."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}",
           "Content-Type": "application/json"}


def push_inventory(hostname, **sections):
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, **sections})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/nodes/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture
def node():
    """A node registered like an agent; returns (hostname, node uuid)."""
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"merged-routes-{uuid.uuid4().hex[:8]}"
    return hostname, push_inventory(hostname, hardware={"cpu": {"name": "Test CPU", "cores": 2}})


def pending_jobs(hostname):
    r = requests.get(f"{API_URL}/api/v1/jobs/pending/{hostname}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["jobs"]


def test_smart_install_creates_a_job_the_agent_gets(node):
    hostname, node_uuid = node
    r = requests.post(f"{API_URL}/api/v1/smart-install", headers=HEADERS, timeout=10,
                      json={"package": "7-Zip", "targets": [hostname, "no-such-node-xyz"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["chocoPackage"], body["jobsCreated"], body["totalTargets"]) == ("7zip", 1, 2)
    job_id = body["results"][0]["jobId"]
    assert body["results"][1]["status"] == "error"

    job = next(j for j in pending_jobs(hostname) if j["jobId"] == job_id)
    assert "install 7zip -y" in job["commandPayload"]


def test_smart_install_rejects_a_command_as_package_name(node):
    hostname, _ = node
    r = requests.post(f"{API_URL}/api/v1/smart-install", headers=HEADERS, timeout=10,
                      json={"package": "7zip; Remove-Item C:\\x", "targets": [hostname]})
    assert r.status_code == 400, r.text


def test_smart_install_needs_a_user():
    r = requests.post(f"{API_URL}/api/v1/smart-install", headers={"X-API-Key": API_KEY or ""}, timeout=10,
                      json={"package": "7zip", "targets": ["x"]})
    assert r.status_code in (401, 403), r.text


def test_job_result_of_an_unknown_instance_is_404():
    for instance in (str(uuid.uuid4()), "not-a-uuid"):
        r = requests.post(f"{API_URL}/api/v1/jobs/instances/{instance}/result", headers=HEADERS, timeout=10,
                          json={"success": True, "exitCode": 0})
        assert r.status_code == 404, r.text


def test_job_result_stores_error_and_duration_and_is_not_retried(node):
    hostname, node_uuid = node
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json={
        "name": "merged result test", "targetType": "device", "targetId": node_uuid,
        "commandType": "script", "commandData": {"script": "false"}, "priority": 1, "timeoutSeconds": 120,
    })
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    instance = next(j for j in pending_jobs(hostname) if j["jobId"] == job_id)
    assert instance["timeoutSeconds"] == 120

    r = requests.post(f"{API_URL}/api/v1/jobs/instances/{instance['instanceId']}/result", headers=HEADERS,
                      timeout=10, json={"success": False, "exitCode": 3, "stderr": "boom",
                                        "errorMessage": "script failed", "durationMs": 42})
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "failed", "instanceId": instance["instanceId"]}

    r = requests.get(f"{API_URL}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    job = r.json()
    inst = job["instances"][0]
    assert (inst["status"], inst["exit_code"], inst["error_message"], inst["duration_ms"], inst["attempt"]) == \
        ("failed", 3, "script failed", 42, 1)
    assert job["priority"] == 1 and job["timeout_seconds"] == 120


def test_scheduled_job_waits_and_bad_options_are_400(node):
    hostname, node_uuid = node
    base = {"name": "scheduled", "targetType": "device", "targetId": node_uuid, "commandType": "script",
            "commandData": {"script": "true"}}
    r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10,
                      json={**base, "scheduledAt": "2099-01-01T00:00:00Z"})
    assert r.status_code == 200, r.text
    assert all(j["jobId"] != r.json()["id"] for j in pending_jobs(hostname))
    for bad in ({"scheduledAt": "tomorrow"}, {"priority": "high"}, {"targetType": "node"}):
        r = requests.post(f"{API_URL}/api/v1/jobs", headers=HEADERS, timeout=10, json={**base, **bad})
        assert r.status_code == 400, (bad, r.text)


def test_package_list_has_camel_case_fields_and_search():
    name = f"merged-pkg-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API_URL}/api/v1/packages", headers=HEADERS, timeout=10,
                      json={"name": name, "displayName": f"Merged {name}", "vendor": "Test", "category": "utility"})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API_URL}/api/v1/packages", headers=HEADERS, params={"search": name}, timeout=10)
    assert r.status_code == 200, r.text
    [pkg] = r.json()["packages"]
    assert (pkg["name"], pkg["displayName"], pkg["versionCount"], pkg["latestVersion"]) == \
        (name, f"Merged {name}", 0, None)
    r = requests.get(f"{API_URL}/api/v1/packages", headers=HEADERS, params={"search": name, "category": "browser"},
                     timeout=10)
    assert r.json()["packages"] == []


def test_deployment_checks_target_mode_and_package_version():
    base = {"name": "merged deployment", "packageVersionId": str(uuid.uuid4())}
    for bad in ({"targetType": "device"}, {"targetType": "all", "mode": "optional"}, {"targetType": "node"}):
        r = requests.post(f"{API_URL}/api/v1/deployments", headers=HEADERS, timeout=10, json={**base, **bad})
        assert r.status_code == 400, (bad, r.text)
    r = requests.post(f"{API_URL}/api/v1/deployments", headers=HEADERS, timeout=10, json={**base, "targetType": "all"})
    assert r.status_code == 404, r.text


def test_compliance_summary_counts_the_nodes():
    hostname = f"merged-compliance-{uuid.uuid4().hex[:8]}"
    push_inventory(hostname, security={
        "antivirus": {"windowsDefender": {"antivirusEnabled": True, "realTimeProtectionEnabled": True}},
        "firewall": {"profiles": [{"name": "Domain", "enabled": True}]},
        "bitlocker": {"volumes": [{"mountPoint": "C:", "protectionStatus": "On"}]},
    })
    r = requests.get(f"{API_URL}/api/v1/compliance/summary", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    summary = r.json()
    [entry] = [n for n in summary["nodes"] if n["hostname"] == hostname]
    assert (entry["defender"], entry["realTimeProtection"], entry["firewall"], entry["bitlocker"]) == \
        (True, True, True, True)
    assert summary["totalNodes"] == len(summary["nodes"])
    assert summary["defender"]["enabled"] >= 1 and summary["bitlocker"]["encrypted"] >= 1
