"""Write routes check a permission: the shared agent key (stored on every managed machine) only
reaches the routes the agents push to, administrative routes need a user with the permission."""
import os
import uuid

import pytest
import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
AGENT = {"X-API-Key": os.getenv("INVENTORY_API_KEY", ""), "Content-Type": "application/json"}
ADMIN = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}
ZERO = "00000000-0000-0000-0000-000000000000"


@pytest.fixture(scope="module")
def node():
    assert AGENT["X-API-Key"], "INVENTORY_API_KEY must be set"
    hostname = f"perm-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/inventory/full", headers=AGENT, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
    assert r.status_code == 200, r.text
    r = requests.get(f"{API}/nodes/{hostname}", headers=ADMIN, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


@pytest.mark.parametrize("method, path, body", [
    ("POST", "/deployments", {"name": "x", "packageVersionId": ZERO, "targetType": "all"}),
    ("POST", "/query/execute", {"from": "nodes", "select": ["hostname"], "limit": 1}),
    ("GET", "/query/history", None),
    ("POST", "/packages", {"name": "agent-key-package"}),
    ("POST", "/repo/cache", {"url": "http://example.invalid/x.msi"}),
    ("POST", "/services", {"name": "x"}),
    ("POST", "/service-classes", {"name": "x"}),
    ("POST", "/mssql/configs", {"name": "x"}),
    ("POST", "/mssql/install", {}),
    ("POST", "/security/policies", {"name": "x"}),
    ("POST", "/security/detection-rules", {"name": "x"}),
    ("POST", "/security/retention/policies", {"name": "x"}),
    ("POST", "/monitoring/profiles", {"name": "x"}),
    ("POST", "/reports/execute", {"reportSlug": "fleet-summary"}),
    ("POST", "/reports/schedules", {"name": "x"}),
    ("POST", "/tags", {"name": "agent-key-tag"}),
    ("POST", "/groups", {"name": "agent-key-group"}),
    ("POST", "/alert-channels", {"name": "x"}),
    ("GET", "/alert-channels", None),
    ("POST", "/content/repositories", {"name": "x"}),
    ("POST", "/metering/catalog", {"name": "x"}),
    ("POST", f"/jobs/instances/{ZERO}/retry", {}),
])
def test_admin_routes_refuse_the_agent_key(method, path, body):
    assert AGENT["X-API-Key"], "INVENTORY_API_KEY must be set"
    r = requests.request(method, API + path, headers=AGENT, json=body, timeout=10)
    assert r.status_code == 403, (method, path, r.status_code, r.text)


def test_admins_reach_the_admin_routes():
    # explain: the CI database has no query_history table, in which executed queries are logged
    r = requests.post(f"{API}/query/execute", headers=ADMIN, timeout=10,
                      json={"from": "nodes", "select": ["hostname"], "limit": 1, "explain": True})
    assert r.status_code == 200, r.text

    r = requests.post(f"{API}/tags", headers=ADMIN, json={"name": f"perm-{uuid.uuid4().hex[:8]}"}, timeout=10)
    assert r.status_code == 200, r.text
    tag_id = r.json()["tag"]["id"]
    assert requests.delete(f"{API}/tags/{tag_id}", headers=ADMIN, timeout=10).status_code == 200

    r = requests.post(f"{API}/packages", headers=ADMIN, json={"name": f"perm-{uuid.uuid4().hex[:8]}"}, timeout=10)
    assert r.status_code == 200, r.text
    assert requests.delete(f"{API}/packages/{r.json()['id']}", headers=ADMIN, timeout=10).status_code == 200

    r = requests.post(f"{API}/security/policies", headers=ADMIN, json={"name": f"perm-{uuid.uuid4().hex[:8]}"}, timeout=10)
    assert r.status_code == 200, r.text
    assert requests.delete(f"{API}/security/policies/{r.json()['id']}", headers=ADMIN, timeout=10).status_code == 200


def test_agent_push_routes_still_accept_the_key(node):
    hostname, node_id = node
    pushes = [
        (f"/nodes/{hostname}/eventlog", {"events": []}),
        (f"/agents/{hostname}/capabilities", {"sensors": [], "agentVersion": "1.0", "osType": "windows"}),
        ("/ingest/events/normalized", {"events": []}),
        ("/posture/snapshots", {"nodeId": node_id, "osInfo": {}}),
        ("/metering/usage/submit", {"nodeId": node_id, "entries": []}),
    ]
    for path, body in pushes:
        r = requests.post(API + path, headers=AGENT, json=body, timeout=10)
        assert r.status_code == 200, (path, r.status_code, r.text)
