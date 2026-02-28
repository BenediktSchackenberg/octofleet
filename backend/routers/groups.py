import json
import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from typing import Any, Dict, List
from uuid import UUID
from dependencies import get_db, verify_api_key, not_found, bad_request, conflict
from app.core.rules import evaluate_dynamic_rule

router = APIRouter(
    prefix="/api/v1",
    tags=["Groups & Tags"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/groups")
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
        return {"groups": [dict(r) for r in rows]}


@router.get("/groups/{group_id}")
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
        
        result = dict(group)
        result["members"] = [dict(m) for m in members]
        return result


@router.post("/groups")
async def create_group(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new group"""
    name = data.get("name")
    if not name:
        raise bad_request("Name is required", "name")
    
    async with db.acquire() as conn:
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
            return {"status": "created", "group": dict(row)}
        except asyncpg.UniqueViolationError:
            raise conflict("Group name already exists", "Group")


@router.put("/groups/{group_id}")
async def update_group(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update an existing group"""
    async with db.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM groups WHERE id = $1", UUID(group_id))
        if not existing:
            raise not_found("Group", group_id)
        
        row = await conn.fetchrow("""
            UPDATE groups SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                parent_id = $4,
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
            data.get("icon")
        )
        return {"status": "updated", "group": dict(row)}


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a group"""
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM groups WHERE id = $1", UUID(group_id))
        if result == "DELETE 0":
            raise not_found("Group", group_id)
        return {"status": "deleted", "groupId": group_id}


@router.post("/groups/preview-rule")
async def preview_dynamic_rule(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """
    Preview which nodes would match a dynamic rule without creating the group.
    Use this to test rules before creating dynamic groups.
    """
    rule = data.get("rule")
    if not rule:
        raise HTTPException(status_code=400, detail="rule is required")
    
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


@router.post("/groups/{group_id}/evaluate")
async def evaluate_dynamic_group(group_id: str, db: asyncpg.Pool = Depends(get_db)):
    """
    Re-evaluate a dynamic group and update memberships.
    Useful after changing the rule or when you want to force a refresh.
    """
    async with db.acquire() as conn:
        group = await conn.fetchrow("""
            SELECT id, name, is_dynamic, dynamic_rule FROM groups WHERE id = $1
        """, UUID(group_id))
        
        if not group:
            raise not_found("Group", group_id)
        
        if not group['is_dynamic']:
            raise HTTPException(status_code=400, detail="Group is not dynamic")
        
        rule = group['dynamic_rule']
        if isinstance(rule, str):
            rule = json.loads(rule)
        
        # Get all nodes
        nodes = await conn.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.os_version, n.os_build, 
                   n.agent_version, s.domain, s.is_domain_joined
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
        
        added = 0
        removed = 0
        
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
            
            should_be_member = evaluate_dynamic_rule(rule, node_data)
            
            is_member = await conn.fetchval("""
                SELECT 1 FROM device_groups WHERE node_id = $1 AND group_id = $2
            """, node['id'], UUID(group_id))
            
            if should_be_member and not is_member:
                await conn.execute("""
                    INSERT INTO device_groups (node_id, group_id, assigned_by)
                    VALUES ($1, $2, 'dynamic_rule')
                    ON CONFLICT DO NOTHING
                """, node['id'], UUID(group_id))
                added += 1
            elif not should_be_member and is_member:
                result = await conn.execute("""
                    DELETE FROM device_groups 
                    WHERE node_id = $1 AND group_id = $2 AND assigned_by = 'dynamic_rule'
                """, node['id'], UUID(group_id))
                if result != "DELETE 0":
                    removed += 1
        
        return {
            "status": "ok",
            "groupId": group_id,
            "groupName": group['name'],
            "added": added,
            "removed": removed,
            "evaluated": len(nodes)
        }


@router.post("/groups/{group_id}/members")
async def add_device_groups(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Add devices to a group"""
    node_ids = data.get("nodeIds", [])
    assigned_by = data.get("assignedBy", "api")
    
    if not node_ids:
        raise bad_request("nodeIds array is required", "nodeIds")
    
    async with db.acquire() as conn:
        # Verify group exists
        group = await conn.fetchrow("SELECT id FROM groups WHERE id = $1", UUID(group_id))
        if not group:
            raise not_found("Group", group_id)
        
        added = 0
        for node_id in node_ids:
            try:
                await conn.execute("""
                    INSERT INTO device_groups (node_id, group_id, assigned_by)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (node_id, group_id) DO NOTHING
                """, UUID(node_id), UUID(group_id), assigned_by)
                added += 1
            except Exception:
                pass  # Skip invalid UUIDs
        
        return {"status": "ok", "groupId": group_id, "added": added}


@router.delete("/groups/{group_id}/members")
async def remove_device_groups(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Remove devices from a group"""
    node_ids = data.get("nodeIds", [])
    
    if not node_ids:
        raise bad_request("nodeIds array is required", "nodeIds")
    
    async with db.acquire() as conn:
        removed = 0
        for node_id in node_ids:
            try:
                result = await conn.execute("""
                    DELETE FROM device_groups WHERE node_id = $1 AND group_id = $2
                """, UUID(node_id), UUID(group_id))
                if result != "DELETE 0":
                    removed += 1
            except Exception:
                pass
        
        return {"status": "ok", "groupId": group_id, "removed": removed}


@router.get("/tags")
async def list_tags(db: asyncpg.Pool = Depends(get_db)):
    """List all tags with usage counts"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT t.id, t.name, t.color, t.created_at,
                   COUNT(dt.node_id) as device_count
            FROM tags t
            LEFT JOIN device_tags dt ON t.id = dt.tag_id
            GROUP BY t.id
            ORDER BY t.name
        """)
        return {"tags": [dict(r) for r in rows]}


@router.post("/tags")
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


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a tag"""
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM tags WHERE id = $1", UUID(tag_id))
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Tag not found")
        return {"status": "deleted", "tagId": tag_id}


@router.post("/devices/{node_id}/tags")
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
        
        return {"status": "ok", "nodeId": node_id, "added": added}


@router.delete("/devices/{node_id}/tags")
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
        
        return {"status": "ok", "nodeId": node_id, "removed": removed}


@router.get("/devices/{node_id}/groups")
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


@router.get("/devices/{node_id}/tags")
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
