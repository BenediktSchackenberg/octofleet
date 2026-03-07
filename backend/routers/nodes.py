from fastapi import APIRouter, Depends, HTTPException, status, Request
import asyncpg
from typing import Optional, List, Dict, Any
from uuid import UUID
import uuid
import json
import secrets
import jwt
from datetime import datetime, timedelta
from dependencies import get_db, verify_api_key, require_scope, not_found, API_KEY
from auth import require_auth, require_permission

# Use the JWT secret from auth module
try:
    from auth import JWT_SECRET
except ImportError:
    JWT_SECRET = "fallback-secret-change-me"

router = APIRouter(
    prefix="/api/v1/nodes",
    tags=["nodes"],
    dependencies=[Depends(verify_api_key)]
)

# Router for registration (no auth required for initial register call)
pending_router = APIRouter(
    prefix="/api/v1",
    tags=["pending-nodes"]
)

def _get_os_family(os_name: str | None) -> str:
    """Determine OS family from OS name"""
    if not os_name:
        return "Unknown"
    os_lower = os_name.lower()
    if "windows" in os_lower:
        return "Windows"
    elif "ubuntu" in os_lower or "debian" in os_lower or "linux" in os_lower:
        return "Linux"
    elif "macos" in os_lower or "darwin" in os_lower:
        return "macOS"
    return "Other"

@router.get("")
async def list_nodes(
    unassigned: bool = False,
    group_id: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_db)
):
    """List all known nodes with summary info."""
    async with db.acquire() as conn:
        if unassigned:
            rows = await conn.fetch("""
                SELECT n.id, n.node_id, n.hostname, n.os_name, n.os_version, n.os_build, 
                       n.first_seen, n.last_seen, n.is_online, n.agent_version,
                       h.cpu->>'name' as cpu_name,
                       (h.ram->>'totalGb')::numeric as total_memory_gb
                FROM nodes n
                LEFT JOIN hardware_current h ON n.id = h.node_id
                WHERE NOT EXISTS (
                    SELECT 1 FROM device_groups dg WHERE dg.node_id::uuid = n.id::uuid
                )
                ORDER BY n.last_seen DESC
            """)
        elif group_id:
            rows = await conn.fetch("""
                SELECT n.id, n.node_id, n.hostname, n.os_name, n.os_version, n.os_build, 
                       n.first_seen, n.last_seen, n.is_online, n.agent_version,
                       h.cpu->>'name' as cpu_name,
                       (h.ram->>'totalGb')::numeric as total_memory_gb
                FROM nodes n
                LEFT JOIN hardware_current h ON n.id = h.node_id
                JOIN device_groups dg ON dg.node_id::uuid = n.id::uuid
                WHERE dg.group_id = $1::uuid
                ORDER BY n.last_seen DESC
            """, UUID(group_id))
        else:
            rows = await conn.fetch("""
                SELECT n.id, n.node_id, n.hostname, n.os_name, n.os_version, n.os_build, 
                       n.first_seen, n.last_seen, n.is_online, n.agent_version,
                       h.cpu->>'name' as cpu_name,
                       (h.ram->>'totalGb')::numeric as total_memory_gb
                FROM nodes n
                LEFT JOIN hardware_current h ON n.id = h.node_id
                ORDER BY n.last_seen DESC
            """)
        
        nodes_list = []
        for r in rows:
            node = dict(r)
            alert_counts = await conn.fetchrow("""
                SELECT 
                    COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'fired') as critical_count,
                    COUNT(*) FILTER (WHERE severity = 'warning' AND status = 'fired') as warning_count
                FROM alerts WHERE node_id = $1::uuid
            """, r['id'])
            
            critical = alert_counts['critical_count'] or 0
            warning = alert_counts['warning_count'] or 0
            
            if critical > 0:
                node['health_status'] = 'critical'
            elif warning > 0:
                node['health_status'] = 'warning'
            else:
                node['health_status'] = 'healthy'
            
            node['alert_count'] = critical + warning
            nodes_list.append(node)
        
        return {"nodes": nodes_list}

