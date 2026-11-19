"""Linux approval rules (#271): rules approve or exclude pending Linux package versions per node, scoped
by deployment rings (with their delay and pause) and groups; the fleet list counts them, and a bulk
installation sends exactly the approved versions, computed by the server.

The rules are global, so every rule here is limited to a distribution release of its own per run
(`ci<tag>:1`) and deleted afterwards."""
import json
import os
import time
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}",
           "Content-Type": "application/json"}


def api(method, path, expect=200, **kwargs):
    r = requests.request(method, f"{API_URL}/api/v1{path}", headers=HEADERS, timeout=30, **kwargs)
    assert r.status_code == expect, f"{method} {path}: {r.status_code} {r.text}"
    return r.json() if r.content else None


def push(hostname, release, package_manager="apt", updates=None):
    body = {"hostname": hostname, "nodeId": hostname, "system": {"os": {"name": "Ubuntu"}},
            "updates": {"packageManager": package_manager, "totalUpdates": len(updates or []),
                        "updates": updates or [], **({"release": release} if release else {})}}
    api("POST", "/inventory/full", json=body)
    return api("GET", f"/nodes/{hostname}")["id"]


UPDATES = [
    {"name": "openssl", "newVersion": "3.5.1-1", "arch": "amd64", "installedVersion": "3.5.0-1",
     "repository": "ci-security,ci-updates", "security": True},
    {"name": "curl", "newVersion": "8.14.1-2", "arch": "amd64", "installedVersion": "8.14.1-1",
     "repository": "ci-updates", "security": False},
]


@pytest.fixture(scope="module")
def setup():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    tag = uuid.uuid4().hex[:8]
    release = {"id": f"ci{tag}", "versionId": "1"}
    nodes = {
        "pilot": push(f"rules-pilot-{tag}", release, updates=UPDATES),
        "broad": push(f"rules-broad-{tag}", release, updates=UPDATES),
        "pacman": push(f"rules-pacman-{tag}", {"id": f"ci{tag}", "versionId": "1"}, "pacman",
                       [{"name": "zstd", "newVersion": "1.5.7-2", "arch": "x86_64", "installedVersion": "1.5.7-1",
                         "repository": "core", "security": False}]),
        "old": push(f"rules-old-{tag}", None, updates=UPDATES),  # older agent: no release
    }
    group = api("POST", "/groups", json={"name": f"rules-pilot-{tag}"})["group"]["id"]
    api("POST", f"/groups/{group}/members", json={"nodeIds": [nodes["pilot"]]})
    pilot = api("POST", "/patches/rings", json={"name": f"ci-pilot-{tag}", "delay_hours": 0, "node_group_id": group})["id"]
    broad = api("POST", "/patches/rings", json={"name": f"ci-broad-{tag}", "delay_hours": 1000})["id"]
    ctx = {"tag": tag, "release": f"ci{tag}:*", "nodes": nodes, "group": group, "pilot": pilot, "broad": broad, "rules": []}
    yield ctx
    for rule in ctx["rules"]:
        requests.delete(f"{API_URL}/api/v1/patches/linux-rules/{rule}", headers=HEADERS, timeout=10)
    for ring in (pilot, broad):
        requests.delete(f"{API_URL}/api/v1/patches/rings/{ring}", headers=HEADERS, timeout=10)
    requests.delete(f"{API_URL}/api/v1/groups/{group}", headers=HEADERS, timeout=10)


def rule(ctx, **fields):
    body = {"name": f"ci rule {ctx['tag']}", "enabled": True, "releases": [ctx["release"]], **fields}
    created = api("POST", "/patches/linux-rules", expect=201, json=body)
    ctx["rules"].append(created["id"])
    return created["id"]


def drop(ctx, rule_id):
    api("DELETE", f"/patches/linux-rules/{rule_id}")
    ctx["rules"].remove(rule_id)


def states(node_uuid):
    return {u["name"]: u["state"] for u in api("GET", f"/patches/linux-approved/{node_uuid}")["updates"]}


