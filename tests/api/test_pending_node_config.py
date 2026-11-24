"""Self-registration: the configuration (with the agent key) of an approved node goes only to the
agent that registered (one-time secret from POST /nodes/register), and only once."""
import os
import uuid

import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
ADMIN = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}
AGENT_KEY = os.getenv("INVENTORY_API_KEY", "")
HEADER = "X-Registration-Secret"


def _register():
    machine = f"ci-machine-{uuid.uuid4().hex[:8]}"
    body = {"hostname": f"REG-{uuid.uuid4().hex[:6]}", "osName": "Windows 11", "osVersion": "10.0.26100",
            "agentVersion": "1.0.0", "machineId": machine}
    r = requests.post(f"{API}/nodes/register", json=body, timeout=10)
    assert r.status_code == 200, r.text
    return body, r.json()


def _config(pending_id, secret=None):
    headers = {HEADER: secret} if secret is not None else {}
    return requests.get(f"{API}/pending-nodes/{pending_id}/config", headers=headers, timeout=10)


def test_registration_returns_a_one_time_secret():
    body, reg = _register()
    assert reg["status"] == "pending"
    assert len(reg["registrationSecret"]) >= 40
    # the same machine again while waiting: no secret for the second caller
    again = requests.post(f"{API}/nodes/register", json=body, timeout=10).json()
    assert again["pendingId"] == reg["pendingId"]
    assert "registrationSecret" not in again


def test_config_needs_the_secret():
    _, reg = _register()
    pending_id, secret = reg["pendingId"], reg["registrationSecret"]
    assert _config(pending_id).status_code == 403
    assert _config(pending_id, "guessed").status_code == 403
    assert _config(pending_id, AGENT_KEY).status_code == 403
    r = _config(pending_id, secret)
    assert r.status_code == 200 and r.json() == {"status": "pending"}, r.text
    # not visible with a key or session either: the route has no other credentials
    assert requests.get(f"{API}/pending-nodes/{pending_id}/config", headers=ADMIN, timeout=10).status_code == 403


def test_approved_config_is_handed_out_once_with_the_server_address():
    body, reg = _register()
    pending_id, secret = reg["pendingId"], reg["registrationSecret"]
    r = requests.post(f"{API}/pending-nodes/{pending_id}/approve", headers=ADMIN, timeout=10)
    assert r.status_code == 200, r.text
    assert _config(pending_id).status_code == 403

    r = _config(pending_id, secret)
    assert r.status_code == 200, r.text
    config = r.json()["config"]
    assert r.json()["status"] == "approved"
    assert config["InventoryApiKey"] == AGENT_KEY
    assert config["DisplayName"] == body["hostname"]
    assert config["InventoryApiUrl"].startswith(("http://", "https://"))
    assert "192.168.0.5" not in config["InventoryApiUrl"]

    # once: the secret is invalid now
    assert _config(pending_id, secret).status_code == 403


def test_rejected_registration():
    _, reg = _register()
    pending_id, secret = reg["pendingId"], reg["registrationSecret"]
    r = requests.delete(f"{API}/pending-nodes/{pending_id}/reject", headers=ADMIN, timeout=10)
    assert r.status_code == 200, r.text
    assert _config(pending_id).status_code == 403
    r = _config(pending_id, secret)
    assert r.status_code == 200 and r.json() == {"status": "rejected"}


def test_unknown_pending_id():
    assert _config("999999999", "x").status_code == 404
    assert _config(str(uuid.uuid4()), "x").status_code == 404


def test_pending_list_needs_nodes_read():
    assert requests.get(f"{API}/pending-nodes", timeout=10).status_code == 401
    assert requests.get(f"{API}/pending-nodes", headers={"X-API-Key": AGENT_KEY}, timeout=10).status_code == 403
    r = requests.get(f"{API}/pending-nodes", headers=ADMIN, timeout=10)
    assert r.status_code == 200, r.text
