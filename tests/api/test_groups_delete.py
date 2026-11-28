"""Deleting a group: an unused group goes at once; a used one only after confirmation, and then its uses
are cleaned up without widening anything - the nodes stay, Linux rules and rings keep the group's id
(the rule engine treats a missing group fail-safe), jobs keep running."""
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


def test_unused_group_is_deleted_at_once():
    gid = api("POST", "/groups", json={"name": f"gdel-empty-{uuid.uuid4().hex[:6]}"})["group"]["id"]
    assert api("GET", f"/groups/{gid}/usage")["uses"] == []
    assert api("DELETE", f"/groups/{gid}")["status"] == "deleted"
    api("GET", f"/groups/{gid}", expect=404)
    api("GET", f"/groups/{gid}/usage", expect=404)
    api("DELETE", f"/groups/not-a-uuid", expect=400)


def test_used_group_needs_confirmation_and_is_cleaned_up():
    tag = uuid.uuid4().hex[:6]
    host = f"gdel-{tag}"
    api("POST", "/inventory/full", json={"hostname": host, "nodeId": host, "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
    node = next(n for n in api("GET", "/nodes")["nodes"] if n.get("hostname") == host)
    gid = api("POST", "/groups", json={"name": f"gdel-used-{tag}"})["group"]["id"]
    child = api("POST", "/groups", json={"name": f"gdel-child-{tag}", "parentId": gid})["group"]["id"]
    api("POST", f"/groups/{gid}/members", json={"nodeIds": [node["id"]]})
    ring = api("POST", "/patches/rings", json={"name": f"gdel-ring-{tag}", "delay_hours": 0, "node_group_id": gid})["id"]
    rules = [api("POST", "/patches/linux-rules", expect=201,
                 json={"name": f"gdel {action} {tag}", "enabled": True, "action": action, "releases": [f"gdel{tag}:*"],
                       "group_id": gid, **({"packages": ["curl"]} if action == "exclude" else {})})["id"]
             for action in ("approve", "exclude")]
    try:
        uses = {u["kind"]: u for u in api("GET", f"/groups/{gid}/usage")["uses"]}
        assert uses["members"]["count"] == 1 and uses["members"]["effect"] == "removed"
        assert uses["subgroups"]["names"] == [f"gdel-child-{tag}"] and uses["subgroups"]["effect"] == "moved_to_top"
        assert uses["linux_approvals"]["effect"] == "approves_nothing"
        assert uses["linux_exclusions"]["effect"] == "covers_all"
        assert uses["patch_rings"]["names"] == [f"gdel-ring-{tag}"] and uses["patch_rings"]["effect"] == "no_nodes"

        # without confirmation: refused, with what uses it
        refused = api("DELETE", f"/groups/{gid}", expect=409)["detail"]
        assert {u["kind"] for u in refused["uses"]} >= {"members", "subgroups", "linux_approvals", "patch_rings"}
        api("GET", f"/groups/{gid}")

        assert api("DELETE", f"/groups/{gid}?confirm=true")["status"] == "deleted"
        api("GET", f"/groups/{gid}", expect=404)
        # the node stays, the sub-group moves to the top, rules and ring are untouched
        assert any(n.get("hostname") == host for n in api("GET", "/nodes")["nodes"])
        assert api("GET", f"/groups/{child}")["parent_id"] is None
        kept = {r["id"]: r for r in api("GET", "/patches/linux-rules")["rules"]}
        assert all(kept[r]["enabled"] and kept[r]["group_id"] == gid for r in rules)
        ring_row = next(r for r in api("GET", "/patches/rings") if str(r["id"]) == str(ring))
        assert str(ring_row["node_group_id"]) == gid
        # the audit log says what the delete did
        entries = api("GET", f"/audit-log?resource_type=group&resource_id={gid}&action=group.deleted")
        rows = entries.get("entries", entries.get("items", entries)) if isinstance(entries, dict) else entries
        assert any(e.get("resource_id") == gid for e in rows)
    finally:
        for rule in rules:
            requests.delete(f"{API}/patches/linux-rules/{rule}", headers=HEADERS, timeout=10)
        requests.delete(f"{API}/patches/rings/{ring}", headers=HEADERS, timeout=10)
        requests.delete(f"{API}/groups/{child}?confirm=true", headers=HEADERS, timeout=10)
        requests.delete(f"{API}/groups/{gid}?confirm=true", headers=HEADERS, timeout=10)
