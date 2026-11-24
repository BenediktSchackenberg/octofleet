"""A session token revoked by a logout no longer opens the terminal, shell or screen websockets
(they check the token like HTTP requests do, including the session version)."""
import base64
import os
import socket
import uuid
from urllib.parse import urlparse

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API = API_URL + "/api/v1"
ADMIN = {"Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}
PATHS = ["/api/v1/terminal/ws/{id}", "/api/v1/shell/ws/{id}", "/api/v1/screen/ws/{id}"]


def handshake_status(path, token):
    """HTTP status of the websocket handshake: 101 when the server accepts it, 403 when it closes
    the connection before accepting."""
    url = urlparse(API_URL)
    key = base64.b64encode(os.urandom(16)).decode()
    request = (f"GET {path}?token={token} HTTP/1.1\r\nHost: {url.netloc}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
    with socket.create_connection((url.hostname, url.port or 80), timeout=10) as sock:
        sock.sendall(request.encode())
        status_line = sock.recv(1024).split(b"\r\n", 1)[0].decode()
    return int(status_line.split()[1])


def test_logout_closes_the_websockets_to_the_old_token():
    name = f"ws-{uuid.uuid4().hex[:8]}"
    password = f"Ws-{uuid.uuid4().hex[:10]}9!"
    r = requests.post(f"{API}/users", headers=ADMIN, json={"username": name, "password": password}, timeout=10)
    assert r.status_code in (200, 201), r.text
    user_id = r.json()["id"]
    try:
        assert requests.post(f"{API}/users/{user_id}/roles/viewer", headers=ADMIN, timeout=10).status_code == 200
        login = requests.post(f"{API}/auth/login", json={"username": name, "password": password}, timeout=10)
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        session_id = str(uuid.uuid4())  # unknown session: accepted, then closed with 4004

        for path in PATHS:
            assert handshake_status(path.format(id=session_id), token) == 101, path

        r = requests.post(f"{API}/auth/logout", headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert r.status_code == 200, r.text

        for path in PATHS:
            assert handshake_status(path.format(id=session_id), token) == 403, path
    finally:
        requests.delete(f"{API}/users/{user_id}", headers=ADMIN, timeout=10)


def test_invalid_token_is_rejected():
    for path in PATHS:
        assert handshake_status(path.format(id=uuid.uuid4()), "not-a-token") == 403, path
