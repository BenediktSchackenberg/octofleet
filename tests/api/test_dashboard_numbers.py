"""Dashboard numbers agree with their source pages and respect their time windows."""
import os

import requests

API_URL = os.getenv("API_URL", "http://localhost:8080")
API_KEY = os.getenv("INVENTORY_API_KEY")
HEADERS = {"X-API-Key": API_KEY or "", "Authorization": f"Bearer {os.getenv('TEST_ADMIN_TOKEN', '')}"}


def test_dashboard_vulnerabilities_match_vulnerability_summary():
    dashboard = requests.get(f"{API_URL}/api/v1/dashboard/summary", headers=HEADERS, timeout=30)
    summary = requests.get(f"{API_URL}/api/v1/vulnerabilities/summary", headers=HEADERS, timeout=30)
    assert dashboard.status_code == 200, dashboard.text
    assert summary.status_code == 200, summary.text
    counts = summary.json()["severity_counts"]
    vulnerabilities = dashboard.json()["vulnerabilities"]
    for severity in ("critical", "high", "medium", "low"):
        assert vulnerabilities[severity] == counts.get(severity.upper(), 0)


def test_event_stats_for_the_last_days_never_exceed_all_events():
    recent = requests.get(f"{API_URL}/api/v1/events/stats?days=7", headers=HEADERS, timeout=30)
    total = requests.get(f"{API_URL}/api/v1/events/stats", headers=HEADERS, timeout=30)
    assert recent.status_code == 200, recent.text
    assert total.status_code == 200, total.text
    totals = {s["event_type"]: s["count"] for s in total.json()["stats"]}
    for stat in recent.json()["stats"]:
        assert stat["count"] <= totals.get(stat["event_type"], 0)
    assert requests.get(f"{API_URL}/api/v1/events/stats?days=0", headers=HEADERS, timeout=30).status_code == 422


def test_concurrent_dashboard_requests_do_not_exhaust_the_pool():
    # each request used to hold one connection while waiting for a second one
    from concurrent.futures import ThreadPoolExecutor

    def get(_):
        return requests.get(f"{API_URL}/api/v1/dashboard/summary", headers=HEADERS, timeout=60).status_code

    with ThreadPoolExecutor(max_workers=30) as pool:
        assert list(pool.map(get, range(30))) == [200] * 30
