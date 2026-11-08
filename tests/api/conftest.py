"""
Pytest configuration for API tests
"""
import pytest
import httpx
import os

API_URL = os.getenv("API_URL", "http://localhost:8080")

ADMIN_USER = {
    "username": "admin",
    "password": "Octofleet2026!",
    "email": "admin@test.local",
    "display_name": "Test Admin"
}


def pytest_configure(config):
    """Setup admin user before tests run"""
    print(f"\n🔧 Setting up test environment...")
    print(f"   API_URL: {API_URL}")
    
    try:
        # Try to create admin user
        with httpx.Client(base_url=API_URL, timeout=30) as client:
            response = client.post("/api/v1/auth/setup", json=ADMIN_USER)
            if response.status_code == 200:
                print("   ✅ Admin user created")
            elif response.status_code == 400:
                print("   ✅ Admin already exists")
            else:
                print(f"   ⚠️ Setup response: {response.status_code}")
            login = client.post("/api/v1/auth/login", json={
                "username": os.getenv("TEST_USERNAME", "admin"),
                "password": os.getenv("TEST_PASSWORD", os.getenv("ADMIN_PASSWORD", "ci-test-admin-password-2026")),
            })
            if login.status_code == 200:
                os.environ["TEST_ADMIN_TOKEN"] = login.json()["access_token"]
            else:
                print(f"   ⚠️ Admin login failed: {login.status_code}")
    except Exception as e:
        print(f"   ⚠️ Setup failed: {e}")
    
    print("")
