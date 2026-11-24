"""Windows itself from Microsoft's Security Update Guide (MSRC): a CVRF document imported through the
API, matched against Windows nodes by build. Two releases (Windows 11 24H2, Windows Server 2022), a
cumulative update that supersedes the previous one, an exploited CVE, a withdrawn fix and a node
without a build.

The document (1999-Jan) and its CVEs are made up and use very low build revisions, so they cannot
affect real nodes; the test empties the document again at the end. It expects the CI stack
(MSRC_SYNC=off): with real MSRC data a newer update would be the one to install."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API = f"{API_URL}/api/v1"
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}",
           "Content-Type": "application/json"}
W11, SRV22 = "12390", "11923"  # MSRC products: Windows 11 Version 24H2 x64, Windows Server 2022
CVE_OLD, CVE_NEW, CVE_GONE = "CVE-1999-990001", "CVE-1999-990002", "CVE-1999-990003"


def fix(kb, product, build):
    return {"Description": {"Value": kb}, "ProductID": [product], "Type": 2, "SubType": "Security Update",
            "FixedBuild": build}


def vulnerability(cve, title, fixes, exploited=False, score=7.8):
    products = [f["ProductID"][0] for f in fixes]
    return {
        "CVE": cve, "Title": {"Value": title},
        "ProductStatuses": [{"ProductID": products, "Type": 3}],
        "Threats": [{"Type": 1, "Description": {"Value": f"Publicly Disclosed:No;Exploited:{'Yes' if exploited else 'No'}"}},
                    *({"Type": 3, "Description": {"Value": "Important"}, "ProductID": [p]} for p in products)],
        "CVSSScoreSets": [{"BaseScore": score, "Vector": "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "ProductID": products}],
        "Remediations": fixes,
        "RevisionHistory": [{"Number": "1.0", "Date": "1999-01-12T08:00:00"}],
    }


def document(vulnerabilities):
    return {"DocumentTitle": {"Value": "January 1999 Security Updates"},
            "DocumentTracking": {"Identification": {"ID": {"Value": "1999-Jan"}},
                                 "InitialReleaseDate": "1999-01-12T08:00:00",
                                 "CurrentReleaseDate": "1999-01-12T08:00:00"},
            "Vulnerability": vulnerabilities}


# KB9000001 (.20) is the first cumulative update; KB9000002 (.30) supersedes it and fixes one more CVE.
OLD = vulnerability(CVE_OLD, "Test Kernel Elevation of Privilege Vulnerability",
                    [fix("9000001", W11, "10.0.26100.20"), fix("9000011", SRV22, "10.0.20348.20")], exploited=True)
NEW = vulnerability(CVE_NEW, "Test SMB Remote Code Execution Vulnerability",
                    [fix("9000002", W11, "10.0.26100.30"), fix("9000012", SRV22, "10.0.20348.30")], score=9.8)
GONE = vulnerability(CVE_GONE, "Test Withdrawn Vulnerability", [fix("9000002", W11, "10.0.26100.30")])


def import_document(vulnerabilities):
    r = requests.post(f"{API}/vulnerabilities/msrc/documents", headers=HEADERS, json=document(vulnerabilities), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def add_node(os_name, os_info):
    hostname = f"msrc-test-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/inventory/system", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, "os": {"name": os_name, "version": "10.0", **os_info}})
    assert r.status_code == 200, r.text
    return hostname


def groups(hostname):
    r = requests.get(f"{API}/vulnerabilities/node/{hostname}/groups", headers=HEADERS, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def windows_cves(hostname):
    r = requests.get(f"{API}/vulnerabilities/node/{hostname}", headers=HEADERS, timeout=30)
    assert r.status_code == 200, r.text
    return [v for v in r.json()["vulnerabilities"] if v["cve_id"].startswith("CVE-1999-99")]


@pytest.fixture(scope="module")
def fleet():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    result = import_document([OLD, NEW, GONE])
    assert result["id"] == "1999-Jan" and result["fixes"] == 5
    nodes = {
        "w11_old": add_node("Microsoft Windows 11 Pro", {"build": "26100.10"}),
        "w11_mid": add_node("Microsoft Windows 11 Enterprise", {"build": "26100.25"}),
        "w11_new": add_node("Microsoft Windows 11 Pro", {"buildNumber": "26100", "ubr": "30"}),
        "srv22": add_node("Microsoft Windows Server 2022 Standard", {"build": "20348.10"}),
        "no_build": add_node("Microsoft Windows 11 Pro", {"buildNumber": "26100"}),
    }
    yield nodes
    import_document([])  # leaves no fixes behind


def test_needs_credentials():
    assert requests.get(f"{API}/vulnerabilities/msrc", timeout=10).status_code in (401, 403)
    assert requests.post(f"{API}/vulnerabilities/msrc/documents", json=document([]), timeout=10).status_code in (401, 403)


def test_rejects_other_documents():
    r = requests.post(f"{API}/vulnerabilities/msrc/documents", headers=HEADERS, json={"Vulnerability": []}, timeout=10)
    assert r.status_code == 400, r.text


def test_superseding_cumulative_update_closes_both(fleet):
    body = groups(fleet["w11_old"])
    state = body["windows_updates"]
    assert state["status"] == "checked" and state["product"] == "Windows 11 Version 24H2 for x64-based Systems"
    assert state["up_to_date"] is False
    cves = windows_cves(fleet["w11_old"])
    assert [v["cve_id"] for v in cves] == [CVE_OLD, CVE_NEW, CVE_GONE]  # exploited first
    assert cves[0]["exploited"] is True and cves[1]["exploited"] is False
    assert {v["software_name"] for v in cves} == {state["latest_kb"]}  # one update closes them all
    assert {v["fixed_version"] for v in cves} == {"10.0.26100.20", "10.0.26100.30"}
    group = next(g for g in body["groups"] if g["fix_unit"] == state["latest_kb"])
    assert group["packages"] == ["Windows 11 Version 24H2 for x64-based Systems"]
    assert group["exploited_count"] >= 1
    assert body["groups"][0]["fix_unit"] == state["latest_kb"]  # groups with exploited CVEs first


def test_build_between_the_updates(fleet):
    assert [v["cve_id"] for v in windows_cves(fleet["w11_mid"])] == [CVE_NEW, CVE_GONE]


def test_current_build_is_not_affected(fleet):
    assert windows_cves(fleet["w11_new"]) == []
    state = groups(fleet["w11_new"])["windows_updates"]
    assert state["status"] == "checked"


def test_second_release(fleet):
    cves = windows_cves(fleet["srv22"])
    assert [v["cve_id"] for v in cves] == [CVE_OLD, CVE_NEW]
    assert all(v["packages"] == ["Windows Server 2022"] for v in cves)
    assert {v["fixed_version"] for v in cves} == {"10.0.20348.20", "10.0.20348.30"}


def test_unknown_build_stays_unknown(fleet):
    body = groups(fleet["no_build"])
    assert body["windows_updates"]["status"] == "unknown"
    assert body["windows_updates"]["reason"] == "no_build"
    r = requests.get(f"{API}/vulnerabilities/msrc", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    status = r.json()
    assert status["windows_nodes"]["unknown"]["no_build"] >= 1
    assert status["windows_nodes"]["checked"] >= 4
    assert any(release["product_id"] == SRV22 for release in status["releases"])


def test_cve_lookup_and_withdrawn_fix(fleet):
    r = requests.get(f"{API}/vulnerabilities/cves/{CVE_OLD}", headers=HEADERS, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exploited"] is True and body["severity"] == "HIGH"
    hosts = {node["hostname"] for node in body["nodes"]}
    assert {fleet["w11_old"], fleet["srv22"]} <= hosts and fleet["w11_mid"] not in hosts

    # Microsoft withdraws the fix for Server 2022 and the whole CVE_GONE: the revised document replaces them
    revised = dict(OLD, ProductStatuses=[{"ProductID": [W11], "Type": 3}])
    result = import_document([revised, NEW])
    assert result["fixes"] == 3 and SRV22 in result["changed_products"]
    assert [v["cve_id"] for v in windows_cves(fleet["srv22"])] == [CVE_NEW]
    assert CVE_GONE not in [v["cve_id"] for v in windows_cves(fleet["w11_old"])]
    assert requests.get(f"{API}/vulnerabilities/cves/{CVE_GONE}", headers=HEADERS, timeout=10).status_code == 404
