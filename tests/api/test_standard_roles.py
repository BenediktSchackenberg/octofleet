"""Standard roles on a new installation: created by the backend at startup, not by a seed file."""
import os

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")


def test_standard_roles_exist():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    r = requests.get(f"{API_URL}/api/v1/roles", headers={"X-API-Key": API_KEY}, timeout=10)
    assert r.status_code == 200, r.text
    names = {role["name"] for role in r.json()["roles"]}
    assert {"admin", "viewer", "operator", "deployer"} <= names
