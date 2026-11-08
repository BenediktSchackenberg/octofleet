"""Headers for API tests that act as a user.

Routes that read or change fleet data, jobs, users, roles or API keys need a user account; the
shared agent key (INVENTORY_API_KEY) gets 403 "This action requires a user account" there.
Tests log in as the CI admin and send the token. The agent key stays in the headers, so
agent routes that only check the key work as before.
"""
import functools
import os

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
# docker-compose.ci.yml sets this password for the first start
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ci-test-admin-password-2026")


@functools.lru_cache(maxsize=1)
def admin_token() -> str:
    r = requests.post(f"{API_URL}/api/v1/auth/login",
                      json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed ({r.status_code}), set ADMIN_PASSWORD: {r.text[:200]}"
    return r.json()["access_token"]


def user_headers(extra=None) -> dict:
    """Admin token plus the agent key, and any extra headers."""
    return {"X-API-Key": os.getenv("INVENTORY_API_KEY") or "",
            "Authorization": f"Bearer {admin_token()}", **(extra or {})}