@router.get("/tree")
async def get_nodes_tree(db: asyncpg.Pool = Depends(get_db)):
    """Get nodes organized in a tree structure by groups/OS/version"""
    async with db.acquire() as conn:
        nodes = await conn.fetch("""
            SELECT n.node_id, n.hostname, n.os_name, n.os_version, n.last_seen, n.is_online,
                   COALESCE(
                       (SELECT array_agg(g.name) FROM groups g 
                        JOIN device_groups dg ON g.id = dg.group_id 
                        WHERE dg.node_id::uuid = n.id::uuid),
                       ARRAY[]::text[]
                   ) as group_names,
                   COALESCE(
                       (SELECT array_agg(g.id::text) FROM groups g 
                        JOIN device_groups dg ON g.id = dg.group_id 
                        WHERE dg.node_id::uuid = n.id::uuid),
                       ARRAY[]::text[]
                   ) as group_ids
            FROM nodes n
            ORDER BY n.hostname
        """)
        
        tree = {"groups": {}, "unassigned": {}}
        for node in nodes:
            node_data = {
                "node_id": node["node_id"],
                "hostname": node["hostname"],
                "os_name": node["os_name"] or "Unknown",
                "os_version": node["os_version"] or "Unknown",
                "last_seen": node["last_seen"].isoformat() if node["last_seen"] else None,
                "is_online": node["is_online"]
            }
            
            if node["last_seen"]:
                now = datetime.utcnow()
                diff_minutes = (now - node["last_seen"].replace(tzinfo=None)).total_seconds() / 60
                if diff_minutes < 5:
                    node_data["status"] = "online"
                elif diff_minutes < 60:
                    node_data["status"] = "away"
                else:
                    node_data["status"] = "offline"
            else:
                node_data["status"] = "offline"
            
            os_family = _get_os_family(node["os_name"])
            os_version = node["os_version"] or "Unknown"
            
            if node["group_names"] and len(node["group_names"]) > 0:
                for i, group_name in enumerate(node["group_names"]):
                    group_id = node["group_ids"][i] if i < len(node["group_ids"]) else group_name
                    if group_name not in tree["groups"]:
                        tree["groups"][group_name] = {"id": group_id, "os_families": {}}
                    if os_family not in tree["groups"][group_name]["os_families"]:
                        tree["groups"][group_name]["os_families"][os_family] = {}
                    if os_version not in tree["groups"][group_name]["os_families"][os_family]:
                        tree["groups"][group_name]["os_families"][os_family][os_version] = []
                    tree["groups"][group_name]["os_families"][os_family][os_version].append(node_data)
            else:
                if os_family not in tree["unassigned"]:
                    tree["unassigned"][os_family] = {}
                if os_version not in tree["unassigned"][os_family]:
                    tree["unassigned"][os_family][os_version] = []
                tree["unassigned"][os_family][os_version].append(node_data)
        
        return tree

