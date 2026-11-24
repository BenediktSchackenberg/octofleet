"""Admin -> Settings -> Logging: GET/PUT /api/v1/settings/logging, defaults as before, applied at once."""
import os

import pytest
import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}", "Content-Type": "application/json"}
URL = f"{API_URL}/api/v1/settings/logging"
DEFAULTS = {"level": "info", "access_log": "all", "slow_ms": 1000, "components": {}}


@pytest.fixture
def restore():
    yield
    requests.put(URL, headers=HEADERS, json=DEFAULTS, timeout=10)


def test_defaults_are_todays_behaviour():
    r = requests.get(URL, headers=HEADERS, timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["defaults"] == DEFAULTS
    assert {"Api", "Agent", "Inventory", "Jobs", "Updates", "Remediation", "Security", "RemoteTools",
            "SelfUpdate"} <= set(r.json()["component_names"])


def test_change_applies_and_is_kept(restore):
    r = requests.put(URL, headers=HEADERS, json={"level": "debug", "access_log": "errors_slow", "slow_ms": 250}, timeout=10)
    assert r.status_code == 200, r.text
    got = requests.get(URL, headers=HEADERS, timeout=10).json()
    assert (got["level"], got["access_log"], got["slow_ms"]) == ("debug", "errors_slow", 250)
    # the backend keeps answering normally with the access log reduced
    assert requests.get(f"{API_URL}/health", timeout=10).status_code == 200
    r = requests.get(f"{API_URL}/api/v1/audit", headers=HEADERS, params={"action": "settings.logging", "limit": 5}, timeout=10)
    assert r.status_code == 200 and any(e["action"] == "settings.logging" for e in r.json()["entries"]), r.text


def test_level_per_component_is_kept_and_reset(restore):
    r = requests.put(URL, headers=HEADERS, json={**DEFAULTS, "components": {"Jobs": "debug", "Auth": "warning"}},
                     timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["components"] == {"Jobs": "debug", "Auth": "warning"}
    assert requests.get(URL, headers=HEADERS, timeout=10).json()["components"] == {"Jobs": "debug", "Auth": "warning"}
    # a setting without components (as the page sent before #330) sets every component back to the level
    r = requests.put(URL, headers=HEADERS, json={"level": "info", "access_log": "all", "slow_ms": 1000}, timeout=10)
    assert r.status_code == 200 and r.json()["components"] == {}, r.text


def test_rejected_agent_data_still_gets_fastapis_answer():
    agent = {"X-API-Key": API_KEY or "", "Content-Type": "application/json"}
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=agent, data=b'{"hostname": "x", "n": 1,5}',
                      timeout=10)
    assert r.status_code == 422, r.text
    assert r.json()["detail"][0]["type"] == "json_invalid"


@pytest.mark.parametrize("body", [{"level": "trace"}, {"access_log": "some"}, {"slow_ms": 1}, {"colour": "red"}, [],
                                  {"components": {"Nope": "debug"}}, {"components": {"Jobs": "trace"}},
                                  {"components": ["Jobs"]}])
def test_invalid(body):
    assert requests.put(URL, headers=HEADERS, json=body, timeout=10).status_code in (400, 422)


def test_users_only_and_not_through_the_generic_settings():
    agent = {"X-API-Key": API_KEY or "", "Content-Type": "application/json"}
    assert requests.put(URL, headers=agent, json=DEFAULTS, timeout=10).status_code in (401, 403)
    r = requests.delete(f"{API_URL}/api/v1/settings/logging", headers=HEADERS, timeout=10)
    assert r.status_code == 400, r.text
