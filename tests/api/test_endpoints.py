"""
Simplified API endpoint tests for CI.
Tests basic functionality without requiring complete database schema.
"""
import pytest
import requests
import os
import time
from pathlib import Path

API_URL = os.getenv("API_URL", "http://localhost:8080")


def _load_env_file() -> None:
    """Load octofleet/.env into process env without overriding exported vars."""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()
API_KEY = os.getenv("INVENTORY_API_KEY")

# Use valid UUID-shaped ids to avoid format errors and keep behavior deterministic.
VALID_UUID = "00000000-0000-0000-0000-000000000000"
PROTECTED_ENDPOINTS = [
    "/api/v1/nodes",
    "/api/v1/nodes/tree",
    "/api/v1/nodes/search?q=test",
    f"/api/v1/nodes/{VALID_UUID}",
    f"/api/v1/nodes/{VALID_UUID}/history",
    "/api/v1/groups",
    f"/api/v1/groups/{VALID_UUID}",
    "/api/v1/jobs",
    f"/api/v1/jobs/{VALID_UUID}",
    "/api/v1/packages",
    f"/api/v1/packages/{VALID_UUID}",
    "/api/v1/service-classes",
    f"/api/v1/service-classes/{VALID_UUID}",
    "/api/v1/services",
    f"/api/v1/services/{VALID_UUID}",
]


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
        assert API_KEY, "INVENTORY_API_KEY must be set in octofleet/.env or shell env"
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
        assert API_KEY, "INVENTORY_API_KEY must be set in octofleet/.env or shell env"
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
        assert API_KEY, "INVENTORY_API_KEY must be set in octofleet/.env or shell env"
        response = requests.post(
            f"{API_URL}/api/v1/service-classes",
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            json={
                "name": f"test-template-{int(time.time())}",
                "description": "Test template for API tests",
                "serviceType": "single",  # valid: single, cluster
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
        assert API_KEY, "INVENTORY_API_KEY must be set in octofleet/.env or shell env"
        # Use a valid UUID format (even if node doesn't exist)
        response = requests.get(
            f"{API_URL}/api/v1/nodes/{VALID_UUID}/service-assignments",
            headers={"X-API-Key": API_KEY},
            timeout=10
        )
        # Should return 200 with empty list or 404 for unknown node
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            data = response.json()
            assert "services" in data
            assert isinstance(data["services"], list)


class TestAPIKeyConsistency:
    """
    Test API key consistency across all protected endpoints.
    Verifies fix for issue #56: Screen WebSocket uses inconsistent API key.
    """
    
    def test_wrong_api_key_rejected(self):
        """Old inconsistent key should be rejected"""
        old_key = "octofleet-dev-key"  # The old incorrect default
        response = requests.get(
            f"{API_URL}/api/v1/nodes",
            headers={"X-API-Key": old_key},
            timeout=10
        )
        # Should be 401 Unauthorized, not 200
        assert response.status_code == 401, \
            f"Old API key should be rejected! Got {response.status_code}"
    
    def test_correct_api_key_accepted(self):
        """Current API key should work on all endpoints"""
        assert API_KEY, "INVENTORY_API_KEY must be set in octofleet/.env or shell env"
        response = requests.get(
            f"{API_URL}/api/v1/nodes",
            headers={"X-API-Key": API_KEY},
            timeout=10
        )
        assert response.status_code == 200, \
            f"Current API key should be accepted! Got {response.status_code}: {response.text[:100]}"
    
    @pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
    def test_protected_endpoints_reject_wrong_key(self, endpoint):
        """All protected endpoints should reject the old inconsistent key"""
        old_key = "octofleet-dev-key"
        response = requests.get(
            f"{API_URL}{endpoint}",
            headers={"X-API-Key": old_key},
            timeout=10
        )
        assert response.status_code == 401, \
            f"{endpoint} accepted wrong key! Status: {response.status_code}"
    
    @pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
    def test_protected_endpoints_accept_correct_key(self, endpoint):
        """All protected endpoints should accept the centralized API key"""
        assert API_KEY, "INVENTORY_API_KEY must be set in octofleet/.env or shell env"
        response = requests.get(
            f"{API_URL}{endpoint}",
            headers={"X-API-Key": API_KEY},
            timeout=10
        )
        assert response.status_code in [200, 404], \
            f"{endpoint} rejected correct key! Status: {response.status_code}: {response.text[:100]}"
    
    @pytest.mark.parametrize("endpoint", PROTECTED_ENDPOINTS)
    def test_no_auth_rejected(self, endpoint):
        """Requests without auth should be rejected on all protected endpoints"""
        response = requests.get(
            f"{API_URL}{endpoint}",
            timeout=10
        )
        assert response.status_code in [401, 403], \
            f"No-auth request should be rejected for {endpoint}! Got {response.status_code}"