@router.get("/search")
async def search_nodes(q: str, limit: int = 20, db: asyncpg.Pool = Depends(get_db)):
    """Search nodes by name, hostname, IP, or node_id"""
    if len(q) < 2:
        return {"nodes": []}
    
    search_term = f"%{q}%"
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.node_id, n.hostname, n.os_name, n.os_version, n.last_seen
            FROM nodes n
            WHERE n.hostname ILIKE $1 
               OR n.node_id ILIKE $1
            ORDER BY 
                CASE WHEN n.hostname ILIKE $2 THEN 0 ELSE 1 END,
                n.last_seen DESC
            LIMIT $3
        """, search_term, f"{q}%", limit)
        
        results = []
        for row in rows:
            node = dict(row)
            if row["last_seen"]:
                now = datetime.utcnow()
                diff_minutes = (now - row["last_seen"].replace(tzinfo=None)).total_seconds() / 60
                if diff_minutes < 5:
                    node["status"] = "online"
                elif diff_minutes < 60:
                    node["status"] = "away"
                else:
                    node["status"] = "offline"
            else:
                node["status"] = "offline"
            node["last_seen"] = row["last_seen"].isoformat() if row["last_seen"] else None
            results.append(node)
        
        return {"nodes": results}

@router.get("/os-distribution")
async def get_os_distribution(db: asyncpg.Pool = Depends(get_db)):
    """Get OS distribution for pie chart"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                COALESCE(os_name, 'Unknown') as os_name,
                COALESCE(os_version, '') as os_version,
                COUNT(*) as count
            FROM nodes
            GROUP BY os_name, os_version
            ORDER BY count DESC
        """)
        
        by_os = {}
        for row in rows:
            os_name = row["os_name"] or "Unknown"
            if os_name not in by_os:
                by_os[os_name] = {"count": 0, "versions": []}
            by_os[os_name]["count"] += row["count"]
            if row["os_version"]:
                by_os[os_name]["versions"].append({
                    "version": row["os_version"],
                    "count": row["count"]
                })
        
        return {
            "distribution": [
                {"name": k, "count": v["count"], "versions": v["versions"]}
                for k, v in by_os.items()
            ]
        }

@router.get("/{node_id}")
async def get_node_detail(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get detailed info for a single node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("""
            SELECT id, node_id, hostname, os_name, os_version, os_build, 
                   first_seen, last_seen, is_online, agent_version, created_at, updated_at
            FROM nodes WHERE node_id = $1 OR id::text = $1
        """, node_id)
        
        if not node:
            raise not_found("Node", node_id)
        
        node_uuid = node['id']
        result = dict(node)
        
        # Get hardware summary
        hw = await conn.fetchrow("""
            SELECT cpu->>'name' as cpu_name,
                   (ram->>'totalGb')::numeric as total_memory_gb,
                   updated_at as hardware_updated_at
            FROM hardware_current WHERE node_id = $1
        """, node_uuid)
        if hw:
            result['cpuName'] = hw['cpu_name']
            result['totalMemoryGb'] = float(hw['total_memory_gb']) if hw['total_memory_gb'] else None
            result['hardwareUpdatedAt'] = hw['hardware_updated_at'].isoformat() if hw['hardware_updated_at'] else None
        
        # Get software count
        sw_count = await conn.fetchval(
            "SELECT COUNT(*) FROM software_current WHERE node_id = $1", node_uuid)
        result['softwareCount'] = sw_count
        
        # Get groups
        groups = await conn.fetch("""
            SELECT g.id, g.name, g.color, g.icon
            FROM device_groups dg
            JOIN groups g ON dg.group_id = g.id
            WHERE dg.node_id = $1
        """, node_uuid)
        result['groups'] = [dict(g) for g in groups]
        
        # Get tags
        tags = await conn.fetch("""
            SELECT t.id, t.name, t.color
            FROM device_tags dt
            JOIN tags t ON dt.tag_id = t.id
            WHERE dt.node_id = $1
        """, node_uuid)
        result['tags'] = [dict(t) for t in tags]
        
        return result

@router.get("/{node_id}/history")
async def get_node_history(node_id: str, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    """Get change history for a node (hardware snapshots)"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
        node_uuid = node['id']
        changes = await conn.fetch("""
            SELECT time as detected_at, change_type, component as category, 
                   old_value, new_value
            FROM hardware_changes 
            WHERE node_id = $1
            ORDER BY time DESC
            LIMIT $2
        """, node_uuid, limit)
        
        result = []
        for i, change in enumerate(changes):
            result.append({
                "id": i + 1,
                "category": change['category'] or "hardware",
                "changeType": change['change_type'] or "snapshot",
                "fieldName": None,
                "oldValue": json.dumps(change['old_value'])[:100] if change['old_value'] else None,
                "newValue": json.dumps(change['new_value'])[:100] if change['new_value'] else None,
                "detectedAt": change['detected_at'].isoformat() if change['detected_at'] else None
            })
        
        return {"changes": result}

# --- Pending Nodes Endpoints ---

