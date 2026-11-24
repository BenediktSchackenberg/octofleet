"""Every method and path is registered once.

A second registration never runs - FastAPI takes the first route that matches - but it looks like
the code that answers. #298 found 25 of them, mostly old copies in main.py behind a router.
"""
import unittest
from collections import Counter

from route_table import api_routes, route_key

from main import app

# Registered twice on purpose (none left: #298 merged the richer copies into the routes that run).
KNOWN_DUPLICATES: set = set()


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
