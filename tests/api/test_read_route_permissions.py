"""Read routes check a permission: the shared agent key (stored on every managed machine) only reads
what the agents read; viewers, operators and auditors keep the pages they see."""
import os
import uuid

import pytest
import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
AGENT = {"X-API-Key": os.getenv("INVENTORY_API_KEY", "")}
ADMIN = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}
ZERO = "00000000-0000-0000-0000-000000000000"

SENSITIVE = [
    "/export/nodes", "/export/nodes/excel", "/export/software", "/export/jobs/excel",
    "/export/vulnerabilities/excel", "/export/compliance",
    "/reports/fleet/pdf", "/reports/security/pdf", "/reports/executions", "/reports/catalog",
    "/jobs", f"/jobs/{ZERO}", "/jobs/failures",
    "/alert-rules", "/alert-history",
    "/security/events", "/security/file-events", "/security/evidence/export",
    "/events", "/events/files", "/nodes/ci-node/eventlog",
    "/metrics/summary", "/metrics/fleet",
    "/admin/agent-status", "/admin/agent-activity",
    "/mssql/configs", "/content/repositories", "/pending-nodes", "/dashboard/summary",
    "/services", "/metering/catalog", "/repo/files", "/deployments", "/remediation/summary",
]
# Pages and widgets every role sees (dashboard, tasks, notifications, security, export menu)
EVERY_ROLE = [
    "/dashboard/summary", "/alert-history", "/jobs", "/jobs/failures", "/pending-nodes",
    "/events/stats", "/metrics/summary", "/security/dashboard", "/security/policies",
    "/monitoring/profiles", "/monitoring/assignments", "/findings", "/security/events",
    "/compliance/summary", "/evidence/exports", "/export/nodes", "/export/compliance",
    "/export/jobs/excel", "/remediation/summary",
]
REPORTS = ["/reports/catalog", "/reports/executions", "/reports/executive-dashboard"]
VIEWER_AND_OPERATOR = ["/packages", "/deployments", "/repo/files", "/alert-rules"]
# The auditor role (backend/auth.py ROLE_PERMISSIONS) is not created by the backend; a custom role
# with its permissions stands in for it.
AUDITOR_PERMISSIONS = ["eventlog:read", "compliance:read", "nodes:read", "inventory:read", "hardware:read",
                       "vulnerabilities:read", "reports:read", "alerts:read", "jobs:read"]


def _user(role=None, permissions=None):
    """A new user with a standard role or with a custom role of the given permissions; returns
    (user_id, headers)."""
    name = f"read-{uuid.uuid4().hex[:8]}"
    password = f"Read-{uuid.uuid4().hex[:10]}9!"
    r = requests.post(f"{API}/users", headers=ADMIN, json={"username": name, "password": password}, timeout=10)
    assert r.status_code in (200, 201), r.text
    user_id = r.json()["id"]
    if permissions is not None:
        role = f"ci-{name}"
        r = requests.post(f"{API}/roles", headers=ADMIN, timeout=10,
                          json={"name": role, "description": "CI", "permissions": permissions})
        assert r.status_code == 200, r.text
    assert requests.post(f"{API}/users/{user_id}/roles/{role}", headers=ADMIN, timeout=10).status_code == 200
    login = requests.post(f"{API}/auth/login", json={"username": name, "password": password}, timeout=10)
    assert login.status_code == 200, login.text
    return user_id, {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture(scope="module")
def users():
    created = {"viewer": _user("viewer"), "operator": _user("operator"),
               "auditor": _user(permissions=AUDITOR_PERMISSIONS)}
    yield {role: headers for role, (_, headers) in created.items()}
    for user_id, _ in created.values():
        requests.delete(f"{API}/users/{user_id}", headers=ADMIN, timeout=10)


@pytest.mark.parametrize("path", SENSITIVE)
def test_agent_key_cannot_read(path):
    assert AGENT["X-API-Key"], "INVENTORY_API_KEY must be set"
    r = requests.get(API + path, headers=AGENT, timeout=30)
    assert r.status_code == 403, (path, r.status_code, r.text[:200])


@pytest.mark.parametrize("path", [
    "/terminal/pending/CI-NODE", "/shell/pending/CI-NODE", "/screen/pending/CI-NODE",
    "/nodes/ci-node/deployments", "/nodes/ci-node/service-assignments",
    "/monitoring/nodes/CI-NODE/effective-policy",
])
def test_agent_key_reads_what_the_agents_read(path):
    r = requests.get(API + path, headers=AGENT, timeout=30)
    assert r.status_code in (200, 404), (path, r.status_code, r.text[:200])  # 404: no such node


@pytest.mark.parametrize("role, paths", [
    ("viewer", EVERY_ROLE + VIEWER_AND_OPERATOR),
    ("operator", EVERY_ROLE + VIEWER_AND_OPERATOR + REPORTS),
    ("auditor", EVERY_ROLE + REPORTS),
])
def test_roles_keep_their_pages(users, role, paths):
    for path in paths:
        r = requests.get(API + path, headers=users[role], timeout=30)
        assert r.status_code == 200, (role, path, r.status_code, r.text[:200])


def test_viewer_cannot_read_reports(users):
    for path in REPORTS + ["/reports/fleet/pdf"]:
        r = requests.get(API + path, headers=users["viewer"], timeout=30)
        assert r.status_code == 403, (path, r.status_code)


def test_admin_reads_the_exports():
    for path in ("/export/nodes", "/export/jobs/excel", "/jobs", "/alert-rules", "/admin/agent-status"):
        r = requests.get(API + path, headers=ADMIN, timeout=30)
        assert r.status_code == 200, (path, r.status_code, r.text[:200])
