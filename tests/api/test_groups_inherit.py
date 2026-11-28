"""A group reaches the nodes of its sub-groups: jobs, the node list filter and the member list include
them; a node is a member once per branch (added to a sub-group, it leaves the parent's own members;
a parent does not take a node a sub-group already brings); groups nest at most 3 levels."""
import os
import uuid

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}
API = f"{API_URL}/api/v1"


def api(method, path, expect=200, **kwargs):
    r = requests.request(method, f"{API}{path}", headers=HEADERS, timeout=30, **kwargs)
    assert r.status_code == expect, f"{method} {path}: {r.status_code} {r.text}"
    return r.json() if r.content else None


def node(tag, n):
    host = f"ginh-{tag}-{n}"
    api("POST", "/inventory/full", json={"hostname": host, "nodeId": host, "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
    return next(x for x in api("GET", "/nodes")["nodes"] if x.get("hostname") == host)["id"]


def group(name, parent=None):
    return api("POST", "/groups", json={"name": name, **({"parentId": parent} if parent else {})})["group"]["id"]


def test_parent_reaches_sub_groups_and_members_move_down():
    tag = uuid.uuid4().hex[:6]
    a, b, c = (node(tag, i) for i in (1, 2, 3))
    top = group(f"ginh-servers-{tag}")
    linux = group(f"ginh-linux-{tag}", top)
    created = []
    try:
        # a and b directly in the parent, then a and c to the sub-group: a moves down
        api("POST", f"/groups/{top}/members", json={"nodeIds": [a, b]})
        res = api("POST", f"/groups/{linux}/members", json={"nodeIds": [a, c]})
        assert res["added"] == 2 and res["movedFrom"] == 1
        detail = api("GET", f"/groups/{top}")
        members = {m["id"]: m for m in detail["members"]}
        assert set(members) == {a, b, c}                          # the parent reaches all three
        assert members[b]["direct"] and not members[a]["direct"]  # a is no longer its own member
        assert members[a]["via"] == [f"ginh-linux-{tag}"]
        assert detail["direct_count"] == 1
        listed = {g["id"]: g for g in api("GET", "/groups")["groups"]}
        assert listed[top]["member_count"] == 3 and listed[top]["direct_count"] == 1
        # a parent does not take a node its sub-group brings
        res = api("POST", f"/groups/{top}/members", json={"nodeIds": [c]})
        assert res["added"] == 0 and res["alreadyIncluded"][0]["via"] == [f"ginh-linux-{tag}"]
        # the node list's group filter and a job for the parent reach the sub-group's nodes
        assert {n["id"] for n in api("GET", f"/nodes?group_id={top}")["nodes"]} == {a, b, c}
        job = api("POST", "/jobs", json={"name": f"ginh {tag}", "targetType": "group", "targetId": top,
                                         "commandType": "script", "commandData": {"script": "true"}})
        created.append(job["id"])
        assert job["instances"] == 3
    finally:
        for j in created:
            if j:
                requests.delete(f"{API}/jobs/{j}", headers=HEADERS, timeout=10)
        for g in (linux, top):
            requests.delete(f"{API}/groups/{g}?confirm=true", headers=HEADERS, timeout=10)


def test_groups_nest_three_levels():
    tag = uuid.uuid4().hex[:6]
    one = group(f"ginh-1-{tag}")
    two = group(f"ginh-2-{tag}", one)
    three = group(f"ginh-3-{tag}", two)
    other = group(f"ginh-x-{tag}")
    sub = group(f"ginh-xs-{tag}", other)
    try:
        api("POST", "/groups", expect=400, json={"name": f"ginh-4-{tag}", "parentId": three})
        # moving a group with a sub-group below level 2 would make 4 levels
        api("PUT", f"/groups/{other}", expect=400, json={"parentId": two})
        api("PUT", f"/groups/{other}", json={"parentId": one})       # 3 levels: fine
        assert [p["id"] for p in api("GET", f"/groups/{sub}")["parents"]] == [one, other]
    finally:
        for g in (sub, other, three, two, one):
            requests.delete(f"{API}/groups/{g}?confirm=true", headers=HEADERS, timeout=10)
