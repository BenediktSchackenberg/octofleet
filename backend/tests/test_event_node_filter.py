"""Node filter of Security -> Events: case-insensitive, wildcards, part of the name, and the
Windows computer account (HOST$) finds the node HOST; resolved to node names for the index."""

import unittest

from routers.monitoring_mgmt import node_filter_pattern, resolve_node_filter


class PatternTests(unittest.TestCase):
    def test_part_of_the_name(self):
        self.assertEqual(node_filter_pattern("deploy"), ("deploy", "%deploy%"))

    def test_computer_account_dollar_is_dropped(self):
        self.assertEqual(node_filter_pattern("WIN-SRV01$"), ("WIN-SRV01", "%WIN-SRV01%"))
        self.assertEqual(node_filter_pattern(" win-srv01$ "), ("win-srv01", "%win-srv01%"))

    def test_wildcards_cover_the_whole_name(self):
        self.assertEqual(node_filter_pattern("srv-*-01"), ("srv-*-01", "srv-%-01"))
        self.assertEqual(node_filter_pattern("web?"), ("web?", "web_"))

    def test_like_characters_are_literal(self):
        self.assertEqual(node_filter_pattern("a_b%"), ("a_b%", "%a\\_b\\%%"))

    def test_empty(self):
        self.assertEqual(node_filter_pattern(""), (None, None))
        self.assertEqual(node_filter_pattern("$"), (None, None))


class Conn:
    def __init__(self, rows):
        self.rows = rows
        self.args = None

    async def fetch(self, query, *args):
        self.args = args
        return self.rows


class ResolveTests(unittest.IsolatedAsyncioTestCase):
    async def test_matches_become_exact_names(self):
        conn = Conn([{"node_id": "WIN-SRV01", "hostname": "WIN-SRV01"},
                     {"node_id": "webapp", "hostname": "web-app-001"}])
        names = await resolve_node_filter(conn, "w*")
        self.assertEqual(conn.args, ("w%",))
        self.assertEqual(names, ["WIN-SRV01", "w*", "web-app-001", "webapp"])

    async def test_unregistered_name_is_still_searched(self):
        self.assertEqual(await resolve_node_filter(Conn([]), "OLD-HOST$"), ["OLD-HOST"])

    async def test_empty_filter(self):
        self.assertEqual(await resolve_node_filter(Conn([]), "  "), [])


if __name__ == "__main__":
    unittest.main()
