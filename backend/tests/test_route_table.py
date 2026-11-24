"""Every method and path is registered once.

A second registration never runs - FastAPI takes the first route that matches - but it looks like
the code that answers. #298 found 25 of them, mostly old copies in main.py behind a router.
"""
import unittest
from collections import Counter

from route_table import api_routes, route_key

from main import app

# Registered twice on purpose until someone decides which version stays: the copy that never runs
# does more than the one that does (#298).
KNOWN_DUPLICATES = {
    # routers/jobs.py returns {"status": "ok"} without creating jobs; main.py has the implementation
    ("POST", "/api/v1/smart-install"),
    # routers/jobs.py only stores the status; main.py also logs, alerts, retries and evaluates
    # patch_install results
    ("POST", "/api/v1/jobs/instances/{}/result"),
    # routers/jobs.py returns the raw rows; routers/packages_mgmt.py has filters and version info
    ("GET", "/api/v1/packages"),
    # routers/security.py returns zero counts; routers/baselines.py counts the nodes
    ("GET", "/api/v1/compliance/summary"),
}


def _duplicates():
    counts = Counter(route_key(method, route.path)
                     for route in api_routes(app) for method in route.methods)
    return {key for key, count in counts.items() if count > 1}


class RouteTableTests(unittest.TestCase):
    def test_route_table_includes_the_routers(self):
        modules = {route.endpoint.__module__ for route in api_routes(app)}
        self.assertIn("routers.jobs", modules)
        self.assertIn("main", modules)

    def test_no_method_and_path_is_registered_twice(self):
        self.assertEqual(sorted(_duplicates() - KNOWN_DUPLICATES), [], "registered more than once")

    def test_known_duplicates_are_still_registered_twice(self):
        self.assertEqual(sorted(KNOWN_DUPLICATES - _duplicates()), [],
                         "no longer duplicated: remove from KNOWN_DUPLICATES")


if __name__ == "__main__":
    unittest.main()
