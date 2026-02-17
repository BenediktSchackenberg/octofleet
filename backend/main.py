"""
Octofleet Inventory Backend
FastAPI server for receiving and storing inventory data from Windows Agents
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Header, status, Request, BackgroundTasks, Body, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncpg
from typing import Optional, Any, Dict
import os
import json
import time
from uuid import UUID
import uuid
import re
import secrets
from datetime import datetime, timedelta

# E7: Alerting imports
from alerting import get_alert_manager, update_node_health, check_node_health

# Config
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://octofleet:octofleet_inventory_2026@127.0.0.1:5432/inventory"
)
API_KEY = os.getenv("INVENTORY_API_KEY", "octofleet-inventory-dev-key")
GATEWAY_URL = os.getenv("OCTOFLEET_GATEWAY_URL", "http://192.168.0.5:18789")
GATEWAY_TOKEN = os.getenv("OCTOFLEET_GATEWAY_TOKEN", "")
INVENTORY_API_URL = os.getenv("OCTOFLEET_INVENTORY_URL", "http://192.168.0.5:8080")

# Database pool
db_pool: Optional[asyncpg.Pool] = None


def sanitize_for_postgres(value: Any) -> Any:
    """Remove null bytes and other problematic characters from strings"""
    if value is None:
        return None
    if isinstance(value, str):
        # Remove null bytes that PostgreSQL can't handle
        return value.replace('\x00', '').replace('\u0000', '')
    if isinstance(value, dict):
        return {k: sanitize_for_postgres(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_for_postgres(item) for item in value]
    return value


def parse_datetime(value: str | None) -> Any:
    """Parse datetime string to timestamp or None"""
    if not value:
        return None
    try:
        from datetime import datetime
        # Try ISO format first
        if 'T' in value:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        # Try common date formats
        for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%m/%d/%Y']:
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        return None
    except Exception:
        return None


async def get_db() -> asyncpg.Pool:
    """Dependency to get database pool"""
    if db_pool is None:
        raise HTTPException(status_code=503, detail="Database not available")
    return db_pool


async def verify_api_key(
    x_api_key: str = Header(None),
    authorization: str = Header(None)
):
    """Verify API key or JWT token from header"""
    # Check JWT Bearer token first
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            import jwt
            from auth import JWT_SECRET
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            return payload  # Valid JWT
        except Exception:
            pass  # Fall through to API key check
    
    # Check X-API-Key
    if x_api_key == API_KEY:
        return x_api_key
    
    # Neither valid
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid API key or token"
    )


async def verify_api_key_or_query(
    request: Request,
    x_api_key: str = Header(None),
    authorization: str = Header(None),
):
    """Verify API key or JWT token from header OR query param (for SSE)"""
    # Check query param token first (for EventSource which can't send headers)
    token = request.query_params.get("token")
    if token:
        # First check if it's the API key
        if token == API_KEY:
            return token
        
        # Then try JWT
        try:
            import jwt
            from auth import JWT_SECRET
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            return payload  # Valid JWT from query
        except Exception:
            pass
    
    # Check JWT Bearer token
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization[7:]
        try:
            import jwt
            from auth import JWT_SECRET
            payload = jwt.decode(auth_token, JWT_SECRET, algorithms=["HS256"])
            return payload
        except Exception:
            pass
    
    # Check X-API-Key
    if x_api_key == API_KEY:
        return x_api_key
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid API key or token"
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    global db_pool
    # Startup
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    print(f"✅ Database pool created")
    yield
    # Shutdown
    if db_pool:
        await db_pool.close()
        print("Database pool closed")


# Create app
app = FastAPI(
    title="Octofleet API",
    description="Receives and stores inventory data from Windows Agents",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# === Helper Functions ===

def evaluate_dynamic_rule(rule: dict, node_data: dict) -> bool:
    """
    Evaluate a dynamic group rule against node data.
    
    Rule format:
    {
        "operator": "AND" | "OR",
        "conditions": [
            { "field": "os_name", "op": "equals|contains|startswith|endswith|gte|lte|gt|lt", "value": "..." },
            ...
        ]
    }
    
    Supported fields:
    - os_name, os_version, os_build, hostname, agent_version
    - tags (special: checks if node has tag)
    - cpu_name, total_memory_gb (from hardware)
    """
    if not rule or not isinstance(rule, dict):
        return False
    
    operator = rule.get("operator", "AND").upper()
    conditions = rule.get("conditions", [])
    
    if not conditions:
        return False
    
    results = []
    for cond in conditions:
        field = cond.get("field", "")
        op = cond.get("op", "equals")
        value = cond.get("value", "")
        
        # Get node field value
        node_value = node_data.get(field)
        if node_value is None:
            node_value = ""
        
        # Convert to string for comparison
        node_value_str = str(node_value).lower()
        value_str = str(value).lower()
        
        # Evaluate condition
        match = False
        try:
            if op == "equals":
                match = node_value_str == value_str
            elif op == "contains":
                match = value_str in node_value_str
            elif op == "startswith":
                match = node_value_str.startswith(value_str)
            elif op == "endswith":
                match = node_value_str.endswith(value_str)
            elif op == "gte":
                match = float(node_value) >= float(value)
            elif op == "lte":
                match = float(node_value) <= float(value)
            elif op == "gt":
                match = float(node_value) > float(value)
            elif op == "lt":
                match = float(node_value) < float(value)
            elif op == "regex":
                match = bool(re.search(value, str(node_value), re.IGNORECASE))
            elif op == "not_equals":
                match = node_value_str != value_str
            elif op == "not_contains":
                match = value_str not in node_value_str
            elif op == "has_tag":
                # Special: check if node has specific tag
                tags = node_data.get("tags", [])
                match = value_str in [t.lower() for t in tags]
        except (ValueError, TypeError):
            match = False
        
        results.append(match)
    
    # Combine results
    if operator == "AND":
        return all(results)
    else:  # OR
        return any(results)


async def update_dynamic_group_memberships(db: asyncpg.Pool, node_uuid: UUID, node_data: dict):
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


async def upsert_node(db: asyncpg.Pool, node_id: str, hostname: str, 
                      os_name: str = None, os_version: str = None, os_build: str = None) -> UUID:
    """Insert or update node, return UUID"""
    async with db.acquire() as conn:
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
        return row['id']


# === API Endpoints ===

@app.get("/api/v1/test-sse")
async def test_sse():
    async def generate():
        for i in range(5):
            yield f"event: tick\ndata: {i}\n\n"
            await asyncio.sleep(1)
        yield f"event: done\ndata: finished\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "ok", "service": "octofleet", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "service": "octofleet", "database": str(e)}


@app.get("/api/v1/test-sse")
async def test_sse():
    async def generate():
        for i in range(5):
            yield f"event: tick\ndata: {i}\n\n"
            await asyncio.sleep(1)
        yield f"event: done\ndata: finished\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/v1/health")
async def api_health_check():
    """Health check endpoint (API versioned path)"""
    return await health_check()


# Agent version management
AGENT_LATEST_VERSION = "0.4.16"
AGENT_DOWNLOAD_URL = f"https://github.com/BenediktSchackenberg/octofleet-windows-agent/releases/download/v{AGENT_LATEST_VERSION}/OctofleetAgent-v{AGENT_LATEST_VERSION}-win-x64.zip"
AGENT_RELEASE_NOTES = "Auto-remediation, vulnerability tracking, improved stability"

@app.get("/api/v1/agent/version")
async def get_agent_version():
    """Get the latest agent version for auto-update"""
    # Try to get from database first
    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT 
                    (SELECT value FROM system_settings WHERE key = 'agent_latest_version') as version,
                    (SELECT value FROM system_settings WHERE key = 'agent_download_url') as url,
                    (SELECT value FROM system_settings WHERE key = 'agent_release_notes') as notes
            """)
            if row and row['version']:
                return {
                    "latestVersion": row['version'],
                    "downloadUrl": row['url'] or AGENT_DOWNLOAD_URL,
                    "releaseNotes": row['notes'] or AGENT_RELEASE_NOTES
                }
    except:
        pass
    # Fallback to hardcoded values
    return {
        "latestVersion": AGENT_LATEST_VERSION,
        "downloadUrl": AGENT_DOWNLOAD_URL,
        "releaseNotes": AGENT_RELEASE_NOTES
    }


@app.get("/api/v1/nodes")
async def list_nodes(
    unassigned: bool = False,
    group_id: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_db)
):
    """List all known nodes with summary info.
    
    Query params:
    - unassigned=true: Only return nodes without any group assignment
    - group_id=<uuid>: Only return nodes in the specified group
    """
    async with db.acquire() as conn:
        if unassigned:
            # Only nodes without any group
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
            # Only nodes in specific group
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
            # All nodes
            rows = await conn.fetch("""
                SELECT n.id, n.node_id, n.hostname, n.os_name, n.os_version, n.os_build, 
                       n.first_seen, n.last_seen, n.is_online, n.agent_version,
                       h.cpu->>'name' as cpu_name,
                       (h.ram->>'totalGb')::numeric as total_memory_gb
                FROM nodes n
                LEFT JOIN hardware_current h ON n.id = h.node_id
                ORDER BY n.last_seen DESC
            """)
        
        # Enrich with health info
        nodes_list = []
        for r in rows:
            node = dict(r)
            # Get active alerts count for this node
            alert_counts = await conn.fetchrow("""
                SELECT 
                    COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'fired') as critical_count,
                    COUNT(*) FILTER (WHERE severity = 'warning' AND status = 'fired') as warning_count
                FROM alerts WHERE node_id = $1
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


@app.get("/api/v1/nodes/tree")
async def get_nodes_tree(db: asyncpg.Pool = Depends(get_db)):
    """Get nodes organized in a tree structure by groups/OS/version"""
    async with db.acquire() as conn:
        # Get all nodes with their groups
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
        
        # Build tree structure
        tree = {
            "groups": {},
            "unassigned": {}
        }
        
        for node in nodes:
            node_data = {
                "node_id": node["node_id"],
                "hostname": node["hostname"],
                "os_name": node["os_name"] or "Unknown",
                "os_version": node["os_version"] or "Unknown",
                "last_seen": node["last_seen"].isoformat() if node["last_seen"] else None,
                "is_online": node["is_online"]
            }
            
            # Calculate status
            if node["last_seen"]:
                now = datetime.now(node["last_seen"].tzinfo) if node["last_seen"].tzinfo else datetime.utcnow()
                diff_minutes = (now - node["last_seen"]).total_seconds() / 60
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
                # Node belongs to groups
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
                # Unassigned node
                if os_family not in tree["unassigned"]:
                    tree["unassigned"][os_family] = {}
                if os_version not in tree["unassigned"][os_family]:
                    tree["unassigned"][os_family][os_version] = []
                tree["unassigned"][os_family][os_version].append(node_data)
        
        return tree


@app.get("/api/v1/nodes/search")
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
                now = datetime.now(row["last_seen"].tzinfo) if row["last_seen"].tzinfo else datetime.utcnow()
                diff_minutes = (now - row["last_seen"]).total_seconds() / 60
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


# OS Distribution - MUST be before /api/v1/nodes/{node_id} to avoid route collision
@app.get("/api/v1/nodes/os-distribution", dependencies=[Depends(verify_api_key)])
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
        
        # Group by OS name
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


@app.get("/api/v1/dashboard/summary")
async def get_dashboard_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get dashboard summary with counts and recent events"""
    async with db.acquire() as conn:
        # Get node counts by status
        counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '5 minutes') as online,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '60 minutes' 
                                   AND last_seen <= NOW() - INTERVAL '5 minutes') as away,
                COUNT(*) FILTER (WHERE last_seen <= NOW() - INTERVAL '60 minutes' 
                                   OR last_seen IS NULL) as offline
            FROM nodes
        """)
        
        # Get unassigned count
        unassigned = await conn.fetchval("""
            SELECT COUNT(*) FROM nodes n
            WHERE NOT EXISTS (
                SELECT 1 FROM device_groups dg WHERE dg.node_id = n.id
            )
        """)
        
        # Get vulnerability counts by severity
        vuln_counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE severity = 'CRITICAL') as critical,
                COUNT(*) FILTER (WHERE severity = 'HIGH') as high,
                COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium,
                COUNT(*) FILTER (WHERE severity = 'LOW') as low
            FROM vulnerabilities
        """)
        
        # Get job stats (last 24h)
        job_stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'success') as success,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'running') as running,
                COUNT(*) FILTER (WHERE status = 'pending') as pending
            FROM job_instances
            WHERE created_at > NOW() - INTERVAL '24 hours'
        """)
        
        # Get active alerts count
        active_alerts = await conn.fetchval("""
            SELECT COUNT(*) FROM alerts WHERE status = 'active'
        """) or 0
        
        # Get recent events (last 10)
        events = await conn.fetch("""
            SELECT 
                'node_seen' as event_type,
                hostname as subject,
                node_id as subject_id,
                last_seen as timestamp
            FROM nodes
            ORDER BY last_seen DESC
            LIMIT 10
        """)
        
        return {
            "counts": {
                "total": counts["total"],
                "online": counts["online"],
                "away": counts["away"],
                "offline": counts["offline"],
                "unassigned": unassigned
            },
            "vulnerabilities": {
                "total": vuln_counts["total"] if vuln_counts else 0,
                "critical": vuln_counts["critical"] if vuln_counts else 0,
                "high": vuln_counts["high"] if vuln_counts else 0,
                "medium": vuln_counts["medium"] if vuln_counts else 0,
                "low": vuln_counts["low"] if vuln_counts else 0
            },
            "jobs": {
                "total": job_stats["total"] if job_stats else 0,
                "success": job_stats["success"] if job_stats else 0,
                "failed": job_stats["failed"] if job_stats else 0,
                "running": job_stats["running"] if job_stats else 0,
                "pending": job_stats["pending"] if job_stats else 0
            },
            "alerts": {
                "active": active_alerts
            },
            "recent_events": [
                {
                    "type": e["event_type"],
                    "subject": e["subject"],
                    "subject_id": e["subject_id"],
                    "timestamp": e["timestamp"].isoformat() if e["timestamp"] else None
                }
                for e in events
            ]
        }


@app.get("/api/v1/nodes/{node_id}")
async def get_node_detail(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get detailed info for a single node"""
    async with db.acquire() as conn:
        # Get node basic info
        node = await conn.fetchrow("""
            SELECT id, node_id, hostname, os_name, os_version, os_build, 
                   first_seen, last_seen, is_online, agent_version, created_at, updated_at
            FROM nodes WHERE node_id = $1 OR id::text = $1
        """, node_id)
        
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
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