@pending_router.post("/nodes/register")
async def register_pending_node(request: Request, db: asyncpg.Pool = Depends(get_db)):
    """Register a new node as pending approval"""
    data = await request.json()
    hostname = data.get("hostname", "Unknown")
    os_name = data.get("osName")
    os_version = data.get("osVersion")
    agent_version = data.get("agentVersion")
    machine_id = data.get("machineId")
    ip_address = request.client.host if request.client else None
    
    async with db.acquire() as conn:
        existing = None
        if machine_id:
            existing = await conn.fetchrow("SELECT id, status FROM pending_nodes WHERE machine_id = $1", machine_id)
        if not existing:
            existing = await conn.fetchrow("SELECT id, status FROM pending_nodes WHERE hostname = $1 AND ip_address = $2", hostname, ip_address)
        
        if existing:
            return {"status": existing['status'], "pendingId": str(existing['id']), "message": f"Node already registered"}
        
        pending_id = await conn.fetchval("""
            INSERT INTO pending_nodes (hostname, os_name, os_version, ip_address, agent_version, machine_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        """, hostname, os_name, os_version, ip_address, agent_version, machine_id)
        
        return {"status": "pending", "pendingId": str(pending_id), "message": f"Node {hostname} registered"}

@pending_router.get("/pending-nodes", dependencies=[Depends(require_auth)])
async def list_pending_nodes(db: asyncpg.Pool = Depends(get_db)):
    """List all pending nodes"""
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT id, hostname, os_name, os_version, ip_address, agent_version, machine_id, status, created_at FROM pending_nodes WHERE status = 'pending' ORDER BY created_at DESC")
        return {"pending": [{"id": str(r['id']), "hostname": r['hostname'], "osName": r['os_name'], "osVersion": r['os_version'], "ipAddress": r['ip_address'], "agentVersion": r['agent_version'], "machineId": r['machine_id'], "createdAt": r['created_at'].isoformat() if r['created_at'] else None} for r in rows]}

@pending_router.post("/pending-nodes/{pending_id}/approve", dependencies=[Depends(require_permission("nodes:write"))])
async def approve_pending_node(pending_id: str, request: Request, db: asyncpg.Pool = Depends(get_db)):
    """Approve a pending node"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM pending_nodes WHERE id = $1 AND status = 'pending'", uuid.UUID(pending_id))
        if not row: raise HTTPException(status_code=404, detail="Pending node not found")
        
        node_api_key = secrets.token_urlsafe(32)
        approver = "admin"
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                payload = jwt.decode(auth_header[7:], JWT_SECRET, algorithms=["HS256"])
                approver = payload.get("sub", "admin")
            except: pass
        
        await conn.execute("UPDATE pending_nodes SET status = 'approved', approved_at = NOW(), approved_by = $2, generated_api_key = $3 WHERE id = $1", uuid.UUID(pending_id), approver, node_api_key)
        return {"status": "approved", "nodeId": pending_id, "hostname": row['hostname']}

@pending_router.delete("/pending-nodes/{pending_id}/reject", dependencies=[Depends(require_permission("nodes:write"))])
async def reject_pending_node(pending_id: str, request: Request, db: asyncpg.Pool = Depends(get_db)):
    """Reject a pending node"""
    async with db.acquire() as conn:
        rejecter = "admin"
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                payload = jwt.decode(auth_header[7:], JWT_SECRET, algorithms=["HS256"])
                rejecter = payload.get("sub", "admin")
            except: pass
        
        result = await conn.execute("UPDATE pending_nodes SET status = 'rejected', rejected_at = NOW(), rejected_by = $2 WHERE id = $1 AND status = 'pending'", uuid.UUID(pending_id), rejecter)
        if result == "UPDATE 0": raise HTTPException(status_code=404, detail="Pending node not found")
        return {"status": "rejected"}

@pending_router.get("/pending-nodes/{pending_id}/config")
async def get_pending_node_config(pending_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Agent polls this for config"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM pending_nodes WHERE id = $1", uuid.UUID(pending_id))
        if not row: raise HTTPException(status_code=404, detail="Unknown pending ID")
        if row['status'] == 'pending': return {"status": "pending"}
        if row['status'] == 'rejected': return {"status": "rejected"}
        if row['status'] == 'approved':
            if not row['config_fetched_at']: await conn.execute("UPDATE pending_nodes SET config_fetched_at = NOW() WHERE id = $1", uuid.UUID(pending_id))
            return {"status": "approved", "config": {"InventoryApiUrl": "http://192.168.0.5:8080", "InventoryApiKey": row['generated_api_key'] or API_KEY, "DisplayName": row['hostname'], "AutoPushInventory": True, "ScheduledPushEnabled": True, "ScheduledPushIntervalMinutes": 30}}
    return {"status": "unknown"}