def fleet_row(ctx, key):
    """The node's fleet row once the approval cache has caught up (a background worker updates the
    counts a moment after a rule, ring or update list changed; `linux.evaluating` until then)."""
    deadline = time.monotonic() + 30
    while True:
        data = api("GET", "/patches/fleet", params={"q": ctx["tag"], "limit": 100})
        node = next(n for n in data["nodes"] if n["id"] == ctx["nodes"][key])
        if not (node["linux"] or {}).get("evaluating") or time.monotonic() > deadline:
            return node
        time.sleep(0.5)


def test_fresh_install_has_only_the_disabled_example(setup):
    rules = api("GET", "/patches/linux-rules")["rules"]
    example = [r for r in rules if r["name"] == "Security updates (example)"]
    assert example and example[0]["enabled"] is False and example[0]["security_only"] is True
    # nothing approved for this run's release without a rule of its own
    assert states(setup["nodes"]["pilot"]) == {"openssl": "not_approved", "curl": "not_approved"}
    assert fleet_row(setup, "pilot")["approved"] == 0


def test_older_agent_and_release_info(setup):
    old = fleet_row(setup, "old")["linux"]
    assert old["approval"] == "agent_too_old" and old["release"] is None
    pilot = fleet_row(setup, "pilot")["linux"]
    assert pilot["release"] == f"ci{setup['tag']}:1" and pilot["package_manager"] == "apt"
    assert pilot["security_data"] is True
    assert fleet_row(setup, "pacman")["linux"]["security_data"] is False


def test_rings_delay_pause_and_expedite(setup):
    rid = rule(setup, security_only=True, ring_ids=[setup["pilot"], setup["broad"]])
    pilot, broad = setup["nodes"]["pilot"], setup["nodes"]["broad"]
    # pilot ring: no delay; broad ring: 1000 hours
    assert states(pilot) == {"openssl": "approved", "curl": "not_approved"}
    assert states(broad) == {"openssl": "waiting", "curl": "not_approved"}
    assert fleet_row(setup, "pilot")["approved"] == 1
    assert fleet_row(setup, "broad")["linux"]["waiting"] == 1
    totals = api("GET", "/patches/linux-rules")["totals"]
    assert totals["approved"] >= 1 and totals["waiting"] >= 1
    # paused pilot ring: the pilot node only has the broad ring (no group = all nodes) left
    api("POST", f"/patches/rings/{setup['pilot']}/pause")
    try:
        assert states(pilot)["openssl"] == "waiting"
    finally:
        api("POST", f"/patches/rings/{setup['pilot']}/resume")
    assert states(pilot)["openssl"] == "approved"
    # expedite skips the ring delay
    api("PUT", f"/patches/linux-rules/{rid}", json={"expedite": True})
    assert states(broad)["openssl"] == "approved"
    drop(setup, rid)
    assert states(broad)["openssl"] == "not_approved"


def test_exclusion_wins(setup):
    approve = rule(setup)  # all updates, all nodes of this release
    assert states(setup["nodes"]["broad"]) == {"openssl": "approved", "curl": "approved"}
    exclude = rule(setup, action="exclude", packages=["open*"])
    assert states(setup["nodes"]["broad"]) == {"openssl": "excluded", "curl": "approved"}
    assert fleet_row(setup, "broad")["linux"]["excluded"] == 1
    drop(setup, exclude)
    # an exclusion by repository, too
    exclude = rule(setup, action="exclude", repositories=["ci-updates"])
    assert states(setup["nodes"]["broad"]) == {"openssl": "approved", "curl": "excluded"}
    drop(setup, exclude)
    drop(setup, approve)


def test_group_narrows_and_disabled_rules_do_nothing(setup):
    rid = rule(setup, group_id=setup["group"])
    assert states(setup["nodes"]["pilot"])["curl"] == "approved"
    assert states(setup["nodes"]["broad"])["curl"] == "not_approved"
    api("PUT", f"/patches/linux-rules/{rid}", json={"enabled": False})
    assert states(setup["nodes"]["pilot"])["curl"] == "not_approved"
    drop(setup, rid)


