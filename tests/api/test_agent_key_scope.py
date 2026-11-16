"""The central agent key is stored on every managed machine, so it gets the agent's permissions
only: inventory, job polls and results. Administrative routes refuse it."""
import os
import uuid

import pytest
import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
AGENT = {"X-API-Key": os.getenv("INVENTORY_API_KEY", ""), "Content-Type": "application/json"}
ADMIN = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def node():
    assert AGENT["X-API-Key"], "INVENTORY_API_KEY must be set"
    hostname = f"agent-key-{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/inventory/full", headers=AGENT, timeout=30,
                      json={"hostname": hostname, "nodeId": hostname, "hardware": {"cpu": {"name": "Test CPU", "cores": 2}}})
    assert r.status_code == 200, r.text  # agents keep reporting with the key
    r = requests.get(f"{API}/nodes/{hostname}", headers=ADMIN, timeout=10)
    assert r.status_code == 200, r.text
    return hostname, r.json()["id"]


@pytest.mark.parametrize("method, path, body", [
    ("POST", "/terminal/start/{host}", {"shell": "powershell"}),
    ("POST", "/shell/start/{host}", {}),
    ("POST", "/screen/start/{host}", {}),
    ("DELETE", "/nodes/{id}", None),
    ("POST", "/nodes/{id}/uninstall", {}),
    ("PUT", "/security/password-policy", {"min_length": 12}),
    ("PUT", "/provisioning/config", {}),
    ("POST", "/roles/00000000-0000-0000-0000-000000000000/scopes", {}),
])
def test_admin_routes_refuse_the_agent_key(node, method, path, body):
    hostname, node_id = node
    url = API + path.format(host=hostname, id=node_id)
    r = requests.request(method, url, headers=AGENT, json=body, timeout=10)
    assert r.status_code == 403, (method, path, r.status_code, r.text)


def test_terminal_reads_refuse_the_agent_key():
    assert requests.get(f"{API}/terminal/sessions", headers=AGENT, timeout=10).status_code == 403


def test_agent_routes_still_accept_the_key(node):
    hostname, _ = node
    assert requests.get(f"{API}/patches/pending/{hostname}", headers=AGENT, timeout=10).status_code == 200
    # the agent's terminal output route checks the agent scope: unknown session, not a 403
    r = requests.post(f"{API}/terminal/output/{uuid.uuid4()}", headers=AGENT, json={"output": "x"}, timeout=10)
    assert r.status_code == 404, r.text


def test_admins_still_reach_the_admin_routes(node):
    hostname, _ = node
    r = requests.post(f"{API}/terminal/start/{hostname}", headers=ADMIN, json={"shell": "powershell"}, timeout=10)
    assert r.status_code == 200, r.text
    requests.delete(f"{API}/terminal/session/{r.json()['sessionId']}", headers=ADMIN, timeout=10)
