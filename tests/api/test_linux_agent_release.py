"""Linux agent offered by the server: install.sh checks both files against /linux/latest."""
import hashlib
import os

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
BASE = f"{API_URL}/api/v1/agent/releases/linux"


def _sha256(url: str) -> str:
    r = requests.get(url, timeout=10)
    assert r.status_code == 200, r.text
    return hashlib.sha256(r.content).hexdigest()


def test_latest_lists_checksums_of_agent_and_service():
    r = requests.get(f"{BASE}/latest", timeout=10)
    assert r.status_code == 200, r.text
    release = r.json()
    assert release["sha256"] == _sha256(f"{BASE}/agent.sh")
    # install.sh refuses to install without it ("SHA256 check of octofleet-agent.service ... failed")
    assert release.get("service_sha256") == _sha256(f"{BASE}/octofleet-agent.service")
