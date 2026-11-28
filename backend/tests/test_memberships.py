"""Dynamic group memberships, set-based: a fixed number of statements for any number of nodes; only
rule-made members are removed; a renamed tag is followed in the rules."""
import asyncio
import json
import unittest
from uuid import uuid4

from app.db import memberships

TAG_GROUP, OS_GROUP = uuid4(), uuid4()
A, B, C = uuid4(), uuid4(), uuid4()
TAG_RULE = {"operator": "AND", "conditions": [{"field": "tags", "op": "has_tag", "value": "Ring-1"}]}
OS_RULE = {"operator": "AND", "conditions": [{"field": "os_name", "op": "contains", "value": "ubuntu"}]}


def node(id, tags, os="Ubuntu"):
    return {"id": id, "hostname": str(id)[:8], "os_name": os, "os_version": "", "os_build": "", "agent_version": "",
            "domain": None, "is_domain_joined": None, "tags": tags}


class Conn:
    def __init__(self, nodes, members):
        self.nodes, self.members, self.calls = nodes, members, []

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        if "FROM groups" in sql:
            return [{"id": TAG_GROUP, "dynamic_rule": json.dumps(TAG_RULE)}, {"id": OS_GROUP, "dynamic_rule": OS_RULE}]
        if "FROM nodes n" in sql:
            return self.nodes
        if "FROM device_groups" in sql:
            return self.members
        if sql.startswith("INSERT"):
            return [1] * len(args[0])
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        return f"DELETE {len(args[0])}"


class ReevaluateTest(unittest.TestCase):
    def test_adds_and_removes_in_one_statement_each(self):
        conn = Conn([node(A, ["ring-1"]), node(B, []), node(C, [])],
                    [{"node_id": B, "group_id": TAG_GROUP, "assigned_by": "dynamic_rule"},
                     {"node_id": C, "group_id": TAG_GROUP, "assigned_by": "admin"}])
        result = asyncio.run(memberships.reevaluate(conn, [A, B, C], tag_rules_only=True))
        # only the group whose rule tests tags; A joins (tag, any case), B leaves, C stays (added by hand)
        self.assertEqual(result, {"groups": 1, "nodes": 3, "added": 1, "removed": 1})
        insert = [c for c in conn.calls if c[0].startswith("INSERT")][0]
        self.assertEqual(insert[1], ([A], [TAG_GROUP]))
        delete = [c for c in conn.calls if c[0].startswith("DELETE")][0]
        self.assertEqual(delete[1], ([B], [TAG_GROUP]))
        self.assertIn("assigned_by = 'dynamic_rule'", delete[0])
        self.assertEqual(len(conn.calls), 5)  # groups, nodes, members, insert, delete - not per node

    def test_all_groups_for_evaluate(self):
        conn = Conn([node(A, [], os="Windows"), node(B, [])], [])
        result = asyncio.run(memberships.reevaluate(conn, None, [OS_GROUP, TAG_GROUP]))
        self.assertEqual(result["groups"], 2)
        self.assertEqual(result["added"], 1)  # B (Ubuntu) joins the OS group
        nodes_query = [c for c in conn.calls if "FROM nodes n" in c[0]][0]
        self.assertEqual(nodes_query[1], (None,))  # all nodes in one query

    def test_no_nodes_no_queries_beyond_the_groups(self):
        conn = Conn([], [])
        self.assertEqual(asyncio.run(memberships.reevaluate(conn, [], tag_rules_only=True))["nodes"], 0)
        self.assertEqual(len(conn.calls), 1)


class RuleHelpersTest(unittest.TestCase):
    def test_rule_tags_and_rename(self):
        self.assertEqual(memberships.rule_tags(json.dumps(TAG_RULE)), {"ring-1"})
        self.assertEqual(memberships.rule_tags(OS_RULE), set())
        renamed = memberships.rename_tag_in_rule(json.dumps(TAG_RULE), "ring-1", "Pilot")
        self.assertEqual(renamed["conditions"][0]["value"], "Pilot")
        self.assertIsNone(memberships.rename_tag_in_rule(OS_RULE, "ring-1", "Pilot"))
        self.assertIsNone(memberships.parse_rule("not json"))


if __name__ == "__main__":
    unittest.main()
