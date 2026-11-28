"""Live view: the agent's own log lines reach the stream also when the node reports network data.
They shared the network data's timer, which the network block had just reset, so a node with
network data (every node) never got its agent logs to the page."""
import json
import os
import time

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}",
           "Content-Type": "application/json"}


def test_agent_logs_are_streamed_next_to_network_data():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"live-agentlogs-{int(time.time() * 1000)}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=10,
                      json={"hostname": hostname, "nodeId": hostname, "system": {"os": {"name": "Ubuntu 26.04 LTS"}}})
    assert r.status_code == 200, r.text
    r = requests.post(f"{API_URL}/api/v1/live-data", headers=HEADERS, timeout=10, json={
        "nodeId": hostname,
        "network": [{"name": "eth0", "description": "eth0", "linkUp": True, "speedMbps": 1000,
                     "rxBytesPerSec": 1, "txBytesPerSec": 1, "rxTotalMb": 1, "txTotalMb": 1}],
        "agentLogs": [{"timestamp": "2026-11-28T19:00:00Z", "level": "Information", "source": "octofleet-agent",
                       "message": "Inventory pushed successfully"}],
    })
    assert r.status_code == 200 and r.json()["agentLogsCached"] == 1, r.text

    events = set()
    with requests.get(f"{API_URL}/api/v1/live/{hostname}", headers=HEADERS, timeout=20, stream=True) as stream:
        assert stream.status_code == 200, stream.text
        started = time.time()
        for line in stream.iter_lines(decode_unicode=True):
            if line and line.startswith("event: "):
                events.add(line[len("event: "):])
                if "agentLogs" in events:
                    break
            if time.time() - started > 12:
                break
    assert "network" in events, events
    assert "agentLogs" in events, events
