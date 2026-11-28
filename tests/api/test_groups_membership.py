"""Groups: members by any node reference in one call, a job for a group reaches its members, removing one
member, editing a sub-group keeps its parent, and dynamic rules only with fields the evaluator fills."""
import os
import uuid

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}
API = f"{API_URL}/api/v1"


def make_node(prefix):
    hostname = f"{prefix}-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/inventory/full", headers=HEADERS, timeout=30,
                      json={"hostname": hostname, "nodeId": f"id-{hostname}", "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
    assert r.status_code == 200, r.text
    node = requests.get(f"{API}/nodes/id-{hostname}", headers=HEADERS, timeout=10)  # by node ID
    assert node.status_code == 200, node.text
    return {"hostname": hostname, "node_id": f"id-{hostname}", "id": node.json()["id"]}


def make_group(name, **extra):
    r = requests.post(f"{API}/groups", headers=HEADERS, timeout=10, json={"name": f"{name}-{uuid.uuid4().hex[:6]}", **extra})
    assert r.status_code == 200, r.text
    return r.json()["group"]["id"]


def members(group_id):
    r = requests.get(f"{API}/groups/{group_id}", headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    return {m["id"] for m in r.json()["members"]}


@pytest.fixture
def nodes():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    return [make_node("groups-m") for _ in range(3)]


def test_add_members_by_uuid_node_id_or_hostname(nodes):
    a, b, c = nodes
    group = make_group("members")
    r = requests.post(f"{API}/groups/{group}/members", headers=HEADERS, timeout=10,
                      json={"nodeIds": [a["id"], b["node_id"], c["hostname"].upper(), "no-such-node"]})
    assert r.status_code == 200, r.text
    assert r.json()["added"] == 3 and r.json()["notFound"] == ["no-such-node"]
    assert members(group) == {a["id"], b["id"], c["id"]}
    # again: nothing new
    again = requests.post(f"{API}/groups/{group}/members", headers=HEADERS, timeout=10, json={"nodeIds": [a["hostname"]]}).json()
    assert again["added"] == 0 and again["alreadyMembers"] == 1
    # the old key is not read
    assert requests.post(f"{API}/groups/{group}/members", headers=HEADERS, timeout=10,
                         json={"node_ids": [a["id"]]}).status_code == 400


def test_remove_one_member_and_several(nodes):
    a, b, c = nodes
    group = make_group("remove")
    requests.post(f"{API}/groups/{group}/members", headers=HEADERS, timeout=10, json={"nodeIds": [n["id"] for n in nodes]})
    r = requests.delete(f"{API}/groups/{group}/members/{a['id']}", headers=HEADERS, timeout=10)
    assert r.status_code == 200 and r.json()["removed"] == 1, r.text
    r = requests.delete(f"{API}/groups/{group}/members", headers=HEADERS, timeout=10, json={"nodeIds": [b["hostname"], c["node_id"]]})
    assert r.json()["removed"] == 2, r.text
    assert members(group) == set()
    assert requests.delete(f"{API}/groups/{group}/members/no-such-node", headers=HEADERS, timeout=10).status_code == 404


def test_a_job_for_a_group_reaches_its_members(nodes):
    a, b, _ = nodes
    group = make_group("job-target")
    requests.post(f"{API}/groups/{group}/members", headers=HEADERS, timeout=10, json={"nodeIds": [a["id"], b["id"]]})
    r = requests.post(f"{API}/jobs", headers=HEADERS, timeout=10, json={
        "name": "group job", "targetType": "group", "targetId": group, "commandType": "script", "commandData": {"script": "true"}})
    assert r.status_code == 200, r.text
    assert r.json()["instances"] == 2
    job = requests.get(f"{API}/jobs/{r.json()['id']}", headers=HEADERS, timeout=10).json()
    assert {i["node_id"] for i in job["instances"]} == {a["id"], b["id"]}


def test_editing_a_sub_group_keeps_its_parent():
    parent = make_group("parent")
    child = make_group("child", parentId=parent)
    r = requests.put(f"{API}/groups/{child}", headers=HEADERS, timeout=10, json={"name": f"edited-{uuid.uuid4().hex[:6]}"})
    assert r.status_code == 200, r.text
    assert r.json()["group"]["parent_id"] == parent
    # named explicitly: moved to the top
    r = requests.put(f"{API}/groups/{child}", headers=HEADERS, timeout=10, json={"parentId": None})
    assert r.json()["group"]["parent_id"] is None


def test_dynamic_rules_only_with_fields_the_evaluator_fills():
    bad = {"operator": "AND", "conditions": [{"field": "cpu_name", "op": "contains", "value": "Xeon"}]}
    r = requests.post(f"{API}/groups", headers=HEADERS, timeout=10,
                      json={"name": f"dyn-{uuid.uuid4().hex[:6]}", "isDynamic": True, "dynamicRule": bad})
    assert r.status_code == 400 and "dynamicRule field" in r.text, r.text
    r = requests.post(f"{API}/groups/preview-rule", headers=HEADERS, timeout=10,
                      json={"rule": {"conditions": [{"field": "hostname", "op": "sounds_like", "value": "x"}]}})
    assert r.status_code == 400
    good = {"operator": "AND", "conditions": [{"field": "hostname", "op": "startswith", "value": "groups-m-"}]}
    r = requests.post(f"{API}/groups/preview-rule", headers=HEADERS, timeout=10, json={"rule": good})
    assert r.status_code == 200, r.text
