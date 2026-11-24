"""Read routes that answered without credentials need a session (or a key with the read permission)."""
import os

import pytest
import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
TOKEN = os.getenv("TEST_ADMIN_TOKEN", "")
AGENT_KEY = os.getenv("INVENTORY_API_KEY", "")
ID = "00000000-0000-0000-0000-000000000000"

# Answer 200 for an admin on the CI database
READABLE = [
    "/eventlog/summary",
    "/eventlog/important-events",
    "/security/activity/files",
    "/security/activity/users",
    "/security/activity/export",
    "/security/findings",
    "/security/findings/summary",
    "/security/rules",
    "/security/vulnerabilities/fleet",
    "/smart-install/packages",
    "/software-baselines",
    "/posture/snapshots/ci-node",
    "/posture/snapshots/ci-node/latest",
    "/posture/diffs/ci-node",
    "/posture/compare/ci-node",
    "/provisioning/images",
    "/provisioning/templates",
    "/provisioning/tasks",
]
# Depend on data or on the server's file system (404, 400, 500 without ISO directory/NFS)
OTHERS = [
    "/discovered-systems",
    f"/discovered-systems/{ID}",
    f"/software-baselines/{ID}",
    "/package-sources",
    f"/provisioning/tasks/{ID}",
    f"/provisioning/tasks/{ID}/events",
    "/provisioning/iso/scan",
    "/provisioning/iso/mounts",
    "/provisioning/iso/wim-info?wim_path=x",
    "/provisioning/iso/nfs/list",
]


@pytest.mark.parametrize("path", READABLE + OTHERS)
def test_read_route_without_credentials_is_rejected(path):
    assert requests.get(f"{API}{path}", timeout=10).status_code == 401


@pytest.mark.parametrize("path", READABLE + OTHERS)
def test_read_route_rejects_the_agent_key(path):
    assert AGENT_KEY, "INVENTORY_API_KEY must be set"
    r = requests.get(f"{API}{path}", headers={"X-API-Key": AGENT_KEY}, timeout=10)
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("path", READABLE)
def test_read_route_answers_an_admin(path):
    r = requests.get(f"{API}{path}", headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("path", OTHERS)
def test_admin_passes_the_permission_check(path):
    r = requests.get(f"{API}{path}", headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
    assert r.status_code not in (401, 403), r.text