def test_deleted_ring_group(setup):
    """Fail-safe after a delete: an exclusion rule whose ring lost its group covers all nodes."""
    tag = setup["tag"]
    group = api("POST", "/groups", json={"name": f"rules-temp-{tag}"})["group"]["id"]
    ring = api("POST", "/patches/rings", json={"name": f"ci-temp-{tag}", "delay_hours": 0, "node_group_id": group})["id"]
    approve = rule(setup)
    exclude = rule(setup, action="exclude", packages=["curl"], ring_ids=[ring])
    try:
        assert states(setup["nodes"]["broad"])["curl"] == "approved"  # not in the ring's (empty) group
        api("DELETE", f"/groups/{group}")
        assert states(setup["nodes"]["broad"])["curl"] == "excluded"  # ring without its group: all nodes
        assert fleet_row(setup, "broad")["linux"]["excluded"] == 1
    finally:
        drop(setup, exclude)
        requests.delete(f"{API_URL}/api/v1/patches/rings/{ring}", headers=HEADERS, timeout=10)
    drop(setup, approve)


def test_minimum_age_waits(setup):
    rid = rule(setup, min_age_hours=48)
    detail = api("GET", f"/patches/linux-approved/{setup['nodes']['pilot']}")["updates"]
    assert {u["state"] for u in detail} == {"waiting"}
    assert all(u["approved_at"] for u in detail)
    drop(setup, rid)


def test_preview(setup):
    preview = api("POST", "/patches/linux-rules/preview",
                  json={"name": "p", "releases": [setup["release"]], "security_only": True})
    # three nodes of the release in scope (the older agent has no release); pacman has no security data
    assert preview["nodes"] == 3 and preview["nodes_without_security_data"] == 1
    assert preview["approved"] == 2  # openssl on the pilot and broad nodes
    preview = api("POST", "/patches/linux-rules/preview",
                  json={"name": "p", "releases": [setup["release"]], "ring_ids": [setup["pilot"]]})
    assert preview["nodes"] == 1


def test_validation(setup):
    bad = [
        {"name": ""},
        {"name": "x", "packages": ["openssl; rm"]},
        {"name": "x", "action": "exclude"},  # an exclusion needs patterns
        {"name": "x", "min_severity": "Important"},  # only with security_only
        {"name": "x", "min_age_hours": -1},
        {"name": "x", "ring_ids": [str(uuid.uuid4())]},
        {"name": "x", "group_id": "not-a-uuid"},
        {"name": "x", "enabled": "yes"},
    ]
    for body in bad:
        api("POST", "/patches/linux-rules", expect=400, json=body)
    api("PUT", f"/patches/linux-rules/{uuid.uuid4()}", expect=404, json={"name": "x"})
    api("DELETE", "/patches/linux-rules/not-a-uuid", expect=404)
    api("POST", f"/patches/rings/{uuid.uuid4()}/pause", expect=404)


def test_bulk_install_sends_the_approved_versions(setup):
    rid = rule(setup, security_only=True, group_id=setup["group"])
    n = setup["nodes"]
    # the browser cannot choose packages: a list in the request is ignored
    r = api("POST", "/patches/fleet/install", json={
        "node_ids": [n["pilot"], n["broad"], n["pacman"], n["old"]],
        "packages": [{"name": "curl", "version": "8.14.1-2"}]})
    skipped = {s["node"]: s["reason"] for s in r["skipped"]}
    assert skipped == {n["broad"]: "not_approved", n["pacman"]: "unsupported", n["old"]: "agent_too_old"}
    assert [j["node"] for j in r["jobs"]] == [n["pilot"]]
    job = api("GET", f"/jobs/{r['jobs'][0]['job_id']}")
    data = job["command_data"] if isinstance(job["command_data"], dict) else json.loads(job["command_data"])
    assert data["packages"] == [{"name": "openssl", "version": "3.5.1-1"}]
    assert job["command_type"] == "patch_install"
    drop(setup, rid)
