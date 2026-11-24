"""One CVE across the fleet: details and affected nodes, unknown CVE (404), invalid input, suggestions."""
import os

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API = f"{API_URL}/api/v1"


def headers():
    return {"X-API-Key": os.getenv("INVENTORY_API_KEY", ""),
            "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}


def test_unknown_cve_is_404():
    r = requests.get(f"{API}/vulnerabilities/cves/CVE-1999-99999999", headers=headers(), timeout=10)
    assert r.status_code == 404, r.text


def test_invalid_cve_id_is_400():
    r = requests.get(f"{API}/vulnerabilities/cves/not-a-cve", headers=headers(), timeout=10)
    assert r.status_code == 400, r.text
    r = requests.get(f"{API}/vulnerabilities/cves?q=CVE-2", headers=headers(), timeout=10)
    assert r.status_code == 400, r.text
    r = requests.get(f"{API}/vulnerabilities/cves?q=CVE-2026&limit=500", headers=headers(), timeout=10)
    assert r.status_code == 422, r.text


def test_needs_a_user_account():
    r = requests.get(f"{API}/vulnerabilities/cves/CVE-2026-1234", timeout=10)
    assert r.status_code in (401, 403), r.text
    r = requests.get(f"{API}/vulnerabilities/cves?q=CVE-2026", timeout=10)
    assert r.status_code in (401, 403), r.text


def test_suggestions_are_bounded_prefix_matches():
    r = requests.get(f"{API}/vulnerabilities/cves?q=2026&limit=5", headers=headers(), timeout=10)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) <= 5
    assert all(item["cve_id"].startswith("CVE-2026") for item in items)
    assert [item["cve_id"] for item in items] == sorted(item["cve_id"] for item in items)


def test_top_cve_agrees_with_the_summary():
    """A CVE of the summary's top list is known and affects nodes; each node links to its
    vulnerabilities, and the CVE is its own first suggestion."""
    summary = requests.get(f"{API}/vulnerabilities/summary", headers=headers(), timeout=30)
    assert summary.status_code == 200, summary.text
    top = summary.json()["top_cves"]
    if not top:
        return  # no findings on this installation
    cve = top[0]
    r = requests.get(f"{API}/vulnerabilities/cves/{cve['cve_id'].lower()}", headers=headers(), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cve_id"] == cve["cve_id"]
    assert body["nvd_url"].endswith(cve["cve_id"])
    assert {"severity", "cvss_score", "published_date", "description", "scan"} <= body.keys()
    assert body["affected_nodes"] >= 1
    assert len(body["nodes"]) == min(body["affected_nodes"], body["limit"])
    for node in body["nodes"]:
        assert node["link"] == f"/nodes/{node['id']}?tab=vulnerabilities&view=cves&q={cve['cve_id']}"
        assert node["packages"] and all({"name", "version", "fixed_version", "fix_status", "kernel_state"} <= p.keys()
                                        for p in node["packages"])
    r = requests.get(f"{API}/vulnerabilities/cves?q={cve['cve_id']}&limit=1", headers=headers(), timeout=10)
    assert r.status_code == 200, r.text
    assert [item["cve_id"] for item in r.json()["items"]] == [cve["cve_id"]]
