"""Package version URLs survive creation, reads and updates."""

import os
import uuid

import requests


API_URL = os.getenv("API_URL", "http://localhost:8080")


def test_package_version_download_url_round_trip():
    token = os.getenv("TEST_ADMIN_TOKEN")
    assert token, "The test setup must log in as admin"
    admin_headers = {"Authorization": f"Bearer {token}"}
    package_id = None

    try:
        created_package = requests.post(
            f"{API_URL}/api/v1/packages", headers=admin_headers, timeout=10,
            json={"name": f"url-test-{uuid.uuid4().hex}", "displayName": "Download URL test"},
        )
        assert created_package.status_code == 200, created_package.text
        package_id = created_package.json()["id"]

        payload = {"version": "1.0", "filename": "installer.msi", "downloadUrl": "https://example.test/installer.msi"}
        agent_key = os.getenv("INVENTORY_API_KEY")
        assert agent_key
        denied = requests.post(
            f"{API_URL}/api/v1/packages/{package_id}/versions",
            headers={"X-API-Key": agent_key}, timeout=10, json=payload,
        )
        assert denied.status_code == 403, denied.text

        created_version = requests.post(
            f"{API_URL}/api/v1/packages/{package_id}/versions",
            headers=admin_headers, timeout=10, json=payload,
        )
        assert created_version.status_code == 200, created_version.text
        version_id = created_version.json()["id"]

        package = requests.get(f"{API_URL}/api/v1/packages/{package_id}", headers=admin_headers, timeout=10)
        assert package.status_code == 200, package.text
        assert package.json()["versions"][0]["downloadUrl"] == payload["downloadUrl"]

        updated_url = "https://example.test/installer-2.msi"
        updated = requests.put(
            f"{API_URL}/api/v1/packages/{package_id}/versions/{version_id}",
            headers=admin_headers, timeout=10, json={"downloadUrl": updated_url},
        )
        assert updated.status_code == 200, updated.text

        version = requests.get(
            f"{API_URL}/api/v1/packages/{package_id}/versions/{version_id}",
            headers=admin_headers, timeout=10,
        )
        assert version.status_code == 200, version.text
        assert version.json()["downloadUrl"] == updated_url
    finally:
        if package_id:
            requests.delete(f"{API_URL}/api/v1/packages/{package_id}", headers=admin_headers, timeout=10)
