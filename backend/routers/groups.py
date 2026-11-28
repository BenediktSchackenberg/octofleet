import json
from typing import Any, Dict
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.rules import RULE_FIELDS, RULE_OPERATORS, evaluate_dynamic_rule
from app.db import group_usage, memberships
from auth import CurrentUser, require_user_permission
from dependencies import bad_request, conflict, get_db, log_audit, not_found, verify_api_key

router = APIRouter(
    prefix="/api/v1",
    tags=["Groups & Tags"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/groups", dependencies=[Depends(require_user_permission("groups:read"))])
async def list_groups(db: asyncpg.Pool = Depends(get_db)):
    """List all groups with member counts"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT g.id, g.name, g.description, g.parent_id, g.is_dynamic, 
                   g.dynamic_rule, g.color, g.icon, g.created_at, g.updated_at,
                   COUNT(dg.node_id) as member_count
            FROM groups g
            LEFT JOIN device_groups dg ON g.id = dg.group_id
            GROUP BY g.id
            ORDER BY g.name
        """)
        return {"groups": [_group(r) for r in rows]}


def _uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise bad_request("Invalid group id") from None


def _group(row) -> dict:
    """A group row with its rule decoded (jsonb comes back as text)"""
    item = dict(row)
    if isinstance(item.get("dynamic_rule"), str):
        item["dynamic_rule"] = json.loads(item["dynamic_rule"])
    return item


# The group's ancestors, nearest last (for the breadcrumb) and its direct sub-groups with member counts
PARENTS_SQL = """
    WITH RECURSIVE up AS (
        SELECT g.id, g.name, g.parent_id, 0 AS depth FROM groups g WHERE g.id = (SELECT parent_id FROM groups WHERE id = $1)
        UNION ALL
        SELECT g.id, g.name, g.parent_id, up.depth + 1 FROM groups g JOIN up ON g.id = up.parent_id WHERE up.depth < 50)
    SELECT id, name FROM up ORDER BY depth DESC"""
CHILDREN_SQL = """
    SELECT g.id, g.name, g.is_dynamic, g.color,
           (SELECT COUNT(*) FROM device_groups dg WHERE dg.group_id = g.id) AS member_count
    FROM groups g WHERE g.parent_id = $1 ORDER BY lower(g.name), g.id"""
# Whether $2 is the group $1 itself or one of its sub-groups (at any depth): such a parent would make a loop
IS_SELF_OR_DESCENDANT_SQL = """
    WITH RECURSIVE down AS (
        SELECT id, 0 AS depth FROM groups WHERE id = $1
        UNION ALL
        SELECT g.id, down.depth + 1 FROM groups g JOIN down ON g.parent_id = down.id WHERE down.depth < 50)
    SELECT EXISTS (SELECT 1 FROM down WHERE id = $2)"""


@router.get("/groups/{group_id}", dependencies=[Depends(require_user_permission("groups:read"))])
async def get_group(group_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get single group with members"""
    async with db.acquire() as conn:
        group = await conn.fetchrow("""
            SELECT g.id, g.name, g.description, g.parent_id, g.is_dynamic, 
                   g.dynamic_rule, g.color, g.icon, g.created_at, g.updated_at
            FROM groups g WHERE g.id = $1
        """, UUID(group_id))
        
        if not group:
            raise not_found("Group", group_id)
        
        # Get members
        members = await conn.fetch("""
            SELECT n.id, n.node_id, n.hostname, n.os_name, n.last_seen, n.is_online,
                   dg.assigned_at, dg.assigned_by
            FROM device_groups dg
            JOIN nodes n ON dg.node_id = n.id
            WHERE dg.group_id = $1
            ORDER BY n.hostname
        """, UUID(group_id))
        
        result = _group(group)
        result["members"] = [dict(m) for m in members]
        result["parents"] = [dict(r) for r in await conn.fetch(PARENTS_SQL, UUID(group_id))]
        result["children"] = [dict(r) for r in await conn.fetch(CHILDREN_SQL, UUID(group_id))]
        return result


@router.post("/groups", dependencies=[Depends(require_user_permission("groups:write"))])
async def create_group(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new group"""
    check_rule(data.get("dynamicRule"))
    name = data.get("name")
    if not name:
        raise bad_request("Name is required", "name")
    if data.get("isDynamic") and not data.get("dynamicRule"):
        raise bad_request("dynamicRule: a dynamic group needs a rule", "dynamicRule")

    async with db.acquire() as conn, conn.transaction():
        if data.get("parentId") and not await conn.fetchval("SELECT 1 FROM groups WHERE id = $1", UUID(data["parentId"])):
            raise bad_request("parentId: no such group", "parentId")
        try:
            row = await conn.fetchrow("""
                INSERT INTO groups (name, description, parent_id, is_dynamic, dynamic_rule, color, icon)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, name, description, parent_id, is_dynamic, dynamic_rule, color, icon, created_at
            """,
                name,
                data.get("description"),
                UUID(data["parentId"]) if data.get("parentId") else None,
                data.get("isDynamic", False),
                json.dumps(data["dynamicRule"]) if data.get("dynamicRule") else None,
                data.get("color"),
                data.get("icon")
            )
        except asyncpg.UniqueViolationError:
            raise conflict("Group name already exists", "Group")
        # a dynamic group gets its members at once, not on the nodes' next push
        members = (await memberships.reevaluate(conn, None, [row["id"]]))["added"] if row["is_dynamic"] else 0
        return {"status": "created", "group": _group(row), "members": members}


def check_rule(rule) -> None:
    """400 for a dynamic rule with a field or operator the evaluator cannot use"""
    if rule is None:
        return
    if not isinstance(rule, dict) or not isinstance(rule.get("conditions"), list) or not rule["conditions"]:
        raise bad_request("dynamicRule: {operator: AND|OR, conditions: [{field, op, value}, ...]}", "dynamicRule")
    if str(rule.get("operator", "AND")).upper() not in ("AND", "OR"):
        raise bad_request("dynamicRule.operator: AND or OR", "dynamicRule")
    for cond in rule["conditions"]:
        if not isinstance(cond, dict) or cond.get("field") not in RULE_FIELDS:
            raise bad_request(f"dynamicRule field: one of {', '.join(sorted(RULE_FIELDS))}", "dynamicRule")
        if cond.get("op", "equals") not in RULE_OPERATORS:
            raise bad_request(f"dynamicRule op: one of {', '.join(sorted(RULE_OPERATORS))}", "dynamicRule")


@router.put("/groups/{group_id}", dependencies=[Depends(require_user_permission("groups:write"))])
async def update_group(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update an existing group"""
    check_rule(data.get("dynamicRule"))
    async with db.acquire() as conn, conn.transaction():
        existing = await conn.fetchrow("SELECT id FROM groups WHERE id = $1", UUID(group_id))
        if not existing:
            raise not_found("Group", group_id)
        if data.get("parentId"):
            parent = UUID(data["parentId"])
            if not await conn.fetchval("SELECT 1 FROM groups WHERE id = $1", parent):
                raise bad_request("parentId: no such group", "parentId")
            if await conn.fetchval(IS_SELF_OR_DESCENDANT_SQL, UUID(group_id), parent):
                raise bad_request("parentId: not the group itself or one of its sub-groups", "parentId")

        row = await conn.fetchrow("""
            UPDATE groups SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                parent_id = CASE WHEN $9 THEN $4 ELSE parent_id END,
                is_dynamic = COALESCE($5, is_dynamic),
                dynamic_rule = COALESCE($6, dynamic_rule),
                color = COALESCE($7, color),
                icon = COALESCE($8, icon),
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, description, parent_id, is_dynamic, dynamic_rule, color, icon, updated_at
        """,
            UUID(group_id),
            data.get("name"),
            data.get("description"),
            UUID(data["parentId"]) if data.get("parentId") else None,
            data.get("isDynamic"),
            json.dumps(data["dynamicRule"]) if data.get("dynamicRule") else None,
            data.get("color"),
            data.get("icon"),
            # only when the request names it: renaming a sub-group set its parent to NULL
            "parentId" in data,
        )
        # a changed rule applies at once
        changes = None
        if row["is_dynamic"] and data.get("dynamicRule"):
            changes = await memberships.reevaluate(conn, None, [row["id"]])
        return {"status": "updated", "group": _group(row),
                "members": {"added": changes["added"], "removed": changes["removed"]} if changes else None}


@router.get("/groups/{group_id}/usage", dependencies=[Depends(require_user_permission("groups:read"))])
async def group_usage_route(group_id: str, db: asyncpg.Pool = Depends(get_db)):
    """What uses the group and what deleting it does to each use (`uses`: kind, count, names, effect)"""
    gid = _uuid(group_id)
    async with db.acquire() as conn:
        if not await conn.fetchval("SELECT 1 FROM groups WHERE id = $1", gid):
            raise not_found("Group", group_id)
        return {"groupId": group_id, "uses": await group_usage.usage(conn, gid)}


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str, request: Request, confirm: bool = False, db: asyncpg.Pool = Depends(get_db),
                       user: CurrentUser = Depends(require_user_permission("groups:write"))):
    """Delete a group. A group that is used (members, sub-groups, rules, rings, assignments, jobs ...) is
    deleted only with `confirm=true`; without it the answer is 409 with the uses. Deleting cleans up:
    members removed (the nodes stay), sub-groups to the top level, Linux approval rules and
    patch rings keep the id (fail-safe: approve nothing, exclusions cover all), maintenance windows deactivated, assignments deleted,
    the onboarding default cleared; jobs and deployments keep running on the nodes they were created for."""
    gid = _uuid(group_id)
    async with db.acquire() as conn:
        async with conn.transaction():
            name = await conn.fetchval("SELECT name FROM groups WHERE id = $1 FOR UPDATE", gid)
            if name is None:
                raise not_found("Group", group_id)
            uses = await group_usage.usage(conn, gid)
            if uses and not confirm:
                raise HTTPException(status_code=409, detail={
                    "message": "The group is in use; deleting it needs confirm=true", "uses": uses})
            await group_usage.clean_up(conn, gid)
            await conn.execute("DELETE FROM groups WHERE id = $1", gid)
            await log_audit(conn, UUID(user.id), "group.deleted", "group", group_id,
                            {"name": name, "uses": [{k: u[k] for k in ("kind", "count", "effect")} for u in uses]},
                            request.client.host if request.client else None)
        return {"status": "deleted", "groupId": group_id, "uses": uses}


@router.post("/groups/preview-rule", dependencies=[Depends(require_user_permission("groups:write"))])
async def preview_dynamic_rule(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """
    Preview which nodes would match a dynamic rule without creating the group.
    Use this to test rules before creating dynamic groups.
    """
    rule = data.get("rule")
    if not rule:
        raise HTTPException(status_code=400, detail="rule is required")
    check_rule(rule)
    
    async with db.acquire() as conn:
        # Get all nodes with their basic info
        nodes = await conn.fetch("""
            SELECT n.id, n.node_id, n.hostname, n.os_name, n.os_version, n.os_build, 
                   n.agent_version, n.last_seen, n.is_online,
                   s.domain, s.is_domain_joined
            FROM nodes n
            LEFT JOIN system_current s ON n.id = s.node_id
        """)
        
        # Pre-fetch all tags for all nodes
        all_tags = await conn.fetch("""
            SELECT dt.node_id, t.name FROM device_tags dt
            JOIN tags t ON dt.tag_id = t.id
        """)
        node_tags_map = {}
        for row in all_tags:
            if row['node_id'] not in node_tags_map:
                node_tags_map[row['node_id']] = []
            node_tags_map[row['node_id']].append(row['name'])
        
        matching = []
        non_matching = []
        
        for node in nodes:
            node_data = {
                "hostname": node['hostname'] or "",
                "os_name": node['os_name'] or "",
                "os_version": node['os_version'] or "",
                "os_build": node['os_build'] or "",
                "agent_version": node['agent_version'] or "",
                "domain": node['domain'] or "",
                "is_domain_joined": node['is_domain_joined'] or False,
                "tags": node_tags_map.get(node['id'], []),
            }
            
            if evaluate_dynamic_rule(rule, node_data):
                matching.append({
                    "id": str(node['id']),
                    "hostname": node['hostname'],
                    "os_name": node['os_name'],
                    "last_seen": node['last_seen'].isoformat() if node['last_seen'] else None
                })
            else:
                non_matching.append({
                    "id": str(node['id']),
                    "hostname": node['hostname'],
                    "os_name": node['os_name'],
                })
        
        return {
            "matchingCount": len(matching),
            "totalNodes": len(nodes),
            "matching": matching,
            "nonMatchingSample": non_matching[:5]  # First 5 for debugging
        }


@router.post("/groups/{group_id}/evaluate", dependencies=[Depends(require_user_permission("groups:write"))])
async def evaluate_dynamic_group(group_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Re-evaluate a dynamic group for all nodes and update its memberships (set-based: four statements,
    not two queries per node)."""
    async with db.acquire() as conn:
        group = await conn.fetchrow("SELECT id, name, is_dynamic FROM groups WHERE id = $1", UUID(group_id))
        if not group:
            raise not_found("Group", group_id)
        if not group["is_dynamic"]:
            raise HTTPException(status_code=400, detail="Group is not dynamic")
        async with conn.transaction():
            result = await memberships.reevaluate(conn, None, [group["id"]])
        return {"status": "ok", "groupId": group_id, "groupName": group["name"],
                "added": result["added"], "removed": result["removed"], "evaluated": result["nodes"]}


def _node_refs(data: Dict[str, Any]) -> list:
    """The nodes of a members request: `nodeIds` (the node's UUID, node ID or hostname each)"""
    refs = data.get("nodeIds")
    if not isinstance(refs, list) or not refs or not all(isinstance(r, str) and r for r in refs):
        raise bad_request("nodeIds: a non-empty array of node UUIDs, node IDs or hostnames", "nodeIds")
    return refs


# The nodes a list of references names - by UUID, node ID or hostname (any case), in that order of
# precedence - as three joins the planner can hash, so a bulk request for 10,000 nodes stays one pass
RESOLVE_NODES_SQL = """
    SELECT DISTINCT ON (r.ref) r.ref, COALESCE(a.id, b.id, c.id) AS id
    FROM unnest($1::text[]) AS r(ref)
    LEFT JOIN nodes a ON a.id = CASE WHEN r.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                     THEN r.ref::uuid END
    LEFT JOIN nodes b ON b.node_id = r.ref
    LEFT JOIN nodes c ON UPPER(c.hostname) = UPPER(r.ref)
    ORDER BY r.ref, c.id"""


async def _resolve_nodes(conn, refs: list) -> tuple[list, list]:
    """(node UUIDs found, references not found)"""
    rows = await conn.fetch(RESOLVE_NODES_SQL, refs)
    return [r["id"] for r in rows if r["id"]], [r["ref"] for r in rows if not r["id"]]


@router.post("/groups/{group_id}/members", dependencies=[Depends(require_user_permission("groups:write"))])
async def add_device_groups(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Add nodes to a group. `nodeIds`: UUIDs, node IDs or hostnames; one statement for all of them.
    Returns `added` (new members), `alreadyMembers` and `notFound` (references that name no node)."""
    refs = _node_refs(data)
    assigned_by = data.get("assignedBy") or "api"
    async with db.acquire() as conn:
        if not await conn.fetchval("SELECT 1 FROM groups WHERE id = $1", UUID(group_id)):
            raise not_found("Group", group_id)
        node_ids, missing = await _resolve_nodes(conn, refs)
        added = await conn.fetchval("""
            WITH ins AS (
                INSERT INTO device_groups (node_id, group_id, assigned_by)
                SELECT DISTINCT unnest($1::uuid[]), $2::uuid, $3::varchar
                ON CONFLICT (node_id, group_id) DO NOTHING RETURNING 1)
            SELECT COUNT(*) FROM ins""", node_ids, UUID(group_id), assigned_by)
        return {"status": "ok", "groupId": group_id, "added": added,
                "alreadyMembers": len(set(node_ids)) - added, "notFound": missing}


@router.delete("/groups/{group_id}/members", dependencies=[Depends(require_user_permission("groups:write"))])
async def remove_device_groups(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Remove nodes from a group (`nodeIds` as for adding), one statement for all of them."""
    refs = _node_refs(data)
    async with db.acquire() as conn:
        node_ids, missing = await _resolve_nodes(conn, refs)
        result = await conn.execute("DELETE FROM device_groups WHERE group_id = $1 AND node_id = ANY($2::uuid[])",
                                    UUID(group_id), node_ids)
        return {"status": "ok", "groupId": group_id, "removed": int(result.split()[-1]), "notFound": missing}


@router.delete("/groups/{group_id}/members/{node_ref}", dependencies=[Depends(require_user_permission("groups:write"))])
async def remove_device_group(group_id: str, node_ref: str, db: asyncpg.Pool = Depends(get_db)):
    """Remove one node (UUID, node ID or hostname) from a group - the group page's *Remove*; the API
    client sends no body with DELETE, so the bulk route above could not be used there."""
    async with db.acquire() as conn:
        node_ids, _ = await _resolve_nodes(conn, [node_ref])
        if not node_ids:
            raise not_found("Node", node_ref)
        result = await conn.execute("DELETE FROM device_groups WHERE group_id = $1 AND node_id = $2",
                                    UUID(group_id), node_ids[0])
        return {"status": "ok", "groupId": group_id, "removed": int(result.split()[-1])}


@router.get("/tags", dependencies=[Depends(require_user_permission("groups:read"))])
async def list_tags(db: asyncpg.Pool = Depends(get_db)):
    """All tags with where they are used: `device_count` (nodes), `dynamic_groups` (dynamic groups whose
    rule tests the tag) and `jobs` (jobs created for the tag)."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT t.id, t.name, t.color, t.created_at,
                   (SELECT COUNT(*) FROM device_tags dt WHERE dt.tag_id = t.id) AS device_count,
                   (SELECT COUNT(*) FROM jobs j WHERE j.target_type = 'tag' AND j.target_tag = t.name) AS jobs
            FROM tags t ORDER BY lower(t.name), t.id""")
        rules = await conn.fetch("SELECT dynamic_rule FROM groups WHERE is_dynamic AND dynamic_rule IS NOT NULL")
        used = [memberships.rule_tags(r["dynamic_rule"]) for r in rules]
        return {"tags": [{**dict(r), "dynamic_groups": sum(1 for names in used if r["name"].lower() in names)}
                         for r in rows]}


@router.post("/tags", dependencies=[Depends(require_user_permission("groups:write"))])
async def create_tag(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new tag"""
    name = data.get("name")
    if not name:
        raise bad_request("Name is required", "name")
    
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow("""
                INSERT INTO tags (name, color) VALUES ($1, $2)
                RETURNING id, name, color, created_at
            """, name, data.get("color"))
            return {"status": "created", "tag": dict(row)}
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail="Tag name already exists")


TAG_COLOR_RE = __import__("re").compile(r"^#[0-9a-fA-F]{6}$")


@router.patch("/tags/{tag_id}", dependencies=[Depends(require_user_permission("groups:write"))])
async def update_tag(tag_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Rename a tag (`name`) or change its `color` (#RRGGBB, or null). Dynamic group rules that test the
    tag follow the new name in the same transaction, so their members stay the same. 409 if the name
    is taken."""
    fields = {k: data[k] for k in ("name", "color") if k in data}
    if not fields:
        raise bad_request("name or color", "name")
    name = fields.get("name")
    if "name" in fields and (not isinstance(name, str) or not name.strip() or len(name.strip()) > 100):
        raise bad_request("name: 1-100 characters", "name")
    color = fields.get("color")
    if "color" in fields and color is not None and not (isinstance(color, str) and TAG_COLOR_RE.match(color)):
        raise bad_request("color: #RRGGBB or null", "color")
    async with db.acquire() as conn, conn.transaction():
        tag = await conn.fetchrow("SELECT id, name, color FROM tags WHERE id = $1 FOR UPDATE", UUID(tag_id))
        if not tag:
            raise not_found("Tag", tag_id)
        new_name = name.strip() if "name" in fields else tag["name"]
        try:
            row = await conn.fetchrow(
                "UPDATE tags SET name = $2, color = $3 WHERE id = $1 RETURNING id, name, color, created_at",
                tag["id"], new_name, color if "color" in fields else tag["color"])
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail="Tag name already exists")
        rules_updated = 0
        if new_name != tag["name"]:
            for g in await conn.fetch("SELECT id, dynamic_rule FROM groups WHERE is_dynamic AND dynamic_rule IS NOT NULL"):
                rule = memberships.rename_tag_in_rule(g["dynamic_rule"], tag["name"], new_name)
                if rule is not None:
                    await conn.execute("UPDATE groups SET dynamic_rule = $2 WHERE id = $1", g["id"], json.dumps(rule))
                    rules_updated += 1
        return {"status": "updated", "tag": dict(row), "rulesUpdated": rules_updated}


async def _tag_or_404(conn, tag_id: str):
    tag = await conn.fetchrow("SELECT id, name FROM tags WHERE id = $1", UUID(tag_id))
    if not tag:
        raise not_found("Tag", tag_id)
    return tag


@router.post("/tags/{tag_id}/nodes", dependencies=[Depends(require_user_permission("groups:write"))])
async def tag_nodes(tag_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Tag many nodes at once: `nodeIds` (UUIDs, node IDs or hostnames), one statement. Dynamic groups
    whose rule tests tags are re-evaluated for these nodes. Returns `added`, `alreadyTagged`,
    `notFound` and `dynamicGroups` (members added/removed by rules)."""
    refs = _node_refs(data)
    async with db.acquire() as conn, conn.transaction():
        tag = await _tag_or_404(conn, tag_id)
        node_ids, missing = await _resolve_nodes(conn, refs)
        added = len(await conn.fetch("""
            INSERT INTO device_tags (node_id, tag_id) SELECT DISTINCT unnest($1::uuid[]), $2::uuid
            ON CONFLICT (node_id, tag_id) DO NOTHING RETURNING 1""", node_ids, tag["id"]))
        changes = await memberships.reevaluate(conn, set(node_ids), tag_rules_only=True)
        return {"status": "ok", "tagId": tag_id, "added": added, "alreadyTagged": len(set(node_ids)) - added,
                "notFound": missing, "dynamicGroups": {"added": changes["added"], "removed": changes["removed"]}}


@router.delete("/tags/{tag_id}/nodes", dependencies=[Depends(require_user_permission("groups:write"))])
async def untag_nodes(tag_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Remove a tag from many nodes (`nodeIds` as for tagging), one statement; dynamic groups as there."""
    refs = _node_refs(data)
    async with db.acquire() as conn, conn.transaction():
        tag = await _tag_or_404(conn, tag_id)
        node_ids, missing = await _resolve_nodes(conn, refs)
        result = await conn.execute("DELETE FROM device_tags WHERE tag_id = $1 AND node_id = ANY($2::uuid[])",
                                    tag["id"], node_ids)
        changes = await memberships.reevaluate(conn, set(node_ids), tag_rules_only=True)
        return {"status": "ok", "tagId": tag_id, "removed": int(result.split()[-1]), "notFound": missing,
                "dynamicGroups": {"added": changes["added"], "removed": changes["removed"]}}


@router.delete("/tags/{tag_id}", dependencies=[Depends(require_user_permission("groups:write"))])
async def delete_tag(tag_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a tag"""
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM tags WHERE id = $1", UUID(tag_id))
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Tag not found")
        return {"status": "deleted", "tagId": tag_id}


@router.post("/devices/{node_id}/tags", dependencies=[Depends(require_user_permission("groups:write"))])
async def add_device_tags(node_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Add tags to a device"""
    tag_ids = data.get("tagIds", [])
    
    if not tag_ids:
        raise HTTPException(status_code=400, detail="tagIds array is required")
    
    async with db.acquire() as conn:
        # Find node by node_id string
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
        added = 0
        for tag_id in tag_ids:
            try:
                await conn.execute("""
                    INSERT INTO device_tags (node_id, tag_id)
                    VALUES ($1, $2)
                    ON CONFLICT (node_id, tag_id) DO NOTHING
                """, node['id'], UUID(tag_id))
                added += 1
            except Exception:
                pass
        await memberships.reevaluate(conn, [node['id']], tag_rules_only=True)
        return {"status": "ok", "nodeId": node_id, "added": added}


@router.delete("/devices/{node_id}/tags", dependencies=[Depends(require_user_permission("groups:write"))])
async def remove_device_tags(node_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Remove tags from a device"""
    tag_ids = data.get("tagIds", [])
    
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
        removed = 0
        for tag_id in tag_ids:
            try:
                result = await conn.execute("""
                    DELETE FROM device_tags WHERE node_id = $1 AND tag_id = $2
                """, node['id'], UUID(tag_id))
                if result != "DELETE 0":
                    removed += 1
            except Exception:
                pass
        await memberships.reevaluate(conn, [node['id']], tag_rules_only=True)
        return {"status": "ok", "nodeId": node_id, "removed": removed}


@router.get("/devices/{node_id}/groups", dependencies=[Depends(require_user_permission("groups:read"))])
async def get_device_groups(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get groups a device belongs to"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
        rows = await conn.fetch("""
            SELECT g.id, g.name, g.description, g.color, g.icon, dg.assigned_at, dg.assigned_by
            FROM device_groups dg
            JOIN groups g ON dg.group_id = g.id
            WHERE dg.node_id = $1
            ORDER BY g.name
        """, node['id'])
        
        return {"nodeId": node_id, "groups": [dict(r) for r in rows]}


@router.get("/devices/{node_id}/tags", dependencies=[Depends(require_user_permission("groups:read"))])
async def get_device_tags(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get tags assigned to a device"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
        rows = await conn.fetch("""
            SELECT t.id, t.name, t.color, dt.assigned_at
            FROM device_tags dt
            JOIN tags t ON dt.tag_id = t.id
            WHERE dt.node_id = $1
            ORDER BY t.name
        """, node['id'])
        
        return {"nodeId": node_id, "tags": [dict(r) for r in rows]}
