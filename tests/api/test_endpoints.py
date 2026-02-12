"""
OpenClaw Inventory API Tests
Run with: pytest tests/api/ -v --html=tests/reports/api/report.html
"""
import pytest
import httpx
import os
from datetime import datetime

API_URL = os.getenv("API_URL", "http://192.168.0.5:8080")
API_KEY = os.getenv("API_KEY", "openclaw-inventory-dev-key")

@pytest.fixture
def client():
    return httpx.Client(base_url=API_URL, timeout=30)

@pytest.fixture
def auth_headers():
    return {"X-API-Key": API_KEY}

@pytest.fixture
def jwt_token(client):
    """Get JWT token for authenticated requests"""
    response = client.post("/api/v1/auth/login", json={
        "username": "admin",
        "password": "OpenClaw2026!"
    })
    assert response.status_code == 200
    return response.json()["access_token"]

@pytest.fixture
def jwt_headers(jwt_token):
    return {"Authorization": f"Bearer {jwt_token}"}


class TestHealth:
    def test_health_endpoint(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"


class TestAuthentication:
    def test_login_success(self, client):
        response = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "OpenClaw2026!"
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login_invalid_password(self, client):
        response = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
    
    def test_login_invalid_user(self, client):
        response = client.post("/api/v1/auth/login", json={
            "username": "nonexistent",
            "password": "test"
        })
        assert response.status_code == 401
    
    def test_api_key_auth(self, client, auth_headers):
        response = client.get("/api/v1/nodes", headers=auth_headers)
        assert response.status_code == 200
    
    def test_jwt_auth(self, client, jwt_headers):
        response = client.get("/api/v1/nodes", headers=jwt_headers)
        assert response.status_code == 200
    
    def test_no_auth_rejected(self, client):
        response = client.get("/api/v1/nodes")
        assert response.status_code == 401


class TestNodes:
    def test_list_nodes(self, client, auth_headers):
        response = client.get("/api/v1/nodes", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_get_node_by_id(self, client, auth_headers):
        # First get list
        response = client.get("/api/v1/nodes", headers=auth_headers)
        nodes = response.json()
        
        if nodes:
            node_id = nodes[0]["id"]
            response = client.get(f"/api/v1/nodes/{node_id}", headers=auth_headers)
            assert response.status_code == 200
            data = response.json()
            assert data["id"] == node_id
    
    def test_get_node_hardware(self, client, auth_headers):
        response = client.get("/api/v1/nodes", headers=auth_headers)
        nodes = response.json()
        
        if nodes:
            node_id = nodes[0]["id"]
            response = client.get(f"/api/v1/nodes/{node_id}/hardware", headers=auth_headers)
            assert response.status_code in [200, 404]
    
    def test_get_node_software(self, client, auth_headers):
        response = client.get("/api/v1/nodes", headers=auth_headers)
        nodes = response.json()
        
        if nodes:
            node_id = nodes[0]["id"]
            response = client.get(f"/api/v1/nodes/{node_id}/software", headers=auth_headers)
            assert response.status_code in [200, 404]
    
    def test_get_nonexistent_node(self, client, auth_headers):
        response = client.get("/api/v1/nodes/00000000-0000-0000-0000-000000000000", headers=auth_headers)
        assert response.status_code == 404


class TestGroups:
    def test_list_groups(self, client, auth_headers):
        response = client.get("/api/v1/groups", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_create_group(self, client, auth_headers):
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        response = client.post("/api/v1/groups", headers=auth_headers, json={
            "name": f"TestGroup-{timestamp}",
            "description": "Created by API test"
        })
        assert response.status_code in [200, 201]
        data = response.json()
        assert "id" in data
        return data["id"]
    
    def test_delete_group(self, client, auth_headers):
        # Create then delete
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        create_resp = client.post("/api/v1/groups", headers=auth_headers, json={
            "name": f"ToDelete-{timestamp}"
        })
        if create_resp.status_code in [200, 201]:
            group_id = create_resp.json()["id"]
            delete_resp = client.delete(f"/api/v1/groups/{group_id}", headers=auth_headers)
            assert delete_resp.status_code in [200, 204]


class TestJobs:
    def test_list_jobs(self, client, auth_headers):
        response = client.get("/api/v1/jobs", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_create_job(self, client, auth_headers):
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        response = client.post("/api/v1/jobs", headers=auth_headers, json={
            "name": f"TestJob-{timestamp}",
            "command": 'echo "Test from API"',
            "job_type": "script"
        })
        assert response.status_code in [200, 201]


class TestPackages:
    def test_list_packages(self, client, auth_headers):
        response = client.get("/api/v1/packages", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
    
    def test_list_package_versions(self, client, auth_headers):
        response = client.get("/api/v1/package-versions", headers=auth_headers)
        assert response.status_code == 200


class TestDeployments:
    def test_list_deployments(self, client, auth_headers):
        response = client.get("/api/v1/deployments", headers=auth_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)


class TestSoftwareCompare:
    def test_top_software(self, client, auth_headers):
        response = client.get("/api/v1/software/compare", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "topSoftware" in data
    
    def test_compare_specific_software(self, client, auth_headers):
        response = client.get("/api/v1/software/compare?software_name=7-Zip", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "versions" in data


class TestCompliance:
    def test_compliance_summary(self, client, auth_headers):
        response = client.get("/api/v1/compliance/summary", headers=auth_headers)
        assert response.status_code == 200


class TestEventlog:
    def test_list_eventlogs(self, client, auth_headers):
        response = client.get("/api/v1/eventlog", headers=auth_headers)
        assert response.status_code == 200


class TestAudit:
    def test_list_audit_logs(self, client, jwt_headers):
        response = client.get("/api/v1/audit", headers=jwt_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


class TestUsers:
    def test_list_users(self, client, jwt_headers):
        response = client.get("/api/v1/users", headers=jwt_headers)
        assert response.status_code == 200
    
    def test_get_current_user(self, client, jwt_headers):
        response = client.get("/api/v1/auth/me", headers=jwt_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "admin"


class TestAPIKeys:
    def test_list_api_keys(self, client, jwt_headers):
        response = client.get("/api/v1/api-keys", headers=jwt_headers)
        assert response.status_code == 200
