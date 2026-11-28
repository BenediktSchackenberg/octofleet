"""Groups: sub-groups with their parent chain and children, no loops, and dynamic groups that get their
members when created and when their rule changes - not only on the nodes' next push."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}
API = f"{API_URL}/api/v1"


def group(name, **extra):
    r = requests.post(f"{API}/groups", headers=HEADERS, timeout=10, json={"name": f"{name}-{uuid.uuid4().hex[:6]}", **extra})
    assert r.status_code == 200, r.text
    return r.json()


def get(group_id):
    r = requests.get(f"{API}/groups/{group_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


def test_parent_chain_children_and_no_loops():
    top = group("tree-top")["group"]["id"]
    mid = group("tree-mid", parentId=top)["group"]["id"]
    leaf = group("tree-leaf", parentId=mid)["group"]["id"]
    assert [p["id"] for p in get(leaf)["parents"]] == [top, mid]
    assert [c["id"] for c in get(top)["children"]] == [mid]
    # a group cannot go below itself or one of its sub-groups
    for parent in (top, leaf):
        r = requests.put(f"{API}/groups/{top}", headers=HEADERS, timeout=10, json={"parentId": leaf if parent == leaf else top})
        assert r.status_code == 400, r.text
    assert requests.post(f"{API}/groups", headers=HEADERS, timeout=10,
                         json={"name": f"x-{uuid.uuid4().hex[:6]}", "parentId": str(uuid.uuid4())}).status_code == 400
    # moving a sub-group up is fine; deleting the parent moves sub-groups to the top
    assert requests.put(f"{API}/groups/{leaf}", headers=HEADERS, timeout=10, json={"parentId": top}).status_code == 200
    assert requests.delete(f"{API}/groups/{top}?confirm=true", headers=HEADERS, timeout=10).status_code == 200
    assert get(mid)["parent_id"] is None


def test_dynamic_group_gets_members_at_once():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    prefix = f"dyn-tree-{uuid.uuid4().hex[:6]}"
    for n in (1, 2):
        r = requests.post(f"{API}/inventory/full", headers=HEADERS, timeout=30, json={"hostname": f"{prefix}-{n}", "nodeId": f"{prefix}-{n}",
                                 "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
        assert r.status_code == 200, r.text
    rule = {"operator": "AND", "conditions": [{"field": "hostname", "op": "startswith", "value": prefix}]}
    assert requests.post(f"{API}/groups", headers=HEADERS, timeout=10,
                         json={"name": f"x-{uuid.uuid4().hex[:6]}", "isDynamic": True}).status_code == 400  # no rule
    created = group("dyn", isDynamic=True, dynamicRule=rule)
    assert created["members"] == 2
    gid = created["group"]["id"]
    assert created["group"]["dynamic_rule"] == rule  # decoded, not text
    assert sorted(m["hostname"] for m in get(gid)["members"]) == [f"{prefix}-1", f"{prefix}-2"]
    # a narrower rule applies at once
    narrower = {"operator": "AND", "conditions": [{"field": "hostname", "op": "equals", "value": f"{prefix}-1"}]}
    r = requests.put(f"{API}/groups/{gid}", headers=HEADERS, timeout=10, json={"dynamicRule": narrower})
    assert r.status_code == 200 and r.json()["members"] == {"added": 0, "removed": 1}, r.text
    assert [m["hostname"] for m in get(gid)["members"]] == [f"{prefix}-1"]
