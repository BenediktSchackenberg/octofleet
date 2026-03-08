import json
from uuid import UUID

import asyncpg

from app.core.rules import evaluate_dynamic_rule


async def update_dynamic_device_groupships(db: asyncpg.Pool, node_uuid: UUID, node_data: dict):
    """
    Evaluate all dynamic groups for a node and update memberships.
    Called after a node checks in with inventory data.
    """
    async with db.acquire() as conn:
        # Get node's tags for has_tag evaluations
        tags = await conn.fetch("""
            SELECT t.name FROM device_tags dt
            JOIN tags t ON dt.tag_id = t.id
            WHERE dt.node_id = $1
        """, node_uuid)
        node_data["tags"] = [t['name'] for t in tags]
        
        # Get all dynamic groups
        dynamic_groups = await conn.fetch("""
            SELECT id, name, dynamic_rule FROM groups WHERE is_dynamic = true AND dynamic_rule IS NOT NULL
        """)
        
        for group in dynamic_groups:
            group_id = group['id']
            rule = group['dynamic_rule']
            
            # Parse rule if it's a string
            if isinstance(rule, str):
                try:
                    rule = json.loads(rule)
                except json.JSONDecodeError:
                    continue
            
            should_be_member = evaluate_dynamic_rule(rule, node_data)
            
            # Check current membership
            is_member = await conn.fetchval("""
                SELECT 1 FROM device_groups WHERE node_id = $1 AND group_id = $2
            """, node_uuid, group_id)
            
            if should_be_member and not is_member:
                # Add to group
                await conn.execute("""
                    INSERT INTO device_groups (node_id, group_id, assigned_by)
                    VALUES ($1, $2, 'dynamic_rule')
                    ON CONFLICT (node_id, group_id) DO NOTHING
                """, node_uuid, group_id)
            elif not should_be_member and is_member:
                # Remove from group (only if it was auto-assigned)
                await conn.execute("""
                    DELETE FROM device_groups 
                    WHERE node_id = $1 AND group_id = $2 AND assigned_by = 'dynamic_rule'
                """, node_uuid, group_id)


async def auto_onboard_node(conn, node_id: str, node_uuid: UUID):
    """
    Auto-assign new node to onboarding group.
    Called when a new node registers for the first time.
    """
    # Check onboarding config
    config = await conn.fetchrow("""
        SELECT onboarding_group_id, auto_assign_new_nodes
        FROM onboarding_config
        LIMIT 1
    """)
    
    if not config or not config["auto_assign_new_nodes"] or not config["onboarding_group_id"]:
        return None
    
    # Add to onboarding group
    try:
        await conn.execute("""
            INSERT INTO device_groups (node_id, group_id, assigned_by)
            VALUES ($1::uuid, $2::uuid, 'auto-onboarding')
            ON CONFLICT DO NOTHING
        """, node_uuid, config["onboarding_group_id"])
        
        return {
            "groupId": str(config["onboarding_group_id"]),
            "action": "auto-onboarded"
        }
    except Exception as e:
        return {"error": str(e)}


async def upsert_node(db: asyncpg.Pool, node_id: str, hostname: str, 
                      os_name: str = None, os_version: str = None, os_build: str = None) -> UUID:
    """Insert or update node, return UUID. Auto-onboards new nodes."""
    async with db.acquire() as conn:
        # Check if node exists
        existing = await conn.fetchval("SELECT id FROM nodes WHERE node_id = $1", node_id)
        is_new = existing is None
        
        row = await conn.fetchrow("""
            INSERT INTO nodes (node_id, hostname, os_name, os_version, os_build, last_seen, is_online)
            VALUES ($1, $2, $3, $4, $5, NOW(), true)
            ON CONFLICT (node_id) DO UPDATE SET
                hostname = $2,
                os_name = COALESCE($3, nodes.os_name),
                os_version = COALESCE($4, nodes.os_version),
                os_build = COALESCE($5, nodes.os_build),
                last_seen = NOW(),
                is_online = true,
                updated_at = NOW()
            RETURNING id
        """, node_id, hostname, os_name, os_version, os_build)
        
        node_uuid = row['id']
        
        # Auto-onboard new nodes
        if is_new:
            try:
                await auto_onboard_node(conn, node_id, node_uuid)
            except Exception:
                # Don't fail registration if onboarding fails
                pass
        
        return node_uuid
