"""The live streams (EventSource, so the session token may come as ?token=) answer only with a
valid session token or key: the agent monitor stream and the remediation stream."""
import os

import pytest
import requests

API = os.getenv("API_URL", "http://localhost:8080") + "/api/v1"
TOKEN = os.getenv("TEST_ADMIN_TOKEN", "")
STREAMS = ["/admin/agent-live", "/remediation/live"]


@pytest.mark.parametrize("path", STREAMS)
def test_stream_without_credentials_is_rejected(path):
    r = requests.get(f"{API}{path}", timeout=10, stream=True)
    r.close()
    assert r.status_code == 401


@pytest.mark.parametrize("path", STREAMS)
@pytest.mark.parametrize("token", ["x", "not-a-valid-token", "eyJhbGciOiJIUzI1NiJ9.e30.invalid"])
def test_stream_with_an_invalid_token_is_rejected(path, token):
    r = requests.get(f"{API}{path}", params={"token": token}, timeout=10, stream=True)
    r.close()
    assert r.status_code == 401


@pytest.mark.parametrize("path", STREAMS)
def test_stream_with_a_wrong_key_is_rejected(path):
    r = requests.get(f"{API}{path}", headers={"X-API-Key": "not-a-valid-key"}, timeout=10, stream=True)
    r.close()
    assert r.status_code == 401


@pytest.mark.parametrize("path", STREAMS)
def test_stream_with_the_session_token_works(path):
    r = requests.get(f"{API}{path}", params={"token": TOKEN}, timeout=10, stream=True)
    try:
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("text/event-stream")
    finally:
        r.close()
