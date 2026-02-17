"""
Simplified API endpoint tests for CI.
Tests basic functionality without requiring complete database schema.
"""
import pytest
import requests
import os
import time

API_URL = os.getenv("API_URL", "http://localhost:8080")


class TestHealth:
    """Health check - most basic test"""
    
    def test_health_endpoint(self):
        response = requests.get(f"{API_URL}/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ["ok", "healthy", "degraded"]
        assert "service" in data


class TestAgentVersion:
    """Agent version endpoint - needed for self-update"""
    
    def test_version_endpoint(self):
        response = requests.get(f"{API_URL}/api/v1/agent/version", timeout=10)
        assert response.status_code == 200
        data = response.json()
        # API returns latestVersion or version
        version = data.get("version") or data.get("latestVersion")
        assert version is not None, f"No version field in response: {data}"
        # Version should be semantic versioning format
        parts = version.split(".")
        assert len(parts) >= 2, f"Invalid version format: {version}"


class TestBasicEndpoints:
    """Test endpoints return valid HTTP responses (not 500)"""
    
    @pytest.mark.parametrize("endpoint,method", [
        ("/api/v1/nodes", "GET"),
        ("/api/v1/groups", "GET"),
        ("/api/v1/jobs", "GET"),
        ("/api/v1/packages", "GET"),
    ])
    def test_endpoints_respond(self, endpoint, method):
        """Endpoints should return 200, 401, or 403 - not 500"""
        response = requests.request(method, f"{API_URL}{endpoint}", timeout=10)
        # Accept success or auth errors, but not server errors
        assert response.status_code in [200, 401, 403, 404], \
            f"{endpoint} returned {response.status_code}: {response.text[:200]}"


class TestEnrollment:
    """Enrollment endpoints for agent registration"""
    
    def test_enroll_requires_token(self):
        """Enrollment without token should be rejected"""
        response = requests.post(
            f"{API_URL}/api/v1/enroll",
            json={"nodeId": "test-node", "hostname": "test"},
            timeout=10
        )
        # Should require valid token
        assert response.status_code in [400, 401, 403, 422]


class TestServiceOrchestration:
    """E18: Service Orchestration API tests"""
    
    def test_list_service_classes(self):
        """Should list service classes"""
        response = requests.get(
            f"{API_URL}/api/v1/service-classes",
            headers={"X-API-Key": API_KEY},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "serviceClasses" in data
        assert isinstance(data["serviceClasses"], list)
    
    def test_list_services(self):
        """Should list services"""
        response = requests.get(
            f"{API_URL}/api/v1/services",
            headers={"X-API-Key": API_KEY},
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert isinstance(data["services"], list)
    
    def test_create_service_class(self):
        """Should create a service class template"""
        response = requests.post(
            f"{API_URL}/api/v1/service-classes",
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            json={
                "name": f"test-template-{int(time.time())}",
                "description": "Test template for API tests",
                "serviceType": "standalone",
                "roles": ["primary"],
                "healthCheck": {"type": "http", "port": 80}
            },
            timeout=10
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "name" in data
    
    def test_get_node_service_assignments(self):
        """Should return service assignments for a node"""
        # Use existing node or dummy ID
        response = requests.get(
            f"{API_URL}/api/v1/nodes/TEST-NODE/service-assignments",
            headers={"X-API-Key": API_KEY},
            timeout=10
        )
        # Should return 200 even for unknown node (empty list)
        assert response.status_code == 200
        data = response.json()
        assert "services" in data
        assert isinstance(data["services"], list)
