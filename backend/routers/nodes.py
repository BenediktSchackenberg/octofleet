from fastapi import APIRouter, Depends, HTTPException, status
import asyncpg
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from dependencies import get_db, verify_api_key

router = APIRouter(
    prefix="/api/v1/nodes",
    tags=["nodes"],
    dependencies=[Depends(verify_api_key)]
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
                    SELECT 1 FROM device_groups dg WHERE dg.node_id = n.id
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
                JOIN device_groups dg ON dg.node_id = n.id
                WHERE dg.group_id = $1
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
                        WHERE dg.node_id = n.id),
                       ARRAY[]::text[]
                   ) as group_names,
                   COALESCE(
                       (SELECT array_agg(g.id::text) FROM groups g 
                        JOIN device_groups dg ON g.id = dg.group_id 
                        WHERE dg.node_id = n.id),
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
