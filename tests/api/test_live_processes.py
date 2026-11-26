"""Live data: each push's process list replaces the node's previous one. Several lists within 30 s
were all kept, so the live view and the query engine showed the same PID once per list."""
import json
import os
import time

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}",
           "Content-Type": "application/json"}


def live_processes(hostname):
    """The node's processes as the query engine returns them (SSE stream, ends after the node)"""
    r = requests.post(f"{API_URL}/api/v1/query/live", headers=HEADERS, timeout=30,
                      json={"command": "processes", "targets": [hostname]})
    assert r.status_code == 200, r.text
    for block in r.text.split("\n\n"):
        if block.startswith("event: result"):
            return json.loads(block.split("data: ", 1)[1])["data"]
    raise AssertionError(f"no result event: {r.text[:300]}")


def push(hostname, processes):
    r = requests.post(f"{API_URL}/api/v1/live-data", headers=HEADERS, timeout=10,
                      json={"nodeId": hostname, "processes": processes})
    assert r.status_code == 200, r.text


def test_a_push_replaces_the_process_list():
    assert API_KEY, "INVENTORY_API_KEY must be set"
    hostname = f"live-procs-{int(time.time() * 1000)}"
    r = requests.post(f"{API_URL}/api/v1/inventory/full", headers=HEADERS, timeout=10,
                      json={"hostname": hostname, "nodeId": hostname, "system": {"os": {"name": "Ubuntu 26.04 LTS"}}})
    assert r.status_code == 200, r.text

    push(hostname, [{"name": "node", "pid": 100, "cpuPercent": 10.1, "memoryMb": 66, "userName": "root"},
                    {"name": "postgres", "pid": 200, "cpuPercent": 8.6, "memoryMb": 91, "userName": "70"}])
    push(hostname, [{"name": "node", "pid": 100, "cpuPercent": 9.4, "memoryMb": 79, "userName": "root"}])

    rows = live_processes(hostname)
    assert [(p["pid"], float(p["cpu_percent"])) for p in rows] == [(100, 9.4)]

    # an empty or missing list keeps the last one (a push without processes is not "none running")
    push(hostname, [])
    assert [p["pid"] for p in live_processes(hostname)] == [100]