@app.get("/api/v1/nodes/{node_id}/history")
async def get_node_history(node_id: str, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    """Get change history for a node (hardware snapshots)"""
    async with db.acquire() as conn:
        # Get node UUID
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        node_uuid = node['id']
        
        # Get hardware change history
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


@app.get("/api/v1/inventory/hardware/{node_id}")
async def get_hardware(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get hardware data for a node"""
    async with db.acquire() as conn:
        # Find node by node_id string or UUID
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        row = await conn.fetchrow("""
            SELECT cpu, ram, disks, mainboard, bios, gpu, nics, virtualization, updated_at
            FROM hardware_current WHERE node_id = $1
        """, node['id'])
        
        if not row:
            return {"data": None}
        
        return {"data": {
            "cpu": json.loads(row['cpu']) if row['cpu'] else {},
            "ram": json.loads(row['ram']) if row['ram'] else {},
            "disks": json.loads(row['disks']) if row['disks'] else {},
            "mainboard": json.loads(row['mainboard']) if row['mainboard'] else {},
            "bios": json.loads(row['bios']) if row['bios'] else {},
            "gpu": json.loads(row['gpu']) if row['gpu'] else [],
            "nics": json.loads(row['nics']) if row['nics'] else [],
            "virtualization": json.loads(row['virtualization']) if row['virtualization'] else None,
            "updatedAt": row['updated_at'].isoformat() if row['updated_at'] else None
        }}


@app.get("/api/v1/hardware/fleet")
async def get_fleet_hardware(db: asyncpg.Pool = Depends(get_db)):
    """Get aggregated hardware data across all nodes for fleet dashboard"""
    async with db.acquire() as conn:
        # Get all hardware data
        rows = await conn.fetch("""
            SELECT n.id, n.hostname, n.node_id, n.last_seen,
                   h.cpu, h.ram, h.disks, h.gpu, h.updated_at
            FROM nodes n
            LEFT JOIN hardware_current h ON n.id = h.node_id
            WHERE n.last_seen > NOW() - INTERVAL '30 days'
        """)
        
        # Aggregations
        cpu_types = {}
        ram_distribution = {"8GB": 0, "16GB": 0, "32GB": 0, "64GB+": 0}
        total_storage_tb = 0
        total_free_storage_tb = 0
        disk_health = {"healthy": 0, "warning": 0, "critical": 0}
        physical_disk_health = {"healthy": 0, "warning": 0, "unhealthy": 0, "unknown": 0}
        disk_types = {"ssd": 0, "hdd": 0, "unknown": 0}
        bus_types = {}
        physical_disks = []
        nodes_with_issues = []
        
        for row in rows:
            # CPU aggregation
            if row['cpu']:
                cpu = json.loads(row['cpu'])
                cpu_name = cpu.get('name', 'Unknown')
                # Normalize CPU name
                cpu_short = cpu_name.split('@')[0].strip() if '@' in cpu_name else cpu_name
                cpu_types[cpu_short] = cpu_types.get(cpu_short, 0) + 1
            
            # RAM aggregation
            if row['ram']:
                ram = json.loads(row['ram'])
                total_gb = ram.get('totalGB', 0)
                if total_gb >= 64:
                    ram_distribution["64GB+"] += 1
                elif total_gb >= 32:
                    ram_distribution["32GB"] += 1
                elif total_gb >= 16:
                    ram_distribution["16GB"] += 1
                else:
                    ram_distribution["8GB"] += 1
            
            # Storage aggregation
            if row['disks']:
                disks = json.loads(row['disks'])
                # Handle both dict with 'volumes' key and direct list
                volumes = []
                physical = []
                if isinstance(disks, dict):
                    volumes = disks.get('volumes', [])
                    physical = disks.get('physical', [])
                elif isinstance(disks, list):
                    volumes = disks
                
                # Process physical disks (SMART data)
                for pdisk in physical:
                    if not isinstance(pdisk, dict):
                        continue
                    
                    health = (pdisk.get('healthStatus') or 'unknown').lower()
                    if health == 'healthy':
                        physical_disk_health['healthy'] += 1
                    elif health == 'warning':
                        physical_disk_health['warning'] += 1
                        nodes_with_issues.append({
                            "nodeId": row['node_id'],
                            "hostname": row['hostname'],
                            "issue": f"Disk {pdisk.get('model', '?')} health warning",
                            "severity": "warning"
                        })
                    elif health == 'unhealthy':
                        physical_disk_health['unhealthy'] += 1
                        nodes_with_issues.append({
                            "nodeId": row['node_id'],
                            "hostname": row['hostname'],
                            "issue": f"Disk {pdisk.get('model', '?')} UNHEALTHY!",
                            "severity": "critical"
                        })
                    else:
                        physical_disk_health['unknown'] += 1
                    
                    # SSD vs HDD
                    is_ssd = pdisk.get('isSsd')
                    if is_ssd is True:
                        disk_types['ssd'] += 1
                    elif is_ssd is False:
                        disk_types['hdd'] += 1
                    else:
                        disk_types['unknown'] += 1
                    
                    # Bus types
                    bus = pdisk.get('busType', 'Unknown')
                    bus_types[bus] = bus_types.get(bus, 0) + 1
                    
                    # Track individual physical disks
                    physical_disks.append({
                        "nodeId": row['node_id'],
                        "hostname": row['hostname'],
                        "model": pdisk.get('model'),
                        "sizeGB": pdisk.get('sizeGB', 0),
                        "busType": bus,
                        "isSsd": is_ssd,
                        "healthStatus": pdisk.get('healthStatus', 'Unknown'),
                        "temperature": pdisk.get('temperature'),
                        "wearLevel": pdisk.get('wearLevel')
                    })
                
                for vol in volumes:
                    if not isinstance(vol, dict):
                        continue
                    size_gb = vol.get('sizeGB', 0)
                    free_gb = vol.get('freeGB', 0)
                    total_storage_tb += size_gb / 1024
                    total_free_storage_tb += free_gb / 1024
                    
                    # Check disk health
                    used_percent = vol.get('usedPercent', 0)
                    if used_percent > 95:
                        disk_health["critical"] += 1
                        nodes_with_issues.append({
                            "nodeId": row['node_id'],
                            "hostname": row['hostname'],
                            "issue": f"Disk {vol.get('driveLetter', '?')} at {used_percent:.0f}% full",
                            "severity": "critical"
                        })
                    elif used_percent > 85:
                        disk_health["warning"] += 1
                        nodes_with_issues.append({
                            "nodeId": row['node_id'],
                            "hostname": row['hostname'],
                            "issue": f"Disk {vol.get('driveLetter', '?')} at {used_percent:.0f}% full",
                            "severity": "warning"
                        })
                    else:
                        disk_health["healthy"] += 1
        
        # Sort CPU types by count
        top_cpus = sorted(cpu_types.items(), key=lambda x: x[1], reverse=True)[:10]
        top_bus_types = sorted(bus_types.items(), key=lambda x: x[1], reverse=True)
        
        # Sort physical disks by health (unhealthy first), then by hostname
        physical_disks.sort(key=lambda d: (
            0 if d['healthStatus'] == 'Unhealthy' else 1 if d['healthStatus'] == 'Warning' else 2,
            d['hostname']
        ))
        
        return {
            "nodeCount": len(rows),
            "cpuTypes": [{"name": name, "count": count} for name, count in top_cpus],
            "ramDistribution": ram_distribution,
            "storage": {
                "totalTB": round(total_storage_tb, 2),
                "freeTB": round(total_free_storage_tb, 2),
                "usedTB": round(total_storage_tb - total_free_storage_tb, 2),
                "usedPercent": round((total_storage_tb - total_free_storage_tb) / total_storage_tb * 100, 1) if total_storage_tb > 0 else 0
            },
            "diskHealth": disk_health,
            "physicalDiskHealth": physical_disk_health,
            "diskTypes": disk_types,
            "busTypes": [{"name": name, "count": count} for name, count in top_bus_types],
            "physicalDisks": physical_disks[:50],  # Top 50 disks
            "issues": nodes_with_issues[:20]  # Top 20 issues
        }


@app.get("/api/v1/inventory/software/{node_id}")
async def get_software(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get software data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        rows = await conn.fetch("""
            SELECT name, version, publisher, install_date, install_path
            FROM software_current WHERE node_id = $1 ORDER BY name
        """, node['id'])
        
        return {"data": {"installedPrograms": [dict(r) for r in rows]}}


@app.get("/api/v1/inventory/hotfixes/{node_id}")
async def get_hotfixes(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get hotfix data for a node (classic hotfixes + Windows Update History)"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        # Get classic hotfixes
        hotfix_rows = await conn.fetch("""
            SELECT kb_id as "hotfixId", description, installed_on as "installedOn", 
                   installed_by as "installedBy"
            FROM hotfixes_current WHERE node_id = $1 ORDER BY installed_on DESC
        """, node['id'])
        
        # Get Windows Update History
        update_rows = await conn.fetch("""
            SELECT update_id as "updateId", kb_id as "kbId", title, description,
                   installed_on as "installedOn", operation, result_code as "resultCode",
                   support_url as "supportUrl", categories
            FROM update_history WHERE node_id = $1 ORDER BY installed_on DESC
        """, node['id'])
        
        # Parse categories JSON
        update_history = []
        for row in update_rows:
            entry = dict(row)
            if entry.get('categories'):
                entry['categories'] = json.loads(entry['categories'])
            update_history.append(entry)
        
        return {
            "data": {
                "hotfixes": [dict(r) for r in hotfix_rows],
                "updateHistory": update_history,
                "hotfixCount": len(hotfix_rows),
                "updateHistoryCount": len(update_history)
            }
        }


@app.get("/api/v1/inventory/system/{node_id}")
async def get_system(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get system data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("""
            SELECT id, os_name, os_version, os_build FROM nodes WHERE node_id = $1 OR id::text = $1
        """, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        row = await conn.fetchrow("""
            SELECT users, services, startup_items, scheduled_tasks, 
                   computer_name, domain, workgroup, domain_role, is_domain_joined,
                   uptime_hours, uptime_formatted, last_boot_time, updated_at
            FROM system_current WHERE node_id = $1
        """, node['id'])
        
        return {"data": {
            "osName": node['os_name'],
            "osVersion": node['os_version'],
            "osBuild": node['os_build'],
            "computerName": row['computer_name'] if row else None,
            "domain": row['domain'] if row else None,
            "workgroup": row['workgroup'] if row else None,
            "domainRole": row['domain_role'] if row else None,
            "isDomainJoined": row['is_domain_joined'] if row else None,
            "uptimeHours": row['uptime_hours'] if row else None,
            "uptimeFormatted": row['uptime_formatted'] if row else None,
            "lastBootTime": row['last_boot_time'].isoformat() if row and row['last_boot_time'] else None,
            "users": json.loads(row['users']) if row and row['users'] else [],
            "services": json.loads(row['services']) if row and row['services'] else [],
            "startupItems": json.loads(row['startup_items']) if row and row['startup_items'] else [],
            "scheduledTasks": json.loads(row['scheduled_tasks']) if row and row['scheduled_tasks'] else []
        }}


@app.get("/api/v1/inventory/security/{node_id}")
async def get_security(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get security data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        row = await conn.fetchrow("""
            SELECT defender, firewall, tpm, uac, bitlocker, local_admins, updated_at
            FROM security_current WHERE node_id = $1
        """, node['id'])
        
        if not row:
            return {"data": None}
        
        return {"data": {
            "defender": json.loads(row['defender']) if row['defender'] else {},
            "firewall": json.loads(row['firewall']) if row['firewall'] else [],
            "tpm": json.loads(row['tpm']) if row['tpm'] else {},
            "uac": json.loads(row['uac']) if row['uac'] else {},
            "bitlocker": json.loads(row['bitlocker']) if row['bitlocker'] else [],
            "localAdmins": json.loads(row['local_admins']) if row['local_admins'] else {}
        }}


@app.get("/api/v1/inventory/network/{node_id}")
async def get_network(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get network data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        row = await conn.fetchrow("""
            SELECT adapters, connections, listening_ports, updated_at
            FROM network_current WHERE node_id = $1
        """, node['id'])
        
        if not row:
            return {"data": None}
        
        return {"data": {
            "adapters": json.loads(row['adapters']) if row['adapters'] else [],
            "connections": json.loads(row['connections']) if row['connections'] else [],
            "listeningPorts": json.loads(row['listening_ports']) if row['listening_ports'] else []
        }}


@app.get("/api/v1/inventory/browser/{node_id}")
async def get_browser(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get browser data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        rows = await conn.fetch("""
            SELECT browser, profile, profile_path, history_count, bookmark_count, 
                   password_count, extensions, username
            FROM browser_current WHERE node_id = $1
        """, node['id'])
        
        # Group by username -> browser
        users = {}
        for row in rows:
            username = row['username'] or 'unknown'
            b = row['browser']
            if username not in users:
                users[username] = {}
            if b not in users[username]:
                users[username][b] = {"profiles": [], "extensionCount": 0}
            users[username][b]["profiles"].append({
                "name": row['profile'],
                "path": row['profile_path'],
                "historyCount": row['history_count'],
                "bookmarkCount": row['bookmark_count'],
                "passwordCount": row['password_count']
            })
            exts = json.loads(row['extensions']) if row['extensions'] else []
            users[username][b]["extensionCount"] += len(exts) if exts else 0
        
        # Get cookies summary
        cookie_rows = await conn.fetch("""
            SELECT username, browser, profile, domain, COUNT(*) as count
            FROM browser_cookies 
            WHERE node_id = $1
            GROUP BY username, browser, profile, domain
            ORDER BY username, browser, profile, count DESC
        """, node['id'])
        
        cookies_by_user = {}
        for row in cookie_rows:
            username = row['username']
            if username not in cookies_by_user:
                cookies_by_user[username] = []
            cookies_by_user[username].append({
                "browser": row['browser'],
                "profile": row['profile'],
                "domain": row['domain'],
                "count": row['count']
            })
        
        return {"data": {"users": users, "cookies": cookies_by_user}}


@app.get("/api/v1/inventory/browser/{node_id}/cookies")
async def get_browser_cookies(node_id: str, username: str = None, browser: str = None, 
                              domain: str = None, limit: int = 500, db: asyncpg.Pool = Depends(get_db)):
    """Get detailed cookie data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        query = """
            SELECT username, browser, profile, domain, name, path, 
                   expires_utc, is_secure, is_http_only, same_site, is_session, is_expired
            FROM browser_cookies 
            WHERE node_id = $1
        """
        params = [node['id']]
        
        if username:
            params.append(username)
            query += f" AND username = ${len(params)}"
        if browser:
            params.append(browser)
            query += f" AND browser = ${len(params)}"
        if domain:
            params.append(f"%{domain}%")
            query += f" AND domain LIKE ${len(params)}"
        
        query += f" ORDER BY username, browser, domain, name LIMIT {limit}"
        
        rows = await conn.fetch(query, *params)
        
        cookies = []
        for row in rows:
            cookies.append({
                "username": row['username'],
                "browser": row['browser'],
                "profile": row['profile'],
                "domain": row['domain'],
                "name": row['name'],
                "path": row['path'],
                "expiresUtc": row['expires_utc'].isoformat() if row['expires_utc'] else None,
                "isSecure": row['is_secure'],
                "isHttpOnly": row['is_http_only'],
                "sameSite": row['same_site'],
                "isSession": row['is_session'],
                "isExpired": row['is_expired']
            })
        
        return {"cookies": cookies, "count": len(cookies)}


# Critical domains list for security analysis
CRITICAL_DOMAINS = {
    # Banking & Finance
    "paypal.com", "stripe.com", "coinbase.com", "binance.com", "kraken.com",
    # Auth Providers
    "google.com", "accounts.google.com", "microsoft.com", "login.microsoftonline.com", 
    "login.live.com", "github.com", "gitlab.com", "okta.com", "auth0.com",
    # Cloud Providers
    "aws.amazon.com", "console.aws.amazon.com", "azure.com", "portal.azure.com",
    # Communication
    "discord.com", "slack.com", "telegram.org", "web.telegram.org", "whatsapp.com",
    # Email
    "mail.google.com", "outlook.com", "outlook.live.com", "protonmail.com",
    # Password Managers
    "1password.com", "lastpass.com", "bitwarden.com", "dashlane.com"
}

def get_domain_category(domain: str) -> str:
    """Categorize a domain for security reporting"""
    d = domain.lower().lstrip('.')
    if any(x in d for x in ["paypal", "stripe", "coinbase", "binance", "kraken"]):
        return "Banking/Finance"
    if any(x in d for x in ["google", "microsoft", "github", "okta", "auth0", "live.com"]):
        return "Auth Provider"
    if any(x in d for x in ["aws", "azure", "cloud.google"]):
        return "Cloud Provider"
    if any(x in d for x in ["discord", "slack", "telegram", "whatsapp"]):
        return "Communication"
    if any(x in d for x in ["mail", "outlook", "proton"]):
        return "Email"
    if any(x in d for x in ["1password", "lastpass", "bitwarden", "dashlane"]):
        return "Password Manager"
    return "Sensitive"

def is_critical_domain(domain: str) -> bool:
    """Check if a domain is in the critical list"""
    d = domain.lower().lstrip('.')
    for critical in CRITICAL_DOMAINS:
        if d == critical or d.endswith('.' + critical):
            return True
    return False


@app.get("/api/v1/inventory/browser/{node_id}/critical")
async def get_critical_cookies(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get critical/sensitive cookies for security analysis"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1 OR hostname = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        rows = await conn.fetch("""
            SELECT username, browser, profile, domain, name, path, 
                   expires_utc, is_secure, is_http_only, same_site, is_session, is_expired
            FROM browser_cookies 
            WHERE node_id = $1
            ORDER BY username, browser, domain, name
        """, node['id'])
        
        # Filter and categorize critical cookies
        critical = []
        categories = {}
        
        for row in rows:
            domain = row['domain']
            if is_critical_domain(domain):
                category = get_domain_category(domain)
                
                cookie = {
                    "username": row['username'],
                    "browser": row['browser'],
                    "profile": row['profile'],
                    "domain": domain,
                    "name": row['name'],
                    "category": category,
                    "isSecure": row['is_secure'],
                    "isHttpOnly": row['is_http_only'],
                    "isSession": row['is_session'],
                    "isExpired": row['is_expired'],
                    "expiresUtc": row['expires_utc'].isoformat() if row['expires_utc'] else None
                }
                critical.append(cookie)
                
                # Count by category
                if category not in categories:
                    categories[category] = {"count": 0, "domains": set()}
                categories[category]["count"] += 1
                categories[category]["domains"].add(domain.lstrip('.'))
        
        # Convert sets to lists for JSON
        summary = {cat: {"count": data["count"], "domains": list(data["domains"])} 
                   for cat, data in categories.items()}
        
        # Security warnings
        warnings = []
        if any(c for c in critical if not c["isSecure"]):
            warnings.append("⚠️ Some critical cookies are NOT marked Secure (vulnerable to MITM)")
        if any(c for c in critical if not c["isHttpOnly"]):
            warnings.append("⚠️ Some critical cookies are NOT HttpOnly (vulnerable to XSS)")
        if "Password Manager" in categories:
            warnings.append("🔐 Password manager cookies found - high-value target")
        if "Banking/Finance" in categories:
            warnings.append("💰 Banking/Finance cookies found - monitor for unauthorized access")
        if "Auth Provider" in categories:
            warnings.append("🔑 Auth provider cookies found - could be used for session hijacking")
        
        return {
            "nodeId": node_id,
            "criticalCookies": critical,
            "count": len(critical),
            "summary": summary,
            "warnings": warnings
        }


@app.post("/api/v1/inventory/hardware", dependencies=[Depends(verify_api_key)])
async def submit_hardware(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit hardware inventory (accepts raw JSON from Windows Agent)"""
    # Extract node info
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    # Windows Agent uses: ram (not memory), gpu (not gpus), nics (not networkAdapters)
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO hardware_current (node_id, cpu, ram, disks, mainboard, bios, gpu, nics, virtualization, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                cpu = $2, ram = $3, disks = $4, mainboard = $5, 
                bios = $6, gpu = $7, nics = $8, virtualization = $9, updated_at = NOW()
        """,
            uuid,
            json.dumps(data.get("cpu", {})),
            json.dumps(data.get("ram") or data.get("memory", {})),
            json.dumps(data.get("disks", {})),
            json.dumps(data.get("mainboard", {})),
            json.dumps(data.get("bios", {})),
            json.dumps(data.get("gpu") or data.get("gpus", [])),
            json.dumps(data.get("nics") or data.get("networkAdapters", [])),
            json.dumps(data.get("virtualization")) if data.get("virtualization") else None
        )
        
        # Log to hypertable
        await conn.execute("""
            INSERT INTO hardware_changes (time, node_id, change_type, component, old_value, new_value)
            VALUES (NOW(), $1, 'snapshot', 'full', NULL, $2)
        """, uuid, json.dumps(data))
    
    return {"status": "ok", "node_id": str(uuid), "type": "hardware"}


@app.post("/api/v1/inventory/software", dependencies=[Depends(verify_api_key)])
async def submit_software(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit software inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    programs = data.get("programs", [])
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    async with db.acquire() as conn:
        # Clear old entries
        await conn.execute("DELETE FROM software_current WHERE node_id = $1", uuid)
        
        # Insert all programs
        for prog in programs:
            await conn.execute("""
                INSERT INTO software_current (node_id, name, version, publisher, install_date, install_path, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
            """,
                uuid,
                prog.get("name", "Unknown")[:500],
                prog.get("version", "")[:100] if prog.get("version") else None,
                prog.get("publisher", "")[:255] if prog.get("publisher") else None,
                None,  # install_date needs parsing
                prog.get("installLocation")
            )
    
    return {"status": "ok", "node_id": str(uuid), "type": "software", "count": len(programs)}


@app.post("/api/v1/inventory/hotfixes", dependencies=[Depends(verify_api_key)])
async def submit_hotfixes(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit hotfix inventory (includes classic hotfixes AND Windows Update History)"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    hotfixes = data.get("hotfixes", [])
    update_history = data.get("updateHistory", [])
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    async with db.acquire() as conn:
        # Store classic hotfixes
        await conn.execute("DELETE FROM hotfixes_current WHERE node_id = $1", uuid)
        
        for hf in hotfixes:
            # Handle both dict and string formats
            # Windows Agent uses "kbId" (camelCase), not "hotfixId"
            if isinstance(hf, dict):
                kb_id = hf.get("kbId") or hf.get("hotfixId") or ""
                if not kb_id:  # Skip entries without KB ID
                    continue
                await conn.execute("""
                    INSERT INTO hotfixes_current (node_id, kb_id, description, installed_on, installed_by, updated_at)
                    VALUES ($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT (node_id, kb_id) DO UPDATE SET
                        description = EXCLUDED.description,
                        installed_on = EXCLUDED.installed_on,
                        installed_by = EXCLUDED.installed_by,
                        updated_at = NOW()
                """,
                    uuid,
                    kb_id,
                    hf.get("description"),
                    parse_datetime(hf.get("installedOn")),
                    hf.get("installedBy")
                )
            elif isinstance(hf, str) and hf:
                await conn.execute("""
                    INSERT INTO hotfixes_current (node_id, kb_id, description, installed_on, installed_by, updated_at)
                    VALUES ($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT (node_id, kb_id) DO UPDATE SET updated_at = NOW()
                """,
                    uuid,
                    hf,  # Just the KB ID as string
                    None,
                    None,
                    None
                )
        
        # Store Windows Update History
        await conn.execute("DELETE FROM update_history WHERE node_id = $1", uuid)
        
        for upd in update_history:
            update_id = upd.get("updateId") or upd.get("title", "")[:100]
            if not update_id:
                continue
            await conn.execute("""
                INSERT INTO update_history (node_id, update_id, kb_id, title, description, 
                    installed_on, operation, result_code, support_url, categories, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                ON CONFLICT (node_id, update_id) DO UPDATE SET
                    kb_id = EXCLUDED.kb_id,
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    installed_on = EXCLUDED.installed_on,
                    operation = EXCLUDED.operation,
                    result_code = EXCLUDED.result_code,
                    support_url = EXCLUDED.support_url,
                    categories = EXCLUDED.categories,
                    updated_at = NOW()
            """,
                uuid,
                update_id,
                upd.get("kbId"),
                upd.get("title", "Unknown Update")[:500],
                upd.get("description"),
                parse_datetime(upd.get("installedOn")),
                upd.get("operation"),
                upd.get("resultCode"),
                upd.get("supportUrl"),
                json.dumps(upd.get("categories", []))
            )
    
    return {
        "status": "ok", 
        "node_id": str(uuid), 
        "type": "hotfixes", 
        "hotfixCount": len(hotfixes),
        "updateHistoryCount": len(update_history)
    }


@app.post("/api/v1/inventory/system", dependencies=[Depends(verify_api_key)])
async def submit_system(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit system inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    os_info = data.get("os", {})
    
    uuid = await upsert_node(
        db, node_id_str, hostname,
        os_name=os_info.get("name"),
        os_version=os_info.get("version"),
        os_build=os_info.get("build")
    )
    
    # Parse lastBootTime to timestamp if present
    last_boot_time = None
    if os_info.get("lastBootTime"):
        try:
            from datetime import datetime
            last_boot_time = datetime.fromisoformat(os_info.get("lastBootTime").replace("Z", "+00:00"))
        except:
            pass
    
    async with db.acquire() as conn:
        # Get agent version from os info
        agent_version = os_info.get("agentVersion")
        
        await conn.execute("""
            INSERT INTO system_current (node_id, users, services, startup_items, scheduled_tasks,
                os_name, os_version, os_build, computer_name, domain, workgroup, domain_role, is_domain_joined,
                uptime_hours, uptime_formatted, last_boot_time, agent_version, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                users = $2, services = $3, startup_items = $4, scheduled_tasks = $5,
                os_name = $6, os_version = $7, os_build = $8, computer_name = $9,
                domain = $10, workgroup = $11, domain_role = $12, is_domain_joined = $13,
                uptime_hours = $14, uptime_formatted = $15, last_boot_time = $16, agent_version = $17, updated_at = NOW()
        """,
            uuid,
            json.dumps(data.get("users", [])),
            json.dumps(data.get("services", [])),
            json.dumps(data.get("startupItems", [])),
            json.dumps(data.get("scheduledTasks", [])),
            os_info.get("name"),
            os_info.get("version"),
            os_info.get("build"),
            os_info.get("computerName"),
            os_info.get("domain"),
            os_info.get("workgroup"),
            os_info.get("domainRole"),
            os_info.get("isDomainJoined"),
            os_info.get("uptimeHours"),
            os_info.get("uptimeFormatted"),
            last_boot_time,
            agent_version
        )
        
        # Also update nodes table with agent_version
        if agent_version:
            await conn.execute("""
                UPDATE nodes SET agent_version = $1 WHERE id = $2
            """, agent_version, uuid)
    
    # Evaluate dynamic group memberships
    node_data_for_rules = {
        "hostname": hostname,
        "os_name": os_info.get("name", ""),
        "os_version": os_info.get("version", ""),
        "os_build": os_info.get("build", ""),
        "agent_version": agent_version or "",
        "domain": os_info.get("domain", ""),
        "is_domain_joined": os_info.get("isDomainJoined", False),
    }
    await update_dynamic_group_memberships(db, uuid, node_data_for_rules)
    
    return {"status": "ok", "node_id": str(uuid), "type": "system"}


@app.post("/api/v1/inventory/security", dependencies=[Depends(verify_api_key)])
async def submit_security(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit security inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO security_current (node_id, defender, firewall, tpm, uac, bitlocker, local_admins, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                defender = $2, firewall = $3, tpm = $4, 
                uac = $5, bitlocker = $6, local_admins = $7, updated_at = NOW()
        """,
            uuid,
            json.dumps(data.get("defender", {})),
            json.dumps(data.get("firewall", [])),
            json.dumps(data.get("tpm", {})),
            json.dumps(data.get("uac", {})),
            json.dumps(data.get("bitlocker", [])),
            json.dumps(data.get("localAdmins", {}))
        )
    
    return {"status": "ok", "node_id": str(uuid), "type": "security"}


@app.post("/api/v1/inventory/network", dependencies=[Depends(verify_api_key)])
async def submit_network(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit network inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO network_current (node_id, adapters, connections, listening_ports, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                adapters = $2, connections = $3, listening_ports = $4, updated_at = NOW()
        """,
            uuid,
            json.dumps(data.get("adapters", [])),
            json.dumps(data.get("connections", [])),
            json.dumps(data.get("listeningPorts", []))
        )
    
    return {"status": "ok", "node_id": str(uuid), "type": "network"}


@app.post("/api/v1/inventory/browser", dependencies=[Depends(verify_api_key)])
async def submit_browser(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit browser inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    browsers = data.get("browsers", {})
    users = data.get("users", [])
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM browser_current WHERE node_id = $1", uuid)
        
        # NEW: Handle new format with users array (from SYSTEM service scanning all users)
        if users:
            await conn.execute("DELETE FROM browser_cookies WHERE node_id = $1", uuid)
            
            for user_data in users:
                username = user_data.get("username", "unknown")
                
                for browser_key in ["chrome", "edge", "firefox"]:
                    browser_data = user_data.get(browser_key)
                    if not browser_data or not browser_data.get("installed"):
                        continue
                    
                    browser_name = browser_key.title()
                    
                    for profile in browser_data.get("profiles", []):
                        profile_name = profile.get("name", "Default")
                        
                        # Store browser profile with username
                        await conn.execute("""
                            INSERT INTO browser_current (node_id, browser, profile, username,
                                history_count, bookmark_count, cookies_count, logins_count, extensions, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                            ON CONFLICT (node_id, browser, profile) DO UPDATE SET
                                username = EXCLUDED.username,
                                history_count = EXCLUDED.history_count,
                                bookmark_count = EXCLUDED.bookmark_count,
                                cookies_count = EXCLUDED.cookies_count,
                                logins_count = EXCLUDED.logins_count,
                                extensions = EXCLUDED.extensions,
                                updated_at = NOW()
                        """,
                            uuid,
                            browser_name,
                            profile_name,
                            username,
                            profile.get("historyCount"),
                            profile.get("bookmarksCount"),
                            profile.get("cookiesCount"),
                            profile.get("loginsCount"),
                            json.dumps(profile.get("extensions", []))
                        )
                        
                        # Store cookies
                        cookies = profile.get("cookies") or []
                        for cookie in cookies:
                            if cookie.get("domain") == "ERROR":
                                continue  # Skip error entries
                            try:
                                expires = None
                                if cookie.get("expiresUtc"):
                                    expires = cookie["expiresUtc"]
                                
                                await conn.execute("""
                                    INSERT INTO browser_cookies 
                                    (node_id, username, browser, profile, domain, name, path,
                                     expires_utc, is_secure, is_http_only, same_site, is_session, is_expired)
                                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                                    ON CONFLICT (node_id, username, browser, profile, domain, name) DO UPDATE SET
                                        path = EXCLUDED.path,
                                        expires_utc = EXCLUDED.expires_utc,
                                        is_secure = EXCLUDED.is_secure,
                                        is_http_only = EXCLUDED.is_http_only,
                                        same_site = EXCLUDED.same_site,
                                        is_session = EXCLUDED.is_session,
                                        is_expired = EXCLUDED.is_expired,
                                        updated_at = NOW()
                                """,
                                    uuid, username, browser_name, profile_name,
                                    cookie.get("domain", ""),
                                    cookie.get("name", ""),
                                    cookie.get("path", "/"),
                                    expires,
                                    cookie.get("isSecure", False),
                                    cookie.get("isHttpOnly", False),
                                    cookie.get("sameSite"),
                                    cookie.get("isSession", False),
                                    cookie.get("isExpired", False)
                                )
                            except Exception as e:
                                # Log but continue with other cookies
                                print(f"Cookie insert error: {e}")
        
        # Handle legacy Windows Agent format: { chrome: {...}, edge: {...}, firefox: {...} }
        elif isinstance(browsers, dict):
            for browser_name, browser_data in browsers.items():
                if not isinstance(browser_data, dict):
                    continue
                # Each browser has: { installed: bool, profileCount: N, profiles: [...] }
                profiles = browser_data.get("profiles", [])
                for profile in profiles:
                    await conn.execute("""
                        INSERT INTO browser_current (node_id, browser, profile, profile_path,
                            history_count, bookmark_count, password_count, extensions, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                        ON CONFLICT (node_id, browser, profile) DO UPDATE SET
                            profile_path = EXCLUDED.profile_path,
                            history_count = EXCLUDED.history_count,
                            bookmark_count = EXCLUDED.bookmark_count,
                            password_count = EXCLUDED.password_count,
                            extensions = EXCLUDED.extensions,
                            updated_at = NOW()
                    """,
                        uuid,
                        browser_name.title(),  # chrome -> Chrome
                        profile.get("name", "Default"),
                        profile.get("path"),
                        profile.get("historyCount"),
                        profile.get("bookmarkCount"),
                        profile.get("savedPasswordCount"),
                        json.dumps(profile.get("extensions", []))
                    )
        # Also handle legacy array format
        elif isinstance(browsers, list):
            for browser in browsers:
                if not isinstance(browser, dict):
                    continue
                browser_name = browser.get("browser", "Unknown")
                for profile in browser.get("profiles", []):
                    await conn.execute("""
                        INSERT INTO browser_current (node_id, browser, profile, profile_path,
                            history_count, bookmark_count, password_count, extensions, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                        ON CONFLICT (node_id, browser, profile) DO UPDATE SET
                            profile_path = EXCLUDED.profile_path,
                            history_count = EXCLUDED.history_count,
                            bookmark_count = EXCLUDED.bookmark_count,
                            password_count = EXCLUDED.password_count,
                            extensions = EXCLUDED.extensions,
                            updated_at = NOW()
                    """,
                        uuid,
                        browser_name,
                        profile.get("name", "Default"),
                        profile.get("path"),
                        profile.get("historyCount"),
                        profile.get("bookmarkCount"),
                        profile.get("savedPasswordCount"),
                        json.dumps(profile.get("extensions", []))
                    )
    
    return {"status": "ok", "node_id": str(uuid), "type": "browser"}


@app.post("/api/v1/inventory/full", dependencies=[Depends(verify_api_key)])
async def submit_full(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit full inventory (all types at once)"""
    # Sanitize all incoming data to remove null bytes
    data = sanitize_for_postgres(data)
    
    hostname = data.get("hostname", "unknown")
    results = {"hostname": hostname, "submitted": []}
    
    # Windows Agent sends: { hardware: { cpu: {...}, ram: {...} }, software: { count: N, software: [...] }, ... }
    # (No "data" wrapper - the data IS the hardware/software/etc object directly)
    
    # Extract hardware data - hardware object contains cpu, ram, disks, etc. directly
    hw_data = data.get("hardware", {})
    if hw_data.get("cpu") or hw_data.get("ram"):
        flat_hw = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            **hw_data
        }
        await submit_hardware(flat_hw, db)
        results["submitted"].append("hardware")
    
    # Extract software data - software.software is the array
    sw_obj = data.get("software", {})
    sw_data = sw_obj.get("software", []) if isinstance(sw_obj, dict) else sw_obj
    if sw_data:
        flat_sw = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            "programs": sw_data
        }
        await submit_software(flat_sw, db)
        results["submitted"].append("software")
    
    # Extract hotfixes data - hotfixes.hotfixes is the array, updateHistory is separate
    hf_obj = data.get("hotfixes", {})
    hf_data = hf_obj.get("hotfixes", []) if isinstance(hf_obj, dict) else hf_obj
    update_history_data = hf_obj.get("updateHistory", []) if isinstance(hf_obj, dict) else []
    if hf_data or update_history_data:
        flat_hf = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            "hotfixes": hf_data,
            "updateHistory": update_history_data
        }
        await submit_hotfixes(flat_hf, db)
        results["submitted"].append("hotfixes")
    
    # Extract system data - system object contains os, services, etc. directly
    sys_data = data.get("system", {})
    if sys_data.get("os") or sys_data.get("services"):
        flat_sys = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            **sys_data
        }
        await submit_system(flat_sys, db)
        results["submitted"].append("system")
    
    # Extract security data - security object contains antivirus, firewall, etc. directly
    sec_data = data.get("security", {})
    if sec_data.get("antivirus") or sec_data.get("firewall") or sec_data.get("bitlocker"):
        flat_sec = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            **sec_data
        }
        await submit_security(flat_sec, db)
        results["submitted"].append("security")
    
    # Extract network data - network object contains openPorts, connections, networkInterfaces, etc.
    net_data = data.get("network", {})
    if net_data.get("openPorts") or net_data.get("connections") or net_data.get("networkInterfaces"):
        flat_net = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            **net_data
        }
        await submit_network(flat_net, db)
        results["submitted"].append("network")
    
    # Extract browser data - browser object contains chrome, edge, firefox, etc.
    # NEW format: { users: [...] } from SYSTEM service
    # OLD format: { chrome: {...}, edge: {...}, firefox: {...} }
    br_data = data.get("browser", {})
    if br_data.get("users") or br_data.get("chrome") or br_data.get("edge") or br_data.get("firefox"):
        flat_br = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            "browsers": br_data,  # Legacy format
            "users": br_data.get("users", [])  # New format
        }
        await submit_browser(flat_br, db)
        results["submitted"].append("browser")
    
    # E7: Update node health timestamp on any inventory push
    node_id = data.get("nodeId", hostname)
    try:
        await update_node_health(db, node_id)
    except Exception as e:
        # Don't fail the whole request if health update fails
        pass
    
    return {"status": "ok", **results}


# =============================================================================
# E2: Groups & Tags API
# =============================================================================

@app.get("/api/v1/groups")
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


@app.get("/api/v1/groups/{group_id}")
async def get_group(group_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get single group with members"""
    async with db.acquire() as conn:
        group = await conn.fetchrow("""
            SELECT g.id, g.name, g.description, g.parent_id, g.is_dynamic, 
                   g.dynamic_rule, g.color, g.icon, g.created_at, g.updated_at
            FROM groups g WHERE g.id = $1
        """, UUID(group_id))
        
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
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


@app.post("/api/v1/groups", dependencies=[Depends(verify_api_key)])
async def create_group(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new group"""
    name = data.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    
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
            raise HTTPException(status_code=409, detail="Group name already exists")


@app.put("/api/v1/groups/{group_id}", dependencies=[Depends(verify_api_key)])
async def update_group(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update an existing group"""
    async with db.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM groups WHERE id = $1", UUID(group_id))
        if not existing:
            raise HTTPException(status_code=404, detail="Group not found")
        
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


@app.delete("/api/v1/groups/{group_id}", dependencies=[Depends(verify_api_key)])
async def delete_group(group_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a group"""
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM groups WHERE id = $1", UUID(group_id))
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Group not found")
        return {"status": "deleted", "groupId": group_id}


@app.post("/api/v1/groups/preview-rule", dependencies=[Depends(verify_api_key)])
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


@app.post("/api/v1/groups/{group_id}/evaluate", dependencies=[Depends(verify_api_key)])
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
            raise HTTPException(status_code=404, detail="Group not found")
        
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


# E2-03: Assign devices to groups
@app.post("/api/v1/groups/{group_id}/members", dependencies=[Depends(verify_api_key)])
async def add_group_members(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Add devices to a group"""
    node_ids = data.get("nodeIds", [])
    assigned_by = data.get("assignedBy", "api")
    
    if not node_ids:
        raise HTTPException(status_code=400, detail="nodeIds array is required")
    
    async with db.acquire() as conn:
        # Verify group exists
        group = await conn.fetchrow("SELECT id FROM groups WHERE id = $1", UUID(group_id))
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
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


@app.delete("/api/v1/groups/{group_id}/members", dependencies=[Depends(verify_api_key)])
async def remove_group_members(group_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Remove devices from a group"""
    node_ids = data.get("nodeIds", [])
    
    if not node_ids:
        raise HTTPException(status_code=400, detail="nodeIds array is required")
    
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


# E2-04: Tags API
@app.get("/api/v1/tags")
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


@app.post("/api/v1/tags", dependencies=[Depends(verify_api_key)])
async def create_tag(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new tag"""
    name = data.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow("""
                INSERT INTO tags (name, color) VALUES ($1, $2)
                RETURNING id, name, color, created_at
            """, name, data.get("color"))
            return {"status": "created", "tag": dict(row)}
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail="Tag name already exists")


@app.delete("/api/v1/tags/{tag_id}", dependencies=[Depends(verify_api_key)])
async def delete_tag(tag_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a tag"""
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM tags WHERE id = $1", UUID(tag_id))
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Tag not found")
        return {"status": "deleted", "tagId": tag_id}


@app.post("/api/v1/devices/{node_id}/tags", dependencies=[Depends(verify_api_key)])
async def add_device_tags(node_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Add tags to a device"""
    tag_ids = data.get("tagIds", [])
    
    if not tag_ids:
        raise HTTPException(status_code=400, detail="tagIds array is required")
    
    async with db.acquire() as conn:
        # Find node by node_id string
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
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


@app.delete("/api/v1/devices/{node_id}/tags", dependencies=[Depends(verify_api_key)])
async def remove_device_tags(node_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Remove tags from a device"""
    tag_ids = data.get("tagIds", [])
    
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
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


@app.get("/api/v1/devices/{node_id}/groups")
async def get_device_groups(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get groups a device belongs to"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        rows = await conn.fetch("""
            SELECT g.id, g.name, g.description, g.color, g.icon, dg.assigned_at, dg.assigned_by
            FROM device_groups dg
            JOIN groups g ON dg.group_id = g.id
            WHERE dg.node_id = $1
            ORDER BY g.name
        """, node['id'])
        
        return {"nodeId": node_id, "groups": [dict(r) for r in rows]}


@app.get("/api/v1/devices/{node_id}/tags")
async def get_device_tags(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get tags assigned to a device"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        rows = await conn.fetch("""
            SELECT t.id, t.name, t.color, dt.assigned_at
            FROM device_tags dt
            JOIN tags t ON dt.tag_id = t.id
            WHERE dt.node_id = $1
            ORDER BY t.name
        """, node['id'])
        
        return {"nodeId": node_id, "tags": [dict(r) for r in rows]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)

# ============================================
# Enrollment Tokens API (E10-10)
# ============================================

@app.post("/api/v1/enrollment-tokens")
async def create_enrollment_token(request: Request):
    """Create a new enrollment token for agent registration"""
    data = await request.json()
    pool = await get_db()
    
    token_id = str(uuid.uuid4())
    token_value = secrets.token_urlsafe(32)
    
    # Token settings
    expires_hours = data.get("expiresHours", 24)  # Default 24h
    max_uses = data.get("maxUses", 10)  # Default 10 uses
    description = data.get("description", "")
    created_by = data.get("createdBy", "admin")
    
    expires_at = datetime.utcnow() + timedelta(hours=expires_hours)
    
    # Create table if not exists
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS enrollment_tokens (
            id UUID PRIMARY KEY,
            token TEXT UNIQUE NOT NULL,
            description TEXT,
            expires_at TIMESTAMPTZ NOT NULL,
            max_uses INT NOT NULL DEFAULT 10,
            use_count INT NOT NULL DEFAULT 0,
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            revoked BOOLEAN DEFAULT FALSE
        )
    """)
    
    row = await pool.fetchrow("""
        INSERT INTO enrollment_tokens (id, token, description, expires_at, max_uses, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, token, expires_at
    """, token_id, token_value, description, expires_at, max_uses, created_by)
    
    return {
        "id": str(row['id']),
        "token": row['token'],
        "expiresAt": row['expires_at'].isoformat(),
        "maxUses": max_uses,
        "description": description,
        "installCommand": f'irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet-windows-agent/main/installer/Install-OctofleetAgent.ps1 -OutFile Install.ps1; .\\Install.ps1 -EnrollToken "{row["token"]}"'
    }

@app.get("/api/v1/enrollment-tokens")
async def list_enrollment_tokens(request: Request):
    """List all enrollment tokens"""
    pool = await get_db()
    
    # Check if table exists
    table_exists = await pool.fetchval("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'enrollment_tokens'
        )
    """)
    
    if not table_exists:
        return {"tokens": []}
    
    rows = await pool.fetch("""
        SELECT id, token, name, description, expires_at, max_uses, current_uses, created_by, created_at, revoked_at, is_active
        FROM enrollment_tokens
        ORDER BY created_at DESC
    """)
    
    tokens = []
    for row in rows:
        expires_at = row['expires_at']
        is_expired = False
        if expires_at:
            is_expired = expires_at < datetime.now(expires_at.tzinfo) if expires_at.tzinfo else expires_at < datetime.utcnow()
        is_exhausted = row['max_uses'] and row['current_uses'] >= row['max_uses']
        is_revoked = row['revoked_at'] is not None
        
        tokens.append({
            "id": str(row['id']),
            "token": row['token'][:8] + "..." if row['token'] else None,
            "name": row['name'],
            "description": row['description'],
            "expiresAt": row['expires_at'].isoformat() if row['expires_at'] else None,
            "maxUses": row['max_uses'],
            "useCount": row['current_uses'],
            "createdBy": row['created_by'],
            "createdAt": row['created_at'].isoformat() if row['created_at'] else None,
            "revoked": is_revoked,
            "isActive": row['is_active'],
            "status": "revoked" if is_revoked else ("expired" if is_expired else ("exhausted" if is_exhausted else "active"))
        })
    
    return {"tokens": tokens}

@app.delete("/api/v1/enrollment-tokens/{token_id}")
async def revoke_enrollment_token(token_id: str, request: Request):
    """Revoke an enrollment token"""
    pool = await get_db()
    
    row = await pool.fetchrow("""
        UPDATE enrollment_tokens SET revoked_at = NOW(), is_active = FALSE WHERE id = $1
        RETURNING id
    """, token_id)
    
    if not row:
        raise HTTPException(status_code=404, detail="Token not found")
    
    return {"status": "revoked", "id": str(row['id'])}

@app.post("/api/v1/enroll")
async def enroll_device(request: Request):
    """Exchange enrollment token for device credentials"""
    data = await request.json()
    pool = await get_db()
    
    enroll_token = data.get("enrollToken")
    hostname = data.get("hostname", "unknown")
    
    if not enroll_token:
        raise HTTPException(status_code=400, detail="enrollToken required")
    
    # Find and validate token
    row = await pool.fetchrow("""
        SELECT id, expires_at, max_uses, use_count, revoked
        FROM enrollment_tokens
        WHERE token = $1
    """, enroll_token)
    
    if not row:
        raise HTTPException(status_code=401, detail="Invalid enrollment token")
    
    token_id = row['id']
    expires_at = row['expires_at']
    max_uses = row['max_uses']
    use_count = row['use_count']
    revoked = row['revoked']
    
    # Check if token is valid
    if revoked:
        raise HTTPException(status_code=401, detail="Enrollment token has been revoked")
    
    is_expired = expires_at < datetime.now(expires_at.tzinfo) if expires_at.tzinfo else expires_at < datetime.utcnow()
    if is_expired:
        raise HTTPException(status_code=401, detail="Enrollment token has expired")
    
    if use_count >= max_uses:
        raise HTTPException(status_code=401, detail="Enrollment token usage limit reached")
    
    # Increment use count
    await pool.execute("""
        UPDATE enrollment_tokens SET use_count = use_count + 1 WHERE id = $1
    """, token_id)
    
    # Generate device credentials
    device_token = secrets.token_urlsafe(48)
    device_id = f"dev-{secrets.token_hex(8)}"
    
    # Return credentials - for now, return the main gateway token
    # In a full implementation, this would be a device-specific token
    return {
        "status": "enrolled",
        "deviceId": device_id,
        "hostname": hostname,
        "gatewayUrl": GATEWAY_URL,
        "gatewayToken": GATEWAY_TOKEN,
        "inventoryApiUrl": INVENTORY_API_URL,
        "message": f"Device {hostname} enrolled successfully"
    }

# ============================================

# ============================================
# E3: Job System API
# ============================================

@app.post("/api/v1/jobs")
async def create_job(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new job targeting devices, groups, or tags"""
    async with db.acquire() as conn:
        job_uuid = uuid.uuid4()
        job_id = str(job_uuid)
        
        # Required fields
        target_type = data.get("targetType", "device")  # device, group, tag, all
        command_type = data.get("commandType", "run")   # run, script, inventory
        command_data = data.get("commandData", {})
        
        # Optional fields
        name = data.get("name", f"Job {job_id[:8]}")
        description = data.get("description", "")
        # Support both targetId and targetDeviceId/targetGroupId
        target_id_input = data.get("targetId") or data.get("targetDeviceId") or data.get("targetGroupId")
        target_tag = data.get("targetTag")
        priority = data.get("priority", 5)
        scheduled_at = data.get("scheduledAt")
        expires_at = data.get("expiresAt")
        created_by = data.get("createdBy", "api")
        timeout_seconds = data.get("timeoutSeconds", 300)
        
        # For device target type, target_id is a text node_id - look up UUID
        target_id = None
        target_node_id = None  # Text node_id for instance creation
        if target_type == "device" and target_id_input:
            # Try to find node by text node_id first
            node = await conn.fetchrow(
                "SELECT id, node_id FROM nodes WHERE node_id = $1 OR id::text = $1", 
                target_id_input
            )
            if node:
                target_id = str(node["id"])
                target_node_id = node["node_id"]
            else:
                # Maybe it's already a UUID?
                try:
                    uuid.UUID(target_id_input)
                    target_id = target_id_input
                    # Look up text node_id
                    node = await conn.fetchrow(
                        "SELECT node_id FROM nodes WHERE id = $1::uuid",
                        target_id_input
                    )
                    if node:
                        target_node_id = node["node_id"]
                except ValueError:
                    raise HTTPException(status_code=404, detail=f"Node not found: {target_id_input}")
        elif target_id_input:
            # For group/tag target types, expect UUID
            target_id = target_id_input
        
        # Insert job
        row = await conn.fetchrow("""
            INSERT INTO jobs (id, name, description, target_type, target_id, target_tag, 
                             command_type, command_data, priority, scheduled_at, expires_at, 
                             created_by, timeout_seconds)
            VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
            RETURNING id, created_at
        """, str(job_uuid), name, description, target_type, target_id, target_tag,
             command_type, json.dumps(command_data), priority, scheduled_at, expires_at, 
             created_by, timeout_seconds)
        
        # Expand job to instances based on target
        instances_created = 0
        
        if target_type == "device" and target_node_id:
            # target_node_id is already resolved text node_id
            await conn.execute("""
                INSERT INTO job_instances (job_id, node_id, status)
                VALUES ($1::uuid, $2, 'pending')
            """, str(job_uuid), target_node_id)
            instances_created = 1
        
        elif target_type == "group" and target_id:
            # device_groups.node_id is UUID, need to join with nodes table
            nodes = await conn.fetch("""
                SELECT n.node_id FROM device_groups dg
                JOIN nodes n ON n.id = dg.node_id
                WHERE dg.group_id = $1::uuid
            """, target_id)
            for node in nodes:
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, str(job_uuid), node["node_id"])
                instances_created += 1
        
        elif target_type == "tag" and target_tag:
            # device_tags.node_id is also UUID
            nodes = await conn.fetch("""
                SELECT n.node_id FROM device_tags dt
                JOIN nodes n ON n.id = dt.node_id
                JOIN tags t ON t.id = dt.tag_id
                WHERE t.name = $1
            """, target_tag)
            for node in nodes:
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, str(job_uuid), node["node_id"])
                instances_created += 1
        
        elif target_type == "all":
            # Get node_id (text) from nodes table via system_current
            nodes = await conn.fetch("""
                SELECT n.node_id 
                FROM nodes n 
                INNER JOIN system_current sc ON sc.node_id = n.id
            """)
            for node in nodes:
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, str(job_uuid), node["node_id"])
                instances_created += 1
        
        return {
            "id": job_id,
            "name": name,
            "targetType": target_type,
            "commandType": command_type,
            "instancesCreated": instances_created,
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None
        }


@app.get("/api/v1/jobs")
async def list_jobs(limit: int = 50, offset: int = 0, db: asyncpg.Pool = Depends(get_db)):
    """List all jobs with summary"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT job_id, name, command_type, target_type, created_at,
                   total_instances, pending, queued, running, success, failed, cancelled
            FROM job_summary
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        """, limit, offset)
        
        jobs = [{
            "id": str(row["job_id"]),
            "name": row["name"],
            "commandType": row["command_type"],
            "targetType": row["target_type"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            "summary": {
                "total": row["total_instances"],
                "pending": row["pending"],
                "queued": row["queued"],
                "running": row["running"],
                "success": row["success"],
                "failed": row["failed"],
                "cancelled": row["cancelled"]
            }
        } for row in rows]
        
        return {"jobs": jobs}


@app.get("/api/v1/jobs/{job_id}")
async def get_job(job_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get job details with all instances"""
    async with db.acquire() as conn:
        job = await conn.fetchrow("""
            SELECT id, name, description, target_type, target_id, target_tag,
                   command_type, command_data, priority, scheduled_at, expires_at,
                   created_by, created_at, timeout_seconds
            FROM jobs WHERE id = $1
        """, job_id)
        
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        instances = await conn.fetch("""
            SELECT id, node_id, status, queued_at, started_at, completed_at,
                   exit_code, stdout, stderr, error_message, duration_ms, attempt
            FROM job_instances
            WHERE job_id = $1
            ORDER BY queued_at
        """, job_id)
        
        return {
            "id": str(job["id"]),
            "name": job["name"],
            "description": job["description"],
            "targetType": job["target_type"],
            "targetId": str(job["target_id"]) if job["target_id"] else None,
            "targetTag": job["target_tag"],
            "commandType": job["command_type"],
            "commandData": json.loads(job["command_data"]) if job["command_data"] else {},
            "priority": job["priority"],
            "scheduledAt": job["scheduled_at"].isoformat() if job["scheduled_at"] else None,
            "expiresAt": job["expires_at"].isoformat() if job["expires_at"] else None,
            "createdBy": job["created_by"],
            "createdAt": job["created_at"].isoformat() if job["created_at"] else None,
            "timeoutSeconds": job["timeout_seconds"],
            "instances": [{
                "id": str(i["id"]),
                "nodeId": i["node_id"],
                "status": i["status"],
                "queuedAt": i["queued_at"].isoformat() if i["queued_at"] else None,
                "startedAt": i["started_at"].isoformat() if i["started_at"] else None,
                "completedAt": i["completed_at"].isoformat() if i["completed_at"] else None,
                "exitCode": i["exit_code"],
                "stdout": i["stdout"],
                "stderr": i["stderr"],
                "errorMessage": i["error_message"],
                "durationMs": i["duration_ms"],
                "attempt": i["attempt"]
            } for i in instances]
        }


@app.get("/api/v1/jobs/pending/{node_id}")
async def get_pending_jobs(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Agent endpoint: Get pending jobs for a specific node"""
    # Support both formats: "win-baltasa" and "BALTASA"
    # Agent uses win-{hostname.lower()}, DB stores HOSTNAME
    lookup_id = node_id
    if node_id.startswith("win-"):
        lookup_id = node_id[4:].upper()  # win-baltasa -> BALTASA
    
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ji.id, ji.job_id, j.name, j.command_type, j.command_data, j.priority,
                   ji.attempt, ji.max_attempts, j.timeout_seconds
            FROM job_instances ji
            JOIN jobs j ON j.id = ji.job_id
            WHERE UPPER(ji.node_id) = UPPER($1) 
              AND ji.status = 'pending'
              AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
              AND (j.expires_at IS NULL OR j.expires_at > NOW())
            ORDER BY j.priority ASC, ji.queued_at ASC
            LIMIT 10
        """, lookup_id)
        
        jobs = []
        for row in rows:
            # Mark as queued
            await conn.execute("""
                UPDATE job_instances SET status = 'queued', updated_at = NOW()
                WHERE id = $1
            """, row["id"])
            
            command_data = row["command_data"]
            if isinstance(command_data, str):
                try:
                    command_data = json.loads(command_data)
                except:
                    command_data = {}
            
            command_type = row["command_type"] or "run"
            command_payload = command_data
            
            # Convert install_package to a run command with PowerShell script
            if command_type == "install_package":
                package_id = command_data.get("packageId")
                version_id = command_data.get("versionId")
                
                # Look up version details to get download URL and install command
                if package_id and version_id:
                    version_row = await conn.fetchrow("""
                        SELECT pv.filename, pv.download_url, pv.install_command, pv.sha256_hash,
                               p.name as package_name, p.display_name
                        FROM package_versions pv
                        JOIN packages p ON p.id = pv.package_id
                        WHERE pv.id = $1 AND p.id = $2
                    """, version_id, package_id)
                    
                    if version_row and version_row["download_url"]:
                        download_url = version_row["download_url"]
                        filename = version_row["filename"] or "installer.exe"
                        package_name = version_row["display_name"] or version_row["package_name"]
                        
                        ps_script = f'''
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$installerPath = "$env:TEMP\\{filename}"

Write-Host "=== Installing {package_name} ==="
Write-Host "Downloading from: {download_url}"

try {{
    Invoke-WebRequest -Uri "{download_url}" -OutFile $installerPath -UseBasicParsing
    Write-Host "Download complete: $installerPath"
    
    Write-Host "Running installation..."
    if ($installerPath -like "*.msi") {{
        $msiArgs = @("/i", $installerPath, "/qn", "/norestart")
        Write-Host "msiexec /i $installerPath /qn /norestart"
        $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
    }} else {{
        Write-Host "$installerPath /S"
        $process = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
    }}
    $exitCode = $process.ExitCode
    
    if ($exitCode -eq 0 -or $exitCode -eq 3010) {{
        Write-Host "Installation successful (exit code: $exitCode)"
    }} else {{
        Write-Host "Installation failed with exit code: $exitCode"
        exit $exitCode
    }}
    
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    Write-Host "=== Done ==="
}} catch {{
    Write-Host "ERROR: $_"
    exit 1
}}
'''
                        # Convert to run command
                        command_type = "run"
                        command_payload = {
                            "command": ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script.strip()],
                            "timeout": row["timeout_seconds"] or 600
                        }
                    else:
                        # No download URL found
                        command_payload = {
                            "command": ["echo", "ERROR: Package version not found or missing download URL"],
                            "timeout": 30
                        }
                        command_type = "run"
            
            jobs.append({
                # camelCase (new agents)
                "instanceId": str(row["id"]),
                "jobId": str(row["job_id"]),
                "jobName": row["name"] or "Unnamed Job",
                "commandType": command_type,
                "commandPayload": json.dumps(command_payload) if isinstance(command_payload, dict) else str(command_payload),
                "priority": row["priority"],
                "attempt": row["attempt"],
                "maxAttempts": row["max_attempts"],
                "timeoutSeconds": row["timeout_seconds"] or 300,
                # snake_case (legacy Linux agent compatibility)
                "instance_id": str(row["id"]),
                "job_id": str(row["job_id"]),
                "job_name": row["name"] or "Unnamed Job",
                "command_type": command_type,
                "command_payload": json.dumps(command_payload) if isinstance(command_payload, dict) else str(command_payload),
            })
        
        return {"jobs": jobs, "count": len(jobs)}


@app.post("/api/v1/jobs/instances/{instance_id}/start")
async def start_job_instance(instance_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Agent endpoint: Mark job as started"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE job_instances 
            SET status = 'running', started_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING id, job_id, node_id
        """, instance_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        await conn.execute("""
            INSERT INTO job_logs (instance_id, level, message)
            VALUES ($1, 'info', 'Job execution started')
        """, instance_id)
        
        return {"status": "running", "instanceId": instance_id}


@app.post("/api/v1/jobs/instances/{instance_id}/result")
async def submit_job_result(instance_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Agent endpoint: Submit job execution result"""
    success = data.get("success", False)
    exit_code = data.get("exitCode", -1)
    stdout = data.get("stdout", "")
    stderr = data.get("stderr", "")
    error_message = data.get("errorMessage", "")
    duration_ms = data.get("durationMs", 0)
    
    status = "success" if success else "failed"
    
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE job_instances 
            SET status = $1, completed_at = NOW(), updated_at = NOW(),
                exit_code = $2, stdout = $3, stderr = $4, error_message = $5, 
                duration_ms = $6
            WHERE id = $7
            RETURNING id, job_id, node_id, attempt, max_attempts
        """, status, exit_code, stdout[:50000] if stdout else None, 
             stderr[:50000] if stderr else None, error_message, duration_ms, instance_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        # Log completion
        await conn.execute("""
            INSERT INTO job_logs (instance_id, level, message)
            VALUES ($1, $2, $3)
        """, instance_id, "info" if success else "error", 
             f"Job completed: exit_code={exit_code}")
        
        # Trigger alert on failure
        if not success:
            # Get job and node info for alert
            job_info = await conn.fetchrow("""
                SELECT j.name as job_name, n.hostname 
                FROM job_instances ji
                JOIN jobs j ON ji.job_id = j.id
                JOIN nodes n ON ji.node_id = n.node_id
                WHERE ji.id = $1
            """, instance_id)
            if job_info:
                try:
                    await trigger_alert('job_failed', {
                        'message': f"Job '{job_info['job_name']}' failed on {job_info['hostname']}",
                        'job_name': job_info['job_name'],
                        'hostname': job_info['hostname'],
                        'exit_code': exit_code,
                        'error': error_message or stderr[:500] if stderr else 'Unknown error'
                    })
                except Exception as e:
                    print(f"Alert trigger error: {e}")
        
        # Check if should retry
        should_retry = False
        if not success and row["attempt"] < row["max_attempts"]:
            should_retry = True
            await conn.execute("""
                UPDATE job_instances 
                SET status = 'pending', attempt = attempt + 1, updated_at = NOW()
                WHERE id = $1
            """, instance_id)
        
        return {
            "status": status,
            "instanceId": instance_id,
            "willRetry": should_retry
        }


# Legacy endpoint for old Linux agent (snake_case fields, different path)
@app.post("/api/v1/jobs/result")
async def submit_job_result_legacy(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Legacy agent endpoint: Submit job result (old format with instance_id in body)"""
    instance_id = data.get("instance_id")
    if not instance_id:
        raise HTTPException(status_code=400, detail="instance_id required")
    
    # Support both old (snake_case) and new (camelCase) field names
    exit_code = data.get("exit_code", data.get("exitCode", -1))
    status = data.get("status", "failed")
    stdout = data.get("output", data.get("stdout", ""))
    stderr = data.get("stderr", "")
    
    success = status == "success" or exit_code == 0
    
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE job_instances 
            SET status = $1, completed_at = NOW(), updated_at = NOW(),
                exit_code = $2, stdout = $3, stderr = $4
            WHERE id = $5
            RETURNING id
        """, "success" if success else "failed", exit_code, 
             stdout[:50000] if stdout else None, stderr[:50000] if stderr else None, 
             instance_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        return {"status": "success" if success else "failed", "instanceId": instance_id}


@app.post("/api/v1/jobs/instances/{instance_id}/retry")
async def retry_job_instance(instance_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Manually retry a failed or cancelled job instance"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, status, attempt, max_attempts FROM job_instances WHERE id = $1
        """, instance_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Instance not found")
        
        if row["status"] not in ("failed", "cancelled"):
            raise HTTPException(status_code=400, detail=f"Cannot retry instance with status: {row['status']}")
        
        # Reset to pending with incremented attempt (or reset if at max)
        new_attempt = 1  # Reset attempts for manual retry
        await conn.execute("""
            UPDATE job_instances 
            SET status = 'pending', 
                attempt = $2,
                started_at = NULL,
                completed_at = NULL,
                exit_code = NULL,
                stdout = NULL,
                stderr = NULL,
                error_message = NULL,
                updated_at = NOW()
            WHERE id = $1
        """, instance_id, new_attempt)
        
        await conn.execute("""
            INSERT INTO job_logs (instance_id, level, message)
            VALUES ($1, 'info', 'Job manually retried')
        """, instance_id)
        
        return {"status": "pending", "instanceId": instance_id, "attempt": new_attempt}


@app.delete("/api/v1/jobs/{job_id}")
async def cancel_job(job_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Cancel a job and all pending instances"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            UPDATE job_instances 
            SET status = 'cancelled', updated_at = NOW()
            WHERE job_id = $1 AND status IN ('pending', 'queued')
            RETURNING id
        """, job_id)
        
        return {"status": "cancelled", "instancesCancelled": len(rows)}

# PACKAGE MANAGEMENT API (E4)
# ============================================

@app.get("/api/v1/packages")
async def list_packages(category: str = None, active_only: bool = True, db: asyncpg.Pool = Depends(get_db)):
    """List all packages"""
    async with db.acquire() as conn:
        query = """
            SELECT p.id, p.name, p.display_name, p.vendor, p.description, p.category,
                   p.os_type, p.architecture, p.icon_url, p.tags, p.is_active, p.created_at,
                   (SELECT COUNT(*) FROM package_versions pv WHERE pv.package_id = p.id) as version_count,
                   (SELECT pv.version FROM package_versions pv WHERE pv.package_id = p.id AND pv.is_latest = true LIMIT 1) as latest_version
            FROM packages p
            WHERE 1=1
        """
        params = []
        param_idx = 1
        
        if active_only:
            query += " AND p.is_active = true"
        
        if category:
            query += f" AND p.category = ${param_idx}"
            params.append(category)
            param_idx += 1
        
        query += " ORDER BY p.display_name ASC"
        
        rows = await conn.fetch(query, *params)
        
        packages = []
        for row in rows:
            packages.append({
                "id": str(row["id"]),
                "name": row["name"],
                "displayName": row["display_name"],
                "vendor": row["vendor"],
                "description": row["description"],
                "category": row["category"],
                "osType": row["os_type"],
                "architecture": row["architecture"],
                "iconUrl": row["icon_url"],
                "tags": row["tags"] or [],
                "isActive": row["is_active"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
                "versionCount": row["version_count"],
                "latestVersion": row["latest_version"]
            })
        
        return {"packages": packages, "count": len(packages)}


@app.post("/api/v1/packages")
async def create_package(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new package"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO packages (name, display_name, vendor, description, category,
                                  os_type, os_min_version, architecture, homepage_url, 
                                  icon_url, tags, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        """,
            data.get("name"),
            data.get("displayName", data.get("name")),
            data.get("vendor"),
            data.get("description"),
            data.get("category"),
            data.get("osType", "windows"),
            data.get("osMinVersion"),
            data.get("architecture", "any"),
            data.get("homepageUrl"),
            data.get("iconUrl"),
            data.get("tags", []),
            data.get("createdBy", "api")
        )
        return {"id": str(row["id"]), "status": "created"}


@app.get("/api/v1/packages/{package_id}")
async def get_package(package_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get package details with versions"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, name, display_name, vendor, description, category,
                   os_type, os_min_version, architecture, homepage_url, icon_url, 
                   tags, is_active, created_by, created_at, updated_at
            FROM packages WHERE id = $1
        """, package_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Package not found")
        
        package = {
            "id": str(row["id"]),
            "name": row["name"],
            "displayName": row["display_name"],
            "vendor": row["vendor"],
            "description": row["description"],
            "category": row["category"],
            "osType": row["os_type"],
            "osMinVersion": row["os_min_version"],
            "architecture": row["architecture"],
            "homepageUrl": row["homepage_url"],
            "iconUrl": row["icon_url"],
            "tags": row["tags"] or [],
            "isActive": row["is_active"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None
        }
        
        # Get versions
        versions = await conn.fetch("""
            SELECT id, version, filename, file_size, sha256_hash,
                   install_command, install_args, uninstall_command, uninstall_args,
                   requires_reboot, requires_admin, silent_install,
                   is_latest, is_active, release_date, release_notes, created_at
            FROM package_versions 
            WHERE package_id = $1
            ORDER BY created_at DESC
        """, package_id)
        
        package["versions"] = [{
            "id": str(v["id"]),
            "version": v["version"],
            "filename": v["filename"],
            "fileSize": v["file_size"],
            "sha256Hash": v["sha256_hash"],
            "installCommand": v["install_command"],
            "installArgs": v["install_args"],
            "uninstallCommand": v["uninstall_command"],
            "uninstallArgs": v["uninstall_args"],
            "requiresReboot": v["requires_reboot"],
            "requiresAdmin": v["requires_admin"],
            "silentInstall": v["silent_install"],
            "isLatest": v["is_latest"],
            "isActive": v["is_active"],
            "releaseDate": v["release_date"].isoformat() if v["release_date"] else None,
            "releaseNotes": v["release_notes"],
            "createdAt": v["created_at"].isoformat() if v["created_at"] else None
        } for v in versions]
        
        return package


@app.put("/api/v1/packages/{package_id}")
async def update_package(package_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update package details"""
    async with db.acquire() as conn:
        await conn.execute("""
            UPDATE packages SET
                display_name = COALESCE($2, display_name),
                vendor = COALESCE($3, vendor),
                description = COALESCE($4, description),
                category = COALESCE($5, category),
                os_type = COALESCE($6, os_type),
                architecture = COALESCE($7, architecture),
                homepage_url = COALESCE($8, homepage_url),
                icon_url = COALESCE($9, icon_url),
                tags = COALESCE($10, tags),
                is_active = COALESCE($11, is_active),
                updated_at = NOW()
            WHERE id = $1
        """,
            package_id,
            data.get("displayName"),
            data.get("vendor"),
            data.get("description"),
            data.get("category"),
            data.get("osType"),
            data.get("architecture"),
            data.get("homepageUrl"),
            data.get("iconUrl"),
            data.get("tags"),
            data.get("isActive")
        )
        return {"status": "updated"}


@app.delete("/api/v1/packages/{package_id}")
async def delete_package(package_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package (cascades to versions)"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM packages WHERE id = $1 RETURNING name", package_id)
        if not row:
            raise HTTPException(status_code=404, detail="Package not found")
        return {"status": "deleted", "name": row["name"]}


# ============================================
# PACKAGE VERSIONS API
# ============================================

@app.post("/api/v1/packages/{package_id}/versions")
async def create_package_version(package_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new version for a package"""
    async with db.acquire() as conn:
        # If this is marked as latest, unset other latest
        if data.get("isLatest", False):
            await conn.execute("""
                UPDATE package_versions SET is_latest = false WHERE package_id = $1
            """, package_id)
        
        row = await conn.fetchrow("""
            INSERT INTO package_versions (
                package_id, version, filename, file_size, sha256_hash,
                install_command, install_args, uninstall_command, uninstall_args,
                requires_reboot, requires_admin, silent_install,
                is_latest, is_active, release_date, release_notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id
        """,
            package_id,
            data.get("version"),
            data.get("filename"),
            data.get("fileSize"),
            data.get("sha256Hash"),
            data.get("installCommand"),
            json.dumps(data.get("installArgs")) if data.get("installArgs") else None,
            data.get("uninstallCommand"),
            json.dumps(data.get("uninstallArgs")) if data.get("uninstallArgs") else None,
            data.get("requiresReboot", False),
            data.get("requiresAdmin", True),
            data.get("silentInstall", True),
            data.get("isLatest", True),
            data.get("isActive", True),
            data.get("releaseDate"),
            data.get("releaseNotes")
        )
        return {"id": str(row["id"]), "status": "created"}


@app.get("/api/v1/packages/{package_id}/versions/{version_id}")
async def get_package_version(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a specific version with detection rules"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, version, filename, file_size, sha256_hash,
                   install_command, install_args, uninstall_command, uninstall_args,
                   requires_reboot, requires_admin, silent_install,
                   is_latest, is_active, release_date, release_notes, created_at
            FROM package_versions 
            WHERE id = $1 AND package_id = $2
        """, version_id, package_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        
        version = {
            "id": str(row["id"]),
            "version": row["version"],
            "filename": row["filename"],
            "fileSize": row["file_size"],
            "sha256Hash": row["sha256_hash"],
            "installCommand": row["install_command"],
            "installArgs": row["install_args"],
            "uninstallCommand": row["uninstall_command"],
            "uninstallArgs": row["uninstall_args"],
            "requiresReboot": row["requires_reboot"],
            "requiresAdmin": row["requires_admin"],
            "silentInstall": row["silent_install"],
            "isLatest": row["is_latest"],
            "isActive": row["is_active"],
            "releaseDate": row["release_date"].isoformat() if row["release_date"] else None,
            "releaseNotes": row["release_notes"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None
        }
        
        # Get detection rules
        rules = await conn.fetch("""
            SELECT id, rule_order, rule_type, config, operator
            FROM detection_rules 
            WHERE package_version_id = $1
            ORDER BY rule_order ASC
        """, version_id)
        
        version["detectionRules"] = [{
            "id": str(r["id"]),
            "order": r["rule_order"],
            "type": r["rule_type"],
            "config": r["config"],
            "operator": r["operator"]
        } for r in rules]
        
        # Get sources
        sources = await conn.fetch("""
            SELECT pvs.id, ps.id as source_id, ps.name, ps.source_type, ps.base_url,
                   pvs.relative_path, pvs.priority
            FROM package_version_sources pvs
            JOIN package_sources ps ON ps.id = pvs.source_id
            WHERE pvs.package_version_id = $1
            ORDER BY pvs.priority ASC
        """, version_id)
        
        version["sources"] = [{
            "id": str(s["id"]),
            "sourceId": str(s["source_id"]),
            "sourceName": s["name"],
            "sourceType": s["source_type"],
            "baseUrl": s["base_url"],
            "relativePath": s["relative_path"],
            "priority": s["priority"]
        } for s in sources]
        
        return version


@app.put("/api/v1/packages/{package_id}/versions/{version_id}")
async def update_package_version(package_id: str, version_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update a package version"""
    async with db.acquire() as conn:
        # Build dynamic UPDATE query
        updates = []
        params = []
        param_idx = 1
        
        field_mapping = {
            "installCommand": "install_command",
            "installArgs": "install_args",
            "uninstallCommand": "uninstall_command",
            "uninstallArgs": "uninstall_args",
            "requiresReboot": "requires_reboot",
            "requiresAdmin": "requires_admin",
            "silentInstall": "silent_install",
            "isLatest": "is_latest",
            "isActive": "is_active",
            "releaseNotes": "release_notes",
            "sha256Hash": "sha256_hash",
        }
        
        for json_key, db_col in field_mapping.items():
            if json_key in data:
                updates.append(f"{db_col} = ${param_idx}")
                params.append(data[json_key])
                param_idx += 1
        
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        params.append(version_id)
        params.append(package_id)
        
        query = f"""
            UPDATE package_versions 
            SET {", ".join(updates)}, updated_at = NOW()
            WHERE id = ${param_idx} AND package_id = ${param_idx + 1}
            RETURNING version
        """
        
        row = await conn.fetchrow(query, *params)
        
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        
        return {"status": "updated", "version": row["version"]}


@app.delete("/api/v1/packages/{package_id}/versions/{version_id}")
async def delete_package_version(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package version"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            DELETE FROM package_versions 
            WHERE id = $1 AND package_id = $2
            RETURNING version
        """, version_id, package_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        return {"status": "deleted", "version": row["version"]}


# ============================================
# DETECTION RULES API
# ============================================

@app.post("/api/v1/packages/{package_id}/versions/{version_id}/rules")
async def create_detection_rule(package_id: str, version_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a detection rule for a version"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO detection_rules (package_version_id, rule_order, rule_type, config, operator)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        """,
            version_id,
            data.get("order", 1),
            data.get("type"),
            json.dumps(data.get("config", {})),
            data.get("operator", "AND")
        )
        return {"id": str(row["id"]), "status": "created"}


@app.delete("/api/v1/detection-rules/{rule_id}")
async def delete_detection_rule(rule_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a detection rule"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM detection_rules WHERE id = $1 RETURNING id", rule_id)
        if not row:
            raise HTTPException(status_code=404, detail="Rule not found")
        return {"status": "deleted"}


# ============================================
# PACKAGE SOURCES API
# ============================================

@app.get("/api/v1/package-sources")
async def list_package_sources(db: asyncpg.Pool = Depends(get_db)):
    """List all package sources"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, name, description, source_type, base_url, auth_config,
                   is_active, priority, created_at
            FROM package_sources
            ORDER BY priority ASC, name ASC
        """)
        
        sources = [{
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "sourceType": row["source_type"],
            "baseUrl": row["base_url"],
            "hasAuth": row["auth_config"] is not None,
            "isActive": row["is_active"],
            "priority": row["priority"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None
        } for row in rows]
        
        return {"sources": sources, "count": len(sources)}


@app.post("/api/v1/package-sources")
async def create_package_source(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a package source (SMB share, HTTP, etc.)"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO package_sources (name, description, source_type, base_url, auth_config, priority)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        """,
            data.get("name"),
            data.get("description"),
            data.get("sourceType", "http"),
            data.get("baseUrl"),
            json.dumps(data.get("authConfig")) if data.get("authConfig") else None,
            data.get("priority", 10)
        )
        return {"id": str(row["id"]), "status": "created"}


@app.delete("/api/v1/package-sources/{source_id}")
async def delete_package_source(source_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package source"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM package_sources WHERE id = $1 RETURNING name", source_id)
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")
        return {"status": "deleted", "name": row["name"]}


# ============================================
# AGENT: PACKAGE DETECTION/DOWNLOAD ENDPOINTS
# ============================================

@app.get("/api/v1/packages/{package_id}/versions/{version_id}/detect")
async def get_detection_info(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get detection info for agent to check if package is installed"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT pv.version, p.name, p.display_name
            FROM package_versions pv
            JOIN packages p ON p.id = pv.package_id
            WHERE pv.id = $1 AND pv.package_id = $2
        """, version_id, package_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        
        rules = await conn.fetch("""
            SELECT rule_type, config, operator, rule_order
            FROM detection_rules 
            WHERE package_version_id = $1
            ORDER BY rule_order ASC
        """, version_id)
        
        return {
            "version": row["version"],
            "packageName": row["name"],
            "displayName": row["display_name"],
            "rules": [{
                "type": r["rule_type"],
                "config": r["config"],
                "operator": r["operator"],
                "order": r["rule_order"]
            } for r in rules]
        }


@app.get("/api/v1/packages/{package_id}/versions/{version_id}/download-info")
async def get_download_info(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get download URLs for agent"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT filename, sha256_hash, file_size,
                   install_command, install_args, 
                   uninstall_command, uninstall_args,
                   requires_reboot, requires_admin, silent_install
            FROM package_versions
            WHERE id = $1 AND package_id = $2
        """, version_id, package_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        
        sources = await conn.fetch("""
            SELECT ps.source_type, ps.base_url, pvs.relative_path, pvs.priority
            FROM package_version_sources pvs
            JOIN package_sources ps ON ps.id = pvs.source_id
            WHERE pvs.package_version_id = $1 AND ps.is_active = true
            ORDER BY pvs.priority ASC
        """, version_id)
        
        source_list = []
        for s in sources:
            base_url = s["base_url"].rstrip('/')
            rel_path = s["relative_path"].lstrip('/') if s["relative_path"] else row["filename"]
            source_list.append({
                "type": s["source_type"],
                "url": f"{base_url}/{rel_path}",
                "priority": s["priority"]
            })
        
        return {
            "filename": row["filename"],
            "sha256Hash": row["sha256_hash"],
            "fileSize": row["file_size"],
            "installCommand": row["install_command"],
            "installArgs": row["install_args"],
            "uninstallCommand": row["uninstall_command"],
            "uninstallArgs": row["uninstall_args"],
            "requiresReboot": row["requires_reboot"],
            "requiresAdmin": row["requires_admin"],
            "silentInstall": row["silent_install"],
            "sources": source_list
        }




# ============================================
# EVENTLOG COLLECTION ENDPOINTS
# ============================================

@app.post("/api/v1/nodes/{node_id}/eventlog")
async def push_eventlog(node_id: str, request: Request, db: asyncpg.Pool = Depends(get_db)):
    """Receive eventlog entries from agent"""
    data = await request.json()
    events = data.get("events", [])
    
    if not events:
        return {"status": "ok", "inserted": 0}
    
    async with db.acquire() as conn:
        # Verify node exists
        node = await conn.fetchrow("SELECT node_id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        inserted = 0
        for event in events:
            try:
                await conn.execute("""
                    INSERT INTO eventlog_entries 
                    (node_id, log_name, event_id, level, level_name, source, message, event_time, raw_data)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                    node_id,
                    sanitize_for_postgres(event.get("logName", "Unknown")),
                    event.get("eventId", 0),
                    event.get("level", 4),
                    sanitize_for_postgres(event.get("levelName")),
                    sanitize_for_postgres(event.get("source")),
                    sanitize_for_postgres(event.get("message", ""))[:4000],  # Limit message size
                    parse_datetime(event.get("eventTime")) or datetime.utcnow(),
                    json.dumps(sanitize_for_postgres(event.get("rawData"))) if event.get("rawData") else None
                )
                inserted += 1
            except Exception as e:
                print(f"Error inserting event: {e}")
                continue
        
        return {"status": "ok", "inserted": inserted, "total": len(events)}


@app.get("/api/v1/nodes/{node_id}/eventlog")
async def get_node_eventlog(
    node_id: str,
    log_name: Optional[str] = None,
    level: Optional[int] = None,  # Max level (1=Critical only, 2=+Error, etc.)
    event_id: Optional[int] = None,
    hours: int = 24,
    limit: int = 100,
    offset: int = 0,
    db: asyncpg.Pool = Depends(get_db)
):
    """Get eventlog entries for a node with filtering"""
    async with db.acquire() as conn:
        # Build query with filters
        conditions = ["node_id = $1", "collected_at > NOW() - $2 * INTERVAL '1 hour'"]
        params = [node_id, hours]
        param_idx = 3
        
        if log_name:
            conditions.append(f"log_name = ${param_idx}")
            params.append(log_name)
            param_idx += 1
        
        if level:
            conditions.append(f"level <= ${param_idx}")
            params.append(level)
            param_idx += 1
        
        if event_id:
            conditions.append(f"event_id = ${param_idx}")
            params.append(event_id)
            param_idx += 1
        
        where_clause = " AND ".join(conditions)
        
        # Get total count
        count = await conn.fetchval(f"""
            SELECT COUNT(*) FROM eventlog_entries WHERE {where_clause}
        """, *params)
        
        # Get events
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT id, log_name, event_id, level, level_name, source, 
                   LEFT(message, 500) as message, event_time, collected_at
            FROM eventlog_entries 
            WHERE {where_clause}
            ORDER BY event_time DESC
            LIMIT ${param_idx} OFFSET ${param_idx + 1}
        """, *params)
        
        events = [dict(r) for r in rows]
        
        # Convert datetimes to ISO strings
        for e in events:
            if e.get("event_time"):
                e["eventTime"] = e.pop("event_time").isoformat()
            if e.get("collected_at"):
                e["collectedAt"] = e.pop("collected_at").isoformat()
            e["eventId"] = e.pop("event_id")
            e["logName"] = e.pop("log_name")
            e["levelName"] = e.pop("level_name")
        
        return {
            "nodeId": node_id,
            "events": events,
            "total": count,
            "limit": limit,
            "offset": offset
        }


@app.get("/api/v1/eventlog/summary")
async def get_eventlog_summary(hours: int = 24, db: asyncpg.Pool = Depends(get_db)):
    """Get eventlog summary across all nodes for dashboard"""
    async with db.acquire() as conn:
        # Summary per node
        rows = await conn.fetch("""
            SELECT 
                e.node_id,
                n.hostname,
                e.log_name,
                COUNT(*) FILTER (WHERE e.level = 1) as critical_count,
                COUNT(*) FILTER (WHERE e.level = 2) as error_count,
                COUNT(*) FILTER (WHERE e.level = 3) as warning_count,
                COUNT(*) as total_count,
                MAX(e.collected_at) as last_collected
            FROM eventlog_entries e
            JOIN nodes n ON n.node_id = e.node_id
            WHERE e.collected_at > NOW() - $1 * INTERVAL '1 hour'
            GROUP BY e.node_id, n.hostname, e.log_name
            ORDER BY critical_count DESC, error_count DESC
        """, hours)
        
        summary = [dict(r) for r in rows]
        for s in summary:
            if s.get("last_collected"):
                s["lastCollected"] = s.pop("last_collected").isoformat()
            s["criticalCount"] = s.pop("critical_count")
            s["errorCount"] = s.pop("error_count")
            s["warningCount"] = s.pop("warning_count")
            s["totalCount"] = s.pop("total_count")
            s["nodeId"] = s.pop("node_id")
            s["logName"] = s.pop("log_name")
        
        # Recent critical/error events
        critical_events = await conn.fetch("""
            SELECT e.id, e.node_id, n.hostname, e.log_name, e.event_id, 
                   e.level, e.level_name, e.source, LEFT(e.message, 200) as message, e.event_time
            FROM eventlog_entries e
            JOIN nodes n ON n.node_id = e.node_id
            WHERE e.level <= 2 AND e.collected_at > NOW() - $1 * INTERVAL '1 hour'
            ORDER BY e.event_time DESC
            LIMIT 20
        """, hours)
        
        recent = []
        for r in critical_events:
            event = dict(r)
            if event.get("event_time"):
                event["eventTime"] = event.pop("event_time").isoformat()
            event["eventId"] = event.pop("event_id")
            event["nodeId"] = event.pop("node_id")
            event["logName"] = event.pop("log_name")
            event["levelName"] = event.pop("level_name")
            recent.append(event)
        
        return {
            "hours": hours,
            "summaryByNode": summary,
            "recentCritical": recent
        }


@app.get("/api/v1/eventlog/important-events")
async def get_important_events(hours: int = 24, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    """Get security-relevant events (login failures, user changes, etc.)"""
    # Important Security Event IDs
    important_event_ids = [
        4624,  # Successful login
        4625,  # Failed login
        4634,  # Logoff
        4648,  # Explicit credential logon
        4720,  # User created
        4722,  # User enabled
        4725,  # User disabled
        4726,  # User deleted
        4732,  # Member added to security group
        4733,  # Member removed from security group
        4672,  # Special privileges assigned
        4688,  # Process created
        4697,  # Service installed
        7045,  # Service installed (System log)
        1102,  # Audit log cleared
    ]
    
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT e.id, e.node_id, n.hostname, e.log_name, e.event_id, 
                   e.level, e.level_name, e.source, LEFT(e.message, 500) as message, e.event_time
            FROM eventlog_entries e
            JOIN nodes n ON n.node_id = e.node_id
            WHERE e.event_id = ANY($1) 
              AND e.collected_at > NOW() - $2 * INTERVAL '1 hour'
            ORDER BY e.event_time DESC
            LIMIT $3
        """, important_event_ids, hours, limit)
        
        events = []
        for r in rows:
            event = dict(r)
            if event.get("event_time"):
                event["eventTime"] = event.pop("event_time").isoformat()
            event["eventId"] = event.pop("event_id")
            event["nodeId"] = event.pop("node_id")
            event["logName"] = event.pop("log_name")
            event["levelName"] = event.pop("level_name")
            events.append(event)
        
        return {
            "hours": hours,
            "events": events,
            "monitoredEventIds": important_event_ids
        }


@app.post("/api/v1/jobs/{job_id}/parse-eventlog")
async def parse_eventlog_from_job(job_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Parse eventlog data from a completed job and store in eventlog_entries"""
    async with db.acquire() as conn:
        # Get job instances with stdout
        instances = await conn.fetch("""
            SELECT id, node_id, stdout, status
            FROM job_instances 
            WHERE job_id = $1 AND status = 'success' AND stdout IS NOT NULL
        """, job_id)
        
        if not instances:
            return {"status": "no_data", "message": "No successful instances with output found"}
        
        total_inserted = 0
        results = []
        
        for inst in instances:
            node_id = inst["node_id"]
            stdout = inst["stdout"]
            
            # Extract JSON from stdout (skip "=== MAIN COMMAND ===" prefix)
            json_start = stdout.find('[')
            if json_start == -1:
                results.append({"nodeId": node_id, "status": "no_json", "inserted": 0})
                continue
            
            json_data = stdout[json_start:]
            
            try:
                events = json.loads(json_data)
                if not isinstance(events, list):
                    events = [events]
                
                inserted = 0
                for event in events:
                    try:
                        await conn.execute("""
                            INSERT INTO eventlog_entries 
                            (node_id, log_name, event_id, level, level_name, source, message, event_time)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                            ON CONFLICT DO NOTHING
                        """,
                            node_id,
                            sanitize_for_postgres(event.get("logName", "Unknown")),
                            event.get("eventId", 0),
                            event.get("level", 4),
                            sanitize_for_postgres(event.get("levelName")),
                            sanitize_for_postgres(event.get("source")),
                            sanitize_for_postgres(event.get("message", ""))[:4000],
                            parse_datetime(event.get("eventTime")) or datetime.utcnow()
                        )
                        inserted += 1
                    except Exception as e:
                        print(f"Error inserting event for {node_id}: {e}")
                        continue
                
                total_inserted += inserted
                results.append({"nodeId": node_id, "status": "ok", "inserted": inserted, "total": len(events)})
                
            except json.JSONDecodeError as e:
                results.append({"nodeId": node_id, "status": "json_error", "error": str(e)})
        
        return {
            "jobId": job_id,
            "totalInserted": total_inserted,
            "results": results
        }


# ============== METRICS API ==============

@app.post("/api/v1/nodes/{node_id}/metrics", dependencies=[Depends(verify_api_key)])
async def push_metrics(node_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Receive metrics from a node"""
    async with db.acquire() as conn:
        # Get node UUID (case-insensitive)
        node = await conn.fetchrow("SELECT id FROM nodes WHERE UPPER(node_id) = UPPER($1)", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        node_uuid = node["id"]
        
        await conn.execute("""
            INSERT INTO node_metrics (time, node_id, cpu_percent, ram_percent, disk_percent, network_in_mb, network_out_mb)
            VALUES (NOW(), $1, $2, $3, $4, $5, $6)
        """, node_uuid, 
            data.get("cpuPercent"),
            data.get("ramPercent"),
            data.get("diskPercent"),
            data.get("networkInMb"),
            data.get("networkOutMb")
        )
        
        return {"status": "ok"}


@app.get("/api/v1/nodes/{node_id}/metrics", dependencies=[Depends(verify_api_key)])
async def get_node_metrics(node_id: str, hours: int = 24, db: asyncpg.Pool = Depends(get_db)):
    """Get metrics for a node with time series data"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        node_uuid = node["id"]
        
        # Get raw metrics
        rows = await conn.fetch("""
            SELECT time, cpu_percent, ram_percent, disk_percent, network_in_mb, network_out_mb
            FROM node_metrics
            WHERE node_id = $1 AND time > NOW() - INTERVAL '%s hours'
            ORDER BY time ASC
        """ % hours, node_uuid)
        
        metrics = [{
            "time": row["time"].isoformat(),
            "cpuPercent": row["cpu_percent"],
            "ramPercent": row["ram_percent"],
            "diskPercent": row["disk_percent"],
            "networkInMb": row["network_in_mb"],
            "networkOutMb": row["network_out_mb"]
        } for row in rows]
        
        # Calculate averages
        if metrics:
            avg_cpu = sum(m["cpuPercent"] or 0 for m in metrics) / len(metrics)
            avg_ram = sum(m["ramPercent"] or 0 for m in metrics) / len(metrics)
            avg_disk = sum(m["diskPercent"] or 0 for m in metrics) / len(metrics)
        else:
            avg_cpu = avg_ram = avg_disk = None
        
        return {
            "nodeId": node_id,
            "hours": hours,
            "dataPoints": len(metrics),
            "averages": {
                "cpuPercent": round(avg_cpu, 1) if avg_cpu else None,
                "ramPercent": round(avg_ram, 1) if avg_ram else None,
                "diskPercent": round(avg_disk, 1) if avg_disk else None
            },
            "metrics": metrics
        }


@app.get("/api/v1/metrics/summary", dependencies=[Depends(verify_api_key)])
async def get_metrics_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get metrics summary for all nodes (for dashboard)"""
    async with db.acquire() as conn:
        # Get latest metrics per node
        rows = await conn.fetch("""
            WITH latest AS (
                SELECT DISTINCT ON (node_id) 
                    node_id, time, cpu_percent, ram_percent, disk_percent
                FROM node_metrics
                WHERE time > NOW() - INTERVAL '1 hour'
                ORDER BY node_id, time DESC
            )
            SELECT n.node_id as text_node_id, n.hostname, 
                   l.time, l.cpu_percent, l.ram_percent, l.disk_percent
            FROM nodes n
            LEFT JOIN latest l ON l.node_id = n.id
            ORDER BY n.hostname
        """)
        
        nodes = [{
            "nodeId": row["text_node_id"],
            "hostname": row["hostname"],
            "lastMetricTime": row["time"].isoformat() if row["time"] else None,
            "cpuPercent": row["cpu_percent"],
            "ramPercent": row["ram_percent"],
            "diskPercent": row["disk_percent"]
        } for row in rows]
        
        # Calculate fleet averages
        active_nodes = [n for n in nodes if n["cpuPercent"] is not None]
        if active_nodes:
            fleet_avg = {
                "cpuPercent": round(sum(n["cpuPercent"] for n in active_nodes) / len(active_nodes), 1),
                "ramPercent": round(sum(n["ramPercent"] for n in active_nodes) / len(active_nodes), 1),
                "diskPercent": round(sum(n["diskPercent"] for n in active_nodes) / len(active_nodes), 1)
            }
        else:
            fleet_avg = {"cpuPercent": None, "ramPercent": None, "diskPercent": None}
        
        return {
            "nodesWithMetrics": len(active_nodes),
            "totalNodes": len(nodes),
            "fleetAverages": fleet_avg,
            "nodes": nodes
        }


@app.get("/api/v1/metrics/fleet", dependencies=[Depends(verify_api_key)])
async def get_fleet_performance(hours: int = 1, db: asyncpg.Pool = Depends(get_db)):
    """
    Get detailed fleet performance data for the performance overview table.
    Returns avg/max/min for CPU, RAM, Disk, Network for each node.
    """
    async with db.acquire() as conn:
        # Get aggregated metrics per node for the last N hours
        rows = await conn.fetch("""
            SELECT 
                n.id,
                n.node_id as text_node_id, 
                n.hostname,
                n.os_name,
                n.last_seen,
                n.is_online,
                -- CPU stats
                ROUND(AVG(m.cpu_percent)::numeric, 1) as avg_cpu,
                ROUND(MAX(m.cpu_percent)::numeric, 1) as max_cpu,
                ROUND(MIN(m.cpu_percent)::numeric, 1) as min_cpu,
                -- RAM stats
                ROUND(AVG(m.ram_percent)::numeric, 1) as avg_ram,
                ROUND(MAX(m.ram_percent)::numeric, 1) as max_ram,
                -- Disk stats
                ROUND(AVG(m.disk_percent)::numeric, 1) as avg_disk,
                ROUND(MAX(m.disk_percent)::numeric, 1) as max_disk,
                -- Network stats
                ROUND(AVG(m.network_in_mb)::numeric, 2) as avg_net_in,
                ROUND(AVG(m.network_out_mb)::numeric, 2) as avg_net_out,
                ROUND(MAX(m.network_in_mb)::numeric, 2) as max_net_in,
                ROUND(MAX(m.network_out_mb)::numeric, 2) as max_net_out,
                -- Data point count
                COUNT(m.*)::int as data_points
            FROM nodes n
            LEFT JOIN node_metrics m ON m.node_id = n.id 
                AND m.time > NOW() - INTERVAL '1 hour' * $1
            GROUP BY n.id, n.node_id, n.hostname, n.os_name, n.last_seen, n.is_online
            ORDER BY n.hostname
        """, hours)
        
        nodes = []
        for row in rows:
            nodes.append({
                "id": str(row["id"]),
                "nodeId": row["text_node_id"],
                "hostname": row["hostname"],
                "osName": row["os_name"],
                "lastSeen": row["last_seen"].isoformat() if row["last_seen"] else None,
                "isOnline": row["is_online"],
                "dataPoints": row["data_points"],
                "cpu": {
                    "avg": float(row["avg_cpu"]) if row["avg_cpu"] else None,
                    "max": float(row["max_cpu"]) if row["max_cpu"] else None,
                    "min": float(row["min_cpu"]) if row["min_cpu"] else None,
                },
                "ram": {
                    "avg": float(row["avg_ram"]) if row["avg_ram"] else None,
                    "max": float(row["max_ram"]) if row["max_ram"] else None,
                },
                "disk": {
                    "avg": float(row["avg_disk"]) if row["avg_disk"] else None,
                    "max": float(row["max_disk"]) if row["max_disk"] else None,
                },
                "network": {
                    "avgIn": float(row["avg_net_in"]) if row["avg_net_in"] else None,
                    "avgOut": float(row["avg_net_out"]) if row["avg_net_out"] else None,
                    "maxIn": float(row["max_net_in"]) if row["max_net_in"] else None,
                    "maxOut": float(row["max_net_out"]) if row["max_net_out"] else None,
                },
            })
        
        # Calculate fleet totals
        active = [n for n in nodes if n["cpu"]["avg"] is not None]
        fleet = {
            "avgCpu": round(sum(n["cpu"]["avg"] for n in active) / len(active), 1) if active else None,
            "avgRam": round(sum(n["ram"]["avg"] for n in active) / len(active), 1) if active else None,
            "avgDisk": round(sum(n["disk"]["avg"] for n in active) / len(active), 1) if active else None,
        }
        
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "hoursAggregated": hours,
            "totalNodes": len(nodes),
            "nodesWithMetrics": len(active),
            "fleet": fleet,
            "nodes": nodes
        }


# NOTE: metrics/history endpoint moved to Line ~6990 with more parameters


# ========== E5: Deployment Engine ==========

@app.post("/api/v1/deployments", dependencies=[Depends(verify_api_key)])
async def create_deployment(data: dict):
    """Create a new deployment (package version -> target)"""
    required = ["name", "packageVersionId", "targetType"]
    for f in required:
        if f not in data:
            raise HTTPException(400, f"Missing required field: {f}")
    
    package_version_id = data["packageVersionId"]
    target_type = data["targetType"]
    target_id = data.get("targetId")
    mode = data.get("mode", "required")
    
    if target_type not in ("node", "group", "all"):
        raise HTTPException(400, "targetType must be node, group, or all")
    if mode not in ("required", "available", "uninstall"):
        raise HTTPException(400, "mode must be required, available, or uninstall")
    if target_type in ("node", "group") and not target_id:
        raise HTTPException(400, f"targetId required for targetType={target_type}")
    
    async with db_pool.acquire() as conn:
        # Verify package version exists
        pv = await conn.fetchrow("SELECT id FROM package_versions WHERE id = $1", package_version_id)
        if not pv:
            raise HTTPException(404, "Package version not found")
        
        # Create deployment
        dep_id = await conn.fetchval("""
            INSERT INTO deployments (name, description, package_version_id, target_type, target_id, mode, 
                                      status, scheduled_start, scheduled_end, maintenance_window_only, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        """, data["name"], data.get("description"), package_version_id, target_type,
            target_id, mode, data.get("status", "active"),
            data.get("scheduledStart"), data.get("scheduledEnd"),
            data.get("maintenanceWindowOnly", False), data.get("createdBy"))
        
        # Create deployment_status entries for targeted nodes
        if target_type == "all":
            await conn.execute("""
                INSERT INTO deployment_status (deployment_id, node_id, status)
                SELECT $1, id, 'pending' FROM nodes
            """, dep_id)
        elif target_type == "node":
            await conn.execute("""
                INSERT INTO deployment_status (deployment_id, node_id, status)
                VALUES ($1, $2, 'pending')
            """, dep_id, target_id)
        elif target_type == "group":
            await conn.execute("""
                INSERT INTO deployment_status (deployment_id, node_id, status)
                SELECT $1, node_id, 'pending' FROM device_groups WHERE group_id = $2
            """, dep_id, target_id)
        
        return {"id": str(dep_id), "status": "created"}


@app.get("/api/v1/deployments", dependencies=[Depends(verify_api_key)])
async def list_deployments(status: str = None, limit: int = 50):
    """List all deployments with aggregated status"""
    async with db_pool.acquire() as conn:
        query = """
            SELECT d.*, p.name as package_name, pv.version as package_version,
                   COUNT(ds.id) as total_nodes,
                   COUNT(ds.id) FILTER (WHERE ds.status = 'success') as success_count,
                   COUNT(ds.id) FILTER (WHERE ds.status = 'failed') as failed_count,
                   COUNT(ds.id) FILTER (WHERE ds.status = 'pending') as pending_count,
                   COUNT(ds.id) FILTER (WHERE ds.status IN ('downloading', 'installing')) as in_progress_count
            FROM deployments d
            JOIN package_versions pv ON d.package_version_id = pv.id
            JOIN packages p ON pv.package_id = p.id
            LEFT JOIN deployment_status ds ON d.id = ds.deployment_id
        """
        params = []
        if status:
            query += " WHERE d.status = $1"
            params.append(status)
        query += " GROUP BY d.id, p.name, pv.version ORDER BY d.created_at DESC LIMIT $" + str(len(params) + 1)
        params.append(limit)
        
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]


@app.get("/api/v1/deployments/{deployment_id}", dependencies=[Depends(verify_api_key)])
async def get_deployment(deployment_id: str):
    """Get deployment details with per-node status"""
    async with db_pool.acquire() as conn:
        dep = await conn.fetchrow("""
            SELECT d.*, p.name as package_name, pv.version as package_version
            FROM deployments d
            JOIN package_versions pv ON d.package_version_id = pv.id
            JOIN packages p ON pv.package_id = p.id
            WHERE d.id = $1
        """, deployment_id)
        if not dep:
            raise HTTPException(404, "Deployment not found")
        
        statuses = await conn.fetch("""
            SELECT ds.*, n.node_id as node_name, n.hostname
            FROM deployment_status ds
            JOIN nodes n ON ds.node_id = n.id
            WHERE ds.deployment_id = $1
            ORDER BY ds.status, n.hostname
        """, deployment_id)
        
        result = dict(dep)
        result["nodes"] = [dict(s) for s in statuses]
        return result


@app.patch("/api/v1/deployments/{deployment_id}", dependencies=[Depends(verify_api_key)])
async def update_deployment(deployment_id: str, data: dict):
    """Update deployment (pause, resume, cancel)"""
    allowed_fields = {"status", "scheduled_start", "scheduled_end", "maintenance_window_only"}
    updates = {k: v for k, v in data.items() if k in allowed_fields or k.replace("_", "") in ["scheduledStart", "scheduledEnd", "maintenanceWindowOnly"]}
    
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    
    async with db_pool.acquire() as conn:
        field_map = {"scheduledStart": "scheduled_start", "scheduledEnd": "scheduled_end", "maintenanceWindowOnly": "maintenance_window_only"}
        set_clauses = []
        params = [deployment_id]
        i = 2
        for k, v in updates.items():
            col = field_map.get(k, k)
            set_clauses.append(f"{col} = ${i}")
            params.append(v)
            i += 1
        
        set_clauses.append("updated_at = NOW()")
        await conn.execute(f"UPDATE deployments SET {', '.join(set_clauses)} WHERE id = $1", *params)
        return {"status": "updated"}


@app.delete("/api/v1/deployments/{deployment_id}", dependencies=[Depends(verify_api_key)])
async def delete_deployment(deployment_id: str):
    """Delete a deployment"""
    async with db_pool.acquire() as conn:
        result = await conn.execute("DELETE FROM deployments WHERE id = $1", deployment_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Deployment not found")
        return {"status": "deleted"}


@app.get("/api/v1/nodes/{node_id}/deployments", dependencies=[Depends(verify_api_key)])
async def get_node_deployments(node_id: str):
    """Get pending deployments for a specific node (agent polling endpoint)"""
    async with db_pool.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(404, "Node not found")
        
        deployments = await conn.fetch("""
            SELECT d.id as deployment_id, d.name, d.mode, d.maintenance_window_only,
                   p.name as package_name, pv.version as package_version,
                   pv.install_command as installer_type, 
                   pv.download_url as installer_url,
                   pv.install_args,
                   pv.uninstall_args, 
                   pv.sha256_hash as expected_hash,
                   ds.status as node_status, ds.attempts
            FROM deployment_status ds
            JOIN deployments d ON ds.deployment_id = d.id
            JOIN package_versions pv ON d.package_version_id = pv.id
            JOIN packages p ON pv.package_id = p.id
            WHERE ds.node_id = $1
              AND d.status = 'active'
              AND ds.status IN ('pending', 'failed')
              AND (ds.attempts < 3 OR ds.attempts IS NULL)
              AND (d.scheduled_start IS NULL OR d.scheduled_start <= NOW())
              AND (d.scheduled_end IS NULL OR d.scheduled_end >= NOW())
            ORDER BY d.created_at
        """, node["id"])
        
        return [dict(d) for d in deployments]


@app.post("/api/v1/nodes/{node_id}/deployments/{deployment_id}/status", dependencies=[Depends(verify_api_key)])
async def update_node_deployment_status(node_id: str, deployment_id: str, data: dict):
    """Agent reports deployment status for this node"""
    status = data.get("status")
    if status not in ("pending", "downloading", "installing", "success", "failed", "skipped"):
        raise HTTPException(400, "Invalid status")
    
    async with db_pool.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(404, "Node not found")
        
        exit_code = data.get("exitCode")
        output = data.get("output")
        error_message = data.get("errorMessage")
        
        # Update status - use separate statements to avoid type ambiguity
        await conn.execute("""
            UPDATE deployment_status 
            SET status = $1::text, 
                exit_code = $2, 
                output = $3, 
                error_message = $4
            WHERE deployment_id = $5::uuid AND node_id = $6::uuid
        """, status, exit_code, output, error_message, deployment_id, node["id"])
        
        # Update timestamps separately
        if status == "downloading":
            await conn.execute("""
                UPDATE deployment_status 
                SET started_at = COALESCE(started_at, NOW())
                WHERE deployment_id = $1::uuid AND node_id = $2::uuid
            """, deployment_id, node["id"])
        elif status in ("success", "failed", "skipped"):
            await conn.execute("""
                UPDATE deployment_status 
                SET completed_at = NOW(),
                    attempts = attempts + 1,
                    last_attempt_at = NOW()
                WHERE deployment_id = $1::uuid AND node_id = $2::uuid
            """, deployment_id, node["id"])
        
        # Check if all nodes completed -> mark deployment as completed
        stats = await conn.fetchrow("""
            SELECT COUNT(*) as total,
                   COUNT(*) FILTER (WHERE status IN ('success', 'failed', 'skipped')) as completed
            FROM deployment_status WHERE deployment_id = $1
        """, deployment_id)
        
        if stats["total"] == stats["completed"]:
            await conn.execute("UPDATE deployments SET status = 'completed', updated_at = NOW() WHERE id = $1", deployment_id)
        
        return {"status": "updated"}


# Get package versions for dropdown
@app.get("/api/v1/package-versions", dependencies=[Depends(verify_api_key)])
async def list_package_versions(limit: int = 100):
    """List package versions for deployment creation"""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT pv.id, pv.version, p.id as package_id, p.name as package_name, p.display_name
            FROM package_versions pv
            JOIN packages p ON pv.package_id = p.id
            WHERE pv.is_active = true
            ORDER BY p.name, pv.version DESC
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]


# ============================================================================
# E7: ALERTING & NOTIFICATIONS
# ============================================================================

# --- Alert Rules (Legacy - Replaced by E19) ---
# These endpoints use old schema, replaced by /api/v1/alert-* endpoints

# @app.get("/api/v1/alerts/rules", dependencies=[Depends(verify_api_key)])
# async def list_alert_rules_legacy():
#     """Legacy: List all alert rules"""
#     pass


# --- Notification Channels (Legacy - Replaced by E19 /api/v1/alert-channels) ---
# Old endpoints that use notification_channels table - replaced by alert_channels

# Legacy endpoints commented out - use /api/v1/alert-channels, /api/v1/alert-rules instead


@app.get("/api/v1/alerts/test-legacy")
async def test_legacy_endpoint():
    """Placeholder to maintain route prefix"""
    return {"message": "Use /api/v1/alert-channels and /api/v1/alert-rules instead"}


# --- Link Rules to Channels (Legacy) ---
# Removed old link_rule_to_channel endpoints


# --- Alert History (Legacy) ---
# Old alert history endpoint - replaced by /api/v1/alert-history

@app.get("/api/v1/alerts", dependencies=[Depends(verify_api_key)])
async def list_alerts_legacy():
    """Legacy: Redirects to new alert-history endpoint"""
    return {"message": "Use /api/v1/alert-history instead"}


@app.get("/api/v1/alerts/stats", dependencies=[Depends(verify_api_key)])
async def get_alert_stats_legacy():
    """Legacy: Alert statistics placeholder"""
    return {"message": "Use new E19 alert system"}


# Legacy alert endpoints removed - use /api/v1/alert-* endpoints


# ============================================================================
# Feature 2: Eventlog Charts - Trends over time
# ============================================================================

@app.get("/api/v1/eventlog/trends", dependencies=[Depends(verify_api_key)])
async def get_eventlog_trends(days: int = 7, db: asyncpg.Pool = Depends(get_db)):
    """Get eventlog trends by day for charts"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                DATE(event_time) as day,
                COUNT(*) FILTER (WHERE level <= 2) as errors,
                COUNT(*) FILTER (WHERE level = 3) as warnings,
                COUNT(*) as total
            FROM windows_eventlog
            WHERE event_time > NOW() - INTERVAL '%s days'
            GROUP BY DATE(event_time)
            ORDER BY day
        """ % days)
        
        return {
            "days": days,
            "trends": [
                {
                    "day": str(row["day"]),
                    "errors": row["errors"],
                    "warnings": row["warnings"],
                    "total": row["total"]
                }
                for row in rows
            ]
        }


# ============================================================================
# Feature 3: Software Comparison - Compare versions across nodes
# ============================================================================

@app.get("/api/v1/software/compare", dependencies=[Depends(verify_api_key)])
async def compare_software(software_name: str = None, db: asyncpg.Pool = Depends(get_db)):
    """Compare software versions across nodes"""
    async with db.acquire() as conn:
        if software_name:
            # Find specific software across all nodes
            rows = await conn.fetch("""
                SELECT 
                    n.id as node_id,
                    n.hostname,
                    s.name,
                    s.version,
                    s.publisher
                FROM nodes n
                JOIN software_current s ON n.id = s.node_id
                WHERE LOWER(s.name) LIKE $1
                ORDER BY s.name, n.hostname
            """, f"%{software_name.lower()}%")
            
            results = []
            for row in rows:
                results.append({
                    "nodeId": str(row["node_id"]),
                    "hostname": row["hostname"],
                    "name": row["name"],
                    "version": row["version"],
                    "publisher": row["publisher"]
                })
            
            # Group by version
            versions = {}
            for r in results:
                v = r["version"] or "Unknown"
                if v not in versions:
                    versions[v] = []
                versions[v].append({"nodeId": r["nodeId"], "hostname": r["hostname"]})
            
            return {
                "software": software_name,
                "totalNodes": len(set(r["nodeId"] for r in results)),
                "versions": versions,
                "results": results
            }
        else:
            # Get top installed software
            rows = await conn.fetch("""
                SELECT 
                    name,
                    COUNT(DISTINCT node_id) as node_count
                FROM software_current
                WHERE name IS NOT NULL AND name != ''
                GROUP BY name
                ORDER BY node_count DESC, name
                LIMIT 50
            """)
            
            return {
                "topSoftware": [{"name": r["name"], "count": r["node_count"]} for r in rows]
            }


# ============================================================================
# Feature 4: Compliance Dashboard - Security status at a glance
# ============================================================================

@app.get("/api/v1/compliance/summary", dependencies=[Depends(verify_api_key)])
async def get_compliance_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get security compliance summary across all nodes"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                n.id as node_id,
                n.hostname,
                s.defender,
                s.firewall,
                s.bitlocker,
                s.antivirus
            FROM nodes n
            LEFT JOIN security_current s ON n.id = s.node_id
        """)
        
        compliance = {
            "totalNodes": len(rows),
            "defender": {"enabled": 0, "disabled": 0, "unknown": 0},
            "firewall": {"enabled": 0, "disabled": 0, "unknown": 0},
            "bitlocker": {"encrypted": 0, "unencrypted": 0, "unknown": 0},
            "realTimeProtection": {"enabled": 0, "disabled": 0, "unknown": 0},
            "nodes": []
        }
        
        for row in rows:
            defender = row["defender"] or row["antivirus"] or {}
            firewall_data = row["firewall"] or {}
            bitlocker_data = row["bitlocker"] or {}
            
            # Ensure we have dicts, not lists
            if isinstance(defender, str):
                import json
                defender = json.loads(defender)
            if isinstance(defender, list):
                defender = {}
            if isinstance(firewall_data, str):
                firewall_data = json.loads(firewall_data)
            if isinstance(firewall_data, list):
                firewall_data = {}
            if isinstance(bitlocker_data, str):
                bitlocker_data = json.loads(bitlocker_data)
            if isinstance(bitlocker_data, list):
                bitlocker_data = {"volumes": bitlocker_data}  # assume it's volumes list
            
            # Defender status
            av_enabled = defender.get("antivirusEnabled") or defender.get("enabled")
            if av_enabled is True:
                compliance["defender"]["enabled"] += 1
            elif av_enabled is False:
                compliance["defender"]["disabled"] += 1
            else:
                compliance["defender"]["unknown"] += 1
            
            # Real-time protection
            rtp = defender.get("realTimeProtection") or defender.get("realTimeProtectionEnabled")
            if rtp is True:
                compliance["realTimeProtection"]["enabled"] += 1
            elif rtp is False:
                compliance["realTimeProtection"]["disabled"] += 1
            else:
                compliance["realTimeProtection"]["unknown"] += 1
            
            # Firewall
            profiles = firewall_data.get("profiles", [])
            fw_enabled = None
            if profiles:
                if isinstance(profiles, list):
                    fw_enabled = any(p.get("enabled") for p in profiles if isinstance(p, dict))
                elif isinstance(profiles, dict):
                    fw_enabled = any(p.get("enabled") for p in profiles.values() if isinstance(p, dict))
            
            if fw_enabled is True:
                compliance["firewall"]["enabled"] += 1
            elif fw_enabled is False:
                compliance["firewall"]["disabled"] += 1
            else:
                compliance["firewall"]["unknown"] += 1
            
            # BitLocker
            volumes = bitlocker_data.get("volumes", [])
            bl_encrypted = None
            if volumes and isinstance(volumes, list):
                # protectionStatus: "1" = On, "0" = Off (can be string or int)
                bl_encrypted = any(
                    str(v.get("protectionStatus", "0")) == "1" or 
                    v.get("encrypted") is True or
                    v.get("protectionStatus") == "On"
                    for v in volumes if isinstance(v, dict)
                )
            
            if bl_encrypted is True:
                compliance["bitlocker"]["encrypted"] += 1
            elif bl_encrypted is False:
                compliance["bitlocker"]["unencrypted"] += 1
            else:
                compliance["bitlocker"]["unknown"] += 1
            
            compliance["nodes"].append({
                "nodeId": str(row["node_id"]),
                "hostname": row["hostname"],
                "defender": av_enabled,
                "realTimeProtection": rtp,
                "firewall": fw_enabled,
                "bitlocker": bl_encrypted
            })
        
        return compliance


# ============================================================================
# Feature 5: OS Distribution - moved to line ~500 (before /nodes/{node_id})
# ============================================================================


# ============================================================================
# Feature 6: Export Functions - CSV/JSON export
# ============================================================================

from fastapi.responses import StreamingResponse
import io
import csv

@app.get("/api/v1/export/nodes", dependencies=[Depends(verify_api_key)])
async def export_nodes(format: str = "json", db: asyncpg.Pool = Depends(get_db)):
    """Export all nodes as CSV or JSON"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                node_id, hostname, os_name, os_version, os_build,
                agent_version, first_seen, last_seen
            FROM nodes
            ORDER BY hostname
        """)
        
        data = [
            {
                "node_id": str(row["node_id"]),
                "hostname": row["hostname"],
                "os_name": row["os_name"],
                "os_version": row["os_version"],
                "os_build": row["os_build"],
                "agent_version": row["agent_version"],
                "first_seen": row["first_seen"].isoformat() if row["first_seen"] else None,
                "last_seen": row["last_seen"].isoformat() if row["last_seen"] else None,
            }
            for row in rows
        ]
        
        if format == "csv":
            output = io.StringIO()
            if data:
                writer = csv.DictWriter(output, fieldnames=data[0].keys())
                writer.writeheader()
                writer.writerows(data)
            
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=nodes.csv"}
            )
        else:
            return data


@app.get("/api/v1/export/software", dependencies=[Depends(verify_api_key)])
async def export_software(format: str = "json", db: asyncpg.Pool = Depends(get_db)):
    """Export all software as CSV or JSON"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                n.hostname,
                s.data->'installedPrograms' as programs
            FROM nodes n
            LEFT JOIN inventory_software s ON n.node_id = s.node_id
            WHERE s.data IS NOT NULL
        """)
        
        data = []
        for row in rows:
            programs = row["programs"] or []
            if isinstance(programs, str):
                import json
                programs = json.loads(programs)
            
            for prog in programs:
                data.append({
                    "hostname": row["hostname"],
                    "name": prog.get("name"),
                    "version": prog.get("version"),
                    "publisher": prog.get("publisher")
                })
        
        if format == "csv":
            output = io.StringIO()
            if data:
                writer = csv.DictWriter(output, fieldnames=["hostname", "name", "version", "publisher"])
                writer.writeheader()
                writer.writerows(data)
            
            return StreamingResponse(
                iter([output.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=software.csv"}
            )
        else:
            return data


@app.get("/api/v1/export/compliance", dependencies=[Depends(verify_api_key)])
async def export_compliance(format: str = "json", db: asyncpg.Pool = Depends(get_db)):
    """Export compliance data as CSV or JSON"""
    summary = await get_compliance_summary(db)
    data = summary["nodes"]
    
    if format == "csv":
        output = io.StringIO()
        if data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=compliance.csv"}
        )
    else:
        return data
    return {"status": "checked"}


# --- Gateway Status Endpoint (E11-05) ---

import aiohttp
from datetime import datetime

# Track gateway start time for uptime calculation
GATEWAY_START_TIME = datetime.utcnow()

@app.get("/api/v1/gateway/status", dependencies=[Depends(verify_api_key)])
async def get_gateway_status():
    """Get Octofleet Gateway health status for the dashboard widget"""
    gateway_url = "http://192.168.0.5:18789"
    
    try:
        async with aiohttp.ClientSession() as session:
            # Try to get gateway status
            async with session.get(f"{gateway_url}/status", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {
                        "online": True,
                        "version": data.get("version", "unknown"),
                        "uptime": data.get("uptime", "unknown"),
                        "connectedNodes": data.get("connectedNodes", 0),
                        "pendingJobs": data.get("pendingJobs", 0),
                        "lastCheck": datetime.utcnow().isoformat() + "Z"
                    }
    except Exception as e:
        pass
    
    # Fallback: Try basic connectivity check
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{gateway_url}/", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                return {
                    "online": resp.status < 500,
                    "version": "unknown",
                    "uptime": "unknown", 
                    "connectedNodes": 0,
                    "pendingJobs": 0,
                    "lastCheck": datetime.utcnow().isoformat() + "Z",
                    "note": "Basic connectivity only - detailed status unavailable"
                }
    except Exception as e:
        return {
            "online": False,
            "version": "unknown",
            "uptime": "unknown",
            "connectedNodes": 0,
            "pendingJobs": 0,
            "lastCheck": datetime.utcnow().isoformat() + "Z",
            "error": str(e)
        }


# --- Gateway Logs Endpoint (E11-06) ---

# In-memory log buffer for demo purposes
# In production, this would read from actual gateway logs
import collections
LOG_BUFFER = collections.deque(maxlen=500)

def add_log_entry(level: str, message: str, node_id: str = None, job_id: str = None):
    """Add a log entry to the buffer"""
    LOG_BUFFER.append({
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "level": level,
        "message": message,
        "node_id": node_id,
        "job_id": job_id
    })

# Seed some demo logs
add_log_entry("info", "Gateway started", None, None)
add_log_entry("info", "Database connection established", None, None)

@app.get("/api/v1/gateway/logs", dependencies=[Depends(verify_api_key)])
async def get_gateway_logs(
    level: Optional[str] = None,
    node_id: Optional[str] = None,
    job_id: Optional[str] = None,
    limit: int = 100
):
    """Get gateway logs with optional filters"""
    logs = list(LOG_BUFFER)
    
    # Apply filters
    if level:
        logs = [l for l in logs if l["level"] == level]
    if node_id:
        logs = [l for l in logs if l.get("node_id") == node_id]
    if job_id:
        logs = [l for l in logs if l.get("job_id") == job_id]
    
    # Return most recent logs
    logs = logs[-limit:]
    
    return {
        "logs": logs,
        "total": len(logs),
        "filters": {"level": level, "node_id": node_id, "job_id": job_id}
    }


# ============================================
# E13: RBAC - Role Based Access Control
# ============================================

from auth import (
    UserCreate, UserUpdate, UserResponse, LoginRequest, TokenResponse,
    RoleCreate, RoleResponse, APIKeyCreate, APIKeyResponse,
    hash_password, verify_password, hash_api_key,
    create_access_token, create_refresh_token, decode_token,
    get_current_user, require_auth, require_permission, CurrentUser,
    get_permissions_for_roles
)


# --- Auth Endpoints ---

@app.post("/api/v1/auth/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    """Login with username/password, get JWT token"""
    async with db_pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, username, password_hash, is_active, is_superuser, email, display_name, created_at, last_login FROM users WHERE username = $1",
            request.username
        )
        
        if not user or not verify_password(request.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        if not user["is_active"]:
            raise HTTPException(status_code=403, detail="Account disabled")
        
        # Get user roles
        roles = await conn.fetch(
            """SELECT r.name FROM roles r 
               JOIN user_roles ur ON r.id = ur.role_id 
               WHERE ur.user_id = $1""",
            user["id"]
        )
        role_names = [r["name"] for r in roles]
        permissions = get_permissions_for_roles(role_names)
        if user["is_superuser"]:
            permissions = ["*"]
        
        # Update last login
        await conn.execute(
            "UPDATE users SET last_login = NOW() WHERE id = $1",
            user["id"]
        )
        
        # Create token
        token = create_access_token(str(user["id"]), user["username"], permissions)
        
        return TokenResponse(
            access_token=token,
            expires_in=86400,
            user=UserResponse(
                id=str(user["id"]),
                username=user["username"],
                email=user["email"],
                display_name=user["display_name"],
                is_active=user["is_active"],
                is_superuser=user["is_superuser"],
                created_at=user["created_at"],
                last_login=user["last_login"],
                roles=role_names
            )
        )


@app.get("/api/v1/auth/me", response_model=UserResponse)
async def get_current_user_info(user: CurrentUser = Depends(require_auth)):
    """Get current user info"""
    if user.id == "system":
        return UserResponse(
            id="system",
            username="system",
            email=None,
            display_name="System (API Key)",
            is_active=True,
            is_superuser=True,
            created_at=datetime.utcnow(),
            last_login=None,
            roles=["admin"]
        )
    
    async with db_pool.acquire() as conn:
        db_user = await conn.fetchrow(
            "SELECT id, username, email, display_name, is_active, is_superuser, created_at, last_login FROM users WHERE id = $1",
            UUID(user.id)
        )
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        roles = await conn.fetch(
            """SELECT r.name FROM roles r 
               JOIN user_roles ur ON r.id = ur.role_id 
               WHERE ur.user_id = $1""",
            db_user["id"]
        )
        
        return UserResponse(
            id=str(db_user["id"]),
            username=db_user["username"],
            email=db_user["email"],
            display_name=db_user["display_name"],
            is_active=db_user["is_active"],
            is_superuser=db_user["is_superuser"],
            created_at=db_user["created_at"],
            last_login=db_user["last_login"],
            roles=[r["name"] for r in roles]
        )


# --- User Management (Admin) ---

@app.get("/api/v1/users")
async def list_users(user: CurrentUser = Depends(require_permission("users:read"))):
    """List all users"""
    async with db_pool.acquire() as conn:
        users = await conn.fetch(
            """SELECT u.id, u.username, u.email, u.display_name, u.is_active, u.is_superuser, 
                      u.created_at, u.last_login,
                      array_agg(r.name) FILTER (WHERE r.name IS NOT NULL) as roles
               FROM users u
               LEFT JOIN user_roles ur ON u.id = ur.user_id
               LEFT JOIN roles r ON ur.role_id = r.id
               GROUP BY u.id
               ORDER BY u.created_at DESC"""
        )
        return {
            "users": [
                {
                    "id": str(u["id"]),
                    "username": u["username"],
                    "email": u["email"],
                    "display_name": u["display_name"],
                    "is_active": u["is_active"],
                    "is_superuser": u["is_superuser"],
                    "created_at": u["created_at"].isoformat() if u["created_at"] else None,
                    "last_login": u["last_login"].isoformat() if u["last_login"] else None,
                    "roles": u["roles"] or []
                }
                for u in users
            ]
        }


@app.post("/api/v1/users", response_model=UserResponse)
async def create_user(
    data: UserCreate,
    user: CurrentUser = Depends(require_permission("users:write"))
):
    """Create new user"""
    async with db_pool.acquire() as conn:
        # Check if username exists
        existing = await conn.fetchval("SELECT 1 FROM users WHERE username = $1", data.username)
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")
        
        # Create user
        new_user = await conn.fetchrow(
            """INSERT INTO users (username, email, password_hash, display_name)
               VALUES ($1, $2, $3, $4)
               RETURNING id, username, email, display_name, is_active, is_superuser, created_at""",
            data.username,
            data.email,
            hash_password(data.password),
            data.display_name or data.username
        )
        
        return UserResponse(
            id=str(new_user["id"]),
            username=new_user["username"],
            email=new_user["email"],
            display_name=new_user["display_name"],
            is_active=new_user["is_active"],
            is_superuser=new_user["is_superuser"],
            created_at=new_user["created_at"],
            last_login=None,
            roles=[]
        )


@app.put("/api/v1/users/{user_id}")
async def update_user(
    user_id: str,
    data: UserUpdate,
    user: CurrentUser = Depends(require_permission("users:write"))
):
    """Update user"""
    async with db_pool.acquire() as conn:
        updates = []
        params = [UUID(user_id)]
        param_idx = 2
        
        if data.email is not None:
            updates.append(f"email = ${param_idx}")
            params.append(data.email)
            param_idx += 1
        if data.display_name is not None:
            updates.append(f"display_name = ${param_idx}")
            params.append(data.display_name)
            param_idx += 1
        if data.is_active is not None:
            updates.append(f"is_active = ${param_idx}")
            params.append(data.is_active)
            param_idx += 1
        
        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")
        
        updates.append("updated_at = NOW()")
        
        await conn.execute(
            f"UPDATE users SET {', '.join(updates)} WHERE id = $1",
            *params
        )
        
        return {"status": "updated"}


@app.delete("/api/v1/users/{user_id}")
async def delete_user(
    user_id: str,
    user: CurrentUser = Depends(require_permission("users:write"))
):
    """Delete user"""
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    async with db_pool.acquire() as conn:
        deleted = await conn.execute(
            "DELETE FROM users WHERE id = $1",
            UUID(user_id)
        )
        return {"status": "deleted"}


@app.post("/api/v1/users/{user_id}/roles/{role_name}")
async def assign_role(
    user_id: str,
    role_name: str,
    user: CurrentUser = Depends(require_permission("users:write"))
):
    """Assign role to user"""
    async with db_pool.acquire() as conn:
        role = await conn.fetchrow("SELECT id FROM roles WHERE name = $1", role_name)
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        
        await conn.execute(
            """INSERT INTO user_roles (user_id, role_id, assigned_by)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING""",
            UUID(user_id),
            role["id"],
            UUID(user.id) if user.id != "system" else None
        )
        return {"status": "role assigned"}


@app.delete("/api/v1/users/{user_id}/roles/{role_name}")
async def remove_role(
    user_id: str,
    role_name: str,
    user: CurrentUser = Depends(require_permission("users:write"))
):
    """Remove role from user"""
    async with db_pool.acquire() as conn:
        role = await conn.fetchrow("SELECT id FROM roles WHERE name = $1", role_name)
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        
        await conn.execute(
            "DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2",
            UUID(user_id),
            role["id"]
        )
        return {"status": "role removed"}


# --- Role Management ---

@app.get("/api/v1/roles")
async def list_roles(user: CurrentUser = Depends(require_permission("users:read"))):
    """List all roles"""
    async with db_pool.acquire() as conn:
        roles = await conn.fetch(
            "SELECT id, name, description, permissions, is_system, created_at FROM roles ORDER BY name"
        )
        return {
            "roles": [
                {
                    "id": str(r["id"]),
                    "name": r["name"],
                    "description": r["description"],
                    "permissions": r["permissions"],
                    "is_system": r["is_system"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None
                }
                for r in roles
            ]
        }


@app.post("/api/v1/roles")
async def create_role(
    data: RoleCreate,
    user: CurrentUser = Depends(require_permission("roles:write"))
):
    """Create custom role"""
    async with db_pool.acquire() as conn:
        role = await conn.fetchrow(
            """INSERT INTO roles (name, description, permissions, is_system)
               VALUES ($1, $2, $3, false)
               RETURNING id, name, description, permissions, is_system, created_at""",
            data.name,
            data.description,
            data.permissions
        )
        return {
            "id": str(role["id"]),
            "name": role["name"],
            "description": role["description"],
            "permissions": role["permissions"],
            "is_system": role["is_system"],
            "created_at": role["created_at"].isoformat()
        }


@app.delete("/api/v1/roles/{role_id}")
async def delete_role(
    role_id: str,
    user: CurrentUser = Depends(require_permission("roles:write"))
):
    """Delete custom role (not system roles)"""
    async with db_pool.acquire() as conn:
        role = await conn.fetchrow(
            "SELECT is_system FROM roles WHERE id = $1",
            UUID(role_id)
        )
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        if role["is_system"]:
            raise HTTPException(status_code=400, detail="Cannot delete system role")
        
        await conn.execute("DELETE FROM roles WHERE id = $1", UUID(role_id))
        return {"status": "deleted"}


# --- Initial Admin Setup ---

@app.post("/api/v1/auth/setup")
async def setup_admin(data: UserCreate):
    """
    One-time admin setup. Only works if no users exist.
    """
    async with db_pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM users")
        if count > 0:
            raise HTTPException(status_code=400, detail="Setup already completed")
        
        # Create admin user
        user = await conn.fetchrow(
            """INSERT INTO users (username, email, password_hash, display_name, is_superuser)
               VALUES ($1, $2, $3, $4, true)
               RETURNING id""",
            data.username,
            data.email,
            hash_password(data.password),
            data.display_name or data.username
        )
        
        # Assign admin role
        admin_role = await conn.fetchval("SELECT id FROM roles WHERE name = 'admin'")
        if admin_role:
            await conn.execute(
                "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
                user["id"],
                admin_role
            )
        
        return {"status": "Admin created", "username": data.username}


# --- Audit Log Endpoints ---

@app.get("/api/v1/audit")
async def get_audit_log(
    limit: int = 100,
    offset: int = 0,
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    user: CurrentUser = Depends(require_permission("audit:read"))
):
    """Get audit log entries"""
    async with db_pool.acquire() as conn:
        query = """
            SELECT a.id, a.timestamp, a.user_id, u.username, a.action, 
                   a.resource_type, a.resource_id, a.details, a.ip_address
            FROM audit_log a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE 1=1
        """
        params = []
        param_idx = 1
        
        if user_id:
            query += f" AND a.user_id = ${param_idx}"
            params.append(UUID(user_id))
            param_idx += 1
        if action:
            query += f" AND a.action ILIKE ${param_idx}"
            params.append(f"%{action}%")
            param_idx += 1
        if resource_type:
            query += f" AND a.resource_type = ${param_idx}"
            params.append(resource_type)
            param_idx += 1
        
        query += f" ORDER BY a.timestamp DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
        params.extend([limit, offset])
        
        rows = await conn.fetch(query, *params)
        total = await conn.fetchval("SELECT COUNT(*) FROM audit_log")
        
        return {
            "entries": [
                {
                    "id": r["id"],
                    "timestamp": r["timestamp"].isoformat() if r["timestamp"] else None,
                    "user_id": str(r["user_id"]) if r["user_id"] else None,
                    "username": r["username"],
                    "action": r["action"],
                    "resource_type": r["resource_type"],
                    "resource_id": r["resource_id"],
                    "details": r["details"],
                    "ip_address": str(r["ip_address"]) if r["ip_address"] else None
                }
                for r in rows
            ],
            "total": total,
            "limit": limit,
            "offset": offset
        }


async def log_audit(
    conn,
    user_id: Optional[str],
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None
):
    """Helper to insert audit log entry"""
    await conn.execute(
        """INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        UUID(user_id) if user_id and user_id != "system" else None,
        action,
        resource_type,
        resource_id,
        json.dumps(details) if details else None,
        ip_address
    )


# --- API Key Management ---

@app.get("/api/v1/api-keys")
async def list_api_keys(user: CurrentUser = Depends(require_auth)):
    """List API keys for current user (or all if admin)"""
    async with db_pool.acquire() as conn:
        if user.is_superuser or user.has_permission("users:read"):
            # Admin sees all keys
            keys = await conn.fetch(
                """SELECT k.id, k.user_id, u.username, k.name, k.permissions, 
                          k.expires_at, k.last_used, k.created_at, k.is_active
                   FROM api_keys k
                   LEFT JOIN users u ON k.user_id = u.id
                   ORDER BY k.created_at DESC"""
            )
        else:
            # User sees own keys
            keys = await conn.fetch(
                """SELECT id, user_id, name, permissions, expires_at, last_used, created_at, is_active
                   FROM api_keys WHERE user_id = $1
                   ORDER BY created_at DESC""",
                UUID(user.id)
            )
        
        return {
            "keys": [
                {
                    "id": str(k["id"]),
                    "user_id": str(k["user_id"]) if k["user_id"] else None,
                    "username": k.get("username"),
                    "name": k["name"],
                    "permissions": k["permissions"] or [],
                    "expires_at": k["expires_at"].isoformat() if k["expires_at"] else None,
                    "last_used": k["last_used"].isoformat() if k["last_used"] else None,
                    "created_at": k["created_at"].isoformat() if k["created_at"] else None,
                    "is_active": k["is_active"]
                }
                for k in keys
            ]
        }


@app.post("/api/v1/api-keys")
async def create_api_key(
    data: APIKeyCreate,
    user: CurrentUser = Depends(require_auth)
):
    """Create new API key for current user"""
    import secrets
    
    # Generate key
    raw_key = f"oci_{secrets.token_hex(24)}"  # oci = octofleet inventory
    key_hash = hash_api_key(raw_key)
    
    expires_at = None
    if data.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=data.expires_days)
    
    async with db_pool.acquire() as conn:
        key = await conn.fetchrow(
            """INSERT INTO api_keys (user_id, key_hash, name, expires_at)
               VALUES ($1, $2, $3, $4)
               RETURNING id, name, created_at, expires_at""",
            UUID(user.id) if user.id != "system" else None,
            key_hash,
            data.name,
            expires_at
        )
        
        # Return key only once (never stored in plain text)
        return {
            "id": str(key["id"]),
            "name": key["name"],
            "key": raw_key,  # Only shown once!
            "created_at": key["created_at"].isoformat(),
            "expires_at": key["expires_at"].isoformat() if key["expires_at"] else None,
            "warning": "Save this key now! It won't be shown again."
        }


@app.delete("/api/v1/api-keys/{key_id}")
async def revoke_api_key(
    key_id: str,
    user: CurrentUser = Depends(require_auth)
):
    """Revoke an API key"""
    async with db_pool.acquire() as conn:
        # Check ownership (unless admin)
        if not user.is_superuser and not user.has_permission("users:write"):
            key = await conn.fetchrow(
                "SELECT user_id FROM api_keys WHERE id = $1",
                UUID(key_id)
            )
            if not key or str(key["user_id"]) != user.id:
                raise HTTPException(status_code=403, detail="Cannot revoke this key")
        
        await conn.execute(
            "UPDATE api_keys SET is_active = false WHERE id = $1",
            UUID(key_id)
        )
        return {"status": "revoked"}


@app.delete("/api/v1/api-keys/{key_id}/permanent")
async def delete_api_key(
    key_id: str,
    user: CurrentUser = Depends(require_permission("users:write"))
):
    """Permanently delete an API key (admin only)"""
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM api_keys WHERE id = $1", UUID(key_id))
        return {"status": "deleted"}


# ========== E9: Maintenance Windows ==========

@app.get("/api/v1/maintenance-windows", dependencies=[Depends(verify_api_key)])
async def list_maintenance_windows():
    """List all maintenance windows"""
    async with db_pool.acquire() as conn:
        # Create table if not exists
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_windows (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                description TEXT,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                days_of_week INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
                timezone TEXT DEFAULT 'Europe/Berlin',
                is_active BOOLEAN DEFAULT true,
                target_type TEXT CHECK (target_type IN ('all', 'group', 'node')),
                target_id UUID,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        rows = await conn.fetch("SELECT * FROM maintenance_windows ORDER BY name")
        return {"windows": [dict(r) for r in rows]}


@app.post("/api/v1/maintenance-windows", dependencies=[Depends(verify_api_key)])
async def create_maintenance_window(data: dict):
    """Create a maintenance window"""
    required = ["name", "startTime", "endTime"]
    for f in required:
        if f not in data:
            raise HTTPException(400, f"Missing required field: {f}")
    
    async with db_pool.acquire() as conn:
        window_id = await conn.fetchval("""
            INSERT INTO maintenance_windows (name, description, start_time, end_time, days_of_week, 
                                             timezone, target_type, target_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        """, data["name"], data.get("description"),
            data["startTime"], data["endTime"],
            data.get("daysOfWeek", [1, 2, 3, 4, 5]),
            data.get("timezone", "Europe/Berlin"),
            data.get("targetType", "all"),
            data.get("targetId"))
        return {"id": str(window_id), "status": "created"}


@app.get("/api/v1/maintenance-windows/{window_id}", dependencies=[Depends(verify_api_key)])
async def get_maintenance_window(window_id: str):
    """Get a specific maintenance window"""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM maintenance_windows WHERE id = $1", window_id)
        if not row:
            raise HTTPException(404, "Maintenance window not found")
        return dict(row)


@app.put("/api/v1/maintenance-windows/{window_id}", dependencies=[Depends(verify_api_key)])
async def update_maintenance_window(window_id: str, data: dict):
    """Update a maintenance window"""
    async with db_pool.acquire() as conn:
        await conn.execute("""
            UPDATE maintenance_windows
            SET name = COALESCE($2, name),
                description = COALESCE($3, description),
                start_time = COALESCE($4, start_time),
                end_time = COALESCE($5, end_time),
                days_of_week = COALESCE($6, days_of_week),
                timezone = COALESCE($7, timezone),
                is_active = COALESCE($8, is_active),
                target_type = COALESCE($9, target_type),
                target_id = COALESCE($10, target_id),
                updated_at = NOW()
            WHERE id = $1
        """, window_id, data.get("name"), data.get("description"),
            data.get("startTime"), data.get("endTime"),
            data.get("daysOfWeek"), data.get("timezone"),
            data.get("isActive"), data.get("targetType"), data.get("targetId"))
        return {"status": "updated"}


@app.delete("/api/v1/maintenance-windows/{window_id}", dependencies=[Depends(verify_api_key)])
async def delete_maintenance_window(window_id: str):
    """Delete a maintenance window"""
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM maintenance_windows WHERE id = $1", window_id)
        return {"status": "deleted"}


@app.get("/api/v1/maintenance-windows/check/{node_id}", dependencies=[Depends(verify_api_key)])
async def check_maintenance_window(node_id: str):
    """Check if a node is currently in a maintenance window"""
    from datetime import datetime
    import pytz
    
    async with db_pool.acquire() as conn:
        # Get node's group memberships
        groups = await conn.fetch(
            "SELECT group_id FROM device_groups WHERE node_id = $1", node_id
        )
        group_ids = [str(g["group_id"]) for g in groups]
        
        # Get all active maintenance windows
        windows = await conn.fetch("""
            SELECT * FROM maintenance_windows 
            WHERE is_active = true
        """)
        
        for w in windows:
            # Check if window applies to this node
            if w["target_type"] == "node" and str(w["target_id"]) != node_id:
                continue
            if w["target_type"] == "group" and str(w["target_id"]) not in group_ids:
                continue
            
            # Check if current time is within window
            tz = pytz.timezone(w["timezone"] or "Europe/Berlin")
            now = datetime.now(tz)
            
            # Check day of week (1=Monday, 7=Sunday)
            if now.isoweekday() not in (w["days_of_week"] or [1, 2, 3, 4, 5]):
                continue
            
            # Check time range
            current_time = now.time()
            if w["start_time"] <= current_time <= w["end_time"]:
                return {
                    "in_maintenance_window": True,
                    "window_id": str(w["id"]),
                    "window_name": w["name"],
                    "ends_at": w["end_time"].isoformat()
                }
        
        return {"in_maintenance_window": False}


# ========== E9: Rollout Strategies ==========

@app.get("/api/v1/rollout-strategies", dependencies=[Depends(verify_api_key)])
async def list_rollout_strategies():
    """List available rollout strategies"""
    return {
        "strategies": [
            {
                "id": "immediate",
                "name": "Sofort (Immediate)",
                "description": "Alle Zielgeräte gleichzeitig",
                "config_schema": {}
            },
            {
                "id": "staged",
                "name": "Gestaffelt (Staged)",
                "description": "Rollout in Wellen mit Wartezeit zwischen Gruppen",
                "config_schema": {
                    "wave_size": {"type": "integer", "default": 10, "description": "Geräte pro Welle"},
                    "wave_delay_minutes": {"type": "integer", "default": 60, "description": "Wartezeit zwischen Wellen (Minuten)"},
                    "success_threshold_percent": {"type": "integer", "default": 90, "description": "Min. Erfolgsrate um fortzufahren (%)"}
                }
            },
            {
                "id": "canary",
                "name": "Canary",
                "description": "Erst kleine Testgruppe, dann voller Rollout",
                "config_schema": {
                    "canary_count": {"type": "integer", "default": 1, "description": "Anzahl Canary-Geräte"},
                    "canary_duration_hours": {"type": "integer", "default": 24, "description": "Canary-Beobachtungszeit (Stunden)"},
                    "auto_proceed": {"type": "boolean", "default": False, "description": "Automatisch fortfahren wenn Canary erfolgreich"}
                }
            },
            {
                "id": "percentage",
                "name": "Prozentual",
                "description": "Schrittweise Erhöhung der Zielgruppe",
                "config_schema": {
                    "initial_percent": {"type": "integer", "default": 10, "description": "Startprozent"},
                    "increment_percent": {"type": "integer", "default": 20, "description": "Erhöhung pro Schritt"},
                    "step_delay_hours": {"type": "integer", "default": 4, "description": "Wartezeit zwischen Schritten (Stunden)"}
                }
            }
        ]
    }


@app.post("/api/v1/deployments/{deployment_id}/rollout", dependencies=[Depends(verify_api_key)])
async def configure_rollout_strategy(deployment_id: str, data: dict):
    """Configure rollout strategy for a deployment"""
    strategy = data.get("strategy", "immediate")
    config = data.get("config", {})
    
    valid_strategies = ["immediate", "staged", "canary", "percentage"]
    if strategy not in valid_strategies:
        raise HTTPException(400, f"Invalid strategy. Must be one of: {valid_strategies}")
    
    async with db_pool.acquire() as conn:
        # Ensure rollout_config column exists
        await conn.execute("""
            ALTER TABLE deployments 
            ADD COLUMN IF NOT EXISTS rollout_strategy TEXT DEFAULT 'immediate',
            ADD COLUMN IF NOT EXISTS rollout_config JSONB DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS rollout_state JSONB DEFAULT '{}'
        """)
        
        await conn.execute("""
            UPDATE deployments 
            SET rollout_strategy = $2, rollout_config = $3, updated_at = NOW()
            WHERE id = $1
        """, deployment_id, strategy, json.dumps(config))
        
        return {"status": "configured", "strategy": strategy}


@app.get("/api/v1/deployments/{deployment_id}/rollout", dependencies=[Depends(verify_api_key)])
async def get_rollout_status(deployment_id: str):
    """Get rollout strategy status for a deployment"""
    async with db_pool.acquire() as conn:
        dep = await conn.fetchrow("""
            SELECT rollout_strategy, rollout_config, rollout_state,
                   (SELECT COUNT(*) FROM deployment_status WHERE deployment_id = $1) as total,
                   (SELECT COUNT(*) FROM deployment_status WHERE deployment_id = $1 AND status = 'success') as success,
                   (SELECT COUNT(*) FROM deployment_status WHERE deployment_id = $1 AND status = 'failed') as failed,
                   (SELECT COUNT(*) FROM deployment_status WHERE deployment_id = $1 AND status = 'pending') as pending
            FROM deployments WHERE id = $1
        """, deployment_id)
        
        if not dep:
            raise HTTPException(404, "Deployment not found")
        
        return {
            "strategy": dep["rollout_strategy"] or "immediate",
            "config": json.loads(dep["rollout_config"] or "{}"),
            "state": json.loads(dep["rollout_state"] or "{}"),
            "progress": {
                "total": dep["total"],
                "success": dep["success"],
                "failed": dep["failed"],
                "pending": dep["pending"],
                "success_rate": round(dep["success"] / dep["total"] * 100, 1) if dep["total"] > 0 else 0
            }
        }


@app.post("/api/v1/deployments/{deployment_id}/rollout/advance", dependencies=[Depends(verify_api_key)])
async def advance_rollout(deployment_id: str):
    """Manually advance a staged/canary rollout to the next phase"""
    async with db_pool.acquire() as conn:
        dep = await conn.fetchrow("""
            SELECT rollout_strategy, rollout_config, rollout_state 
            FROM deployments WHERE id = $1
        """, deployment_id)
        
        if not dep:
            raise HTTPException(404, "Deployment not found")
        
        strategy = dep["rollout_strategy"] or "immediate"
        config = json.loads(dep["rollout_config"] or "{}")
        state = json.loads(dep["rollout_state"] or "{}")
        
        if strategy == "immediate":
            return {"message": "Immediate rollout - no phases to advance"}
        
        # Get current wave/phase
        current_wave = state.get("current_wave", 0)
        
        if strategy == "canary":
            if not state.get("canary_complete"):
                # Mark canary as complete, enable full rollout
                state["canary_complete"] = True
                state["full_rollout_started"] = datetime.now().isoformat()
                
                # Enable all remaining pending nodes
                await conn.execute("""
                    UPDATE deployment_status 
                    SET status = 'pending', updated_at = NOW()
                    WHERE deployment_id = $1 AND status = 'pending'
                """, deployment_id)
                
                await conn.execute("""
                    UPDATE deployments SET rollout_state = $2, updated_at = NOW() WHERE id = $1
                """, deployment_id, json.dumps(state))
                
                return {"message": "Canary complete - full rollout started", "state": state}
            else:
                return {"message": "Full rollout already in progress"}
        
        elif strategy == "staged":
            wave_size = config.get("wave_size", 10)
            
            # Activate next wave
            await conn.execute("""
                UPDATE deployment_status 
                SET status = 'pending', updated_at = NOW()
                WHERE deployment_id = $1 
                AND status = 'waiting'
                AND id IN (
                    SELECT id FROM deployment_status 
                    WHERE deployment_id = $1 AND status = 'waiting'
                    LIMIT $2
                )
            """, deployment_id, wave_size)
            
            state["current_wave"] = current_wave + 1
            state["wave_started_at"] = datetime.now().isoformat()
            
            await conn.execute("""
                UPDATE deployments SET rollout_state = $2, updated_at = NOW() WHERE id = $1
            """, deployment_id, json.dumps(state))
            
            return {"message": f"Advanced to wave {state['current_wave']}", "state": state}
        
        elif strategy == "percentage":
            current_percent = state.get("current_percent", config.get("initial_percent", 10))
            increment = config.get("increment_percent", 20)
            new_percent = min(100, current_percent + increment)
            
            # Calculate how many more nodes to activate
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM deployment_status WHERE deployment_id = $1", deployment_id
            )
            target_count = int(total * new_percent / 100)
            current_active = await conn.fetchval(
                "SELECT COUNT(*) FROM deployment_status WHERE deployment_id = $1 AND status != 'waiting'",
                deployment_id
            )
            to_activate = target_count - current_active
            
            if to_activate > 0:
                await conn.execute("""
                    UPDATE deployment_status 
                    SET status = 'pending', updated_at = NOW()
                    WHERE deployment_id = $1 
                    AND status = 'waiting'
                    AND id IN (
                        SELECT id FROM deployment_status 
                        WHERE deployment_id = $1 AND status = 'waiting'
                        LIMIT $2
                    )
                """, deployment_id, to_activate)
            
            state["current_percent"] = new_percent
            state["step_started_at"] = datetime.now().isoformat()
            
            await conn.execute("""
                UPDATE deployments SET rollout_state = $2, updated_at = NOW() WHERE id = $1
            """, deployment_id, json.dumps(state))
            
            return {"message": f"Advanced to {new_percent}%", "state": state}
        
        return {"message": "Unknown strategy"}

# ============================================
# E13: Vulnerability Tracking API
# ============================================

from vulnerability import VulnerabilityScanner, get_vulnerability_summary, get_node_vulnerabilities
import logging
logger = logging.getLogger(__name__)

@app.get("/api/v1/vulnerabilities/summary")
async def vulnerability_summary():
    """Get vulnerability dashboard summary."""
    return await get_vulnerability_summary(db_pool)

@app.get("/api/v1/vulnerabilities/node/{node_id}")
async def node_vulnerabilities(node_id: str):
    """Get all vulnerabilities affecting a specific node."""
    vulns = await get_node_vulnerabilities(db_pool, node_id)
    return {"vulnerabilities": vulns, "count": len(vulns)}

@app.get("/api/v1/vulnerabilities")
async def list_vulnerabilities(
    severity: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """List all discovered vulnerabilities with optional filtering."""
    async with db_pool.acquire() as conn:
        query = """
            SELECT 
                v.*,
                COUNT(DISTINCT s.node_id) as affected_nodes
            FROM vulnerabilities v
            LEFT JOIN software_current s ON s.name = v.software_name AND s.version = v.software_version
        """
        params = []
        
        if severity:
            query += " WHERE v.severity = $1"
            params.append(severity.upper())
        
        query += """
            GROUP BY v.id
            ORDER BY v.cvss_score DESC NULLS LAST, v.discovered_at DESC
            LIMIT $%d OFFSET $%d
        """ % (len(params) + 1, len(params) + 2)
        params.extend([limit, offset])
        
        rows = await conn.fetch(query, *params)
        
        # Get total count
        count_query = "SELECT COUNT(*) FROM vulnerabilities"
        if severity:
            count_query += " WHERE severity = $1"
            total = await conn.fetchval(count_query, severity.upper()) if severity else await conn.fetchval(count_query)
        else:
            total = await conn.fetchval(count_query)
        
        return {
            "vulnerabilities": [dict(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset
        }

@app.post("/api/v1/vulnerabilities/scan")
async def trigger_vulnerability_scan(background_tasks: BackgroundTasks):
    """Trigger a full vulnerability scan of all software inventory."""
    nvd_api_key = os.environ.get("NVD_API_KEY")
    scanner = VulnerabilityScanner(db_pool, nvd_api_key)
    
    # Create scan record
    async with db_pool.acquire() as conn:
        scan_id = await conn.fetchval("""
            INSERT INTO vulnerability_scans (status) VALUES ('running') RETURNING id
        """)
    
    async def run_scan():
        try:
            result = await scanner.scan_all_nodes()
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE vulnerability_scans SET
                        completed_at = NOW(),
                        packages_scanned = $1,
                        vulnerabilities_found = $2,
                        critical_count = $3,
                        high_count = $4,
                        status = 'completed'
                    WHERE id = $5
                """, 
                    result["scanned_packages"],
                    result["total_vulnerabilities"],
                    result["critical"],
                    result["high"],
                    scan_id
                )
            
            # AUTO-REMEDIATION: After vuln scan completes, create remediation jobs
            try:
                engine = RemediationEngine(db_pool)
                remediation_result = await engine.scan_and_create_jobs(
                    severity_filter=['CRITICAL', 'HIGH'],
                    dry_run=False
                )
                logger.info(f"Auto-remediation: Created {remediation_result['jobs_created']} jobs for {remediation_result['with_fix_available']} fixable vulns")
            except Exception as re:
                logger.error(f"Auto-remediation failed: {re}")
                
        except Exception as e:
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    UPDATE vulnerability_scans SET
                        completed_at = NOW(),
                        status = 'failed',
                        error_message = $1
                    WHERE id = $2
                """, str(e), scan_id)
    
    background_tasks.add_task(run_scan)
    
    return {"scan_id": scan_id, "status": "started", "message": "Vulnerability scan started in background"}

@app.get("/api/v1/vulnerabilities/scans")
async def list_vulnerability_scans(limit: int = 10):
    """Get vulnerability scan history."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM vulnerability_scans
            ORDER BY started_at DESC
            LIMIT $1
        """, limit)
        return {"scans": [dict(row) for row in rows]}

@app.post("/api/v1/vulnerabilities/{cve_id}/suppress")
async def suppress_vulnerability(
    cve_id: str,
    reason: str = Body(...),
    software_name: Optional[str] = Body(None),
    expires_days: Optional[int] = Body(None),
    auth: Any = Depends(verify_api_key)
):
    """Suppress a vulnerability (mark as accepted risk or false positive)."""
    # Get username from JWT payload or default to 'api-key'
    username = "api-key"
    if isinstance(auth, dict):
        username = auth.get("sub") or auth.get("username") or auth.get("email", "unknown")
    
    expires_at = None
    if expires_days:
        expires_at = datetime.utcnow() + timedelta(days=expires_days)
    
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO vulnerability_suppressions (cve_id, software_name, reason, suppressed_by, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (cve_id, software_name) DO UPDATE SET
                reason = EXCLUDED.reason,
                suppressed_by = EXCLUDED.suppressed_by,
                suppressed_at = NOW(),
                expires_at = EXCLUDED.expires_at
        """, cve_id, software_name, reason, username, expires_at)
        
    return {"status": "suppressed", "cve_id": cve_id}

# ============================================
# System Settings API
# ============================================

@app.get("/api/v1/settings")
async def get_settings():
    """Get all system settings (values masked for secrets)."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT key, value, updated_at FROM system_settings")
        settings = {}
        for row in rows:
            key = row["key"]
            value = row["value"]
            # Mask sensitive values
            if "key" in key.lower() or "secret" in key.lower() or "password" in key.lower():
                settings[key] = {"value": "***" + (value[-4:] if value and len(value) > 4 else ""), "masked": True, "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None}
            else:
                settings[key] = {"value": value, "masked": False, "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None}
        return settings

@app.get("/api/v1/settings/{key}")
async def get_setting(key: str):
    """Get a specific setting."""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT value, updated_at FROM system_settings WHERE key = $1", key)
        if not row:
            raise HTTPException(status_code=404, detail="Setting not found")
        return {"key": key, "value": row["value"], "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None}

@app.put("/api/v1/settings/{key}")
async def update_setting(key: str, value: str = Body(..., embed=True)):
    """Update or create a setting."""
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO system_settings (key, value, updated_at, updated_by)
            VALUES ($1, $2, NOW(), 'admin')
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
        """, key, value)
    
    # Special handling: if NVD_API_KEY changed, update the scanner
    if key == "nvd_api_key":
        os.environ["NVD_API_KEY"] = value
    
    return {"status": "updated", "key": key}

@app.delete("/api/v1/settings/{key}")
async def delete_setting(key: str):
    """Delete a setting."""
    async with db_pool.acquire() as conn:
        result = await conn.execute("DELETE FROM system_settings WHERE key = $1", key)
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Setting not found")
    return {"status": "deleted", "key": key}

@app.get("/api/v1/test/nvd")
async def test_nvd():
    """Test NVD API connectivity."""
    import httpx
    from urllib.parse import quote
    
    keyword = "Google Chrome"
    url = f"https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch={quote(keyword)}&resultsPerPage=1"
    headers = {"User-Agent": "Octofleet-Inventory/1.0"}
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            return {
                "status_code": response.status_code,
                "response_length": len(response.text),
                "first_100": response.text[:100]
            }
    except Exception as e:
        return {"error": str(e)}


# ============================================
# E14: Auto-Remediation API
# ============================================

from remediation import (
    RemediationPackageCreate, RemediationPackageUpdate,
    RemediationRuleCreate, RemediationRuleUpdate,
    MaintenanceWindowCreate, TriggerRemediationRequest, ApproveRemediationRequest,
    get_remediation_packages, get_remediation_package, create_remediation_package,
    update_remediation_package, delete_remediation_package,
    get_remediation_rules, get_remediation_rule, create_remediation_rule,
    update_remediation_rule, delete_remediation_rule,
    get_maintenance_windows, create_maintenance_window, is_in_maintenance_window,
    get_remediation_jobs, get_remediation_job, approve_remediation_jobs,
    update_remediation_job_status, get_remediation_summary,
    RemediationEngine
)


# --- Remediation Packages (Fix Mappings) ---

@app.get("/api/v1/remediation/packages")
async def list_remediation_packages(
    enabled_only: bool = False,
    _: str = Depends(verify_api_key)
):
    """List all remediation packages (fix mappings)."""
    packages = await get_remediation_packages(db_pool, enabled_only)
    return {"packages": packages}


@app.get("/api/v1/remediation/packages/{package_id}")
async def get_remediation_package_by_id(
    package_id: int,
    _: str = Depends(verify_api_key)
):
    """Get a specific remediation package."""
    pkg = await get_remediation_package(db_pool, package_id)
    if not pkg:
        raise HTTPException(status_code=404, detail="Remediation package not found")
    return pkg


@app.post("/api/v1/remediation/packages", status_code=201)
async def create_remediation_package_endpoint(
    data: RemediationPackageCreate,
    _: str = Depends(verify_api_key)
):
    """Create a new remediation package (CVE → Fix mapping)."""
    try:
        pkg = await create_remediation_package(db_pool, data)
        return pkg
    except Exception as e:
        if "duplicate key" in str(e):
            raise HTTPException(status_code=409, detail="Package with this name already exists")
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/v1/remediation/packages/{package_id}")
async def update_remediation_package_endpoint(
    package_id: int,
    data: RemediationPackageUpdate,
    _: str = Depends(verify_api_key)
):
    """Update a remediation package."""
    pkg = await update_remediation_package(db_pool, package_id, data)
    if not pkg:
        raise HTTPException(status_code=404, detail="Remediation package not found")
    return pkg


@app.delete("/api/v1/remediation/packages/{package_id}")
async def delete_remediation_package_endpoint(
    package_id: int,
    _: str = Depends(verify_api_key)
):
    """Delete a remediation package."""
    deleted = await delete_remediation_package(db_pool, package_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Remediation package not found")
    return {"status": "deleted", "id": package_id}


# --- Remediation Rules ---

@app.get("/api/v1/remediation/rules")
async def list_remediation_rules(
    enabled_only: bool = False,
    _: str = Depends(verify_api_key)
):
    """List all remediation rules."""
    rules = await get_remediation_rules(db_pool, enabled_only)
    return {"rules": rules}


@app.get("/api/v1/remediation/rules/{rule_id}")
async def get_remediation_rule_by_id(
    rule_id: int,
    _: str = Depends(verify_api_key)
):
    """Get a specific remediation rule."""
    rule = await get_remediation_rule(db_pool, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Remediation rule not found")
    return rule


@app.post("/api/v1/remediation/rules", status_code=201)
async def create_remediation_rule_endpoint(
    data: RemediationRuleCreate,
    _: str = Depends(verify_api_key)
):
    """Create a new remediation rule."""
    rule = await create_remediation_rule(db_pool, data)
    return rule


@app.patch("/api/v1/remediation/rules/{rule_id}")
async def update_remediation_rule_endpoint(
    rule_id: int,
    data: RemediationRuleUpdate,
    _: str = Depends(verify_api_key)
):
    """Update a remediation rule."""
    rule = await update_remediation_rule(db_pool, rule_id, data)
    if not rule:
        raise HTTPException(status_code=404, detail="Remediation rule not found")
    return rule


@app.delete("/api/v1/remediation/rules/{rule_id}")
async def delete_remediation_rule_endpoint(
    rule_id: int,
    _: str = Depends(verify_api_key)
):
    """Delete a remediation rule."""
    deleted = await delete_remediation_rule(db_pool, rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Remediation rule not found")
    return {"status": "deleted", "id": rule_id}


# --- Maintenance Windows ---

@app.get("/api/v1/remediation/maintenance-windows")
async def list_maintenance_windows(_: str = Depends(verify_api_key)):
    """List all maintenance windows."""
    windows = await get_maintenance_windows(db_pool)
    return {"windows": windows}


@app.post("/api/v1/remediation/maintenance-windows", status_code=201)
async def create_maintenance_window_endpoint(
    data: MaintenanceWindowCreate,
    _: str = Depends(verify_api_key)
):
    """Create a new maintenance window."""
    window = await create_maintenance_window(db_pool, data)
    return window


@app.get("/api/v1/remediation/maintenance-windows/active")
async def check_maintenance_window(_: str = Depends(verify_api_key)):
    """Check if we're currently in a maintenance window."""
    in_window = await is_in_maintenance_window(db_pool)
    return {"in_maintenance_window": in_window}


# --- Remediation Jobs ---

@app.get("/api/v1/remediation/jobs")
async def list_remediation_jobs(
    status: Optional[str] = None,
    node_id: Optional[UUID] = None,
    limit: int = 100,
    _: str = Depends(verify_api_key)
):
    """List remediation jobs with filters."""
    jobs = await get_remediation_jobs(db_pool, status, node_id, limit)
    return {"jobs": jobs}


@app.get("/api/v1/remediation/jobs/{job_id}")
async def get_remediation_job_by_id(
    job_id: int,
    _: str = Depends(verify_api_key)
):
    """Get a specific remediation job."""
    job = await get_remediation_job(db_pool, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Remediation job not found")
    return job


@app.post("/api/v1/remediation/jobs/approve")
async def approve_jobs(
    data: ApproveRemediationRequest,
    _: str = Depends(verify_api_key)
):
    """Approve pending remediation jobs."""
    count = await approve_remediation_jobs(db_pool, data.job_ids, data.approved_by)
    return {"approved_count": count}


@app.patch("/api/v1/remediation/jobs/{job_id}/status")
async def update_job_status(
    job_id: int,
    status: str,
    exit_code: Optional[int] = None,
    output_log: Optional[str] = None,
    error_message: Optional[str] = None,
    _: str = Depends(verify_api_key)
):
    """Update remediation job status (called by agent after execution)."""
    job = await update_remediation_job_status(
        db_pool, job_id, status, exit_code, output_log, error_message
    )
    if not job:
        raise HTTPException(status_code=404, detail="Remediation job not found")
    return job


# --- Remediation Engine ---

@app.post("/api/v1/remediation/scan")
async def trigger_remediation_scan(
    data: TriggerRemediationRequest,
    background_tasks: BackgroundTasks,
    _: str = Depends(verify_api_key)
):
    """
    Scan vulnerabilities and create remediation jobs.
    
    This will:
    1. Find all vulnerabilities matching the filter
    2. Match them to available fix packages
    3. Apply rules to determine action
    4. Create remediation jobs (or show dry-run results)
    """
    engine = RemediationEngine(db_pool)
    results = await engine.scan_and_create_jobs(
        severity_filter=data.severity_filter,
        software_filter=data.software_filter,
        node_ids=data.node_ids,
        dry_run=data.dry_run
    )
    return results


@app.post("/api/v1/remediation/fix/{vulnerability_id}")
async def one_click_fix(
    vulnerability_id: int,
    node_id: UUID,
    _: str = Depends(verify_api_key)
):
    """
    One-click fix for a specific vulnerability on a node.
    
    Creates a remediation job immediately (no approval required).
    """
    # Get the vulnerability
    async with db_pool.acquire() as conn:
        vuln = await conn.fetchrow(
            "SELECT * FROM vulnerabilities WHERE id = $1", vulnerability_id
        )
        if not vuln:
            raise HTTPException(status_code=404, detail="Vulnerability not found")
        vuln = dict(vuln)
    
    # Find fix package
    engine = RemediationEngine(db_pool)
    fix_pkg = await engine.find_fix_for_vulnerability(vuln)
    if not fix_pkg:
        raise HTTPException(
            status_code=404, 
            detail=f"No fix package available for {vuln['software_name']}"
        )
    
    # Create job without approval requirement
    from remediation import create_remediation_job
    job = await create_remediation_job(
        db_pool,
        vulnerability_id=vulnerability_id,
        remediation_package_id=fix_pkg['id'],
        rule_id=None,  # Manual trigger, no rule
        node_id=node_id,
        software_name=vuln['software_name'],
        software_version=vuln['software_version'],
        cve_id=vuln['cve_id'],
        requires_approval=False
    )
    
    # Generate the fix command
    command = await engine.generate_fix_command(job, fix_pkg)
    
    return {
        "job": job,
        "fix_package": fix_pkg,
        "command": command,
        "message": f"Remediation job created. Execute: {command}"
    }


# --- Agent Endpoint for Remediation Jobs ---

@app.get("/api/v1/remediation/jobs/pending/{node_id}")
async def get_pending_remediation_jobs(node_id: str):
    """
    Agent endpoint: Get pending remediation jobs for a node.
    
    The agent polls this endpoint and executes the fix commands.
    """
    # Resolve node_id to UUID
    async with db_pool.acquire() as conn:
        # Support both formats: "win-baltasa" and "BALTASA"
        lookup_id = node_id
        if node_id.startswith("win-"):
            lookup_id = node_id[4:].upper()
        
        # Find node UUID
        node_row = await conn.fetchrow("""
            SELECT id FROM nodes WHERE UPPER(hostname) = UPPER($1) OR UPPER(node_id) = UPPER($1)
        """, lookup_id)
        
        if not node_row:
            return {"jobs": [], "count": 0}
        
        node_uuid = node_row['id']
        
        # Get approved remediation jobs for this node
        jobs = await conn.fetch("""
            SELECT rj.*, rp.name as package_name, rp.fix_method, rp.fix_command
            FROM remediation_jobs rj
            JOIN remediation_packages rp ON rp.id = rj.remediation_package_id
            WHERE rj.node_id = $1 
              AND rj.status = 'approved'
            ORDER BY rj.created_at ASC
            LIMIT 5
        """, node_uuid)
        
        result = []
        for job in jobs:
            # Mark as running
            await conn.execute("""
                UPDATE remediation_jobs 
                SET status = 'running', started_at = NOW(), updated_at = NOW()
                WHERE id = $1
            """, job['id'])
            
            # Generate the command based on fix method
            fix_cmd = job['fix_command']
            if not fix_cmd:
                method = job['fix_method']
                software = job['software_name']
                if method == 'winget':
                    fix_cmd = f'winget upgrade --name "{software}" --silent --accept-source-agreements'
                elif method == 'choco':
                    fix_cmd = f'choco upgrade {software} -y'
                else:
                    fix_cmd = f'echo "No fix command for {software}"'
            
            result.append({
                "jobId": job['id'],
                "cveId": job['cve_id'],
                "softwareName": job['software_name'],
                "softwareVersion": job['software_version'],
                "fixMethod": job['fix_method'],
                "fixCommand": fix_cmd,
                "packageName": job['package_name']
            })
        
        return {"jobs": result, "count": len(result)}


@app.post("/api/v1/remediation/jobs/{job_id}/result")
async def submit_remediation_result(job_id: int, data: Dict[str, Any]):
    """
    Agent endpoint: Submit remediation job result.
    
    Called by agent after executing the fix command.
    """
    exit_code = data.get("exitCode", -1)
    output = data.get("output", "")
    error = data.get("error", "")
    
    success = exit_code == 0
    status = "success" if success else "failed"
    
    job = await update_remediation_job_status(
        db_pool,
        job_id=job_id,
        status=status,
        exit_code=exit_code,
        output_log=output[:10000] if output else None,
        error_message=error[:1000] if error else None
    )
    
    if not job:
        raise HTTPException(status_code=404, detail="Remediation job not found")
    
    return {
        "status": status,
        "jobId": job_id,
        "success": success
    }


# --- Dashboard Summary ---

@app.get("/api/v1/remediation/summary")
async def remediation_dashboard(_: str = Depends(verify_api_key)):
    """Get remediation dashboard summary."""
    summary = await get_remediation_summary(db_pool)
    return summary


# ============================================================================
# E16: Live View - Real-time Node Monitoring
# ============================================================================

import asyncio
from datetime import datetime as dt

# Store active live sessions
live_sessions: Dict[str, Dict] = {}

# Cache for live network data (node_id -> network data)
live_network_cache: Dict[str, Dict] = {}
live_agent_logs_cache: Dict[str, Dict] = {}  # Cache for agent service logs

async def live_data_generator(node_id: str, session_id: str, pool):
    """Generator for SSE live data stream"""
    global live_sessions
    
    # Initial connection event
    yield f"event: connected\ndata: {json.dumps({'nodeId': node_id, 'sessionId': session_id})}\n\n"
    
    last_metrics_time = 0
    last_processes_time = 0
    last_logs_time = 0
    last_network_time = 0
    last_log_id = 0  # Track last seen log ID
    
    
    try:
        while session_id in live_sessions:
            now = time.time()
            
            # Send metrics every 2 seconds
            if now - last_metrics_time >= 2:
                async with pool.acquire() as conn:
                    # Get latest metrics from timescale
                    metrics = await conn.fetchrow("""
                        SELECT cpu_percent, ram_percent, disk_percent,
                               network_in_mb, network_out_mb, time as timestamp
                        FROM node_metrics
                        WHERE node_id = (SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1)
                        ORDER BY time DESC LIMIT 1
                    """, node_id)
                    
                    if metrics:
                        data = {
                            "type": "metrics",
                            "data": {
                                "cpu": float(metrics['cpu_percent']) if metrics['cpu_percent'] else 0,
                                "memory": float(metrics['ram_percent']) if metrics['ram_percent'] else 0,
                                "disk": float(metrics['disk_percent']) if metrics['disk_percent'] else 0,
                                "netIn": float(metrics['network_in_mb']) if metrics['network_in_mb'] else None,
                                "netOut": float(metrics['network_out_mb']) if metrics['network_out_mb'] else None,
                                "timestamp": metrics['timestamp'].isoformat() if metrics['timestamp'] else None
                            }
                        }
                        yield f"event: metrics\ndata: {json.dumps(data)}\n\n"
                
                last_metrics_time = now
            
            # Send processes every 5 seconds
            if now - last_processes_time >= 5:
                async with pool.acquire() as conn:
                    procs = await conn.fetch("""
                        SELECT process_name, pid, cpu_percent, memory_mb, user_name
                        FROM node_processes
                        WHERE node_id = (SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1)
                          AND collected_at > NOW() - INTERVAL '30 seconds'
                        ORDER BY cpu_percent DESC NULLS LAST LIMIT 20
                    """, node_id)
                    
                    if procs:
                        data = {
                            "type": "processes",
                            "data": [
                                {
                                    "name": p['process_name'],
                                    "pid": p['pid'],
                                    "cpu": float(p['cpu_percent']) if p['cpu_percent'] else 0,
                                    "memoryMb": float(p['memory_mb']) if p['memory_mb'] else 0,
                                    "user": p['user_name']
                                }
                                for p in procs
                            ]
                        }
                        yield f"event: processes\ndata: {json.dumps(data)}\n\n"
                
                last_processes_time = now
            
            # Send new logs every 3 seconds
            if now - last_logs_time >= 3:
                async with pool.acquire() as conn:
                    # Get new logs since last check
                    if last_log_id == 0:
                        # First fetch - get last 50 logs
                        logs = await conn.fetch("""
                            SELECT id, log_name, event_id, level, level_name, source, 
                                   LEFT(message, 500) as message, event_time
                            FROM eventlog_entries
                            WHERE node_id = (SELECT id::text FROM nodes WHERE node_id = $1 OR id::text = $1)
                            ORDER BY id DESC LIMIT 50
                        """, node_id)
                        logs = list(reversed(logs))  # Oldest first
                    else:
                        # Incremental - only new logs
                        logs = await conn.fetch("""
                            SELECT id, log_name, event_id, level, level_name, source,
                                   LEFT(message, 500) as message, event_time
                            FROM eventlog_entries
                            WHERE node_id = (SELECT id::text FROM nodes WHERE node_id = $1 OR id::text = $1) AND id > $2
                            ORDER BY id ASC LIMIT 100
                        """, node_id, last_log_id)
                    
                    if logs:
                        last_log_id = logs[-1]['id']
                        data = {
                            "type": "logs",
                            "data": [
                                {
                                    "id": log['id'],
                                    "logName": log['log_name'],
                                    "eventId": int(log['event_id']) if log['event_id'] else 0,
                                    "level": int(log['level']) if log['level'] else 0,
                                    "levelName": log['level_name'],
                                    "source": log['source'],
                                    "message": log['message'],
                                    "timestamp": log['event_time'].isoformat() if log['event_time'] else None
                                }
                                for log in logs
                            ]
                        }
                        yield f"event: logs\ndata: {json.dumps(data)}\n\n"
                
                last_logs_time = now
            
            # Send network data every 5 seconds (from cache)
            # NOTE: Check BEFORE updating last_processes_time below
            if node_id in live_network_cache and now - last_network_time >= 5:
                net_data = live_network_cache[node_id]
                data = {
                    "type": "network",
                    "data": net_data
                }
                yield f"event: network\ndata: {json.dumps(data)}\n\n"
                last_network_time = now
            
            # Send agent logs every 5 seconds (from cache)
            if node_id in live_agent_logs_cache and now - last_network_time >= 5:
                agent_logs_data = live_agent_logs_cache[node_id]
                data = {
                    "type": "agentLogs",
                    "data": agent_logs_data
                }
                yield f"event: agentLogs\ndata: {json.dumps(data)}\n\n"
            
            # Heartbeat every 10 seconds
            yield f"event: heartbeat\ndata: {json.dumps({'ts': int(now * 1000)})}\n\n"
            
            await asyncio.sleep(1)
            
    except asyncio.CancelledError:
        pass
    except Exception as e:
        pass
    finally:
        if session_id in live_sessions:
            del live_sessions[session_id]
        yield f"event: disconnected\ndata: {json.dumps({'reason': 'session_ended'})}\n\n"


@app.get("/api/v1/live/{node_id}")
async def live_stream(node_id: str, _: str = Depends(verify_api_key_or_query)):
    """
    SSE endpoint for live node data streaming.
    
    Returns Server-Sent Events with:
    - metrics: CPU, RAM, Disk, Network (every 2s)
    - processes: Top 20 processes by CPU (every 5s)
    - heartbeat: Connection keepalive (every 10s)
    """
    # Verify node exists
    async with db_pool.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
    
    # Create session
    session_id = str(uuid.uuid4())
    live_sessions[session_id] = {
        "node_id": node_id,
        "started_at": dt.utcnow(),
        "last_activity": dt.utcnow()
    }
    
    return StreamingResponse(
        live_data_generator(node_id, session_id, db_pool),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/api/v1/live-sessions")
async def list_live_sessions(_: str = Depends(verify_api_key)):
    """List active live monitoring sessions"""
    return {
        "sessions": [
            {
                "sessionId": sid,
                "nodeId": data["node_id"],
                "startedAt": data["started_at"].isoformat(),
                "lastActivity": data["last_activity"].isoformat()
            }
            for sid, data in live_sessions.items()
        ],
        "count": len(live_sessions)
    }


@app.delete("/api/v1/live/{session_id}")
async def stop_live_session(session_id: str, _: str = Depends(verify_api_key)):
    """Stop a live monitoring session"""
    if session_id in live_sessions:
        del live_sessions[session_id]
        return {"status": "stopped", "sessionId": session_id}
    raise HTTPException(status_code=404, detail="Session not found")


@app.post("/api/v1/live-data")
async def receive_live_data(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """
    Receives live monitoring data from agents.
    Stores metrics in node_metrics and processes in node_processes.
    """
    node_id_text = data.get("nodeId")
    if not node_id_text:
        raise HTTPException(status_code=400, detail="nodeId required")
    
    # Debug: log network data presence
    network_data = data.get("network", [])
    if network_data:
        logger.info(f"[LIVE-DATA] {node_id_text}: {len(network_data)} network interfaces received")
    
    async with db.acquire() as conn:
        # Get node UUID
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id_text)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        node_uuid = node['id']
        now = dt.utcnow()
        
        # Store metrics
        metrics = data.get("metrics", {})
        if metrics:
            await conn.execute("""
                INSERT INTO node_metrics (time, node_id, cpu_percent, ram_percent, disk_percent)
                VALUES ($1, $2, $3, $4, $5)
            """, now, node_uuid, 
                metrics.get("cpuPercent"),
                metrics.get("memoryPercent"),
                metrics.get("diskPercent")
            )
        
        # Store processes (replace old data)
        processes = data.get("processes", [])
        if processes:
            # Delete old process data for this node
            await conn.execute(
                "DELETE FROM node_processes WHERE node_id = $1 AND collected_at < NOW() - INTERVAL '30 seconds'",
                node_uuid
            )
            
            # Insert new process data
            for proc in processes:
                await conn.execute("""
                    INSERT INTO node_processes (node_id, process_name, pid, cpu_percent, memory_mb, user_name, collected_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, node_uuid, 
                    proc.get("name", "unknown"),
                    proc.get("pid", 0),
                    proc.get("cpuPercent"),
                    proc.get("memoryMb"),
                    proc.get("userName"),
                    now
                )
        
        # Cache network data for SSE streaming
        network = data.get("network", [])
        if network:
            live_network_cache[node_id_text] = {
                "timestamp": now.isoformat(),
                "interfaces": network
            }
        
        # Cache agent logs for SSE streaming
        agent_logs = data.get("agentLogs", [])
        if agent_logs:
            live_agent_logs_cache[node_id_text] = {
                "timestamp": now.isoformat(),
                "logs": agent_logs
            }
        
        return {
            "status": "ok",
            "metricsStored": bool(metrics),
            "processesStored": len(processes),
            "networkCached": len(network),
            "agentLogsCached": len(agent_logs)
        }


@app.get("/api/v1/nodes/{node_id}/metrics/history")
async def get_metrics_history(
    node_id: str, 
    hours: int = 24,
    interval: str = "5m",
    _: str = Depends(verify_api_key),
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Get historical metrics for a node with time bucketing.
    
    Args:
        node_id: Node identifier
        hours: How many hours back (default 24)
        interval: Bucket size - 1m, 5m, 15m, 1h (default 5m)
    
    Returns time-series data for charts.
    """
    # Map interval to TimescaleDB time_bucket
    interval_map = {
        "1m": "1 minute",
        "5m": "5 minutes",
        "15m": "15 minutes",
        "30m": "30 minutes",
        "1h": "1 hour",
        "6h": "6 hours",
        "1d": "1 day"
    }
    bucket = interval_map.get(interval, "5 minutes")
    
    async with db.acquire() as conn:
        # Get node UUID
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        node_uuid = node['id']
        
        # Use time_bucket for aggregation (TimescaleDB)
        rows = await conn.fetch(f"""
            SELECT 
                time_bucket('{bucket}', time) as bucket,
                AVG(cpu_percent) as cpu,
                AVG(ram_percent) as memory,
                AVG(disk_percent) as disk,
                AVG(network_in_mb) as net_in,
                AVG(network_out_mb) as net_out
            FROM node_metrics
            WHERE node_id = $1 
              AND time > NOW() - INTERVAL '{hours} hours'
            GROUP BY bucket
            ORDER BY bucket ASC
        """, node_uuid)
        
        return {
            "nodeId": node_id,
            "hours": hours,
            "interval": interval,
            "dataPoints": len(rows),
            "data": [
                {
                    "timestamp": row['bucket'].isoformat(),
                    "cpu": round(row['cpu'], 1) if row['cpu'] else None,
                    "memory": round(row['memory'], 1) if row['memory'] else None,
                    "disk": round(row['disk'], 1) if row['disk'] else None,
                    "netIn": round(row['net_in'], 2) if row['net_in'] else None,
                    "netOut": round(row['net_out'], 2) if row['net_out'] else None
                }
                for row in rows
            ]
        }


# ============================================================================
# E15-06: Hardware Export Endpoints
# ============================================================================

@app.get("/api/v1/hardware/export")
async def export_fleet_hardware(
    format: str = "json",
    _: str = Depends(verify_api_key),
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Export fleet hardware data as JSON or CSV.
    
    Query params:
    - format: json (default) or csv
    """
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                n.node_id,
                n.hostname,
                n.os_name,
                n.is_online,
                h.cpu->>'name' as cpu_name,
                (h.cpu->>'cores')::int as cpu_cores,
                (h.ram->>'totalGb')::numeric as ram_gb,
                jsonb_array_length(COALESCE(h.disks->'physical', '[]'::jsonb)) as disk_count,
                h.updated_at
            FROM nodes n
            LEFT JOIN hardware_current h ON n.id = h.node_id
            ORDER BY n.hostname
        """)
        
        if format.lower() == "csv":
            import io
            import csv
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['node_id', 'hostname', 'os_name', 'is_online', 'cpu_name', 'cpu_cores', 'ram_gb', 'disk_count', 'updated_at'])
            for r in rows:
                writer.writerow([
                    r['node_id'], r['hostname'], r['os_name'], r['is_online'],
                    r['cpu_name'], r['cpu_cores'], float(r['ram_gb']) if r['ram_gb'] else None,
                    r['disk_count'], r['updated_at'].isoformat() if r['updated_at'] else None
                ])
            from fastapi.responses import Response
            return Response(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=fleet-hardware.csv"}
            )
        
        # JSON format
        return {
            "exportedAt": dt.utcnow().isoformat(),
            "nodeCount": len(rows),
            "nodes": [
                {
                    "nodeId": r['node_id'],
                    "hostname": r['hostname'],
                    "osName": r['os_name'],
                    "isOnline": r['is_online'],
                    "cpu": {"name": r['cpu_name'], "cores": r['cpu_cores']},
                    "ramGb": float(r['ram_gb']) if r['ram_gb'] else None,
                    "diskCount": r['disk_count'],
                    "updatedAt": r['updated_at'].isoformat() if r['updated_at'] else None
                }
                for r in rows
            ]
        }


@app.get("/api/v1/nodes/{node_id}/hardware/export")
async def export_node_hardware(
    node_id: str,
    format: str = "json",
    _: str = Depends(verify_api_key),
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Export single node hardware data as JSON or CSV.
    """
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id, hostname FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        hw = await conn.fetchrow("""
            SELECT cpu, ram, disks, mainboard, bios, gpu, nics, updated_at
            FROM hardware_current WHERE node_id = $1
        """, node['id'])
        
        if not hw:
            raise HTTPException(status_code=404, detail="No hardware data")
        
        data = {
            "nodeId": node_id,
            "hostname": node['hostname'],
            "exportedAt": dt.utcnow().isoformat(),
            "cpu": json.loads(hw['cpu']) if hw['cpu'] else {},
            "ram": json.loads(hw['ram']) if hw['ram'] else {},
            "disks": json.loads(hw['disks']) if hw['disks'] else {},
            "mainboard": json.loads(hw['mainboard']) if hw['mainboard'] else {},
            "bios": json.loads(hw['bios']) if hw['bios'] else {},
            "gpu": json.loads(hw['gpu']) if hw['gpu'] else [],
            "nics": json.loads(hw['nics']) if hw['nics'] else [],
            "updatedAt": hw['updated_at'].isoformat() if hw['updated_at'] else None
        }
        
        if format.lower() == "csv":
            # Flatten for CSV
            import io
            import csv
            output = io.StringIO()
            writer = csv.writer(output)
            
            # CPU row
            cpu = data.get('cpu', {})
            writer.writerow(['Component', 'Property', 'Value'])
            writer.writerow(['CPU', 'Name', cpu.get('name', '')])
            writer.writerow(['CPU', 'Cores', cpu.get('cores', '')])
            writer.writerow(['CPU', 'Threads', cpu.get('logicalProcessors', '')])
            
            # RAM
            ram = data.get('ram', {})
            writer.writerow(['RAM', 'Total GB', ram.get('totalGb', '')])
            
            # Disks
            for i, disk in enumerate(data.get('disks', {}).get('physical', [])):
                writer.writerow([f'Disk {i+1}', 'Model', disk.get('model', '')])
                writer.writerow([f'Disk {i+1}', 'Size GB', disk.get('sizeGB', '')])
            
            from fastapi.responses import Response
            return Response(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={node_id}-hardware.csv"}
            )
        
        return data


# =============================================================================
# E17: Screen Mirroring Endpoints
# =============================================================================

from screen_session import screen_session_manager, ScreenSessionState

@app.on_event("startup")
async def start_screen_manager():
    await screen_session_manager.start()

@app.on_event("shutdown")
async def stop_screen_manager():
    await screen_session_manager.stop()


@app.post("/api/v1/screen/start/{node_id}")
async def start_screen_session(
    node_id: str,
    quality: str = "medium",
    max_fps: int = 15,
    resolution: str = "auto",
    monitor: int = 0,
    user: dict = Depends(get_current_user)
):
    """
    Start a screen viewing session for a node.
    
    The session enters PENDING state until the agent connects.
    """
    try:
        session = await screen_session_manager.create_session(
            node_id=node_id.upper(),
            user_id=user.id,
            quality=quality,
            max_fps=max_fps,
            resolution=resolution,
            monitor_index=monitor
        )
        
        # Log audit event
        await log_audit(
            db_pool, 
            action="screen_session_start",
            user_id=user.id,
            resource_type="screen_session",
            resource_id=session.id,
            details={"node_id": node_id, "quality": quality}
        )
        
        return {
            "session_id": session.id,
            "state": session.state.value,
            "node_id": session.node_id,
            "websocket_url": f"/api/v1/screen/ws/{session.id}"
        }
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.get("/api/v1/screen/sessions")
async def list_screen_sessions(_: str = Depends(verify_api_key)):
    """List all active screen sessions."""
    return {
        "sessions": screen_session_manager.list_sessions(),
        "count": len([s for s in screen_session_manager.sessions.values() 
                     if s.state != ScreenSessionState.CLOSED])
    }


@app.get("/api/v1/screen/session/{session_id}")
async def get_screen_session(session_id: str, _: str = Depends(verify_api_key)):
    """Get details of a screen session."""
    session = screen_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "id": session.id,
        "node_id": session.node_id,
        "user_id": session.user_id,
        "state": session.state.value,
        "quality": session.quality,
        "max_fps": session.max_fps,
        "resolution": session.resolution,
        "monitor_index": session.monitor_index,
        "created_at": session.created_at.isoformat(),
        "started_at": session.started_at.isoformat() if session.started_at else None,
        "frames_sent": session.frames_sent,
        "bytes_sent": session.bytes_sent
    }


@app.delete("/api/v1/screen/session/{session_id}")
async def stop_screen_session(
    session_id: str, 
    user: dict = Depends(get_current_user)
):
    """Stop a screen viewing session."""
    success = await screen_session_manager.close_session(session_id, "user_request")
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    
    await log_audit(
        db_pool,
        action="screen_session_stop",
        user_id=user.id,
        resource_type="screen_session",
        resource_id=session_id
    )
    
    return {"status": "stopped", "session_id": session_id}


@app.get("/api/v1/screen/pending/{node_id}")
async def get_pending_screen_session(node_id: str, _: str = Depends(verify_api_key)):
    """
    Agent endpoint: Check if there's a pending screen session for this node.
    
    Agent polls this to know when to start capturing.
    """
    session = screen_session_manager.get_pending_session_for_node(node_id.upper())
    if not session:
        return {"pending": False}
    
    return {
        "pending": True,
        "session_id": session.id,
        "quality": session.quality,
        "max_fps": session.max_fps,
        "resolution": session.resolution,
        "monitor_index": session.monitor_index,
        "websocket_url": f"/api/v1/screen/ws/agent/{session.id}"
    }


@app.websocket("/api/v1/screen/ws/{session_id}")
async def screen_viewer_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for browser viewers to receive screen frames.
    
    Protocol:
    - Server sends: {"type": "frame", "data": "<base64 jpeg>"} 
    - Server sends: {"type": "info", "resolution": "1920x1080", "fps": 15}
    - Server sends: {"type": "closed", "reason": "..."}
    """
    await websocket.accept()
    
    session = screen_session_manager.get_session(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    session.viewer_ws = websocket
    logger.info(f"Viewer connected to screen session {session_id}")
    
    try:
        # Send initial info
        await websocket.send_json({
            "type": "info",
            "session_id": session_id,
            "node_id": session.node_id,
            "state": session.state.value,
            "quality": session.quality
        })
        
        # Keep connection alive, frames are pushed by agent websocket handler
        while True:
            try:
                # Receive keep-alive pings from client
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Send keep-alive
                await websocket.send_json({"type": "ping"})
                
    except WebSocketDisconnect:
        logger.info(f"Viewer disconnected from screen session {session_id}")
    except Exception as e:
        logger.error(f"Viewer WebSocket error: {e}")
    finally:
        session.viewer_ws = None


@app.websocket("/api/v1/screen/ws/agent/{session_id}")
async def screen_agent_websocket(websocket: WebSocket, session_id: str, api_key: str = None):
    """
    WebSocket endpoint for agents to send screen frames.
    
    Protocol:
    - Agent sends: {"type": "frame", "data": "<base64 jpeg>", "width": 1920, "height": 1080}
    - Agent sends: {"type": "ready"} when capture started
    - Server sends: {"type": "stop"} to end session
    """
    # Validate API key
    valid_api_key = os.getenv("API_KEY", "octofleet-dev-key")
    if api_key != valid_api_key:
        await websocket.close(code=4001, reason="Invalid API key")
        return
    
    await websocket.accept()
    
    session = screen_session_manager.get_session(session_id)
    if not session:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    if session.state != ScreenSessionState.PENDING:
        await websocket.send_json({"type": "error", "message": "Session not in pending state"})
        await websocket.close()
        return
    
    session.agent_ws = websocket
    await screen_session_manager.activate_session(session_id)
    logger.info(f"Agent connected to screen session {session_id}")
    
    try:
        # Send config
        await websocket.send_json({
            "type": "config",
            "quality": session.quality,
            "max_fps": session.max_fps,
            "resolution": session.resolution,
            "monitor_index": session.monitor_index
        })
        
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "frame":
                session.frames_sent += 1
                session.bytes_sent += len(data.get("data", ""))
                
                # Forward to viewer
                if session.viewer_ws:
                    try:
                        await session.viewer_ws.send_json(data)
                    except:
                        pass  # Viewer disconnected
                        
            elif data.get("type") == "ready":
                logger.info(f"Agent ready for screen capture: {session_id}")
                if session.viewer_ws:
                    await session.viewer_ws.send_json({
                        "type": "info",
                        "state": "active",
                        "message": "Agent started capturing"
                    })
                    
    except WebSocketDisconnect:
        logger.info(f"Agent disconnected from screen session {session_id}")
    except Exception as e:
        logger.error(f"Agent WebSocket error: {e}")
    finally:
        session.agent_ws = None
        await screen_session_manager.close_session(session_id, "agent_disconnected")
        
        # Notify viewer
        if session.viewer_ws:
            try:
                await session.viewer_ws.send_json({
                    "type": "closed",
                    "reason": "Agent disconnected"
                })
            except:
                pass


# === Remediation Live SSE ===
@app.get("/api/v1/remediation/live")
async def remediation_live_sse(request: Request, token: str = None, api_key: str = Header(None, alias="X-API-Key")):
    """
    SSE endpoint for live remediation job updates.
    Broadcasts job status changes in real-time.
    """
    # Validate auth
    valid_api_key = os.getenv("API_KEY", "octofleet-dev-key")
    if api_key != valid_api_key and not token:
        raise HTTPException(401, "Unauthorized")
    
    async def event_generator():
        # Track last seen job states
        last_states = {}
        
        while True:
            if await request.is_disconnected():
                break
            
            try:
                async with db_pool.acquire() as conn:
                    rows = await conn.fetch("""
                        SELECT id, status, exit_code, software_name, cve_id, node_id,
                               created_at, completed_at, error_message
                        FROM remediation_jobs
                        WHERE updated_at > NOW() - INTERVAL '30 seconds'
                        ORDER BY updated_at DESC
                        LIMIT 20
                    """)
                    
                    for row in rows:
                        job_id = row['id']
                        current_state = f"{row['status']}:{row['exit_code']}"
                        
                        if last_states.get(job_id) != current_state:
                            last_states[job_id] = current_state
                            job_data = {
                                "type": "job_update",
                                "job": {
                                    "id": row['id'],
                                    "status": row['status'],
                                    "exit_code": row['exit_code'],
                                    "software_name": row['software_name'],
                                    "cve_id": row['cve_id'],
                                    "node_id": row['node_id'],
                                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                                    "completed_at": row['completed_at'].isoformat() if row['completed_at'] else None,
                                    "error_message": row['error_message']
                                }
                            }
                            yield f"data: {json.dumps(job_data)}\n\n"
            except Exception as e:
                logger.error(f"Remediation SSE error: {e}")
            
            await asyncio.sleep(2)  # Poll every 2 seconds
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ============================================================================
# E18: Service Orchestration API
# ============================================================================

# --- Service Classes ---

@app.get("/api/v1/service-classes")
async def list_service_classes(db: asyncpg.Pool = Depends(get_db)):
    """List all service class templates"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT sc.*, 
                   (SELECT COUNT(*) FROM services s WHERE s.class_id = sc.id) as service_count
            FROM service_classes sc
            ORDER BY sc.name
        """)
        return {"serviceClasses": [dict(r) for r in rows]}


@app.post("/api/v1/service-classes")
async def create_service_class(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new service class template"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO service_classes (
                name, description, service_type, min_nodes, max_nodes,
                roles, required_packages, config_template, health_check,
                drift_policy, update_strategy, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        """,
            data.get("name"),
            data.get("description"),
            data.get("serviceType", "single"),
            data.get("minNodes", 1),
            data.get("maxNodes", 1),
            json.dumps(data.get("roles", ["primary"])),
            json.dumps(data.get("requiredPackages", [])),
            data.get("configTemplate"),
            json.dumps(data.get("healthCheck", {"type": "tcp", "port": 80})),
            data.get("driftPolicy", "strict"),
            data.get("updateStrategy", "rolling"),
            data.get("createdBy")
        )
        return dict(row)


@app.get("/api/v1/service-classes/{class_id}")
async def get_service_class(class_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a service class by ID"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM service_classes WHERE id = $1
        """, class_id)
        if not row:
            raise HTTPException(status_code=404, detail="Service class not found")
        return dict(row)


@app.put("/api/v1/service-classes/{class_id}")
async def update_service_class(class_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update a service class"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE service_classes SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                service_type = COALESCE($4, service_type),
                min_nodes = COALESCE($5, min_nodes),
                max_nodes = COALESCE($6, max_nodes),
                roles = COALESCE($7, roles),
                required_packages = COALESCE($8, required_packages),
                config_template = COALESCE($9, config_template),
                health_check = COALESCE($10, health_check),
                drift_policy = COALESCE($11, drift_policy),
                update_strategy = COALESCE($12, update_strategy),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        """,
            class_id,
            data.get("name"),
            data.get("description"),
            data.get("serviceType"),
            data.get("minNodes"),
            data.get("maxNodes"),
            json.dumps(data["roles"]) if "roles" in data else None,
            json.dumps(data["requiredPackages"]) if "requiredPackages" in data else None,
            data.get("configTemplate"),
            json.dumps(data["healthCheck"]) if "healthCheck" in data else None,
            data.get("driftPolicy"),
            data.get("updateStrategy")
        )
        if not row:
            raise HTTPException(status_code=404, detail="Service class not found")
        return dict(row)


@app.delete("/api/v1/service-classes/{class_id}")
async def delete_service_class(class_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a service class (only if no services use it)"""
    async with db.acquire() as conn:
        # Check for existing services
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM services WHERE class_id = $1", class_id
        )
        if count > 0:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot delete: {count} service(s) still using this class"
            )
        
        result = await conn.execute(
            "DELETE FROM service_classes WHERE id = $1", class_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Service class not found")
        return {"status": "deleted", "id": class_id}


# --- Services ---

@app.get("/api/v1/services")
async def list_services(
    status: str = None,
    class_id: str = None,
    db: asyncpg.Pool = Depends(get_db)
):
    """List all services with optional filters"""
    async with db.acquire() as conn:
        query = """
            SELECT s.*, sc.name as class_name,
                   (SELECT COUNT(*) FROM service_node_assignments sna 
                    WHERE sna.service_id = s.id AND sna.status = 'active') as active_nodes
            FROM services s
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE 1=1
        """
        params = []
        param_idx = 1
        
        if status:
            query += f" AND s.status = ${param_idx}"
            params.append(status)
            param_idx += 1
        
        if class_id:
            query += f" AND s.class_id = ${param_idx}"
            params.append(class_id)
            param_idx += 1
        
        query += " ORDER BY s.name"
        
        rows = await conn.fetch(query, *params)
        return {"services": [dict(r) for r in rows]}


@app.post("/api/v1/services")
async def create_service(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new service instance"""
    class_id = data.get("classId")
    if not class_id:
        raise HTTPException(status_code=400, detail="classId required")
    
    async with db.acquire() as conn:
        # Verify class exists
        class_row = await conn.fetchrow(
            "SELECT * FROM service_classes WHERE id = $1", class_id
        )
        if not class_row:
            raise HTTPException(status_code=404, detail="Service class not found")
        
        row = await conn.fetchrow("""
            INSERT INTO services (
                class_id, name, description, config_values, secrets_ref, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        """,
            class_id,
            data.get("name"),
            data.get("description"),
            json.dumps(data.get("configValues", {})),
            data.get("secretsRef"),
            data.get("createdBy")
        )
        return dict(row)


@app.get("/api/v1/services/{service_id}")
async def get_service(service_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a service with its node assignments"""
    async with db.acquire() as conn:
        service = await conn.fetchrow("""
            SELECT s.*, sc.name as class_name, sc.roles as available_roles,
                   sc.health_check, sc.drift_policy, sc.update_strategy
            FROM services s
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE s.id = $1
        """, service_id)
        
        if not service:
            raise HTTPException(status_code=404, detail="Service not found")
        
        # Get node assignments
        assignments = await conn.fetch("""
            SELECT sna.*, n.hostname, n.os_name, n.agent_version
            FROM service_node_assignments sna
            JOIN nodes n ON sna.node_id = n.id
            WHERE sna.service_id = $1
            ORDER BY sna.role, n.hostname
        """, service_id)
        
        result = dict(service)
        result["nodes"] = [dict(a) for a in assignments]
        return result


@app.put("/api/v1/services/{service_id}")
async def update_service(service_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update a service"""
    async with db.acquire() as conn:
        # Increment desired_state_version if config changes
        version_increment = 1 if "configValues" in data else 0
        
        row = await conn.fetchrow("""
            UPDATE services SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                status = COALESCE($4, status),
                config_values = COALESCE($5, config_values),
                secrets_ref = COALESCE($6, secrets_ref),
                desired_state_version = desired_state_version + $7,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        """,
            service_id,
            data.get("name"),
            data.get("description"),
            data.get("status"),
            json.dumps(data["configValues"]) if "configValues" in data else None,
            data.get("secretsRef"),
            version_increment
        )
        if not row:
            raise HTTPException(status_code=404, detail="Service not found")
        return dict(row)


@app.delete("/api/v1/services/{service_id}")
async def delete_service(service_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a service and all its assignments"""
    async with db.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM services WHERE id = $1", service_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Service not found")
        return {"status": "deleted", "id": service_id}


# --- Service Node Assignments ---

@app.post("/api/v1/services/{service_id}/nodes")
async def assign_node_to_service(
    service_id: str, 
    data: Dict[str, Any], 
    db: asyncpg.Pool = Depends(get_db)
):
    """Assign a node to a service with a role"""
    node_id = data.get("nodeId")
    role = data.get("role", "primary")
    
    if not node_id:
        raise HTTPException(status_code=400, detail="nodeId required")
    
    async with db.acquire() as conn:
        # Verify service and node exist
        service = await conn.fetchrow("SELECT * FROM services WHERE id = $1", service_id)
        if not service:
            raise HTTPException(status_code=404, detail="Service not found")
        
        node = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        # Create assignment
        try:
            row = await conn.fetchrow("""
                INSERT INTO service_node_assignments (service_id, node_id, role)
                VALUES ($1, $2, $3)
                RETURNING *
            """, service_id, node_id, role)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=400, detail="Node already assigned to this service")
        
        # Log the assignment
        await conn.execute("""
            INSERT INTO service_reconciliation_log 
                (service_id, node_id, action, status, message)
            VALUES ($1, $2, 'assign', 'success', $3)
        """, service_id, node_id, f"Node assigned with role: {role}")
        
        return dict(row)


@app.delete("/api/v1/services/{service_id}/nodes/{node_id}")
async def remove_node_from_service(
    service_id: str, 
    node_id: str, 
    db: asyncpg.Pool = Depends(get_db)
):
    """Remove a node from a service"""
    async with db.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM service_node_assignments 
            WHERE service_id = $1 AND node_id = $2
        """, service_id, node_id)
        
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Assignment not found")
        
        # Log removal
        await conn.execute("""
            INSERT INTO service_reconciliation_log 
                (service_id, node_id, action, status, message)
            VALUES ($1, $2, 'remove', 'success', 'Node removed from service')
        """, service_id, node_id)
        
        return {"status": "removed", "serviceId": service_id, "nodeId": node_id}


# --- Service Reconciliation Log ---

@app.get("/api/v1/services/{service_id}/logs")
async def get_service_logs(
    service_id: str,
    limit: int = 50,
    db: asyncpg.Pool = Depends(get_db)
):
    """Get reconciliation logs for a service"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT srl.*, n.hostname
            FROM service_reconciliation_log srl
            LEFT JOIN nodes n ON srl.node_id = n.id
            WHERE srl.service_id = $1
            ORDER BY srl.started_at DESC
            LIMIT $2
        """, service_id, limit)
        return {"logs": [dict(r) for r in rows]}


# ============================================================================
# E18-03: Service Reconciliation Engine
# ============================================================================

@app.post("/api/v1/services/{service_id}/reconcile")
async def trigger_reconciliation(service_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Trigger reconciliation for a service - creates jobs for all assigned nodes"""
    async with db.acquire() as conn:
        # Get service with class details
        service = await conn.fetchrow("""
            SELECT s.*, sc.name as class_name, sc.service_type, sc.roles,
                   sc.required_packages, sc.config_template, sc.health_check
            FROM services s
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE s.id = $1
        """, service_id)
        
        if not service:
            raise HTTPException(status_code=404, detail="Service not found")
        
        # Get all node assignments
        assignments = await conn.fetch("""
            SELECT sna.*, n.id as node_uuid, n.hostname, n.os_name
            FROM service_node_assignments sna
            JOIN nodes n ON sna.node_id = n.id
            WHERE sna.service_id = $1
        """, service_id)
        
        if not assignments:
            raise HTTPException(status_code=400, detail="No nodes assigned to service")
        
        # Build service definition
        service_def = {
            "serviceId": service_id,
            "serviceName": service["name"],
            "className": service["class_name"],
            "serviceType": service["service_type"],
            "requiredPackages": json.loads(service["required_packages"]) if service["required_packages"] else [],
            "configTemplate": service["config_template"],
            "configValues": json.loads(service["config_values"]) if service["config_values"] else {},
            "healthCheck": json.loads(service["health_check"]) if service["health_check"] else {},
            "desiredStateVersion": service["desired_state_version"]
        }
        
        # Create reconciliation jobs for each node
        jobs_created = []
        for assignment in assignments:
            # Create job with service definition
            job_data = {
                "type": "service_reconcile",
                "serviceDefinition": service_def,
                "role": assignment["role"],
                "assignmentId": str(assignment["id"])
            }
            
            job = await conn.fetchrow("""
                INSERT INTO jobs (name, command_type, command_data, target_type, target_id, created_by)
                VALUES ($1, 'service_reconcile', $2, 'node', $3, 'system')
                RETURNING id, name
            """, f"Reconcile: {service['name']} on {assignment['hostname']}", json.dumps(job_data), assignment['node_uuid'])
            
            # Create job instance for this node
            instance = await conn.fetchrow("""
                INSERT INTO job_instances (job_id, node_id)
                VALUES ($1, $2)
                RETURNING id
            """, job["id"], assignment["hostname"])
            
            # Log reconciliation start
            await conn.execute("""
                INSERT INTO service_reconciliation_log 
                    (service_id, node_id, action, status, message)
                VALUES ($1, $2, 'reconcile', 'started', $3)
            """, service_id, assignment["node_uuid"], f"Reconciliation triggered for role: {assignment['role']}")
            
            jobs_created.append({
                "jobId": str(job["id"]),
                "instanceId": str(instance["id"]),
                "nodeId": assignment["hostname"],
                "role": assignment["role"]
            })
        
        # Update service status
        await conn.execute("""
            UPDATE services SET status = 'reconciling', updated_at = NOW()
            WHERE id = $1
        """, service_id)
        
        return {
            "status": "reconciliation_triggered",
            "serviceId": service_id,
            "jobsCreated": len(jobs_created),
            "jobs": jobs_created
        }


@app.get("/api/v1/nodes/{node_id}/service-assignments")
async def get_node_service_assignments(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get all services assigned to a node - for agent polling.
    node_id can be the database ID or the hostname (case-insensitive).
    """
    async with db.acquire() as conn:
        # If node_id is not numeric, treat it as hostname and look up the actual ID
        actual_node_id = node_id
        if not node_id.isdigit():
            node = await conn.fetchrow(
                "SELECT id FROM nodes WHERE UPPER(hostname) = UPPER($1)",
                node_id
            )
            if not node:
                # No services for unknown node - return empty list (not an error)
                return {"nodeId": node_id, "services": []}
            actual_node_id = str(node["id"])
        
        assignments = await conn.fetch("""
            SELECT 
                sna.id as assignment_id,
                sna.role,
                sna.status as assignment_status,
                sna.current_state_version,
                s.id as service_id,
                s.name as service_name,
                s.status as service_status,
                s.config_values,
                s.desired_state_version,
                sc.name as class_name,
                sc.service_type,
                sc.required_packages,
                sc.config_template,
                sc.health_check,
                sc.drift_policy
            FROM service_node_assignments sna
            JOIN services s ON sna.service_id = s.id
            JOIN service_classes sc ON s.class_id = sc.id
            WHERE sna.node_id = $1
            ORDER BY s.name
        """, actual_node_id)
        
        services = []
        for a in assignments:
            services.append({
                "assignmentId": str(a["assignment_id"]),
                "serviceId": str(a["service_id"]),
                "serviceName": a["service_name"],
                "className": a["class_name"],
                "role": a["role"],
                "status": a["assignment_status"],
                "serviceType": a["service_type"],
                "requiredPackages": json.loads(a["required_packages"]) if a["required_packages"] else [],
                "configTemplate": a["config_template"],
                "configValues": json.loads(a["config_values"]) if a["config_values"] else {},
                "healthCheck": json.loads(a["health_check"]) if a["health_check"] else {},
                "driftPolicy": a["drift_policy"],
                "currentVersion": a["current_state_version"],
                "desiredVersion": a["desired_state_version"],
                "needsReconcile": a["current_state_version"] < a["desired_state_version"]
            })
        
        return {"nodeId": node_id, "services": services}


@app.post("/api/v1/services/{service_id}/nodes/{node_id}/status")
async def update_node_service_status(
    service_id: str,
    node_id: str,
    data: Dict[str, Any],
    db: asyncpg.Pool = Depends(get_db)
):
    """Agent reports service status after reconciliation"""
    async with db.acquire() as conn:
        # Update assignment status
        result = await conn.execute("""
            UPDATE service_node_assignments SET
                status = $3,
                health_status = $4,
                current_state_version = COALESCE($5, current_state_version),
                last_health_check = NOW(),
                updated_at = NOW()
            WHERE service_id = $1 AND node_id = $2
        """,
            service_id,
            node_id,
            data.get("status", "active"),
            data.get("healthStatus", "unknown"),
            data.get("stateVersion")
        )
        
        # Log the status update
        await conn.execute("""
            INSERT INTO service_reconciliation_log 
                (service_id, node_id, action, status, message, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        """,
            service_id,
            node_id,
            data.get("action", "status_update"),
            data.get("result", "success"),
            data.get("message", "Status updated"),
            json.dumps(data.get("details", {}))
        )
        
        # Check overall service health
        health_counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE health_status = 'healthy') as healthy,
                COUNT(*) FILTER (WHERE health_status = 'unhealthy') as unhealthy
            FROM service_node_assignments
            WHERE service_id = $1
        """, service_id)
        
        # Determine service status
        if health_counts["total"] == health_counts["healthy"]:
            new_status = "healthy"
        elif health_counts["unhealthy"] > 0:
            new_status = "degraded" if health_counts["healthy"] > 0 else "failed"
        else:
            new_status = "provisioning"
        
        await conn.execute("""
            UPDATE services SET status = $2, updated_at = NOW()
            WHERE id = $1
        """, service_id, new_status)
        
        return {
            "status": "updated",
            "serviceStatus": new_status,
            "healthyNodes": health_counts["healthy"],
            "totalNodes": health_counts["total"]
        }

# ============================================================================
# E19: Alert System
# ============================================================================

import aiohttp

async def send_discord_webhook(webhook_url: str, embed: dict) -> bool:
    """Send a Discord webhook message."""
    try:
        async with aiohttp.ClientSession() as session:
            payload = {"embeds": [embed]}
            async with session.post(webhook_url, json=payload) as resp:
                return resp.status in (200, 204)
    except Exception as e:
        print(f"Discord webhook error: {e}")
        return False

async def trigger_alert(event_type: str, event_data: dict):
    """Check alert rules and send notifications."""
    async with db_pool.acquire() as conn:
        # Find matching enabled rules
        rules = await conn.fetch("""
            SELECT r.*, c.channel_type, c.config, c.name as channel_name
            FROM alert_rules r
            JOIN alert_channels c ON r.channel_id = c.id
            WHERE r.event_type = $1 
            AND r.enabled = true 
            AND c.enabled = true
        """, event_type)
        
        for rule in rules:
            # Check cooldown
            last_alert = await conn.fetchval("""
                SELECT created_at FROM alert_history
                WHERE rule_id = $1 AND status = 'sent'
                ORDER BY created_at DESC LIMIT 1
            """, rule['id'])
            
            if last_alert:
                from datetime import timedelta
                cooldown = timedelta(minutes=rule['cooldown_minutes'])
                if datetime.utcnow().replace(tzinfo=None) - last_alert.replace(tzinfo=None) < cooldown:
                    # Throttled
                    await conn.execute("""
                        INSERT INTO alert_history (rule_id, channel_id, event_type, event_data, status)
                        VALUES ($1, $2, $3, $4, 'throttled')
                    """, rule['id'], rule['channel_id'], event_type, json.dumps(event_data))
                    continue
            
            # Send alert based on channel type
            success = False
            error_msg = None
            
            if rule['channel_type'] == 'discord':
                webhook_url = rule['config'].get('webhook_url')
                if webhook_url:
                    # Build Discord embed
                    color = {
                        'node_offline': 0xFF0000,  # Red
                        'node_online': 0x00FF00,   # Green
                        'job_failed': 0xFF6600,    # Orange
                        'job_success': 0x00FF00,   # Green
                        'disk_warning': 0xFFFF00,  # Yellow
                        'vulnerability_critical': 0xFF0000,  # Red
                    }.get(event_type, 0x0099FF)
                    
                    embed = {
                        "title": f"🔔 {event_type.replace('_', ' ').title()}",
                        "description": event_data.get('message', str(event_data)),
                        "color": color,
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "footer": {"text": "Octofleet Inventory"},
                        "fields": []
                    }
                    
                    # Add fields from event_data
                    for key, value in event_data.items():
                        if key != 'message' and value:
                            embed["fields"].append({
                                "name": key.replace('_', ' ').title(),
                                "value": str(value)[:1024],
                                "inline": True
                            })
                    
                    success = await send_discord_webhook(webhook_url, embed)
                    if not success:
                        error_msg = "Webhook request failed"
            
            # Log alert
            await conn.execute("""
                INSERT INTO alert_history (rule_id, channel_id, event_type, event_data, status, error_message)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, rule['id'], rule['channel_id'], event_type, json.dumps(event_data),
                'sent' if success else 'failed', error_msg)


# Alert Channels CRUD
@app.get("/api/v1/alert-channels")
async def list_alert_channels(_: str = Depends(verify_api_key)):
    """List all alert channels."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, name, channel_type, config, enabled, created_at, updated_at
            FROM alert_channels ORDER BY created_at DESC
        """)
        return [dict(r) for r in rows]

@app.post("/api/v1/alert-channels")
async def create_alert_channel(request: Request, _: str = Depends(verify_api_key)):
    """Create a new alert channel."""
    data = await request.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO alert_channels (name, channel_type, config, enabled)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, channel_type, config, enabled, created_at
        """, data['name'], data['channel_type'], json.dumps(data.get('config', {})), 
            data.get('enabled', True))
        return dict(row)

@app.delete("/api/v1/alert-channels/{channel_id}")
async def delete_alert_channel(channel_id: str, _: str = Depends(verify_api_key)):
    """Delete an alert channel."""
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM alert_channels WHERE id = $1", channel_id)
        return {"status": "deleted"}

# Alert Rules CRUD
@app.get("/api/v1/alert-rules")
async def list_alert_rules(_: str = Depends(verify_api_key)):
    """List all alert rules."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT r.*, c.name as channel_name
            FROM alert_rules r
            LEFT JOIN alert_channels c ON r.channel_id = c.id
            ORDER BY r.created_at DESC
        """)
        return [dict(r) for r in rows]

@app.post("/api/v1/alert-rules")
async def create_alert_rule(request: Request, _: str = Depends(verify_api_key)):
    """Create a new alert rule."""
    data = await request.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO alert_rules (name, event_type, condition, channel_id, cooldown_minutes, enabled)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        """, data['name'], data['event_type'], json.dumps(data.get('condition', {})),
            data['channel_id'], data.get('cooldown_minutes', 15), data.get('enabled', True))
        return dict(row)

@app.delete("/api/v1/alert-rules/{rule_id}")
async def delete_alert_rule(rule_id: str, _: str = Depends(verify_api_key)):
    """Delete an alert rule."""
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM alert_rules WHERE id = $1", rule_id)
        return {"status": "deleted"}

# Alert History
@app.get("/api/v1/alert-history")
async def list_alert_history(limit: int = 50, _: str = Depends(verify_api_key)):
    """Get recent alert history."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT h.*, r.name as rule_name, c.name as channel_name
            FROM alert_history h
            LEFT JOIN alert_rules r ON h.rule_id = r.id
            LEFT JOIN alert_channels c ON h.channel_id = c.id
            ORDER BY h.created_at DESC
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]

# Test alert endpoint
@app.post("/api/v1/alert-channels/{channel_id}/test")
async def test_alert_channel(channel_id: str, _: str = Depends(verify_api_key)):
    """Send a test alert to a channel."""
    async with db_pool.acquire() as conn:
        channel = await conn.fetchrow(
            "SELECT * FROM alert_channels WHERE id = $1", channel_id)
        
        if not channel:
            raise HTTPException(404, "Channel not found")
        
        # Parse config if it's a string
        config = channel['config']
        if isinstance(config, str):
            config = json.loads(config)
        
        if channel['channel_type'] == 'discord':
            webhook_url = config.get('webhook_url')
            if webhook_url:
                embed = {
                    "title": "🔔 Test Alert",
                    "description": "This is a test alert from Octofleet Inventory.",
                    "color": 0x0099FF,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                    "footer": {"text": "Octofleet Inventory"}
                }
                success = await send_discord_webhook(webhook_url, embed)
                return {"status": "sent" if success else "failed"}
        
        return {"status": "unsupported_channel_type"}

# ============================================================================
# Node Health Monitor - Background Task
# ============================================================================

import asyncio
from datetime import timedelta

# Track last known status to detect changes
_node_status_cache: dict = {}

async def check_node_health_and_alert():
    """Background task to check node health and trigger alerts."""
    global _node_status_cache
    
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT node_id, hostname, last_seen, is_online
                FROM nodes
            """)
            
            for row in rows:
                node_id = row['node_id']
                hostname = row['hostname']
                last_seen = row['last_seen']
                
                # Calculate current status
                if last_seen:
                    diff = datetime.utcnow() - last_seen.replace(tzinfo=None)
                    if diff < timedelta(minutes=5):
                        current_status = "online"
                    elif diff < timedelta(minutes=60):
                        current_status = "away"
                    else:
                        current_status = "offline"
                else:
                    current_status = "offline"
                
                # Check if status changed
                prev_status = _node_status_cache.get(node_id)
                
                if prev_status and prev_status != current_status:
                    # Status changed!
                    if current_status == "offline" and prev_status in ("online", "away"):
                        # Node went offline - trigger alert
                        await trigger_alert('node_offline', {
                            'message': f"Node '{hostname}' went offline",
                            'hostname': hostname,
                            'node_id': node_id,
                            'previous_status': prev_status,
                            'last_seen': last_seen.isoformat() if last_seen else 'Never'
                        })
                    elif current_status == "online" and prev_status == "offline":
                        # Node came back online
                        await trigger_alert('node_online', {
                            'message': f"Node '{hostname}' is back online",
                            'hostname': hostname,
                            'node_id': node_id,
                            'previous_status': prev_status
                        })
                
                # Update cache
                _node_status_cache[node_id] = current_status
                
    except Exception as e:
        print(f"Node health check error: {e}")

async def node_health_monitor_task():
    """Background task that runs every 2 minutes."""
    await asyncio.sleep(30)  # Initial delay
    while True:
        await check_node_health_and_alert()
        await asyncio.sleep(120)  # Check every 2 minutes

@app.on_event("startup")
async def start_node_health_monitor():
    """Start the node health monitor on app startup."""
    asyncio.create_task(node_health_monitor_task())

# ============================================================================
# E20: Remote Terminal
# ============================================================================

# Terminal sessions storage
_terminal_sessions: dict = {}

class TerminalSession:
    def __init__(self, session_id: str, node_id: str, shell: str = "powershell"):
        self.session_id = session_id
        self.node_id = node_id
        self.shell = shell
        self.created_at = datetime.utcnow()
        self.output_buffer = []
        self.pending_commands = []
        self.connected = False

@app.post("/api/v1/terminal/start/{node_id}")
async def start_terminal_session(node_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Start a new terminal session for a node."""
    data = await request.json() if request.headers.get('content-type') == 'application/json' else {}
    shell = data.get('shell', 'powershell')  # powershell, cmd, bash
    
    session_id = str(uuid.uuid4())
    session = TerminalSession(session_id, node_id, shell)
    _terminal_sessions[session_id] = session
    
    return {
        "sessionId": session_id,
        "nodeId": node_id,
        "shell": shell,
        "status": "created"
    }

@app.get("/api/v1/terminal/sessions")
async def list_terminal_sessions(_: str = Depends(verify_api_key)):
    """List active terminal sessions."""
    return [
        {
            "sessionId": s.session_id,
            "nodeId": s.node_id,
            "shell": s.shell,
            "createdAt": s.created_at.isoformat(),
            "connected": s.connected
        }
        for s in _terminal_sessions.values()
    ]

@app.delete("/api/v1/terminal/session/{session_id}")
async def stop_terminal_session(session_id: str, _: str = Depends(verify_api_key)):
    """Stop a terminal session."""
    if session_id in _terminal_sessions:
        del _terminal_sessions[session_id]
    return {"status": "stopped"}

@app.post("/api/v1/terminal/session/{session_id}/input")
async def send_terminal_input(session_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Send input to a terminal session."""
    if session_id not in _terminal_sessions:
        raise HTTPException(404, "Session not found")
    
    data = await request.json()
    command = data.get('command', '')
    
    session = _terminal_sessions[session_id]
    session.pending_commands.append(command)
    
    return {"status": "queued", "command": command}

@app.get("/api/v1/terminal/session/{session_id}/output")
async def get_terminal_output(session_id: str, _: str = Depends(verify_api_key)):
    """Get output from a terminal session."""
    if session_id not in _terminal_sessions:
        raise HTTPException(404, "Session not found")
    
    session = _terminal_sessions[session_id]
    output = session.output_buffer.copy()
    session.output_buffer.clear()
    
    return {"output": output}

# Agent polling endpoint for terminal commands
@app.get("/api/v1/terminal/pending/{node_id}")
async def get_pending_terminal_commands(node_id: str, _: str = Depends(verify_api_key)):
    """Agent polls this to get pending commands."""
    commands = []
    for session in _terminal_sessions.values():
        if session.node_id == node_id and session.pending_commands:
            commands.append({
                "sessionId": session.session_id,
                "shell": session.shell,
                "commands": session.pending_commands.copy()
            })
            session.pending_commands.clear()
    return {"commands": commands}

# Agent posts output here
@app.post("/api/v1/terminal/output/{session_id}")
async def post_terminal_output(session_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Agent posts command output here."""
    if session_id not in _terminal_sessions:
        raise HTTPException(404, "Session not found")
    
    data = await request.json()
    output = data.get('output', '')
    
    session = _terminal_sessions[session_id]
    session.output_buffer.append(output)
    session.connected = True
    
    return {"status": "received"}

# WebSocket for real-time terminal (optional)
@app.websocket("/api/v1/terminal/ws/{session_id}")
async def terminal_websocket(websocket: WebSocket, session_id: str):
    """WebSocket for real-time terminal communication."""
    await websocket.accept()
    
    if session_id not in _terminal_sessions:
        await websocket.close(code=4004)
        return
    
    session = _terminal_sessions[session_id]
    session.connected = True
    
    try:
        while True:
            # Send any pending output
            if session.output_buffer:
                for output in session.output_buffer:
                    await websocket.send_json({"type": "output", "data": output})
                session.output_buffer.clear()
            
            # Check for input from browser
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=0.5)
                if data.get("type") == "input":
                    session.pending_commands.append(data.get("data", ""))
            except asyncio.TimeoutError:
                pass
            
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        session.connected = False
