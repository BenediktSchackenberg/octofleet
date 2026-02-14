"""
Simplified API endpoint tests for CI.
Tests basic functionality without requiring complete database schema.
"""
import pytest
import requests
import os

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
