"""Groups as a tree: a group reaches its own members and the members of all its sub-groups.

`device_groups` holds the *direct* members. Whatever targets a group - jobs, deployments, patch rings,
Linux approval rules, maintenance windows, monitoring and baseline assignments, the node list's group
filter - uses these functions, so a parent reaches everything below it, like an OU or a Puppet node group:

- `group_node_ids(group)`: the nodes a group reaches (its members and those of its sub-groups, each once)
- `node_group_ids(node)`: the groups that reach a node (its groups and all their parents)
- `group_descendant_ids(group)` / `group_ancestor_ids(group)`: the group itself and the groups below / above

Each walks `groups.parent_id` from one group (index `idx_groups_parent`) and stops at 20 levels, so a
loop that slipped past the API's check cannot run forever. Read only; members are still added and
removed in `device_groups`.
"""

DEPTH = 20

SCHEMA = (
    "CREATE INDEX IF NOT EXISTS idx_groups_parent ON groups (parent_id) WHERE parent_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_device_groups_group ON device_groups (group_id)",
    "CREATE INDEX IF NOT EXISTS idx_device_groups_node ON device_groups (node_id)",
    f"""CREATE OR REPLACE FUNCTION group_descendant_ids(gid uuid) RETURNS TABLE (group_id uuid)
        LANGUAGE sql STABLE AS $$
        WITH RECURSIVE d(id, depth) AS (
            SELECT gid, 0
            UNION ALL
            SELECT g.id, d.depth + 1 FROM groups g JOIN d ON g.parent_id = d.id WHERE d.depth < {DEPTH})
        SELECT DISTINCT id FROM d $$""",
    f"""CREATE OR REPLACE FUNCTION group_ancestor_ids(gid uuid) RETURNS TABLE (group_id uuid)
        LANGUAGE sql STABLE AS $$
        WITH RECURSIVE u(id, depth) AS (
            SELECT gid, 0
            UNION ALL
            SELECT g.parent_id, u.depth + 1 FROM groups g JOIN u ON g.id = u.id
             WHERE g.parent_id IS NOT NULL AND u.depth < {DEPTH})
        SELECT DISTINCT id FROM u $$""",
    """CREATE OR REPLACE FUNCTION group_node_ids(gid uuid) RETURNS TABLE (node_id uuid)
        LANGUAGE sql STABLE AS $$
        SELECT DISTINCT dg.node_id FROM group_descendant_ids(gid) d JOIN device_groups dg ON dg.group_id = d.group_id $$""",
    f"""CREATE OR REPLACE FUNCTION node_group_ids(nid uuid) RETURNS TABLE (group_id uuid)
        LANGUAGE sql STABLE AS $$
        WITH RECURSIVE u(id, depth) AS (
            SELECT dg.group_id, 0 FROM device_groups dg WHERE dg.node_id = nid
            UNION ALL
            SELECT g.parent_id, u.depth + 1 FROM groups g JOIN u ON g.id = u.id
             WHERE g.parent_id IS NOT NULL AND u.depth < {DEPTH})
        SELECT DISTINCT id FROM u $$""",
)


async def ensure_schema(pool) -> None:
    async with pool.acquire() as conn:
        for sql in SCHEMA:
            await conn.execute(sql)


# How deep groups nest: a top-level group, its sub-groups and theirs (user decision 2026-11-28, 3 for now)
MAX_LEVELS = 3

# levels of a group: 1 for a top-level group
LEVEL_SQL = "SELECT count(*) FROM group_ancestor_ids($1::uuid)"
# levels of a group's subtree: 1 for a group without sub-groups
HEIGHT_SQL = f"""
    WITH RECURSIVE d(id, depth) AS (
        SELECT $1::uuid, 1
        UNION ALL
        SELECT g.id, d.depth + 1 FROM groups g JOIN d ON g.parent_id = d.id WHERE d.depth < {DEPTH})
    SELECT max(depth) FROM d"""


async def too_deep(conn, parent_id, group_id=None) -> bool:
    """Whether putting the group (a new one when `group_id` is None) under `parent_id` nests deeper than MAX_LEVELS"""
    height = await conn.fetchval(HEIGHT_SQL, group_id) if group_id else 1
    return await conn.fetchval(LEVEL_SQL, parent_id) + height > MAX_LEVELS


# Nodes of $2 that a sub-group of $1 already brings into $1, with those sub-groups' names
INCLUDED_SQL = """
    SELECT dg.node_id, array_agg(DISTINCT g.name ORDER BY g.name) AS via
      FROM group_descendant_ids($1::uuid) d
      JOIN device_groups dg ON dg.group_id = d.group_id
      JOIN groups g ON g.id = dg.group_id
     WHERE d.group_id <> $1::uuid AND dg.node_id = ANY($2::uuid[])
     GROUP BY dg.node_id"""

# A node added to a group no longer needs to be a member of the group's parents itself: their direct,
# static memberships of these nodes go (rule-managed ones stay - the rule decides those)
MOVE_UP_SQL = """
    DELETE FROM device_groups dg
     USING group_ancestor_ids($1::uuid) a, groups g
     WHERE dg.group_id = a.group_id AND a.group_id <> $1::uuid AND g.id = a.group_id
       AND NOT g.is_dynamic AND dg.assigned_by IS DISTINCT FROM 'dynamic_rule'
       AND dg.node_id = ANY($2::uuid[])
    RETURNING dg.group_id"""


async def leave_parents(conn, group_id, node_ids) -> int:
    """Remove the nodes' direct static memberships in the group's parents (they reach them through the group)"""
    if not node_ids:
        return 0
    return len(await conn.fetch(MOVE_UP_SQL, group_id, list(node_ids)))
