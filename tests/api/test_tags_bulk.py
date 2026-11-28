"""Tags: many nodes tagged and untagged in one call, dynamic groups with tag rules follow at once, a
rename keeps the rules working, where a tag is used, and tags in the Nodes list."""
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
    return {"hostname": hostname, "node_id": f"id-{hostname}",
            "id": requests.get(f"{API}/nodes/id-{hostname}", headers=HEADERS, timeout=10).json()["id"]}


def make_tag(name=None, **extra):
    r = requests.post(f"{API}/tags", headers=HEADERS, timeout=10, json={"name": name or f"tag-{uuid.uuid4().hex[:6]}", **extra})
    assert r.status_code == 200, r.text
    return r.json()["tag"]


def tags_of(node):
    nodes = requests.get(f"{API}/nodes", headers=HEADERS, timeout=30).json()["nodes"]
    return [t["name"] for t in next(n for n in nodes if n["id"] == node["id"])["tags"]]


def members(group_id):
    return {m["id"] for m in requests.get(f"{API}/groups/{group_id}", headers=HEADERS, timeout=10).json()["members"]}


@pytest.fixture
def nodes():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    return [make_node("tags-bulk") for _ in range(3)]


def test_tag_and_untag_many_nodes(nodes):
    a, b, c = nodes
    tag = make_tag()
    r = requests.post(f"{API}/tags/{tag['id']}/nodes", headers=HEADERS, timeout=10,
                      json={"nodeIds": [a["id"], b["node_id"], c["hostname"].upper(), "no-such-node"]})
    assert r.status_code == 200, r.text
    assert r.json()["added"] == 3 and r.json()["notFound"] == ["no-such-node"]
    assert tag["name"] in tags_of(a) and tag["name"] in tags_of(c)
    again = requests.post(f"{API}/tags/{tag['id']}/nodes", headers=HEADERS, timeout=10, json={"nodeIds": [a["id"]]}).json()
    assert again["added"] == 0 and again["alreadyTagged"] == 1
    r = requests.delete(f"{API}/tags/{tag['id']}/nodes", headers=HEADERS, timeout=10, json={"nodeIds": [a["hostname"], b["id"]]})
    assert r.json()["removed"] == 2, r.text
    assert tag["name"] not in tags_of(a) and tag["name"] in tags_of(c)
    assert requests.post(f"{API}/tags/{uuid.uuid4()}/nodes", headers=HEADERS, timeout=10, json={"nodeIds": [a["id"]]}).status_code == 404


def test_dynamic_group_with_a_tag_rule_follows_at_once_and_after_a_rename(nodes):
    a, b, _ = nodes
    tag = make_tag()
    rule = {"operator": "AND", "conditions": [{"field": "tags", "op": "has_tag", "value": tag["name"]}]}
    r = requests.post(f"{API}/groups", headers=HEADERS, timeout=10,
                      json={"name": f"dyn-tag-{uuid.uuid4().hex[:6]}", "isDynamic": True, "dynamicRule": rule})
    assert r.status_code == 200, r.text
    group = r.json()["group"]["id"]
    r = requests.post(f"{API}/tags/{tag['id']}/nodes", headers=HEADERS, timeout=10, json={"nodeIds": [a["id"], b["id"]]})
    assert r.json()["dynamicGroups"]["added"] == 2, r.text
    assert members(group) == {a["id"], b["id"]}
    # a rename keeps the rule working: the rule follows the new name
    new_name = f"renamed-{uuid.uuid4().hex[:6]}"
    r = requests.patch(f"{API}/tags/{tag['id']}", headers=HEADERS, timeout=10, json={"name": new_name, "color": "#22c55e"})
    assert r.status_code == 200 and r.json()["rulesUpdated"] == 1, r.text
    g = requests.get(f"{API}/groups/{group}", headers=HEADERS, timeout=10).json()
    rule_now = g.get("group", g).get("dynamic_rule")
    assert new_name in str(rule_now)
    r = requests.delete(f"{API}/tags/{tag['id']}/nodes", headers=HEADERS, timeout=10, json={"nodeIds": [a["id"]]})
    assert r.json()["dynamicGroups"]["removed"] == 1, r.text
    assert members(group) == {b["id"]}
    # where the tag is used
    listed = next(t for t in requests.get(f"{API}/tags", headers=HEADERS, timeout=10).json()["tags"] if t["id"] == tag["id"])
    assert listed["name"] == new_name and listed["color"] == "#22c55e"
    assert listed["device_count"] == 1 and listed["dynamic_groups"] == 1 and listed["jobs"] == 0


def test_rename_and_color_are_checked():
    tag, other = make_tag(), make_tag()
    assert requests.patch(f"{API}/tags/{tag['id']}", headers=HEADERS, timeout=10, json={"name": other["name"]}).status_code == 409
    assert requests.patch(f"{API}/tags/{tag['id']}", headers=HEADERS, timeout=10, json={"name": "  "}).status_code == 400
    assert requests.patch(f"{API}/tags/{tag['id']}", headers=HEADERS, timeout=10, json={"color": "green"}).status_code == 400
    assert requests.patch(f"{API}/tags/{tag['id']}", headers=HEADERS, timeout=10, json={"color": None}).status_code == 200
    assert requests.patch(f"{API}/tags/{uuid.uuid4()}", headers=HEADERS, timeout=10, json={"name": "x"}).status_code == 404
