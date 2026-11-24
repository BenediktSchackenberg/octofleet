"""Remediation (#197): fix packages with a winget ID, one job per node and update with its CVE list."""
import os
import uuid

import pytest
import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
ADMIN = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}
AGENT = {"X-API-Key": os.getenv("INVENTORY_API_KEY") or "", **ADMIN}


@pytest.fixture
def package():
    name = f"winget-id-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/remediation/packages", headers=ADMIN, timeout=10, json={
        "name": name, "target_software": f"No Such App {name}", "fix_method": "winget",
        "winget_id": "Notepad++.Notepad++", "enabled": False})
    assert r.status_code == 201, r.text
    pkg = r.json()
    yield pkg
    requests.delete(f"{API}/remediation/packages/{pkg['id']}", headers=ADMIN, timeout=10)


def test_package_keeps_its_winget_id(package):
    assert package["winget_id"] == "Notepad++.Notepad++"
    assert package["fix_command"] is None
    r = requests.patch(f"{API}/remediation/packages/{package['id']}", headers=ADMIN, timeout=10,
                       json={"winget_id": "7zip.7zip"})
    assert r.status_code == 200, r.text
    assert r.json()["winget_id"] == "7zip.7zip"
    r = requests.get(f"{API}/remediation/packages/{package['id']}", headers=ADMIN, timeout=10)
    assert r.json()["winget_id"] == "7zip.7zip"
    # cleared: the display name is used again
    r = requests.patch(f"{API}/remediation/packages/{package['id']}", headers=ADMIN, timeout=10,
                       json={"winget_id": None})
    assert r.status_code == 200 and r.json()["winget_id"] is None


@pytest.mark.parametrize("bad", ["7zip.7zip; calc", "a b", "'x'", "-x", ""])
def test_winget_id_that_is_no_package_id_is_rejected(package, bad):
    r = requests.patch(f"{API}/remediation/packages/{package['id']}", headers=ADMIN, timeout=10,
                       json={"winget_id": bad})
    assert r.status_code == 422, r.text
    r = requests.post(f"{API}/remediation/packages", headers=ADMIN, timeout=10, json={
        "name": f"bad-{uuid.uuid4().hex[:8]}", "target_software": "x", "fix_method": "winget", "winget_id": bad})
    assert r.status_code == 422, r.text


def test_packages_without_winget_id_still_work():
    r = requests.post(f"{API}/remediation/packages", headers=ADMIN, timeout=10, json={
        "name": f"no-id-{uuid.uuid4().hex[:8]}", "target_software": "No Such App", "fix_method": "winget",
        "fix_command": "winget upgrade --id 7zip.7zip --silent", "enabled": False})
    assert r.status_code == 201, r.text
    assert r.json()["winget_id"] is None
    requests.delete(f"{API}/remediation/packages/{r.json()['id']}", headers=ADMIN, timeout=10)


def test_dry_run_reports_jobs_per_update():
    hostname = f"remediation-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/inventory/full", headers=AGENT, timeout=30, json={
        "hostname": hostname, "nodeId": hostname,
        "software": {"software": [{"name": f"No Such App {hostname}", "version": "1.0",
                                   "registryKey": "LocalMachine\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows"
                                                  "\\CurrentVersion\\Uninstall\\x"}]}})
    assert r.status_code == 200, r.text
    node_id = requests.get(f"{API}/nodes/{hostname}", headers=AGENT, timeout=10).json()["id"]
    r = requests.post(f"{API}/remediation/scan", headers=ADMIN, timeout=30,
                      json={"node_ids": [node_id], "dry_run": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert (body["scanned"], body["would_create"], body["jobs_created"], body["cves_added"]) == (0, 0, 0, 0)
    assert body["details"] == []
    # the agent's poll for this node: nothing approved
    r = requests.get(f"{API}/remediation/jobs/pending/win-{hostname}", headers=ADMIN, timeout=10)
    assert r.status_code == 200 and r.json() == {"jobs": [], "count": 0}


def test_every_job_lists_its_cves():
    r = requests.get(f"{API}/remediation/jobs?limit=500", headers=ADMIN, timeout=10)
    assert r.status_code == 200, r.text
    for job in r.json()["jobs"]:
        # jobs from before #197 were given their one CVE
        assert isinstance(job["cve_ids"], list) and job["cve_id"] in job["cve_ids"], job
        assert "architecture" in job
