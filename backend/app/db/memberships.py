"""Dynamic group membership, set-based.

A dynamic group's members follow its rule (app.core.rules). The inventory push re-evaluates one node
(app.db.nodes); this module re-evaluates many nodes and groups at once - after a tag change (bulk
tagging, renaming a tag) and for *Evaluate*: one query for the nodes' rule data, one for the current
memberships, one INSERT and one DELETE for the differences. Evaluating 10,000 nodes one by one took
two queries per node.

Only rows the rules created (`assigned_by = 'dynamic_rule'`) are removed; members added by hand stay.
"""
import json
from typing import Iterable, Optional
from uuid import UUID

from app.core.rules import evaluate_dynamic_rule

# The fields a rule can use (RULE_FIELDS), for many nodes; $1: the nodes, NULL for all
NODE_RULE_DATA_SQL = """
    SELECT n.id, n.hostname, n.os_name, n.os_version, n.os_build, n.agent_version,
           s.domain, s.is_domain_joined,
           COALESCE((SELECT array_agg(t.name) FROM device_tags dt JOIN tags t ON t.id = dt.tag_id
                     WHERE dt.node_id = n.id), '{}') AS tags
    FROM nodes n LEFT JOIN system_current s ON s.node_id = n.id
    WHERE $1::uuid[] IS NULL OR n.id = ANY($1::uuid[])"""


def parse_rule(rule) -> Optional[dict]:
    """A stored rule (JSON text or already decoded), or None when it cannot be read."""
    if isinstance(rule, str):
        try:
            rule = json.loads(rule)
        except json.JSONDecodeError:
            return None
    return rule if isinstance(rule, dict) else None


def rule_tags(rule) -> set:
    """The tag names (lower case) a rule tests, from its `tags` conditions."""
    rule = parse_rule(rule) or {}
    return {str(c.get("value", "")).lower() for c in rule.get("conditions") or []
            if isinstance(c, dict) and c.get("field") == "tags"}


def rename_tag_in_rule(rule, old: str, new: str):
    """The rule with `tags` conditions on `old` (any case) set to `new`, or None if it has none."""
    rule = parse_rule(rule)
    if not rule:
        return None
    changed = False
    for cond in rule.get("conditions") or []:
        if isinstance(cond, dict) and cond.get("field") == "tags" and str(cond.get("value", "")).lower() == old.lower():
            cond["value"] = new
            changed = True
    return rule if changed else None


def node_data(row) -> dict:
    return {
        "hostname": row["hostname"] or "", "os_name": row["os_name"] or "", "os_version": row["os_version"] or "",
        "os_build": row["os_build"] or "", "agent_version": row["agent_version"] or "",
        "domain": row["domain"] or "", "is_domain_joined": row["is_domain_joined"] or False,
        "tags": list(row["tags"] or []),
    }


async def reevaluate(conn, node_ids: Optional[Iterable[UUID]] = None, group_ids: Optional[Iterable[UUID]] = None,
                     tag_rules_only: bool = False) -> dict:
    """Bring the memberships of dynamic groups (all, or `group_ids`; with `tag_rules_only` only those
    whose rule tests tags) in line with their rules, for `node_ids` (None: all nodes).
    Returns {"groups", "nodes", "added", "removed"}."""
    groups = await conn.fetch(
        "SELECT id, dynamic_rule FROM groups WHERE is_dynamic AND dynamic_rule IS NOT NULL"
        " AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))",
        list(group_ids) if group_ids is not None else None)
    rules = {g["id"]: parse_rule(g["dynamic_rule"]) for g in groups}
    rules = {gid: r for gid, r in rules.items() if r and (not tag_rules_only or rule_tags(r))}
    ids = list(node_ids) if node_ids is not None else None
    if not rules or ids == []:
        return {"groups": len(rules), "nodes": 0, "added": 0, "removed": 0}
    nodes = await conn.fetch(NODE_RULE_DATA_SQL, ids)
    members = await conn.fetch(
        "SELECT node_id, group_id, assigned_by FROM device_groups"
        " WHERE group_id = ANY($1::uuid[]) AND ($2::uuid[] IS NULL OR node_id = ANY($2::uuid[]))",
        list(rules), ids)
    current = {(m["node_id"], m["group_id"]): m["assigned_by"] for m in members}
    add_n, add_g, del_n, del_g = [], [], [], []
    for row in nodes:
        data = node_data(row)
        for gid, rule in rules.items():
            want = evaluate_dynamic_rule(rule, data)
            key = (row["id"], gid)
            if want and key not in current:
                add_n.append(row["id"]); add_g.append(gid)
            elif not want and current.get(key) == "dynamic_rule":
                del_n.append(row["id"]); del_g.append(gid)
    added = removed = 0
    if add_n:
        added = len(await conn.fetch(
            "INSERT INTO device_groups (node_id, group_id, assigned_by)"
            " SELECT * , 'dynamic_rule' FROM unnest($1::uuid[], $2::uuid[])"
            " ON CONFLICT (node_id, group_id) DO NOTHING RETURNING 1", add_n, add_g))
    if del_n:
        result = await conn.execute(
            "DELETE FROM device_groups d USING unnest($1::uuid[], $2::uuid[]) AS x(node_id, group_id)"
            " WHERE d.node_id = x.node_id AND d.group_id = x.group_id AND d.assigned_by = 'dynamic_rule'",
            del_n, del_g)
        removed = int(result.split()[-1])
    return {"groups": len(rules), "nodes": len(nodes), "added": added, "removed": removed}
