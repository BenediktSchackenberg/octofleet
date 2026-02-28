"""
Octofleet Inventory Backend
FastAPI server for receiving and storing inventory data from Windows Agents
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Header, status, Request, BackgroundTasks, Body, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncpg
from typing import Optional, Any, Dict, List
from pydantic import BaseModel, Field
import os
import json
import time
from uuid import UUID
import uuid
import re
import secrets
from datetime import datetime, timedelta, timezone

# E7: Alerting imports
from alerting import get_alert_manager, update_node_health, check_node_health

# E19: Provisioning imports
from routers.provisioning import router as provisioning_router, pxe_router
from routers.provisioning_vm import vm_router as provisioning_vm_router
from routers.provisioning_iso import iso_router as provisioning_iso_router
from routers.nodes import router as nodes_router, pending_router
from routers.inventory import router as inventory_router
from routers.jobs import router as jobs_router
from routers.mssql import router as mssql_router
from routers.metrics import router as metrics_router
from routers.deployments import router as deployments_router
from routers.alerting import router as alerting_router
from routers.security import router as security_router
from routers.auth import router as auth_router, users_router
from routers.dashboard import router as dashboard_router
from routers.groups import router as groups_router
from app.core.rules import evaluate_dynamic_rule
from app.db.nodes import update_dynamic_device_groupships, auto_onboard_node, upsert_node
from auth import (
    UserCreate, UserUpdate, UserResponse, LoginRequest, TokenResponse,
    RoleCreate, RoleResponse, APIKeyCreate, APIKeyResponse,
    hash_password, verify_password, hash_api_key,
    create_access_token, create_refresh_token, decode_token,
    get_current_user, require_auth, require_permission, CurrentUser,
    get_permissions_for_roles
)
from routers.provisioning_domain import generate_autounattend, generate_djoin_script
from routers.provisioning_postinstall import execute_post_install, handle_provisioning_complete

# E19: PDF Report imports
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.charts.barcharts import VerticalBarChart
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt

# Centralized dependencies - single source of truth for auth and config
from dependencies import (
    not_found, bad_request, conflict, internal_error,
    API_KEY, DATABASE_URL, GATEWAY_URL, GATEWAY_TOKEN, INVENTORY_API_URL,
    verify_api_key, verify_api_key_or_query,
    sanitize_for_postgres, parse_datetime, get_db, set_db_pool,
    db_pool as _deps_db_pool
)

# Local db_pool reference (set during lifespan)
db_pool: Optional[asyncpg.Pool] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    global db_pool
    # Startup
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    set_db_pool(db_pool)  # Set in dependencies for shared access
    
    # Auto-provision default admin user if table is empty
    try:
        async with db_pool.acquire() as conn:
            user_count = await conn.fetchval("SELECT COUNT(*) FROM users")
            if user_count == 0:
                print("⚠️ No users found in database. Provisioning default admin user...")
                # Hash for 'admin' with cost 12
                admin_hash = "$2b$12$rYyY2JO.Uh/NBVp7kXBlY.p9Iv.S0GeIZbgttoYjjyS.hQQQJkkJK"
                await conn.execute("""
                    INSERT INTO users (username, password_hash, display_name, is_superuser, is_active)
                    VALUES ('admin', $1, 'System Administrator', true, true)
                """, admin_hash)
                print("✅ Default admin user created (admin / admin)")
    except Exception as e:
        print(f"❌ Failed to check/provision admin user: {e}")
        
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

# CORS - configurable via CORS_ORIGINS env var (comma-separated), default: allow all
_cors_env = os.environ.get("CORS_ORIGINS", "*")
CORS_ORIGINS = ["*"] if _cors_env.strip() == "*" else [o.strip() for o in _cors_env.split(",") if o.strip()]

# When allow_origins=["*"], credentials must be False per CORS spec.
# Browsers silently block responses when both are set.
_allow_creds = CORS_ORIGINS != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=_allow_creds,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Agent activity tracking middleware
import re as _re
_AGENT_PATH_PATTERN = _re.compile(
    r"/api/v1/(?:jobs/pending|terminal/pending|shell/pending|screen/pending|remediation/jobs/pending|live-data|agents)/(?:([^/]+))"
)
_AGENT_POST_PATTERNS = [
    (_re.compile(r"/api/v1/live-data"), "live-data"),
    (_re.compile(r"/api/v1/agents/([^/]+)/health"), "health-report"),
    (_re.compile(r"/api/v1/remediation/jobs/(\d+)/result"), "remediation-result"),
    (_re.compile(r"/api/v1/jobs/instances/([^/]+)/result"), "job-result"),
]

from collections import deque
import time as _time

_agent_activity_buffer = deque(maxlen=500)

def log_agent_activity(hostname: str, action: str, detail: str = "", ip: str = "", status_code: int = 200):
    _agent_activity_buffer.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hostname": hostname,
        "action": action,
        "detail": detail,
        "ip": ip,
        "status_code": status_code,
        "ts": _time.time()
    })

@app.middleware("http")
async def agent_activity_middleware(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    ip = request.client.host if request.client else ""

    # Track polling endpoints
    if "/pending/" in path:
        m = _re.search(r"/pending/([^/]+)", path)
        if m:
            hostname = m.group(1)
            action = "poll"
            if "terminal" in path: action = "terminal-poll"
            elif "shell" in path: action = "shell-poll"
            elif "screen" in path: action = "screen-poll"
            elif "remediation" in path: action = "remediation-poll"
            elif "jobs" in path: action = "job-poll"
            log_agent_activity(hostname, action, path, ip, response.status_code)

    # Track POST endpoints (health, live-data, results)
    elif request.method == "POST":
        for pattern, action in _AGENT_POST_PATTERNS:
            m = pattern.search(path)
            if m:
                hostname = m.group(1) if m.lastindex else "unknown"
                log_agent_activity(hostname, action, path, ip, response.status_code)
                break

    return response

# Global exception handler to ensure CORS headers on 500 errors
from starlette.responses import JSONResponse
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
    )

# Include routers
app.include_router(nodes_router)
app.include_router(pending_router)
app.include_router(inventory_router)
app.include_router(dashboard_router)
app.include_router(groups_router)
app.include_router(jobs_router)
app.include_router(mssql_router)
app.include_router(metrics_router)
app.include_router(deployments_router)
app.include_router(alerting_router)
app.include_router(security_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(provisioning_router)
app.include_router(provisioning_vm_router)
app.include_router(provisioning_iso_router)
app.include_router(pxe_router)
app.include_router(dashboard_router)


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


@app.get("/api/v1/nodes/{node_id}", dependencies=[Depends(verify_api_key)])
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


@app.get("/api/v1/nodes/{node_id}/history", dependencies=[Depends(verify_api_key)])
async def get_node_history(node_id: str, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    """Get change history for a node (hardware snapshots)"""
    async with db.acquire() as conn:
        # Get node UUID
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
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


@app.post("/api/v1/nodes/register")
async def register_pending_node(request: Request):
    """
    Register a new node as pending approval.
    No authentication required - agents call this on first startup.
    """
    pool = await get_db()
    data = await request.json()
    
    hostname = data.get("hostname", "Unknown")
    os_name = data.get("osName")
    os_version = data.get("osVersion")
    agent_version = data.get("agentVersion")
    machine_id = data.get("machineId")  # Unique hardware identifier
    
    # Get client IP
    ip_address = request.client.host if request.client else None
    
    # Check if already registered (by machine_id or hostname+ip)
    existing = None
    if machine_id:
        existing = await pool.fetchrow(
            "SELECT id, status FROM pending_nodes WHERE machine_id = $1",
            machine_id
        )
    if not existing:
        existing = await pool.fetchrow(
            "SELECT id, status FROM pending_nodes WHERE hostname = $1 AND ip_address = $2",
            hostname, ip_address
        )
    
    if existing:
        # Return existing pending ID so agent can poll
        return {
            "status": existing['status'],
            "pendingId": str(existing['id']),
            "message": f"Node already registered with status: {existing['status']}"
        }
    
    # Create new pending node
    pending_id = await pool.fetchval("""
        INSERT INTO pending_nodes (hostname, os_name, os_version, ip_address, agent_version, machine_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
    """, hostname, os_name, os_version, ip_address, agent_version, machine_id)
    
    return {
        "status": "pending",
        "pendingId": str(pending_id),
        "message": f"Node {hostname} registered. Awaiting admin approval."
    }


@app.get("/api/v1/pending-nodes")
async def list_pending_nodes(request: Request, _: str = Depends(verify_api_key)):
    """List all pending nodes awaiting approval"""
    pool = await get_db()
    
    rows = await pool.fetch("""
        SELECT id, hostname, os_name, os_version, ip_address, agent_version, 
               machine_id, status, created_at
        FROM pending_nodes
        WHERE status = 'pending'
        ORDER BY created_at DESC
    """)
    
    return {
        "pending": [
            {
                "id": str(row['id']),
                "hostname": row['hostname'],
                "osName": row['os_name'],
                "osVersion": row['os_version'],
                "ipAddress": row['ip_address'],
                "agentVersion": row['agent_version'],
                "machineId": row['machine_id'],
                "createdAt": row['created_at'].isoformat() if row['created_at'] else None
            }
            for row in rows
        ]
    }


@app.post("/api/v1/pending-nodes/{pending_id}/approve")
async def approve_pending_node(pending_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Approve a pending node and generate its config"""
    pool = await get_db()
    
    # Get pending node
    row = await pool.fetchrow(
        "SELECT * FROM pending_nodes WHERE id = $1 AND status = 'pending'",
        uuid.UUID(pending_id)
    )
    
    if not row:
        raise HTTPException(status_code=404, detail="Pending node not found or already processed")
    
    # Generate per-node API key
    node_api_key = secrets.token_urlsafe(32)
    
    # Get approver from JWT if available
    approver = "admin"
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token = auth_header[7:]
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            approver = payload.get("sub", "admin")
        except:
            pass
    
    # Update pending node status
    await pool.execute("""
        UPDATE pending_nodes 
        SET status = 'approved', approved_at = NOW(), approved_by = $2, generated_api_key = $3
        WHERE id = $1
    """, uuid.UUID(pending_id), approver, node_api_key)
    
    # Get server URL from request
    server_url = f"http://{request.headers.get('host', 'localhost:8080')}"
    
    return {
        "status": "approved",
        "nodeId": pending_id,
        "hostname": row['hostname'],
        "message": f"Node {row['hostname']} approved successfully"
    }


@app.delete("/api/v1/pending-nodes/{pending_id}/reject")
async def reject_pending_node(pending_id: str, request: Request, _: str = Depends(verify_api_key)):
    """Reject a pending node"""
    pool = await get_db()
    
    # Get approver from JWT
    rejecter = "admin"
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token = auth_header[7:]
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            rejecter = payload.get("sub", "admin")
        except:
            pass
    
    result = await pool.execute("""
        UPDATE pending_nodes 
        SET status = 'rejected', rejected_at = NOW(), rejected_by = $2
        WHERE id = $1 AND status = 'pending'
    """, uuid.UUID(pending_id), rejecter)
    
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Pending node not found")
    
    return {"status": "rejected", "message": "Node rejected"}


@app.get("/api/v1/pending-nodes/{pending_id}/config")
async def get_pending_node_config(pending_id: str):
    """
    Agent polls this to get config after approval.
    No auth required - pending_id acts as a one-time token.
    """
    pool = await get_db()
    
    row = await pool.fetchrow(
        "SELECT * FROM pending_nodes WHERE id = $1",
        uuid.UUID(pending_id)
    )
    
    if not row:
        raise HTTPException(status_code=404, detail="Unknown pending ID")
    
    if row['status'] == 'pending':
        return {"status": "pending", "message": "Awaiting admin approval"}
    
    if row['status'] == 'rejected':
        return {"status": "rejected", "message": "Node was rejected by admin"}
    
    if row['status'] == 'approved':
        # Mark config as fetched
        if not row['config_fetched_at']:
            await pool.execute(
                "UPDATE pending_nodes SET config_fetched_at = NOW() WHERE id = $1",
                uuid.UUID(pending_id)
            )
        
        # Return the config the agent should write
        return {
            "status": "approved",
            "config": {
                "InventoryApiUrl": f"http://192.168.0.5:8080",  # TODO: make configurable
                "InventoryApiKey": row['generated_api_key'] or API_KEY,
                "DisplayName": row['hostname'],
                "AutoPushInventory": True,
                "ScheduledPushEnabled": True,
                "ScheduledPushIntervalMinutes": 30
            }
        }
    
    return {"status": "unknown"}


# ============================================

# ============================================
# E3: Job System API
# ============================================

@app.post("/api/v1/jobs", dependencies=[Depends(verify_api_key)])
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


# Popular Chocolatey packages for quick reference
CHOCO_PACKAGES = {
    "notepad++": "notepadplusplus",
    "notepadplusplus": "notepadplusplus",
    "7zip": "7zip",
    "7-zip": "7zip",
    "vlc": "vlc",
    "git": "git",
    "vscode": "vscode",
    "vs-code": "vscode",
    "python": "python",
    "nodejs": "nodejs-lts",
    "node": "nodejs-lts",
    "chrome": "googlechrome",
    "firefox": "firefox",
    "putty": "putty",
    "winscp": "winscp",
    "filezilla": "filezilla",
    "sysinternals": "sysinternals",
    "powershell": "powershell-core",
    "pwsh": "powershell-core",
}


class SmartInstallRequest(BaseModel):
    """Request body for smart-install endpoint"""
    package: str = Field(..., description="Package name (e.g., 'notepad++', '7zip', 'git')")
    targets: List[str] = Field(..., description="List of node IDs or hostnames")
    timeout_seconds: int = Field(600, description="Timeout for installation")


@app.post("/api/v1/smart-install")
async def smart_install(
    request: SmartInstallRequest,
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Smart software installation with automatic Chocolatey bootstrap.
    
    Installs software on Windows nodes using Chocolatey. If Chocolatey is not
    installed on the target node, it will be automatically installed first.
    
    Example:
    ```json
    {
        "package": "notepad++",
        "targets": ["CONTROLLER", "DESKTOP-PC1"]
    }
    ```
    """
    # Normalize package name
    package_name = request.package.lower().strip()
    choco_package = CHOCO_PACKAGES.get(package_name, package_name)
    
    # Build smart-install command (installs choco if missing, then package)
    smart_cmd = (
        f'$c="C:\\ProgramData\\chocolatey\\bin\\choco.exe";'
        f'if(!(Test-Path $c))'
        f'{{Set-ExecutionPolicy Bypass -Scope Process -Force;'
        f'[Net.ServicePointManager]::SecurityProtocol='
        f'[Net.ServicePointManager]::SecurityProtocol -bor 3072;'
        f'iex((New-Object Net.WebClient).DownloadString('
        f"'https://community.chocolatey.org/install.ps1'))}}"
        f';& $c install {choco_package} -y --no-progress'
    )
    
    results = []
    async with db.acquire() as conn:
        for target in request.targets:
            # Find node
            node = await conn.fetchrow(
                "SELECT id, node_id, hostname FROM nodes WHERE node_id = $1 OR hostname = $1",
                target
            )
            if not node:
                results.append({
                    "target": target,
                    "status": "error",
                    "error": f"Node not found: {target}"
                })
                continue
            
            # Create job
            job_uuid = uuid.uuid4()
            job_name = f"Smart-Install {request.package}"
            
            await conn.execute("""
                INSERT INTO jobs (id, name, description, target_type, target_id, 
                                 command_type, command_data, timeout_seconds, created_by)
                VALUES ($1::uuid, $2, $3, 'device', $4::uuid, 'run', $5::jsonb, $6, $7)
            """, str(job_uuid), job_name, 
                f"Auto-install {choco_package} via Chocolatey (with bootstrap)",
                str(node["id"]), json.dumps({"command": smart_cmd}),
                request.timeout_seconds, "api")
            
            # Create instance
            await conn.execute("""
                INSERT INTO job_instances (job_id, node_id, status)
                VALUES ($1::uuid, $2, 'pending')
            """, str(job_uuid), node["node_id"])
            
            results.append({
                "target": target,
                "hostname": node["hostname"],
                "status": "created",
                "jobId": str(job_uuid),
                "package": choco_package
            })
    
    return {
        "package": request.package,
        "chocoPackage": choco_package,
        "results": results,
        "totalTargets": len(request.targets),
        "jobsCreated": sum(1 for r in results if r["status"] == "created")
    }


@app.get("/api/v1/smart-install/packages")
async def list_smart_install_packages():
    """List available package aliases for smart-install"""
    return {
        "packages": [
            {"alias": k, "chocoName": v, "description": f"Installs {v} via Chocolatey"}
            for k, v in sorted(CHOCO_PACKAGES.items())
        ]
    }


# ============================================
# E19: MSSQL Deployment Module
# ============================================

from mssql_module import (
    generate_disk_prep_script,
    generate_install_script,
    MssqlInstallRequest,
    DiskConfig,
    DiskConfigSection,
    SqlPaths,
    MSSQL_DOWNLOADS,
    EDITIONS as MSSQL_EDITIONS
)


@app.get("/api/v1/onboarding/config")
async def get_onboarding_config(db: asyncpg.Pool = Depends(get_db)):
    """Get onboarding configuration"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT oc.*, g.name as group_name
            FROM onboarding_config oc
            LEFT JOIN groups g ON g.id = oc.onboarding_group_id
            LIMIT 1
        """)
        
        if not row:
            return {"configured": False}
        
        return {
            "configured": True,
            "onboardingGroupId": str(row["onboarding_group_id"]) if row["onboarding_group_id"] else None,
            "onboardingGroupName": row["group_name"],
            "autoAssignNewNodes": row["auto_assign_new_nodes"]
        }


@app.put("/api/v1/onboarding/config")
async def update_onboarding_config(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update onboarding configuration"""
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO onboarding_config (id, onboarding_group_id, auto_assign_new_nodes, updated_at)
            VALUES (gen_random_uuid(), $1::uuid, $2, now())
            ON CONFLICT (id) DO UPDATE SET
                onboarding_group_id = $1::uuid,
                auto_assign_new_nodes = $2,
                updated_at = now()
        """, data.get("onboardingGroupId"), data.get("autoAssignNewNodes", True))
        
        # Actually update the existing row
        await conn.execute("""
            UPDATE onboarding_config SET
                onboarding_group_id = $1::uuid,
                auto_assign_new_nodes = $2,
                updated_at = now()
        """, data.get("onboardingGroupId"), data.get("autoAssignNewNodes", True))
        
        return {"status": "updated"}


@app.post("/api/v1/baselines")
async def create_software_baseline(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a software baseline (package collection)"""
    async with db.acquire() as conn:
        baseline_id = str(uuid.uuid4())
        
        await conn.execute("""
            INSERT INTO software_baselines (id, name, description, packages)
            VALUES ($1::uuid, $2, $3, $4)
        """, baseline_id, data.get("name"), data.get("description"), data.get("packages", []))
        
        return {
            "id": baseline_id,
            "name": data.get("name"),
            "packages": data.get("packages", [])
        }


@app.get("/api/v1/baselines")
async def list_software_baselines(db: asyncpg.Pool = Depends(get_db)):
    """List all software baselines"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, name, description, packages, created_at
            FROM software_baselines
            ORDER BY created_at DESC
        """)
        
        baselines = [{
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "packages": row["packages"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None
        } for row in rows]
        
        return {"baselines": baselines}


@app.get("/api/v1/baselines/{baseline_id}")
async def get_software_baseline(baseline_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a specific baseline with its assignments"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM software_baselines WHERE id = $1::uuid
        """, baseline_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Baseline not found")
        
        # Get assignments
        assignments = await conn.fetch("""
            SELECT ba.id, ba.group_id, ba.enabled, g.name as group_name
            FROM software_baseline_assignments ba
            JOIN groups g ON g.id = ba.group_id
            WHERE ba.baseline_id = $1::uuid
        """, baseline_id)
        
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "packages": row["packages"],
            "assignments": [{
                "id": str(a["id"]),
                "groupId": str(a["group_id"]),
                "groupName": a["group_name"],
                "enabled": a["enabled"]
            } for a in assignments]
        }


@app.delete("/api/v1/baselines/{baseline_id}")
async def delete_software_baseline(baseline_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a software baseline"""
    async with db.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM software_baselines WHERE id = $1::uuid
        """, baseline_id)
        
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Baseline not found")
        
        return {"status": "deleted", "id": baseline_id}


@app.post("/api/v1/baselines/{baseline_id}/assign")
async def assign_baseline_to_group(baseline_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Assign a software baseline to a group"""
    group_id = data.get("groupId")
    if not group_id:
        raise HTTPException(status_code=400, detail="groupId is required")
    
    async with db.acquire() as conn:
        # Verify baseline and group exist
        baseline = await conn.fetchrow("SELECT name FROM software_baselines WHERE id = $1::uuid", baseline_id)
        if not baseline:
            raise HTTPException(status_code=404, detail="Baseline not found")
        
        group = await conn.fetchrow("SELECT name FROM groups WHERE id = $1::uuid", group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        try:
            assignment_id = str(uuid.uuid4())
            await conn.execute("""
                INSERT INTO software_baseline_assignments (id, baseline_id, group_id)
                VALUES ($1::uuid, $2::uuid, $3::uuid)
            """, assignment_id, baseline_id, group_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail="Baseline already assigned to this group")
        
        return {
            "id": assignment_id,
            "baselineId": baseline_id,
            "baselineName": baseline["name"],
            "groupId": group_id,
            "groupName": group["name"]
        }


@app.post("/api/v1/baselines/reconcile")
async def reconcile_all_baselines(db: asyncpg.Pool = Depends(get_db)):
    """
    Reconcile all baseline assignments.
    Installs missing packages on nodes in assigned groups.
    """
    async with db.acquire() as conn:
        # Get all enabled assignments
        assignments = await conn.fetch("""
            SELECT ba.id, ba.baseline_id, ba.group_id, 
                   b.name as baseline_name, b.packages,
                   g.name as group_name
            FROM software_baseline_assignments ba
            JOIN software_baselines b ON b.id = ba.baseline_id
            JOIN groups g ON g.id = ba.group_id
            WHERE ba.enabled = true
        """)
        
        results = []
        
        for assignment in assignments:
            # Get nodes in group that haven't completed this baseline
            nodes_needing_install = await conn.fetch("""
                SELECT n.id, n.node_id, n.hostname
                FROM device_groups dg
                JOIN nodes n ON n.id = dg.node_id
                LEFT JOIN software_baseline_status sbs 
                    ON sbs.node_id = n.node_id AND sbs.baseline_id = $1::uuid
                WHERE dg.group_id = $2::uuid
                  AND n.is_online = true
                  AND (sbs.status IS NULL OR sbs.status = 'failed')
            """, assignment["baseline_id"], assignment["group_id"])
            
            if not nodes_needing_install:
                continue
            
            # Build installation script
            packages = assignment["packages"]
            if not packages:
                continue
            
            # Create jobs for each node
            for node in nodes_needing_install:
                # Build choco install script
                choco_packages = []
                for pkg in packages:
                    choco_name = CHOCO_PACKAGES.get(pkg.lower(), pkg)
                    choco_packages.append(choco_name)
                
                install_script = f'''
# Software Baseline: {assignment["baseline_name"]}
$ErrorActionPreference = "Stop"

# Ensure Chocolatey is installed
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {{
    Write-Host "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}}

# Install packages
$packages = @({", ".join([f'"{p}"' for p in choco_packages])})
foreach ($pkg in $packages) {{
    Write-Host "Installing $pkg..."
    choco install $pkg -y --no-progress
    if ($LASTEXITCODE -ne 0) {{
        Write-Warning "Failed to install $pkg"
    }}
}}

Write-Host "Baseline installation complete!"
'''
                
                job_id = str(uuid.uuid4())
                await conn.execute("""
                    INSERT INTO jobs (id, name, description, target_type, target_id,
                                     command_type, command_data, timeout_seconds, created_by)
                    VALUES ($1::uuid, $2, $3, 'device', $4::uuid, 'run', $5::jsonb, $6, 'baseline-reconciler')
                """, job_id,
                    f"[Baseline] {assignment['baseline_name']} - {node['hostname']}",
                    f"Install baseline packages: {', '.join(packages)}",
                    str(node["id"]),
                    json.dumps({"command": install_script}),
                    1800  # 30 min timeout
                )
                
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, job_id, node["node_id"])
                
                # Track baseline status
                await conn.execute("""
                    INSERT INTO software_baseline_status (node_id, baseline_id, assignment_id, status, job_id)
                    VALUES ($1, $2::uuid, $3::uuid, 'pending', $4::uuid)
                    ON CONFLICT (node_id, baseline_id) DO UPDATE SET
                        status = 'pending', job_id = $4::uuid, error_message = NULL
                """, node["node_id"], assignment["baseline_id"], assignment["id"], job_id)
                
                results.append({
                    "nodeId": node["node_id"],
                    "hostname": node["hostname"],
                    "baselineName": assignment["baseline_name"],
                    "jobId": job_id
                })
        
        return {
            "reconciled": len(results),
            "results": results
        }


@app.get("/api/v1/jobs", dependencies=[Depends(verify_api_key)])
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


@app.get("/api/v1/jobs/{job_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Job", job_id)
        
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


@app.get("/api/v1/jobs/pending/{node_id}", dependencies=[Depends(verify_api_key)])
async def get_pending_jobs(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Agent endpoint: Get pending jobs for a specific node"""
    # Support both formats: "win-baltasa" and "BALTASA"
    # Agent uses win-{hostname.lower()}, DB stores HOSTNAME
    lookup_id = node_id
    if node_id.startswith("win-"):
        lookup_id = node_id[4:].upper()  # win-baltasa -> BALTASA
    
    async with db.acquire() as conn:
        # Reset stuck 'queued' jobs back to 'pending' (jobs that were picked up but never completed)
        # Uses job timeout or 5 minutes default
        await conn.execute("""
            UPDATE job_instances ji
            SET status = 'pending', updated_at = NOW()
            FROM jobs j
            WHERE ji.job_id = j.id
              AND ji.status = 'queued'
              AND ji.updated_at < NOW() - INTERVAL '1 second' * COALESCE(j.timeout_seconds, 300)
        """)
        
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


@app.post("/api/v1/jobs/instances/{instance_id}/start", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Job instance", instance_id)
        
        await conn.execute("""
            INSERT INTO job_logs (instance_id, level, message)
            VALUES ($1, 'info', 'Job execution started')
        """, instance_id)
        
        return {"status": "running", "instanceId": instance_id}


@app.post("/api/v1/jobs/instances/{instance_id}/result", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Job instance", instance_id)
        
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
        
        # Handle VM creation job completion - extract MAC and update provisioning task
        if success:
            job_info = await conn.fetchrow("""
                SELECT name FROM jobs WHERE id = $1
            """, row["job_id"])
            
            if job_info and job_info['name'] and job_info['name'].startswith('Create VM:'):
                # This is a VM creation job - parse MAC from output
                try:
                    import re
                    mac_match = re.search(r'"macAddress"\s*:\s*"([0-9A-Fa-f:]{17})"', stdout or '')
                    if mac_match:
                        mac_address = mac_match.group(1).upper()
                        
                        # Find provisioning task linked to this job
                        task = await conn.fetchrow("""
                            SELECT id, hostname FROM provisioning_tasks 
                            WHERE network_config::jsonb->>'vm_job_id' = $1
                        """, row["job_id"])
                        
                        if task:
                            # Update task with MAC address and activate it
                            await conn.execute("""
                                UPDATE provisioning_tasks 
                                SET mac_address = $1, 
                                    status = 'pending',
                                    status_message = 'VM created, waiting for PXE boot',
                                    updated_at = NOW()
                                WHERE id = $2
                            """, mac_address, task['id'])
                            print(f"✅ VM created: {task['hostname']} - MAC: {mac_address}")
                except Exception as e:
                    print(f"Error processing VM creation result: {e}")
        
        return {
            "status": status,
            "instanceId": instance_id,
            "willRetry": should_retry
        }


# Legacy endpoint for old Linux agent (snake_case fields, different path)
@app.post("/api/v1/jobs/result", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Job instance", instance_id)
        
        return {"status": "success" if success else "failed", "instanceId": instance_id}


@app.post("/api/v1/jobs/instances/{instance_id}/retry", dependencies=[Depends(verify_api_key)])
async def retry_job_instance(instance_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Manually retry a failed or cancelled job instance"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, status, attempt, max_attempts FROM job_instances WHERE id = $1
        """, instance_id)
        
        if not row:
            raise not_found("Job instance", instance_id)
        
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


@app.delete("/api/v1/jobs/{job_id}", dependencies=[Depends(verify_api_key)])
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

@app.get("/api/v1/packages", dependencies=[Depends(verify_api_key)])
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


@app.post("/api/v1/packages", dependencies=[Depends(verify_api_key)])
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


@app.get("/api/v1/packages/{package_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Package", package_id if "package_id" in dir() else str(id))
        
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


@app.put("/api/v1/packages/{package_id}", dependencies=[Depends(verify_api_key)])
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


@app.delete("/api/v1/packages/{package_id}", dependencies=[Depends(verify_api_key)])
async def delete_package(package_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package (cascades to versions)"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM packages WHERE id = $1 RETURNING name", package_id)
        if not row:
            raise not_found("Package", package_id if "package_id" in dir() else str(id))
        return {"status": "deleted", "name": row["name"]}


# ============================================
# PACKAGE VERSIONS API
# ============================================

@app.post("/api/v1/packages/{package_id}/versions", dependencies=[Depends(verify_api_key)])
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


@app.get("/api/v1/packages/{package_id}/versions/{version_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Version", version_id)
        
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


@app.put("/api/v1/packages/{package_id}/versions/{version_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Version", version_id)
        
        return {"status": "updated", "version": row["version"]}


@app.delete("/api/v1/packages/{package_id}/versions/{version_id}", dependencies=[Depends(verify_api_key)])
async def delete_package_version(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package version"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            DELETE FROM package_versions 
            WHERE id = $1 AND package_id = $2
            RETURNING version
        """, version_id, package_id)
        
        if not row:
            raise not_found("Version", version_id)
        return {"status": "deleted", "version": row["version"]}


# ============================================
# DETECTION RULES API
# ============================================

@app.post("/api/v1/packages/{package_id}/versions/{version_id}/rules", dependencies=[Depends(verify_api_key)])
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

@app.get("/api/v1/packages/{package_id}/versions/{version_id}/detect", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Version", version_id)
        
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


@app.get("/api/v1/packages/{package_id}/versions/{version_id}/download-info", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Version", version_id)
        
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

@app.post("/api/v1/nodes/{node_id}/eventlog", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Node", node_id)
        
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
                    parse_datetime(event.get("timestamp") or event.get("eventTime")) or datetime.utcnow(),
                    json.dumps(sanitize_for_postgres(event.get("rawData"))) if event.get("rawData") else None
                )
                inserted += 1
            except Exception as e:
                print(f"Error inserting event: {e}")
                continue
        
        return {"status": "ok", "inserted": inserted, "total": len(events)}


@app.get("/api/v1/nodes/{node_id}/eventlog", dependencies=[Depends(verify_api_key)])
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


@app.post("/api/v1/jobs/{job_id}/parse-eventlog", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Node", node_id)
        
        node_uuid = node["id"]
        
        # Insert metrics
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
        
        # Update last_seen timestamp - metrics prove the node is alive
        await conn.execute("UPDATE nodes SET last_seen = NOW() WHERE id = $1", node_uuid)
        
        return {"status": "ok"}


@app.get("/api/v1/nodes/{node_id}/metrics", dependencies=[Depends(verify_api_key)])
async def get_node_metrics(node_id: str, hours: int = 24, db: asyncpg.Pool = Depends(get_db)):
    """Get metrics for a node with time series data"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
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


@app.get("/api/v1/metrics/timeseries", dependencies=[Depends(verify_api_key)])
async def get_fleet_timeseries(
    hours: int = 1, 
    bucket_minutes: int = 5,
    group_id: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Get fleet-wide time series data for sparkline charts.
    Aggregates all nodes (or filtered by group) into time buckets.
    """
    from datetime import timedelta
    
    async with db.acquire() as conn:
        # Calculate start time as datetime
        start_time = datetime.utcnow() - timedelta(hours=hours)
        bucket_delta = timedelta(minutes=bucket_minutes)
        
        # Build group filter
        group_filter = ""
        params = [start_time, bucket_delta]
        if group_id:
            group_filter = "AND n.id IN (SELECT node_id FROM group_members WHERE group_id = $3::uuid)"
            params.append(group_id)
        
        # Use TimescaleDB time_bucket for efficient aggregation
        query = f"""
            SELECT 
                time_bucket($2, m.time) as bucket,
                ROUND(AVG(m.cpu_percent)::numeric, 1) as avg_cpu,
                ROUND(AVG(m.ram_percent)::numeric, 1) as avg_ram,
                ROUND(AVG(m.disk_percent)::numeric, 1) as avg_disk,
                COUNT(DISTINCT m.node_id) as node_count
            FROM node_metrics m
            JOIN nodes n ON n.id = m.node_id
            WHERE m.time > $1
            {group_filter}
            GROUP BY bucket
            ORDER BY bucket ASC
        """
        
        rows = await conn.fetch(query, *params)
        
        timeseries = [{
            "time": row["bucket"].isoformat(),
            "cpu": float(row["avg_cpu"]) if row["avg_cpu"] else None,
            "ram": float(row["avg_ram"]) if row["avg_ram"] else None,
            "disk": float(row["avg_disk"]) if row["avg_disk"] else None,
            "nodes": row["node_count"]
        } for row in rows]
        
        # Get current averages
        if timeseries:
            latest = timeseries[-1]
            current = {"cpu": latest["cpu"], "ram": latest["ram"], "disk": latest["disk"]}
        else:
            current = {"cpu": None, "ram": None, "disk": None}
        
        return {
            "hours": hours,
            "bucketMinutes": bucket_minutes,
            "groupId": group_id,
            "dataPoints": len(timeseries),
            "current": current,
            "timeseries": timeseries
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
# Auth & User Management (Moved to routers/auth.py)
# ============================================


# ============================================
# Feature 2: Eventlog Charts - Trends over time
# ============================================


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
            raise not_found("Role", role_id)
        
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
            raise not_found("Role", role_id)
        
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
            raise not_found("Role", role_id)
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

@app.get("/api/v1/vulnerabilities/by-node")
async def vulnerabilities_by_node(_: str = Depends(verify_api_key)):
    """Get vulnerability breakdown per node with severity counts."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.last_seen,
                COUNT(DISTINCT v.id) as total_vulns,
                COUNT(DISTINCT CASE WHEN v.severity='CRITICAL' THEN v.id END) as critical,
                COUNT(DISTINCT CASE WHEN v.severity='HIGH' THEN v.id END) as high,
                COUNT(DISTINCT CASE WHEN v.severity='MEDIUM' THEN v.id END) as medium,
                COUNT(DISTINCT CASE WHEN v.severity='LOW' THEN v.id END) as low,
                MAX(v.cvss_score) as max_cvss,
                COUNT(DISTINCT s.name) as affected_software_count
            FROM nodes n
            JOIN software_current s ON s.node_id = n.id
            JOIN vulnerabilities v ON s.name = v.software_name AND s.version = v.software_version
            LEFT JOIN node_vulnerabilities nv ON nv.vulnerability_id = v.id AND nv.node_id = n.id::text
            WHERE nv.status IS NULL OR nv.status != 'fixed'
            GROUP BY n.id, n.hostname, n.os_name, n.last_seen
            ORDER BY total_vulns DESC
        """)
        return {"nodes": [{
            "id": str(r["id"]), "hostname": r["hostname"], "os_type": r["os_name"],
            "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
            "total_vulns": r["total_vulns"], "critical": r["critical"], "high": r["high"],
            "medium": r["medium"], "low": r["low"], "max_cvss": float(r["max_cvss"]) if r["max_cvss"] else 0,
            "affected_software_count": r["affected_software_count"]
        } for r in rows]}

@app.get("/api/v1/vulnerabilities/by-software")
async def vulnerabilities_by_software(_: str = Depends(verify_api_key)):
    """Get vulnerability breakdown per software with affected node names."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT v.software_name, v.software_version,
                COUNT(DISTINCT v.id) as vuln_count,
                MAX(v.cvss_score) as max_cvss,
                COUNT(DISTINCT CASE WHEN v.severity='CRITICAL' THEN v.id END) as critical,
                COUNT(DISTINCT CASE WHEN v.severity='HIGH' THEN v.id END) as high,
                array_agg(DISTINCT n.hostname) as affected_nodes
            FROM vulnerabilities v
            JOIN software_current s ON s.name = v.software_name AND s.version = v.software_version
            JOIN nodes n ON n.id = s.node_id
            LEFT JOIN node_vulnerabilities nv ON nv.vulnerability_id = v.id AND nv.node_id = n.id::text
            WHERE nv.status IS NULL OR nv.status != 'fixed'
            GROUP BY v.software_name, v.software_version
            ORDER BY vuln_count DESC
            LIMIT 20
        """)
        return {"software": [{
            "software_name": r["software_name"], "software_version": r["software_version"],
            "vuln_count": r["vuln_count"], "max_cvss": float(r["max_cvss"]) if r["max_cvss"] else 0,
            "critical": r["critical"], "high": r["high"],
            "affected_nodes": list(r["affected_nodes"])
        } for r in rows]}

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

class TriggerRemediationRequest(BaseModel):
    severity_filter: List[str] = ["CRITICAL", "HIGH"]
    software_filter: Optional[str] = None
    node_ids: Optional[List[str]] = None
    dry_run: bool = True

class RemediationEngine:
    def __init__(self, pool):
        self.pool = pool

    async def scan_and_create_jobs(self, severity_filter=None, software_filter=None, node_ids=None, dry_run=True):
        async with self.pool.acquire() as conn:
            # Find vulnerabilities with available fixes
            where = "WHERE 1=1"
            params = []
            idx = 1
            if severity_filter:
                placeholders = ", ".join(f"${i}" for i in range(idx, idx + len(severity_filter)))
                where += f" AND UPPER(v.severity) IN ({placeholders})"
                params.extend([s.upper() for s in severity_filter])
                idx += len(severity_filter)
            if software_filter:
                where += f" AND v.software_name ILIKE ${idx}"
                params.append(f"%{software_filter}%")
                idx += 1

            vulns = await conn.fetch(f"""
                SELECT v.id, v.software_name, v.software_version, v.cve_id, v.severity, v.cvss_score,
                       nv.node_id
                FROM vulnerabilities v
                JOIN node_vulnerabilities nv ON nv.vulnerability_id = v.id
                {where}
                ORDER BY v.cvss_score DESC NULLS LAST
                LIMIT 500
            """, *params)

            if node_ids:
                vulns = [v for v in vulns if str(v["node_id"]) in node_ids]

            # Match to remediation packages
            packages = await conn.fetch("SELECT * FROM remediation_packages WHERE enabled = true")
            pkg_map = {}
            for p in packages:
                key = (p["target_software"] or "").lower()
                if key not in pkg_map:
                    pkg_map[key] = p

            jobs_created = []
            jobs_preview = []
            for v in vulns:
                sw = (v["software_name"] or "").lower()
                pkg = pkg_map.get(sw)
                fix_method = pkg["fix_method"] if pkg else "winget"
                fix_cmd = pkg["fix_command"] if pkg else f"winget upgrade {v['software_name']}"

                job_info = {
                    "vulnerabilityId": v["id"],
                    "nodeId": str(v["node_id"]),
                    "softwareName": v["software_name"],
                    "softwareVersion": v["software_version"],
                    "cveId": v["cve_id"],
                    "severity": v["severity"],
                    "fixMethod": fix_method,
                    "fixCommand": fix_cmd,
                    "packageId": str(pkg["id"]) if pkg else None,
                }

                if dry_run:
                    jobs_preview.append(job_info)
                else:
                    row = await conn.fetchrow("""
                        INSERT INTO remediation_jobs (vulnerability_id, remediation_package_id, node_id,
                            software_name, software_version, cve_id, status, requires_approval)
                        VALUES ($1, $2, $3::uuid, $4, $5, $6, 'pending', false) RETURNING id
                    """, v["id"], pkg["id"] if pkg else None, str(v["node_id"]),
                        v["software_name"], v["software_version"], v["cve_id"])
                    job_info["id"] = str(row["id"])
                    job_info["status"] = "pending"
                    jobs_created.append(job_info)

            return {
                "dryRun": dry_run,
                "totalVulnerabilities": len(vulns),
                "jobsCreated": len(jobs_created),
                "jobsPreview": len(jobs_preview),
                "jobs": jobs_created if not dry_run else jobs_preview,
            }

async def get_remediation_summary(pool):
    async with pool.acquire() as conn:
        fixed = await conn.fetchval("SELECT COUNT(*) FROM remediation_jobs WHERE status IN ('completed', 'success')") or 0
        pending = await conn.fetchval("SELECT COUNT(*) FROM remediation_jobs WHERE status IN ('pending', 'approved', 'running')") or 0
        failed = await conn.fetchval("SELECT COUNT(*) FROM remediation_jobs WHERE status = 'failed'") or 0
        running = await conn.fetchval("SELECT COUNT(*) FROM remediation_jobs WHERE status = 'running'") or 0
        fixable = await conn.fetchval("""
            SELECT COUNT(DISTINCT v.id) FROM vulnerabilities v
            JOIN node_vulnerabilities nv ON nv.vulnerability_id = v.id
            WHERE UPPER(v.severity) IN ('CRITICAL', 'HIGH')
        """) or 0
        active_packages = await conn.fetchval("SELECT COUNT(*) FROM remediation_packages WHERE enabled = true") or 0
        active_rules = await conn.fetchval("SELECT COUNT(*) FROM remediation_rules WHERE enabled = true") or 0
        recent = await conn.fetch("""
            SELECT rj.id, rj.node_id, rj.software_name, rj.software_version, rj.cve_id, rj.status, 
                   rp.fix_method, rj.created_at, rj.completed_at, rj.exit_code, rj.error_message
            FROM remediation_jobs rj
            LEFT JOIN remediation_packages rp ON rp.id = rj.remediation_package_id
            ORDER BY rj.created_at DESC LIMIT 20
        """)
        return {
            "fixed": fixed,
            "pending": pending,
            "failed": failed,
            "fixableCves": fixable,
            "fixable_vulnerabilities": fixable,
            "active_packages": active_packages,
            "active_rules": active_rules,
            "job_counts": {"success": fixed, "completed": fixed, "approved": pending, "pending": pending, "failed": failed, "running": running},
            "recent_jobs": [{
                "id": r["id"], "node_id": str(r["node_id"]), "software_name": r["software_name"],
                "software_version": r["software_version"], "cve_id": r["cve_id"], "status": r["status"],
                "fix_method": r["fix_method"], "exit_code": r["exit_code"], "error_message": r["error_message"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None
            } for r in recent],
            "recentJobs": [{
                "id": str(r["id"]), "nodeId": str(r["node_id"]), "softwareName": r["software_name"],
                "cveId": r["cve_id"], "status": r["status"],
                "createdAt": str(r["created_at"]), "completedAt": str(r["completed_at"]) if r["completed_at"] else None
            } for r in recent]
        }

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
        
        # Get pending/approved remediation jobs for this node
        jobs = await conn.fetch("""
            SELECT rj.*, rp.name as package_name, rp.fix_method, rp.fix_command
            FROM remediation_jobs rj
            LEFT JOIN remediation_packages rp ON rp.id = rj.remediation_package_id
            WHERE rj.node_id = $1 
              AND rj.status IN ('pending', 'approved')
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
    # winget returns exit code 1 when "no upgrade available" — treat as success
    if exit_code == 1 and output and ("keine" in output.lower() or "no applicable" in output.lower() or "no available upgrade" in output.lower() or "neueren paketversionen" in output.lower()):
        success = True
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
    
    # On success: mark related node_vulnerabilities as remediated
    if success:
        try:
            async with db_pool.acquire() as conn:
                # Get the job details to find node_id and vulnerability_id
                job_row = await conn.fetchrow(
                    "SELECT node_id, vulnerability_id, software_name FROM remediation_jobs WHERE id = $1", job_id
                )
                if job_row and job_row["node_id"]:
                    node_id_str = str(job_row["node_id"])
                    # Mark the specific node_vulnerability as fixed
                    await conn.execute("""
                        UPDATE node_vulnerabilities 
                        SET status = 'fixed', fixed_at = NOW(), fixed_by = 'remediation'
                        WHERE node_id = $1 AND vulnerability_id = $2 AND status != 'fixed'
                    """, node_id_str, job_row["vulnerability_id"])
                    
                    # Also mark all node_vulnerabilities for same node+software as fixed
                    # (one package update fixes all CVEs for that software)
                    if job_row["software_name"]:
                        await conn.execute("""
                            UPDATE node_vulnerabilities nv
                            SET status = 'fixed', fixed_at = NOW(), fixed_by = 'remediation'
                            FROM vulnerabilities v
                            WHERE nv.vulnerability_id = v.id
                              AND nv.node_id = $1
                              AND v.software_name = $2
                              AND nv.status != 'fixed'
                        """, node_id_str, job_row["software_name"])
        except Exception as e:
            logger.warning(f"Failed to update node_vulnerabilities after remediation: {e}")
    
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
live_eventlog_cache: Dict[str, Dict] = {}  # Cache for Windows Event Logs (System, Security, Application)

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
                async with db_pool.acquire() as conn:
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
                async with db_pool.acquire() as conn:
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
                async with db_pool.acquire() as conn:
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
            
            # Send Windows Event Logs every 5 seconds (from cache)
            if node_id in live_eventlog_cache and now - last_network_time >= 5:
                eventlog_data = live_eventlog_cache[node_id]
                data = {
                    "type": "eventLogs",
                    "data": eventlog_data
                }
                yield f"event: eventLogs\ndata: {json.dumps(data)}\n\n"
            
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
            raise not_found("Node", node_id)
    
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
        raise bad_request("nodeId is required", "nodeId")
    
    # Debug: log network data presence
    network_data = data.get("network", [])
    if network_data:
        logger.info(f"[LIVE-DATA] {node_id_text}: {len(network_data)} network interfaces received")
    
    async with db.acquire() as conn:
        # Get node UUID
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id_text)
        if not node:
            raise not_found("Node", node_id_text)
        
        node_uuid = node['id']
        now = dt.utcnow()
        
        # Update last_seen - live-data proves the node is alive
        await conn.execute("UPDATE nodes SET last_seen = NOW() WHERE id = $1", node_uuid)
        
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
        
        # Cache Windows Event Logs for SSE streaming
        event_logs = data.get("eventLogs", [])
        if event_logs:
            live_eventlog_cache[node_id_text] = {
                "timestamp": now.isoformat(),
                "logs": event_logs
            }
        
        return {
            "status": "ok",
            "metricsStored": bool(metrics),
            "processesStored": len(processes),
            "networkCached": len(network),
            "agentLogsCached": len(agent_logs)
        }


@app.get("/api/v1/nodes/{node_id}/metrics/history", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Node", node_id)
        
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


@app.get("/api/v1/nodes/{node_id}/hardware/export", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Node", node_id)
        
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
    logger.info(f"Viewer WebSocket connected for session {session_id}")
    
    session = screen_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Viewer tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    session.viewer_ws = websocket
    logger.info(f"Viewer connected to screen session {session_id}, state={session.state}")
    
    try:
        # Send initial info
        await websocket.send_json({
            "type": "info",
            "session_id": session_id,
            "node_id": session.node_id,
            "state": session.state.value,
            "quality": session.quality
        })
        
        # Keep connection alive - just wait for messages, frames are pushed by agent handler
        # Use a longer timeout and don't break on timeout
        while True:
            try:
                # Wait for client messages (pings, control messages)
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    logger.debug(f"Viewer ping/pong for session {session_id}")
                elif data.get("type") == "stop":
                    logger.info(f"Viewer requested stop for session {session_id}")
                    break
            except asyncio.TimeoutError:
                # Send keep-alive ping to browser - but don't break if it fails
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception as e:
                    logger.warning(f"Failed to send ping to viewer {session_id}: {e}")
                    break
                
    except WebSocketDisconnect:
        logger.info(f"Viewer disconnected from screen session {session_id}")
    except Exception as e:
        logger.error(f"Viewer WebSocket error for {session_id}: {e}")
    finally:
        logger.info(f"Viewer WebSocket cleanup for session {session_id}")
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
    logger.info(f"Agent WebSocket connecting for session {session_id}")
    
    # Validate API key (use centralized constant from dependencies)
    if api_key != API_KEY:
        logger.warning(f"Agent WebSocket rejected: invalid API key for session {session_id}")
        await websocket.close(code=4001, reason="Invalid API key")
        return
    
    await websocket.accept()
    logger.info(f"Agent WebSocket accepted for session {session_id}")
    
    session = screen_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Agent tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    if session.state != ScreenSessionState.PENDING:
        logger.warning(f"Agent tried to connect to session {session_id} but state is {session.state}")
        await websocket.send_json({"type": "error", "message": f"Session not in pending state (is {session.state})"})
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


# =============================================================================
# REMOTE SHELL (E19)
# =============================================================================

from shell_session import shell_session_manager, ShellSessionState

@app.on_event("startup")
async def start_shell_manager():
    await shell_session_manager.start()

@app.on_event("shutdown")
async def stop_shell_manager():
    await shell_session_manager.stop()


@app.post("/api/v1/shell/start/{node_id}")
async def start_shell_session(
    node_id: str,
    shell_type: str = "powershell",  # powershell, cmd, bash
    user: dict = Depends(get_current_user)
):
    """
    Start a remote shell session for a node.
    
    The session enters PENDING state until the agent connects.
    """
    import uuid
    
    # Validate shell type
    valid_shells = ["powershell", "cmd", "bash", "sh"]
    if shell_type not in valid_shells:
        raise HTTPException(400, f"Invalid shell type. Must be one of: {valid_shells}")
    
    try:
        session_id = str(uuid.uuid4())
        session = await shell_session_manager.create_session(
            session_id=session_id,
            node_id=node_id.upper(),
            user_id=user.get("id", "unknown"),
            shell_type=shell_type
        )
        
        # Log audit event
        await log_audit(
            db_pool, 
            action="shell_session_start",
            user_id=user.get("id"),
            resource_type="shell_session",
            resource_id=session_id,
            details={"node_id": node_id, "shell_type": shell_type}
        )
        
        return {
            "session_id": session_id,
            "state": session.state.value,
            "shell_type": shell_type,
            "node_id": node_id.upper()
        }
    except Exception as e:
        logger.error(f"Failed to create shell session: {e}")
        raise HTTPException(500, str(e))


@app.post("/api/v1/shell/stop/{session_id}")
async def stop_shell_session(
    session_id: str,
    user: dict = Depends(get_current_user)
):
    """Stop a shell session."""
    session = shell_session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    
    await shell_session_manager.close_session(session_id, "user_stopped")
    
    return {"status": "stopped"}


@app.get("/api/v1/shell/pending/{node_id}")
async def get_pending_shell_session(
    node_id: str,
    api_key: str = Header(None, alias="X-API-Key")
):
    """
    Agent polls this to check for pending shell sessions.
    """
    if api_key != API_KEY:
        raise HTTPException(401, "Invalid API key")
    
    session = shell_session_manager.get_pending_for_node(node_id.upper())
    if not session:
        return {"session": None}
    
    return {
        "session": {
            "session_id": session.session_id,
            "shell_type": session.shell_type,
            "user_id": session.user_id
        }
    }


@app.websocket("/api/v1/shell/ws/{session_id}")
async def shell_viewer_websocket(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for browser viewers to interact with remote shell.
    
    Protocol:
    - Client sends: {"type": "input", "data": "ls -la\n"}
    - Server sends: {"type": "output", "data": "..."}
    - Server sends: {"type": "info", "state": "active"}
    - Server sends: {"type": "closed", "reason": "..."}
    """
    await websocket.accept()
    logger.info(f"Shell viewer WebSocket connected for session {session_id}")
    
    session = shell_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Shell viewer tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    session.viewer_ws = websocket
    logger.info(f"Shell viewer connected to session {session_id}, state={session.state}")
    
    try:
        # Send initial info
        await websocket.send_json({
            "type": "info",
            "session_id": session_id,
            "node_id": session.node_id,
            "state": session.state.value,
            "shell_type": session.shell_type
        })
        
        # Forward input from viewer to agent
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120)
                
                if data.get("type") == "input":
                    # Forward to agent
                    if session.agent_ws:
                        await session.agent_ws.send_json(data)
                        shell_session_manager.record_command(session_id)
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Agent not connected"
                        })
                        
                elif data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    
                elif data.get("type") == "resize":
                    # Forward terminal resize to agent
                    if session.agent_ws:
                        await session.agent_ws.send_json(data)
                        
            except asyncio.TimeoutError:
                # Send keep-alive
                try:
                    await websocket.send_json({"type": "ping"})
                except:
                    break
                
    except WebSocketDisconnect:
        logger.info(f"Shell viewer disconnected from session {session_id}")
    except Exception as e:
        logger.error(f"Shell viewer WebSocket error for {session_id}: {e}")
    finally:
        logger.info(f"Shell viewer WebSocket cleanup for session {session_id}")
        session.viewer_ws = None


@app.websocket("/api/v1/shell/ws/agent/{session_id}")
async def shell_agent_websocket(websocket: WebSocket, session_id: str, api_key: str = None):
    """
    WebSocket endpoint for agents to connect shell sessions.
    
    Protocol:
    - Agent sends: {"type": "output", "data": "..."}
    - Agent sends: {"type": "ready"}
    - Agent sends: {"type": "exit", "code": 0}
    - Server sends: {"type": "input", "data": "..."}
    - Server sends: {"type": "resize", "cols": 80, "rows": 24}
    - Server sends: {"type": "stop"}
    """
    logger.info(f"Shell agent WebSocket connecting for session {session_id}")
    
    if api_key != API_KEY:
        logger.warning(f"Shell agent WebSocket rejected: invalid API key for session {session_id}")
        await websocket.close(code=4001, reason="Invalid API key")
        return
    
    await websocket.accept()
    logger.info(f"Shell agent WebSocket accepted for session {session_id}")
    
    session = shell_session_manager.get_session(session_id)
    if not session:
        logger.warning(f"Shell agent tried to connect to non-existent session {session_id}")
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    
    if session.state != ShellSessionState.PENDING:
        logger.warning(f"Shell agent tried to connect to session {session_id} but state is {session.state}")
        await websocket.send_json({"type": "error", "message": f"Session not pending (is {session.state})"})
        await websocket.close()
        return
    
    session.agent_ws = websocket
    await shell_session_manager.activate_session(session_id)
    
    # Send config to agent
    await websocket.send_json({
        "type": "config",
        "shell_type": session.shell_type,
        "session_id": session_id
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "output":
                # Forward output to viewer
                if session.viewer_ws:
                    try:
                        await session.viewer_ws.send_json(data)
                    except:
                        pass
                        
            elif data.get("type") == "ready":
                logger.info(f"Shell agent ready for session {session_id}")
                if session.viewer_ws:
                    await session.viewer_ws.send_json({
                        "type": "info",
                        "state": "active",
                        "message": "Shell started"
                    })
                    
            elif data.get("type") == "exit":
                logger.info(f"Shell exited for session {session_id} with code {data.get('code')}")
                if session.viewer_ws:
                    await session.viewer_ws.send_json({
                        "type": "exit",
                        "code": data.get("code", 0)
                    })
                break
                    
    except WebSocketDisconnect:
        logger.info(f"Shell agent disconnected from session {session_id}")
    except Exception as e:
        logger.error(f"Shell agent WebSocket error: {e}")
    finally:
        session.agent_ws = None
        await shell_session_manager.close_session(session_id, "agent_disconnected")
        
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
    # Validate auth (use centralized API_KEY from dependencies)
    if api_key != API_KEY and not token:
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
                                    "node_id": str(row['node_id']),
                                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                                    "completed_at": row['completed_at'].isoformat() if row['completed_at'] else None,
                                    "error_message": row['error_message']
                                }
                            }
                            yield f"data: {json.dumps(job_data, default=str)}\n\n"
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

@app.get("/api/v1/service-classes", dependencies=[Depends(verify_api_key)])
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


@app.post("/api/v1/service-classes", dependencies=[Depends(verify_api_key)])
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


@app.get("/api/v1/service-classes/{class_id}", dependencies=[Depends(verify_api_key)])
async def get_service_class(class_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a service class by ID"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM service_classes WHERE id = $1
        """, class_id)
        if not row:
            raise not_found("Service class", class_id)
        return dict(row)


@app.put("/api/v1/service-classes/{class_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Service class", class_id)
        return dict(row)


@app.delete("/api/v1/service-classes/{class_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Service class", class_id)
        return {"status": "deleted", "id": class_id}


# --- Services ---

@app.get("/api/v1/services", dependencies=[Depends(verify_api_key)])
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


@app.post("/api/v1/services", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Service class", class_id)
        
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


@app.get("/api/v1/services/{service_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Service", service_id)
        
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


@app.put("/api/v1/services/{service_id}", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Service", service_id)
        return dict(row)


@app.delete("/api/v1/services/{service_id}", dependencies=[Depends(verify_api_key)])
async def delete_service(service_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a service and all its assignments"""
    async with db.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM services WHERE id = $1", service_id
        )
        if result == "DELETE 0":
            raise not_found("Service", service_id)
        return {"status": "deleted", "id": service_id}


# --- Service Node Assignments ---

@app.post("/api/v1/services/{service_id}/nodes", dependencies=[Depends(verify_api_key)])
async def assign_node_to_service(
    service_id: str, 
    data: Dict[str, Any], 
    db: asyncpg.Pool = Depends(get_db)
):
    """Assign a node to a service with a role"""
    node_id = data.get("nodeId")
    role = data.get("role", "primary")
    
    if not node_id:
        raise bad_request("nodeId is required", "nodeId")
    
    async with db.acquire() as conn:
        # Verify service and node exist
        service = await conn.fetchrow("SELECT * FROM services WHERE id = $1", service_id)
        if not service:
            raise not_found("Service", service_id)
        
        node = await conn.fetchrow("SELECT * FROM nodes WHERE id = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
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


@app.delete("/api/v1/services/{service_id}/nodes/{node_id}", dependencies=[Depends(verify_api_key)])
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

@app.get("/api/v1/services/{service_id}/logs", dependencies=[Depends(verify_api_key)])
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

@app.post("/api/v1/services/{service_id}/reconcile", dependencies=[Depends(verify_api_key)])
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
            raise not_found("Service", service_id)
        
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


@app.get("/api/v1/nodes/{node_id}/service-assignments", dependencies=[Depends(verify_api_key)])
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


@app.post("/api/v1/services/{service_id}/nodes/{node_id}/status", dependencies=[Depends(verify_api_key)])
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


# =============================================================================
# Auto-Update Endpoint
# =============================================================================

@app.get("/api/v1/agent/version")
async def get_agent_version():
    """
    Returns the latest agent version from GitHub Releases.
    Agents poll this to check for updates.
    """
    import aiohttp
    
    cache_key = "agent_version"
    cache_ttl = 300  # 5 minutes cache
    
    # Check cache
    if cache_key in _cache:
        cached, timestamp = _cache[cache_key]
        if time.time() - timestamp < cache_ttl:
            return cached
    
    try:
        async with aiohttp.ClientSession() as session:
            url = "https://api.github.com/repos/BenediktSchackenberg/octofleet/releases/latest"
            headers = {"Accept": "application/vnd.github.v3+json"}
            
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="Failed to fetch release info")
                
                data = await resp.json()
                
                version = data["tag_name"].lstrip("v")
                
                # Find ZIP asset
                zip_asset = next((a for a in data["assets"] if a["name"].endswith(".zip")), None)
                sha_asset = next((a for a in data["assets"] if a["name"].endswith(".sha256")), None)
                
                if not zip_asset:
                    raise HTTPException(status_code=502, detail="No ZIP asset found")
                
                # Get SHA256 if available
                sha256 = None
                if sha_asset:
                    async with session.get(sha_asset["browser_download_url"]) as sha_resp:
                        if sha_resp.status == 200:
                            sha256 = (await sha_resp.text()).strip()
                
                # Keep backward-compatible keys used by existing tests/clients.
                result = {
                    "latest": version,
                    "version": version,
                    "latestVersion": version,
                    "downloadUrl": zip_asset["browser_download_url"],
                    "sha256": sha256,
                    "releaseDate": data["published_at"],
                    "releaseNotes": data.get("body", "")[:500]
                }
                
                # Cache result
                _cache[cache_key] = (result, time.time())
                
                return result
                
    except aiohttp.ClientError as e:
        logger.error(f"Failed to fetch GitHub release: {e}")
        raise HTTPException(status_code=502, detail="Failed to connect to GitHub")

# Simple cache dict
_cache: Dict[str, tuple] = {}


# =============================================================================
# Software Repository Endpoints (Epic #57)
# =============================================================================
import aiofiles
import hashlib

REPO_BASE_PATH = os.environ.get("OCTOFLEET_REPO_PATH", os.path.expanduser("~/.openclaw/repo"))
MAX_REPO_FILE_SIZE = int(os.environ.get("OCTOFLEET_MAX_FILE_SIZE", 5 * 1024 * 1024 * 1024))  # 5GB


def get_repo_storage_path(file_type: str, filename: str) -> str:
    """Get the full storage path for a file based on its type."""
    type_dirs = {'msi': 'msi', 'exe': 'exe', 'sql-cu': 'sql-cu', 'script': 'scripts', 'ps1': 'scripts', 'other': 'other'}
    subdir = type_dirs.get(file_type, 'other')
    return os.path.join(REPO_BASE_PATH, subdir, filename)


def detect_repo_file_type(filename: str) -> str:
    """Detect file type from extension."""
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    return {'msi': 'msi', 'exe': 'exe', 'zip': 'zip', 'ps1': 'ps1', 'cab': 'cab'}.get(ext, 'other')


async def compute_file_sha256(filepath: str) -> str:
    """Compute SHA256 hash of a file."""
    sha256_hash = hashlib.sha256()
    async with aiofiles.open(filepath, 'rb') as f:
        while chunk := await f.read(8192):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()


@app.post("/api/v1/repo/upload", dependencies=[Depends(verify_api_key)])
async def repo_upload_file(
    request: Request,
    db: asyncpg.Pool = Depends(get_db)
):
    """Upload a file to the repository. Use multipart/form-data with 'file' field."""
    from fastapi import UploadFile
    
    form = await request.form()
    file = form.get("file")
    if not file or not hasattr(file, 'filename'):
        raise HTTPException(400, "No file uploaded. Use multipart/form-data with 'file' field.")
    
    display_name = form.get("display_name", file.filename)
    version = form.get("version")
    category = form.get("category")
    file_type = form.get("file_type") or detect_repo_file_type(file.filename)
    
    file_id = str(uuid.uuid4())
    safe_filename = f"{file_id}_{file.filename}"
    storage_path = get_repo_storage_path(file_type, safe_filename)
    os.makedirs(os.path.dirname(storage_path), exist_ok=True)
    
    file_size = 0
    try:
        async with aiofiles.open(storage_path, 'wb') as out_file:
            while chunk := await file.read(1024 * 1024):
                file_size += len(chunk)
                if file_size > MAX_REPO_FILE_SIZE:
                    raise HTTPException(413, "File too large")
                await out_file.write(chunk)
    except Exception as e:
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(500, f"Upload failed: {str(e)}")
    
    sha256_hash = await compute_file_sha256(storage_path)
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO repo_files (id, filename, display_name, version, file_type, category, sha256_hash, file_size, storage_path, created_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, 'api')
        """, file_id, file.filename, display_name, version, file_type, category, sha256_hash, file_size, storage_path)
    
    return {"id": file_id, "filename": file.filename, "sha256": sha256_hash, "size": file_size, "downloadUrl": f"/api/v1/repo/download/{file_id}"}


@app.get("/api/v1/repo/files", dependencies=[Depends(verify_api_key)])
async def repo_list_files(
    category: Optional[str] = None,
    file_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    db: asyncpg.Pool = Depends(get_db)
):
    """List files in the repository."""
    async with db.acquire() as conn:
        query = "SELECT id, filename, display_name, version, file_type, category, sha256_hash, file_size, source_url, download_count, created_at FROM repo_files WHERE 1=1"
        params = []
        idx = 1
        if category:
            query += f" AND category = ${idx}"; params.append(category); idx += 1
        if file_type:
            query += f" AND file_type = ${idx}"; params.append(file_type); idx += 1
        if search:
            query += f" AND (filename ILIKE ${idx} OR display_name ILIKE ${idx})"; params.append(f"%{search}%"); idx += 1
        query += f" ORDER BY created_at DESC LIMIT ${idx}"; params.append(limit)
        
        rows = await conn.fetch(query, *params)
    
    return {"files": [{"id": str(r["id"]), "filename": r["filename"], "displayName": r["display_name"], "version": r["version"], "type": r["file_type"], "category": r["category"], "sha256": r["sha256_hash"], "size": r["file_size"], "downloads": r["download_count"], "downloadUrl": f"/api/v1/repo/download/{r['id']}"} for r in rows]}


@app.get("/api/v1/repo/files/{file_id}", dependencies=[Depends(verify_api_key)])
async def repo_get_file(file_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get file metadata."""
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM repo_files WHERE id = $1::uuid", file_id)
    if not row:
        raise HTTPException(404, "File not found")
    return {"id": str(row["id"]), "filename": row["filename"], "displayName": row["display_name"], "version": row["version"], "type": row["file_type"], "category": row["category"], "sha256": row["sha256_hash"], "size": row["file_size"], "storagePath": row["storage_path"], "sourceUrl": row["source_url"], "downloads": row["download_count"], "downloadUrl": f"/api/v1/repo/download/{row['id']}"}


@app.get("/api/v1/repo/download/{file_id}")
async def repo_download_file(file_id: str, node_id: Optional[str] = None, db: asyncpg.Pool = Depends(get_db)):
    """Download a file. No auth required for agents."""
    from fastapi.responses import FileResponse
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT filename, storage_path, file_size FROM repo_files WHERE id = $1::uuid", file_id)
        if not row:
            raise HTTPException(404, "File not found")
        if not os.path.exists(row["storage_path"]):
            raise HTTPException(404, "File not found on disk")
        await conn.execute("UPDATE repo_files SET download_count = download_count + 1 WHERE id = $1::uuid", file_id)
        if node_id:
            await conn.execute("INSERT INTO repo_downloads (file_id, node_id, bytes_transferred, success) VALUES ($1::uuid, $2, $3, true)", file_id, node_id, row["file_size"])
    return FileResponse(path=row["storage_path"], filename=row["filename"], media_type="application/octet-stream")


@app.delete("/api/v1/repo/files/{file_id}", dependencies=[Depends(verify_api_key)])
async def repo_delete_file(file_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a file from the repository."""
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT storage_path FROM repo_files WHERE id = $1::uuid", file_id)
        if not row:
            raise HTTPException(404, "File not found")
        if row["storage_path"] and os.path.exists(row["storage_path"]):
            os.remove(row["storage_path"])
        await conn.execute("DELETE FROM repo_files WHERE id = $1::uuid", file_id)
    return {"status": "deleted", "id": file_id}


@app.post("/api/v1/repo/cache", dependencies=[Depends(verify_api_key)])
async def repo_cache_remote_file(
    data: Dict[str, Any] = Body(...),
    db: asyncpg.Pool = Depends(get_db)
):
    """Cache a remote file locally. Body: {url, display_name?, version?, category?, file_type?, expected_hash?}"""
    import aiohttp
    
    url = data.get("url")
    if not url:
        raise HTTPException(400, "url required")
    
    filename = url.rsplit('/', 1)[-1].split('?')[0] or f"cached_{uuid.uuid4().hex[:8]}"
    file_type = data.get("file_type") or detect_repo_file_type(filename)
    file_id = str(uuid.uuid4())
    storage_path = get_repo_storage_path(file_type, f"{file_id}_{filename}")
    os.makedirs(os.path.dirname(storage_path), exist_ok=True)
    
    file_size = 0
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise HTTPException(400, f"Download failed: HTTP {response.status}")
                async with aiofiles.open(storage_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(1024 * 1024):
                        file_size += len(chunk)
                        if file_size > MAX_REPO_FILE_SIZE:
                            raise HTTPException(413, "File too large")
                        await f.write(chunk)
    except aiohttp.ClientError as e:
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(400, f"Download failed: {str(e)}")
    
    sha256_hash = await compute_file_sha256(storage_path)
    if data.get("expected_hash") and sha256_hash.lower() != data["expected_hash"].lower():
        os.remove(storage_path)
        raise HTTPException(400, f"Hash mismatch! Expected: {data['expected_hash']}, Got: {sha256_hash}")
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO repo_files (id, filename, display_name, version, file_type, category, sha256_hash, file_size, storage_path, source_url, is_cached, cached_at, created_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), 'cache')
        """, file_id, filename, data.get("display_name", filename), data.get("version"), file_type, data.get("category"), sha256_hash, file_size, storage_path, url)
    
    return {"id": file_id, "filename": filename, "sha256": sha256_hash, "size": file_size, "cached": True, "downloadUrl": f"/api/v1/repo/download/{file_id}"}


@app.get("/api/v1/repo/stats", dependencies=[Depends(verify_api_key)])
async def repo_get_stats(db: asyncpg.Pool = Depends(get_db)):
    """Get repository statistics."""
    async with db.acquire() as conn:
        stats = await conn.fetchrow("SELECT COUNT(*) as total_files, COALESCE(SUM(file_size), 0) as total_size, COALESCE(SUM(download_count), 0) as total_downloads FROM repo_files")
        by_type = await conn.fetch("SELECT file_type, COUNT(*) as count, COALESCE(SUM(file_size), 0) as size FROM repo_files GROUP BY file_type")
    
    total_gb = stats["total_size"] / 1024 / 1024 / 1024
    return {
        "totalFiles": stats["total_files"],
        "totalSize": stats["total_size"],
        "totalSizeFormatted": f"{total_gb:.2f} GB" if total_gb >= 1 else f"{stats['total_size'] / 1024 / 1024:.2f} MB",
        "totalDownloads": stats["total_downloads"],
        "byType": [{"type": r["file_type"], "count": r["count"], "size": r["size"]} for r in by_type]
    }


# =============================================================================
# Export Endpoints (Epic #19 - Reporting & Exports)
# =============================================================================
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from io import BytesIO

def style_excel_header(ws, row=1):
    """Apply header styling to first row."""
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )
    for cell in ws[row]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center')
        cell.border = thin_border

def auto_column_width(ws):
    """Auto-adjust column widths."""
    for col in ws.columns:
        max_length = 0
        column = col[0].column_letter
        for cell in col:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        adjusted_width = min(max_length + 2, 50)
        ws.column_dimensions[column].width = adjusted_width


@app.get("/api/v1/export/nodes/excel", dependencies=[Depends(verify_api_key)])
async def export_nodes_excel(db: asyncpg.Pool = Depends(get_db)):
    """Export all nodes to Excel."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.id, n.hostname, n.domain, n.os_name, n.os_version, n.agent_version,
                   n.last_seen, n.is_online,
                   h.cpu->>'Name' as cpu_name,
                   (h.cpu->>'Cores')::int as cpu_cores,
                   (h.ram->>'TotalGB')::numeric as ram_total_gb,
                   h.mainboard->>'Manufacturer' as manufacturer,
                   h.mainboard->>'Product' as model,
                   h.bios->>'SerialNumber' as serial_number
            FROM nodes n
            LEFT JOIN hardware_current h ON h.node_id = n.id
            ORDER BY n.hostname
        """)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Nodes"
    
    # Headers
    headers = ["ID", "Hostname", "Domain", "OS", "OS Version", "Agent Version", "Last Seen", 
               "Online", "CPU", "Cores", "RAM (GB)",
               "Manufacturer", "Model", "Serial Number"]
    ws.append(headers)
    style_excel_header(ws)
    
    # Data
    for row in rows:
        ws.append([
            str(row["id"]), row["hostname"], row["domain"], row["os_name"], row["os_version"],
            row["agent_version"], row["last_seen"].isoformat() if row["last_seen"] else None,
            "Yes" if row["is_online"] else "No",
            row["cpu_name"], row["cpu_cores"], 
            round(float(row["ram_total_gb"]), 1) if row["ram_total_gb"] else None,
            row["manufacturer"], row["model"], row["serial_number"]
        ])
    
    auto_column_width(ws)
    
    # Save to BytesIO
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_nodes_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/v1/export/software/excel", dependencies=[Depends(verify_api_key)])
async def export_software_excel(db: asyncpg.Pool = Depends(get_db)):
    """Export all installed software to Excel."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.hostname, s.name, s.version, s.publisher, s.install_date, s.install_path
            FROM software_current s
            JOIN nodes n ON n.id = s.node_id
            ORDER BY n.hostname, s.name
        """)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Software"
    
    headers = ["Hostname", "Software Name", "Version", "Publisher", "Install Date", "Install Location"]
    ws.append(headers)
    style_excel_header(ws)
    
    for row in rows:
        ws.append([row["hostname"], row["name"], row["version"], row["publisher"],
                   row["install_date"].isoformat() if row["install_date"] else None, 
                   row["install_path"]])
    
    auto_column_width(ws)
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_software_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/v1/export/vulnerabilities/excel", dependencies=[Depends(verify_api_key)])
async def export_vulnerabilities_excel(db: asyncpg.Pool = Depends(get_db)):
    """Export all vulnerabilities with affected nodes to Excel."""
    async with db.acquire() as conn:
        # Get vulnerabilities with affected node count
        rows = await conn.fetch("""
            SELECT v.cve_id, v.software_name, v.software_version,
                   v.severity, v.cvss_score, v.description, v.published_date,
                   (SELECT COUNT(DISTINCT s.node_id) 
                    FROM software_current s 
                    WHERE s.name ILIKE v.software_name 
                    AND s.version = v.software_version) as affected_nodes,
                   (SELECT STRING_AGG(DISTINCT n.hostname, ', ' ORDER BY n.hostname)
                    FROM software_current s 
                    JOIN nodes n ON n.id = s.node_id
                    WHERE s.name ILIKE v.software_name 
                    AND s.version = v.software_version
                    LIMIT 5) as node_list
            FROM vulnerabilities v
            ORDER BY v.cvss_score DESC NULLS LAST, v.software_name
        """)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Vulnerabilities"
    
    headers = ["CVE ID", "Software", "Version", "Severity", "CVSS Score",
               "Affected Nodes", "Nodes (first 5)", "Published", "Description"]
    ws.append(headers)
    style_excel_header(ws)
    
    # Color coding for severity
    severity_colors = {
        "CRITICAL": "FF0000",
        "HIGH": "FF6600", 
        "MEDIUM": "FFCC00",
        "LOW": "00CC00"
    }
    
    for i, row in enumerate(rows, start=2):
        ws.append([row["cve_id"], row["software_name"], row["software_version"],
                   row["severity"], float(row["cvss_score"]) if row["cvss_score"] else None,
                   row["affected_nodes"], row["node_list"],
                   row["published_date"].isoformat() if row["published_date"] else None,
                   row["description"][:200] if row["description"] else None])
        
        # Color the severity cell
        if row["severity"] in severity_colors:
            ws.cell(row=i, column=4).fill = PatternFill(
                start_color=severity_colors[row["severity"]], 
                end_color=severity_colors[row["severity"]], 
                fill_type="solid"
            )
    
    auto_column_width(ws)
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_vulnerabilities_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/v1/export/jobs/excel", dependencies=[Depends(verify_api_key)])
async def export_jobs_excel(
    days: int = 30,
    db: asyncpg.Pool = Depends(get_db)
):
    """Export job history to Excel."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT j.id, j.name, j.command_type, j.created_at, j.created_by,
                   ji.node_id as target_node, ji.status, ji.queued_at, ji.started_at, ji.completed_at,
                   ji.exit_code, ji.error_message, ji.duration_ms
            FROM jobs j
            LEFT JOIN job_instances ji ON ji.job_id = j.id
            WHERE j.created_at > NOW() - INTERVAL '1 day' * $1
            ORDER BY j.created_at DESC
        """, days)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Jobs"
    
    headers = ["Job ID", "Name", "Type", "Created By", "Target Node", "Status", 
               "Queued", "Started", "Completed", "Duration (ms)", "Exit Code", "Error"]
    ws.append(headers)
    style_excel_header(ws)
    
    status_colors = {
        "completed": "00CC00",
        "failed": "FF0000",
        "running": "0066FF",
        "pending": "CCCCCC"
    }
    
    for i, row in enumerate(rows, start=2):
        ws.append([
            str(row["id"])[:8], row["name"], row["command_type"], row["created_by"],
            row["target_node"], row["status"],
            row["queued_at"].isoformat() if row["queued_at"] else None,
            row["started_at"].isoformat() if row["started_at"] else None,
            row["completed_at"].isoformat() if row["completed_at"] else None,
            row["duration_ms"], row["exit_code"],
            row["error_message"][:100] if row["error_message"] else None
        ])
        
        if row["status"] in status_colors:
            ws.cell(row=i, column=6).fill = PatternFill(
                start_color=status_colors[row["status"]], 
                end_color=status_colors[row["status"]], 
                fill_type="solid"
            )
    
    auto_column_width(ws)
    
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"octofleet_jobs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# =============================================================================
# E19: PDF Report Generation
# =============================================================================

def create_pdf_styles():
    """Create custom styles for PDF reports"""
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='ReportTitle',
        parent=styles['Heading1'],
        fontSize=24,
        spaceAfter=30,
        textColor=colors.HexColor('#1a1a2e')
    ))
    styles.add(ParagraphStyle(
        name='SectionTitle',
        parent=styles['Heading2'],
        fontSize=16,
        spaceAfter=12,
        spaceBefore=20,
        textColor=colors.HexColor('#16213e')
    ))
    styles.add(ParagraphStyle(
        name='SubSection',
        parent=styles['Heading3'],
        fontSize=12,
        spaceAfter=8,
        textColor=colors.HexColor('#0f3460')
    ))
    return styles


def create_header_footer(canvas, doc, title: str):
    """Add header and footer to PDF pages"""
    canvas.saveState()
    
    # Header
    canvas.setFont('Helvetica-Bold', 10)
    canvas.setFillColor(colors.HexColor('#1a1a2e'))
    canvas.drawString(50, A4[1] - 30, f"Octofleet - {title}")
    canvas.drawRightString(A4[0] - 50, A4[1] - 30, datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'))
    
    # Footer
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.grey)
    canvas.drawString(50, 30, "Generated by Octofleet Endpoint Management Platform")
    canvas.drawRightString(A4[0] - 50, 30, f"Page {doc.page}")
    
    canvas.restoreState()


def create_status_table(data: List[List], col_widths: List[float] = None) -> Table:
    """Create a styled table for reports"""
    table = Table(data, colWidths=col_widths)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cccccc')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
    ]))
    return table


@app.get("/api/v1/reports/fleet/pdf", dependencies=[Depends(verify_api_key)])
async def generate_fleet_summary_pdf(db: asyncpg.Pool = Depends(get_db)):
    """E19-05: Generate Fleet Summary PDF Report"""
    
    # Fetch data - join nodes with v_nodes_overview for all columns
    nodes = await db.fetch("""
        SELECT n.hostname, n.os_name, n.agent_version, n.is_online, n.last_seen,
               v.cpu_name, v.ram_gb
        FROM nodes n
        LEFT JOIN v_nodes_overview v ON n.id = v.id
        ORDER BY n.hostname
    """)
    
    # Online/Offline stats (no health_status in schema, use online status)
    online_stats = await db.fetch("""
        SELECT is_online, COUNT(*) as count
        FROM nodes GROUP BY is_online
    """)
    
    # Performance summary (last 24h averages) from node_metrics
    perf_stats = await db.fetchrow("""
        SELECT 
            ROUND(AVG(cpu_percent)::numeric, 1) as avg_cpu,
            ROUND(AVG(ram_percent)::numeric, 1) as avg_memory,
            ROUND(AVG(disk_percent)::numeric, 1) as avg_disk
        FROM node_metrics
        WHERE time > NOW() - INTERVAL '24 hours'
    """)
    
    # Create PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, 
                           rightMargin=50, leftMargin=50,
                           topMargin=60, bottomMargin=50)
    
    styles = create_pdf_styles()
    story = []
    
    # Title
    story.append(Paragraph("Fleet Summary Report", styles['ReportTitle']))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles['Normal']))
    story.append(Spacer(1, 20))
    
    # Overview Section
    story.append(Paragraph("Fleet Overview", styles['SectionTitle']))
    
    total_nodes = len(nodes)
    online_nodes = sum(1 for n in nodes if n['is_online'])
    
    overview_data = [
        ["Metric", "Value"],
        ["Total Nodes", str(total_nodes)],
        ["Online Nodes", f"{online_nodes} ({round(online_nodes/total_nodes*100) if total_nodes else 0}%)"],
        ["Offline Nodes", f"{total_nodes - online_nodes}"],
        ["Agent Versions", ", ".join(set(n['agent_version'] for n in nodes if n['agent_version'])) or "-"],
    ]
    story.append(create_status_table(overview_data, [150, 300]))
    story.append(Spacer(1, 20))
    
    # Performance Section
    story.append(Paragraph("Performance Summary (24h Average)", styles['SectionTitle']))
    
    perf_data = [
        ["Metric", "Average"],
        ["CPU Usage", f"{perf_stats['avg_cpu'] or 0}%"],
        ["Memory Usage", f"{perf_stats['avg_memory'] or 0}%"],
        ["Disk Usage", f"{perf_stats['avg_disk'] or 0}%"],
    ]
    story.append(create_status_table(perf_data, [150, 150]))
    story.append(Spacer(1, 20))
    
    # Online Status Distribution
    story.append(Paragraph("Status Distribution", styles['SectionTitle']))
    
    status_data = [["Status", "Count"]]
    for s in online_stats:
        status_label = "Online" if s['is_online'] else "Offline"
        status_data.append([status_label, str(s['count'])])
    story.append(create_status_table(status_data, [150, 100]))
    story.append(Spacer(1, 20))
    
    # Node List
    story.append(Paragraph("Node Inventory", styles['SectionTitle']))
    
    node_data = [["Hostname", "OS", "Version", "Status", "CPU"]]
    for n in nodes:
        os_short = (n['os_name'] or '-')[:30]
        cpu_short = (n['cpu_name'] or '-')[:25] if n.get('cpu_name') else '-'
        node_data.append([
            n['hostname'],
            os_short,
            n['agent_version'] or '-',
            "Online" if n['is_online'] else "Offline",
            cpu_short
        ])
    story.append(create_status_table(node_data, [90, 140, 50, 55, 100]))
    
    # Build PDF
    doc.build(story, onFirstPage=lambda c, d: create_header_footer(c, d, "Fleet Summary"),
              onLaterPages=lambda c, d: create_header_footer(c, d, "Fleet Summary"))
    
    buffer.seek(0)
    filename = f"octofleet_fleet_summary_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/v1/reports/security/pdf", dependencies=[Depends(verify_api_key)])
async def generate_security_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """E19-06: Generate Security Report PDF (CVEs, Compliance)"""
    
    # Fetch vulnerability data
    vulns = await db.fetch("""
        SELECT v.cve_id, v.severity, v.cvss_score, v.description,
               v.software_name, v.software_version,
               (SELECT COUNT(DISTINCT s.node_id) FROM software_current s 
                WHERE s.name = v.software_name AND s.version = v.software_version) as affected_nodes
        FROM vulnerabilities v
        ORDER BY v.cvss_score DESC NULLS LAST
        LIMIT 50
    """)
    
    # Severity distribution
    severity_stats = await db.fetch("""
        SELECT severity, COUNT(*) as count
        FROM vulnerabilities
        GROUP BY severity
        ORDER BY CASE severity 
            WHEN 'critical' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            WHEN 'low' THEN 4 
            ELSE 5 END
    """)
    
    # Nodes with vulnerabilities (via software match)
    node_vulns = await db.fetch("""
        SELECT n.hostname,
               COUNT(DISTINCT v.id) as vuln_count,
               SUM(CASE WHEN v.severity = 'critical' THEN 1 ELSE 0 END) as critical_count
        FROM nodes n
        JOIN software_current s ON s.node_id = n.id
        JOIN vulnerabilities v ON v.software_name = s.name AND v.software_version = s.version
        GROUP BY n.id, n.hostname
        HAVING COUNT(DISTINCT v.id) > 0
        ORDER BY critical_count DESC, vuln_count DESC
        LIMIT 20
    """)
    
    # Create PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                           rightMargin=50, leftMargin=50,
                           topMargin=60, bottomMargin=50)
    
    styles = create_pdf_styles()
    story = []
    
    # Title
    story.append(Paragraph("Security Report", styles['ReportTitle']))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles['Normal']))
    story.append(Spacer(1, 20))
    
    # Summary
    story.append(Paragraph("Vulnerability Summary", styles['SectionTitle']))
    
    total_vulns = sum(s['count'] for s in severity_stats)
    critical = next((s['count'] for s in severity_stats if s['severity'] == 'critical'), 0)
    high = next((s['count'] for s in severity_stats if s['severity'] == 'high'), 0)
    
    summary_data = [
        ["Metric", "Value"],
        ["Total Vulnerabilities", str(total_vulns)],
        ["Critical", str(critical)],
        ["High", str(high)],
        ["Affected Nodes", str(len(node_vulns))],
    ]
    story.append(create_status_table(summary_data, [150, 150]))
    story.append(Spacer(1, 20))
    
    # Severity Distribution
    story.append(Paragraph("Severity Distribution", styles['SectionTitle']))
    sev_data = [["Severity", "Count", "Percentage"]]
    for s in severity_stats:
        pct = round(s['count'] / total_vulns * 100, 1) if total_vulns else 0
        sev_data.append([s['severity'].title(), str(s['count']), f"{pct}%"])
    story.append(create_status_table(sev_data, [100, 80, 80]))
    story.append(Spacer(1, 20))
    
    # Most Affected Nodes
    story.append(Paragraph("Most Affected Nodes", styles['SectionTitle']))
    node_data = [["Hostname", "Total CVEs", "Critical"]]
    for n in node_vulns[:10]:
        node_data.append([n['hostname'], str(n['vuln_count']), str(n['critical_count'])])
    story.append(create_status_table(node_data, [150, 80, 80]))
    story.append(Spacer(1, 20))
    
    # Top Vulnerabilities
    story.append(Paragraph("Top Vulnerabilities by CVSS Score", styles['SectionTitle']))
    vuln_data = [["CVE ID", "Severity", "CVSS", "Affected"]]
    for v in vulns[:15]:
        vuln_data.append([
            v['cve_id'],
            (v['severity'] or '-').title(),
            str(v['cvss_score'] or '-'),
            str(v['affected_nodes'])
        ])
    story.append(create_status_table(vuln_data, [120, 80, 60, 60]))
    
    # Build PDF
    doc.build(story, onFirstPage=lambda c, d: create_header_footer(c, d, "Security Report"),
              onLaterPages=lambda c, d: create_header_footer(c, d, "Security Report"))
    
    buffer.seek(0)
    filename = f"octofleet_security_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/v1/reports/inventory/pdf", dependencies=[Depends(verify_api_key)])
async def generate_inventory_report_pdf(
    node_id: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_db)
):
    """E19-07: Generate Inventory Report PDF (Hardware, Software)"""
    
    # Determine scope - join nodes with v_nodes_overview for cpu_name
    if node_id:
        nodes = await db.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.agent_version, n.is_online, 
                   v.cpu_name, v.ram_gb 
            FROM nodes n
            LEFT JOIN v_nodes_overview v ON n.id = v.id
            WHERE n.id::text = $1 OR n.node_id = $1
        """, node_id)
        title_suffix = f" - {nodes[0]['hostname']}" if nodes else ""
    else:
        nodes = await db.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.agent_version, n.is_online, 
                   v.cpu_name, v.ram_gb 
            FROM nodes n
            LEFT JOIN v_nodes_overview v ON n.id = v.id
            ORDER BY n.hostname
        """)
        title_suffix = " - All Nodes"
    
    # Software inventory
    if node_id:
        software = await db.fetch("""
            SELECT name, version, publisher, install_date,
                   COUNT(*) as install_count
            FROM software_current
            WHERE node_id = (SELECT id FROM nodes WHERE id::text = $1 OR node_id = $1 LIMIT 1)
            GROUP BY name, version, publisher, install_date
            ORDER BY name
            LIMIT 100
        """, node_id)
    else:
        software = await db.fetch("""
            SELECT name, version, publisher,
                   COUNT(DISTINCT node_id) as install_count
            FROM software_current
            GROUP BY name, version, publisher
            ORDER BY install_count DESC, name
            LIMIT 100
        """)
    
    # Hardware summary - use v_nodes_overview
    hw_summary = await db.fetch("""
        SELECT 
            cpu_name,
            COUNT(*) as count
        FROM v_nodes_overview
        WHERE cpu_name IS NOT NULL
        GROUP BY cpu_name
        ORDER BY count DESC
        LIMIT 10
    """)
    
    # Create PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                           rightMargin=50, leftMargin=50,
                           topMargin=60, bottomMargin=50)
    
    styles = create_pdf_styles()
    story = []
    
    # Title
    story.append(Paragraph(f"Inventory Report{title_suffix}", styles['ReportTitle']))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles['Normal']))
    story.append(Spacer(1, 20))
    
    # Node Hardware
    story.append(Paragraph("Hardware Inventory", styles['SectionTitle']))
    
    node_data = [["Hostname", "OS", "CPU", "Agent"]]
    for n in nodes:
        os_short = (n['os_name'] or '-')[:25]
        cpu_short = (n['cpu_name'] or '-')[:30]
        node_data.append([
            n['hostname'],
            os_short,
            cpu_short,
            n['agent_version'] or '-'
        ])
    story.append(create_status_table(node_data, [90, 130, 180, 50]))
    story.append(Spacer(1, 20))
    
    # CPU Distribution
    if hw_summary:
        story.append(Paragraph("CPU Distribution", styles['SectionTitle']))
        cpu_data = [["CPU Model", "Count"]]
        for hw in hw_summary:
            cpu_short = (hw['cpu_name'] or '-')[:50]
            cpu_data.append([cpu_short, str(hw['count'])])
        story.append(create_status_table(cpu_data, [350, 60]))
        story.append(Spacer(1, 20))
    
    # Software Inventory
    story.append(Paragraph("Software Inventory", styles['SectionTitle']))
    
    sw_data = [["Software", "Version", "Publisher", "Installs"]]
    for s in software[:50]:
        sw_data.append([
            (s['name'] or '-')[:35],
            (s['version'] or '-')[:15],
            (s['publisher'] or '-')[:20],
            str(s['install_count'])
        ])
    story.append(create_status_table(sw_data, [180, 80, 120, 50]))
    
    # Build PDF
    doc.build(story, onFirstPage=lambda c, d: create_header_footer(c, d, "Inventory Report"),
              onLaterPages=lambda c, d: create_header_footer(c, d, "Inventory Report"))
    
    buffer.seek(0)
    filename = f"octofleet_inventory_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# =============================================================================
# E22: Provisioning API - Zero-Touch OS Deployment
# =============================================================================

from provisioning import generate_autounattend, generate_ipxe_script

# Provisioning Config
PROVISIONING_ANSWERS_PATH = os.getenv("PROVISIONING_ANSWERS_PATH", "/home/benedikt/.openclaw/workspace/octofleet-work/provisioning/answers")
PXE_SERVER_URL = os.getenv("PXE_SERVER_URL", "http://192.168.0.5:9080")


class ProvisioningTaskCreate(BaseModel):
    """Create a new provisioning task"""
    hostname: str = Field(..., min_length=1, max_length=63, pattern=r'^[a-zA-Z0-9\-]+$')
    mac_address: str = Field(..., pattern=r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$')
    
    # Network
    use_dhcp: bool = True
    ip_address: Optional[str] = None
    subnet_mask: str = "255.255.255.0"
    gateway: Optional[str] = None
    dns_servers: Optional[List[str]] = None
    
    # Credentials
    admin_password: str = Field(..., min_length=8)
    
    # Domain Join
    join_domain: bool = False
    domain_name: Optional[str] = None
    domain_ou: Optional[str] = None
    domain_user: Optional[str] = None
    domain_password: Optional[str] = None
    
    # Options
    windows_edition: str = "Windows Server 2025 SERVERDATACENTER"
    language: str = "en-US"
    timezone: str = "W. Europe Standard Time"
    
    # Post-Install
    install_octofleet_agent: bool = True
    enable_rdp: bool = True
    disable_firewall: bool = False


class ProvisioningTaskResponse(BaseModel):
    """Response for created provisioning task"""
    id: int
    hostname: str
    mac_address: str
    status: str
    ipxe_url: str
    autounattend_url: str
    created_at: datetime


@app.post("/api/v1/provisioning/tasks", response_model=ProvisioningTaskResponse, tags=["Provisioning"])
async def create_provisioning_task(
    task: ProvisioningTaskCreate,
    db: asyncpg.Connection = Depends(get_db),
    api_key: str = Depends(verify_api_key)
):
    """
    Create a new provisioning task for zero-touch Windows deployment.
    
    This generates:
    - MAC-specific iPXE boot script
    - Autounattend.xml with all configuration
    
    The target machine will automatically install Windows on next PXE boot.
    """
    # Normalize MAC address
    mac_normalized = task.mac_address.lower().replace("-", ":")
    mac_hyp = mac_normalized.replace(":", "-")
    
    # Check for existing task with same MAC
    existing = await db.fetchrow(
        "SELECT id FROM provisioning_tasks WHERE mac_address = $1 AND status NOT IN ('completed', 'failed', 'cancelled')",
        mac_normalized
    )
    if existing:
        raise conflict(f"Active provisioning task already exists for MAC {mac_normalized}")
    
    # Generate Autounattend.xml
    autounattend_xml = generate_autounattend(
        hostname=task.hostname,
        admin_password=task.admin_password,
        use_dhcp=task.use_dhcp,
        ip_address=task.ip_address,
        subnet_mask=task.subnet_mask,
        gateway=task.gateway,
        dns_servers=task.dns_servers,
        join_domain=task.join_domain,
        domain_name=task.domain_name,
        domain_ou=task.domain_ou,
        domain_user=task.domain_user,
        domain_password=task.domain_password,
        windows_edition=task.windows_edition,
        language=task.language,
        timezone=task.timezone,
        install_octofleet_agent=task.install_octofleet_agent,
        enable_rdp=task.enable_rdp,
        disable_firewall=task.disable_firewall,
        pxe_server=PXE_SERVER_URL,
    )
    
    # Generate iPXE boot script
    ipxe_script = generate_ipxe_script(
        mac_address=mac_normalized,
        hostname=task.hostname,
        pxe_server=PXE_SERVER_URL,
    )
    
    # Ensure answers directory exists
    os.makedirs(PROVISIONING_ANSWERS_PATH, exist_ok=True)
    
    # Write files
    xml_path = os.path.join(PROVISIONING_ANSWERS_PATH, f"{mac_hyp}.xml")
    ipxe_path = os.path.join(PROVISIONING_ANSWERS_PATH, f"{mac_hyp}.ipxe")
    
    with open(xml_path, "w") as f:
        f.write(autounattend_xml)
    
    with open(ipxe_path, "w") as f:
        f.write(ipxe_script)
    
    # Insert into database
    row = await db.fetchrow("""
        INSERT INTO provisioning_tasks (
            hostname, mac_address, status, config,
            created_at, updated_at
        ) VALUES (
            $1, $2, 'pending', $3::jsonb,
            now(), now()
        )
        RETURNING id, hostname, mac_address, status, created_at
    """, task.hostname, mac_normalized, json.dumps({
        "use_dhcp": task.use_dhcp,
        "ip_address": task.ip_address,
        "join_domain": task.join_domain,
        "domain_name": task.domain_name,
        "install_agent": task.install_octofleet_agent,
        "enable_rdp": task.enable_rdp,
    }))
    
    return ProvisioningTaskResponse(
        id=row["id"],
        hostname=row["hostname"],
        mac_address=row["mac_address"],
        status=row["status"],
        ipxe_url=f"{PXE_SERVER_URL}/boot/{mac_hyp}.ipxe",
        autounattend_url=f"{PXE_SERVER_URL}/answers/{mac_hyp}.xml",
        created_at=row["created_at"],
    )


@app.get("/api/v1/provisioning/tasks", tags=["Provisioning"])
async def list_provisioning_tasks(
    status: Optional[str] = None,
    limit: int = 50,
    db: asyncpg.Connection = Depends(get_db),
    api_key: str = Depends(verify_api_key)
):
    """List all provisioning tasks"""
    query = "SELECT * FROM provisioning_tasks"
    params = []
    
    if status:
        query += " WHERE status = $1"
        params.append(status)
    
    query += " ORDER BY created_at DESC LIMIT $" + str(len(params) + 1)
    params.append(limit)
    
    rows = await db.fetch(query, *params)
    return [dict(r) for r in rows]


@app.get("/api/v1/provisioning/tasks/{task_id}", tags=["Provisioning"])
async def get_provisioning_task(
    task_id: int,
    db: asyncpg.Connection = Depends(get_db),
    api_key: str = Depends(verify_api_key)
):
    """Get provisioning task details"""
    row = await db.fetchrow("SELECT * FROM provisioning_tasks WHERE id = $1", task_id)
    if not row:
        raise not_found("Provisioning task not found")
    return dict(row)


@app.delete("/api/v1/provisioning/tasks/{task_id}", tags=["Provisioning"])
async def cancel_provisioning_task(
    task_id: int,
    db: asyncpg.Connection = Depends(get_db),
    api_key: str = Depends(verify_api_key)
):
    """Cancel a provisioning task and remove boot files"""
    row = await db.fetchrow("SELECT mac_address, status FROM provisioning_tasks WHERE id = $1", task_id)
    if not row:
        raise not_found("Provisioning task not found")
    
    if row["status"] in ("completed", "failed"):
        raise bad_request(f"Cannot cancel task in status '{row['status']}'")
    
    mac_hyp = row["mac_address"].replace(":", "-")
    
    # Remove boot files
    xml_path = os.path.join(PROVISIONING_ANSWERS_PATH, f"{mac_hyp}.xml")
    ipxe_path = os.path.join(PROVISIONING_ANSWERS_PATH, f"{mac_hyp}.ipxe")
    
    for path in [xml_path, ipxe_path]:
        if os.path.exists(path):
            os.remove(path)
    
    # Update status
    await db.execute(
        "UPDATE provisioning_tasks SET status = 'cancelled', updated_at = now() WHERE id = $1",
        task_id
    )
    
    return {"message": "Provisioning task cancelled", "id": task_id}


@app.get("/api/v1/provisioning/images", tags=["Provisioning"])
async def list_available_images(api_key: str = Depends(verify_api_key)):
    """List available OS images for provisioning"""
    images_path = os.getenv("PROVISIONING_IMAGES_PATH", "/home/benedikt/.openclaw/workspace/octofleet-work/provisioning/images")
    
    images = []
    
    # Check win2025
    win2025_wim = os.path.join(images_path, "win2025", "install.wim")
    if os.path.exists(win2025_wim):
        size = os.path.getsize(win2025_wim)
        images.append({
            "id": "win2025",
            "name": "Windows Server 2025",
            "editions": [
                "Windows Server 2025 SERVERSTANDARDCORE",
                "Windows Server 2025 SERVERSTANDARD",
                "Windows Server 2025 SERVERDATACENTERCORE",
                "Windows Server 2025 SERVERDATACENTER",
            ],
            "size_bytes": size,
            "size_human": f"{size / 1024 / 1024 / 1024:.1f} GB",
        })
    
    # Check winpe
    winpe_dir = os.path.join(images_path, "winpe")
    if os.path.isdir(winpe_dir):
        winpe_files = os.listdir(winpe_dir)
        required = {"wimboot", "BCD", "boot.sdi", "boot.wim"}
        if required.issubset(set(winpe_files)):
            images.append({
                "id": "winpe",
                "name": "WinPE Boot Environment",
                "status": "ready",
                "files": winpe_files,
            })
    
    return {"images": images}


@app.get("/api/v1/provisioning/windows-editions", tags=["Provisioning"])
async def list_windows_editions(api_key: str = Depends(verify_api_key)):
    """List available Windows editions"""
    return {
        "editions": [
            {"id": "Windows Server 2025 SERVERSTANDARDCORE", "name": "Windows Server 2025 Standard (Core)"},
            {"id": "Windows Server 2025 SERVERSTANDARD", "name": "Windows Server 2025 Standard (Desktop)"},
            {"id": "Windows Server 2025 SERVERDATACENTERCORE", "name": "Windows Server 2025 Datacenter (Core)"},
            {"id": "Windows Server 2025 SERVERDATACENTER", "name": "Windows Server 2025 Datacenter (Desktop)"},
        ]
    }


# ============================================
# PXE API - Dynamic iPXE Script Generation (#72)
# ============================================

@app.get("/api/v1/pxe/{mac}", tags=["PXE"])
async def get_pxe_script(mac: str, db: asyncpg.Pool = Depends(get_db)):
    """
    Generate iPXE script for a specific MAC address.
    Called by iPXE bootloader during PXE boot.
    """
    mac = mac.upper().replace("-", ":").replace(".", ":")
    
    # Find pending task for this MAC
    task = await db.fetchrow("""
        SELECT t.*, i.wim_path, i.wim_index, i.os_type, p.ipxe_template
        FROM provisioning_tasks t
        JOIN provisioning_images i ON t.image_id = i.id
        JOIN provisioning_templates p ON t.platform::text = p.platform::text
        WHERE t.mac_address = $1 AND t.status = 'pending'
    """, mac)
    
    pxe_server = os.environ.get("PXE_SERVER", "http://192.168.0.5:9080")
    api_server = os.environ.get("API_SERVER", "http://192.168.0.5:8080")
    
    if not task:
        # No task - return fallback/info screen
        from fastapi.responses import PlainTextResponse
        fallback_script = f"""#!ipxe
# Octofleet PXE - No provisioning task for this MAC
# MAC: {mac}

echo
echo ========================================
echo   Octofleet PXE Boot
echo ========================================
echo
echo MAC Address: {mac}
echo No provisioning task found.
echo
echo To provision this machine:
echo   1. Go to Octofleet Web UI
echo   2. Create a new provisioning task
echo   3. Enter this MAC address
echo   4. Reboot this machine
echo
echo Booting from local disk in 30 seconds...
sleep 30
exit
"""
        return PlainTextResponse(content=fallback_script)
    
    # Mark task as booting
    await db.execute("""
        UPDATE provisioning_tasks 
        SET status = 'booting', started_at = NOW(), status_message = 'iPXE script delivered'
        WHERE mac_address = $1
    """, mac)
    
    # Get template and substitute variables
    script = task["ipxe_template"]
    
    # Variable substitutions
    substitutions = {
        "${PXE_SERVER}": pxe_server,
        "${API_SERVER}": api_server,
        "${MAC}": mac.lower().replace(":", "-"),
        "${MAC_COLON}": mac,
        "${IMAGE_PATH}": task["wim_path"],
        "${IMAGE_INDEX}": str(task["wim_index"]),
        "${TASK_ID}": str(task["id"]),
        "${HOSTNAME}": task["hostname"] or "localhost",
        "${OS_TYPE}": task.get("os_type") or "windows",
    }
    
    for var, value in substitutions.items():
        script = script.replace(var, value)
    
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(content=script)


@app.get("/api/v1/pxe", tags=["PXE"])
async def get_default_pxe():
    """Default iPXE script - chainload to MAC-specific script"""
    pxe_server = os.environ.get("PXE_SERVER", "http://192.168.0.5:9080")
    api_server = os.environ.get("API_SERVER", "http://192.168.0.5:8080")
    
    from fastapi.responses import PlainTextResponse
    script = f"""#!ipxe
# Octofleet PXE Bootloader
# Chainloads to MAC-specific provisioning script

echo Octofleet PXE Boot
echo MAC: ${{net0/mac}}

# Fetch MAC-specific script from API
chain {api_server}/api/v1/pxe/${{net0/mac}} || goto fallback

:fallback
echo
echo Failed to fetch provisioning script.
echo Retrying in 10 seconds...
sleep 10
goto start
"""
    return PlainTextResponse(content=script)


# ============================================
# Status Callbacks API (#71)
# ============================================

class TaskEventCreate(BaseModel):
    """Status callback from provisioning client"""
    event: str = Field(..., description="Event type: booted, downloading, partitioning, applying, configuring, firstboot, done, failed")
    message: Optional[str] = None
    progress: Optional[int] = Field(None, ge=0, le=100)
    error: Optional[str] = None


@app.post("/api/v1/provisioning/tasks/{task_id}/events", tags=["Provisioning"])
async def create_task_event(task_id: str, event: TaskEventCreate, db: asyncpg.Pool = Depends(get_db)):
    """
    Receive status callback from provisioning client.
    Called by WinPE/installer scripts during deployment.
    """
    # Verify task exists
    task = await db.fetchrow("SELECT id, status FROM provisioning_tasks WHERE id = $1", task_id)
    if not task:
        raise not_found("Task not found")
    
    # Map event to task status
    event_to_status = {
        "booted": "booting",
        "downloading": "installing",
        "partitioning": "installing",
        "applying": "installing",
        "configuring": "installing",
        "firstboot": "installing",
        "done": "completed",
        "failed": "failed",
    }
    
    # Map event to default progress
    event_to_progress = {
        "booted": 5,
        "downloading": 15,
        "partitioning": 25,
        "applying": 50,
        "configuring": 85,
        "firstboot": 95,
        "done": 100,
        "failed": None,
    }
    
    new_status = event_to_status.get(event.event, str(task["status"]))
    progress = event.progress if event.progress is not None else event_to_progress.get(event.event)
    
    # Create event record
    event_id = str(uuid.uuid4())
    await db.execute("""
        INSERT INTO provisioning_task_events (id, task_id, event, message, progress)
        VALUES ($1, $2, $3, $4, $5)
    """, event_id, task_id, event.event, event.message or event.error, progress)
    
    # Update task status and progress
    update_parts = ["status = $2", "status_message = $3"]
    update_params = [task_id, new_status, event.message or event.error or event.event]
    
    if progress is not None:
        update_parts.append(f"progress_percent = ${len(update_params) + 1}")
        update_params.append(progress)
    
    if event.event in ("done", "failed"):
        update_parts.append("completed_at = NOW()")
    elif event.event == "booted" and str(task["status"]) == "pending":
        update_parts.append("started_at = NOW()")
    
    await db.execute(f"""
        UPDATE provisioning_tasks 
        SET {", ".join(update_parts)}, updated_at = NOW()
        WHERE id = $1
    """, *update_params)
    
    # Fetch created event
    row = await db.fetchrow("""
        SELECT id, task_id, event, message, progress, created_at
        FROM provisioning_task_events WHERE id = $1
    """, event_id)
    
    return {
        "id": str(row["id"]),
        "task_id": str(row["task_id"]),
        "event": row["event"],
        "message": row.get("message"),
        "progress": row.get("progress"),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


@app.get("/api/v1/provisioning/tasks/{task_id}/events", tags=["Provisioning"])
async def list_task_events(task_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get all events/callbacks for a task"""
    # Verify task exists
    task = await db.fetchrow("SELECT id FROM provisioning_tasks WHERE id = $1", task_id)
    if not task:
        raise not_found("Task not found")
    
    rows = await db.fetch("""
        SELECT id, task_id, event, message, progress, created_at
        FROM provisioning_task_events
        WHERE task_id = $1
        ORDER BY created_at ASC
    """, task_id)
    
    return [{
        "id": str(row["id"]),
        "task_id": str(row["task_id"]),
        "event": row["event"],
        "message": row.get("message"),
        "progress": row.get("progress"),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    } for row in rows]


# ============================================================================
# E20: PDF Report Generation
# ============================================================================

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend


def create_pie_chart(data: dict, title: str, filename: str) -> str:
    """Create a pie chart and save to temp file."""
    fig, ax = plt.subplots(figsize=(4, 4))
    
    # Filter out zero values
    filtered = {k: v for k, v in data.items() if v > 0}
    if not filtered:
        filtered = {"No Data": 1}
    
    colors_map = {
        "online": "#22c55e",
        "away": "#f59e0b", 
        "offline": "#ef4444",
        "critical": "#dc2626",
        "high": "#f97316",
        "medium": "#eab308",
        "low": "#22c55e",
        "success": "#22c55e",
        "failed": "#ef4444",
        "running": "#3b82f6",
        "pending": "#6b7280"
    }
    
    chart_colors = [colors_map.get(k.lower(), "#6b7280") for k in filtered.keys()]
    
    wedges, texts, autotexts = ax.pie(
        filtered.values(), 
        labels=filtered.keys(),
        autopct='%1.1f%%',
        colors=chart_colors,
        startangle=90
    )
    ax.set_title(title, fontsize=12, fontweight='bold')
    
    plt.tight_layout()
    filepath = f"/tmp/{filename}"
    plt.savefig(filepath, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    return filepath


def create_bar_chart(data: dict, title: str, filename: str, xlabel: str = "", ylabel: str = "") -> str:
    """Create a bar chart and save to temp file."""
    fig, ax = plt.subplots(figsize=(6, 3))
    
    bars = ax.bar(data.keys(), data.values(), color='#3b82f6')
    ax.set_title(title, fontsize=12, fontweight='bold')
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    
    # Add value labels on bars
    for bar, val in zip(bars, data.values()):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, 
                str(val), ha='center', va='bottom', fontsize=9)
    
    plt.tight_layout()
    filepath = f"/tmp/{filename}"
    plt.savefig(filepath, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    return filepath


@app.get("/api/v1/reports/fleet/pdf", dependencies=[Depends(verify_api_key)], tags=["Reports"])
async def generate_fleet_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """Generate a comprehensive Fleet Summary PDF report."""
    async with db.acquire() as conn:
        # Get node counts
        node_counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '5 minutes') as online,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '60 minutes' 
                                   AND last_seen <= NOW() - INTERVAL '5 minutes') as away,
                COUNT(*) FILTER (WHERE last_seen <= NOW() - INTERVAL '60 minutes' 
                                   OR last_seen IS NULL) as offline
            FROM nodes
        """)
        
        # Get OS distribution
        os_dist = await conn.fetch("""
            SELECT COALESCE(os_name, 'Unknown') as os_name, COUNT(*) as count
            FROM nodes
            GROUP BY os_name
            ORDER BY count DESC
            LIMIT 10
        """)
        
        # Get all nodes with details
        nodes = await conn.fetch("""
            SELECT n.hostname, n.os_name, n.os_version, n.agent_version,
                   n.last_seen, n.is_online,
                   h.cpu->>'Name' as cpu_name,
                   (h.ram->>'TotalGB')::numeric as ram_gb
            FROM nodes n
            LEFT JOIN hardware_current h ON h.node_id = n.id
            ORDER BY n.hostname
        """)
        
        # Get job stats (last 7 days)
        job_stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'success') as success,
                COUNT(*) FILTER (WHERE status = 'failed') as failed
            FROM job_instances
            WHERE created_at > NOW() - INTERVAL '7 days'
        """)
        
        # Get health distribution
        health_dist = await conn.fetch("""
            SELECT COALESCE(health_status, 'unknown') as status, COUNT(*) as count
            FROM nodes
            GROUP BY health_status
        """)
    
    # Generate PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=24, spaceAfter=30, textColor=colors.HexColor('#1e3a5f'))
    heading_style = ParagraphStyle('Heading', parent=styles['Heading1'], fontSize=16, spaceBefore=20, spaceAfter=10, textColor=colors.HexColor('#1e3a5f'))
    normal_style = styles['Normal']
    
    elements = []
    
    # Title
    elements.append(Paragraph("🐙 Octofleet Fleet Summary Report", title_style))
    elements.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", normal_style))
    elements.append(Spacer(1, 20))
    
    # Executive Summary
    elements.append(Paragraph("Executive Summary", heading_style))
    summary_data = [
        ["Total Nodes", str(node_counts["total"])],
        ["Online", str(node_counts["online"])],
        ["Away", str(node_counts["away"])],
        ["Offline", str(node_counts["offline"])],
        ["Jobs (7 days)", str(job_stats["total"] if job_stats else 0)],
        ["Success Rate", f"{(job_stats['success'] / job_stats['total'] * 100):.1f}%" if job_stats and job_stats["total"] > 0 else "N/A"]
    ]
    summary_table = Table(summary_data, colWidths=[3*inch, 2*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#f0f4f8')),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 20))
    
    # Status Chart
    try:
        status_chart = create_pie_chart(
            {"Online": node_counts["online"], "Away": node_counts["away"], "Offline": node_counts["offline"]},
            "Node Status Distribution",
            "fleet_status_chart.png"
        )
        elements.append(Image(status_chart, width=3*inch, height=3*inch))
        elements.append(Spacer(1, 20))
    except Exception as e:
        elements.append(Paragraph(f"Chart generation failed: {str(e)}", normal_style))
    
    # OS Distribution
    elements.append(Paragraph("Operating System Distribution", heading_style))
    os_data = [["Operating System", "Count"]]
    for row in os_dist:
        os_data.append([row["os_name"] or "Unknown", str(row["count"])])
    
    os_table = Table(os_data, colWidths=[4*inch, 1.5*inch])
    os_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
    ]))
    elements.append(os_table)
    elements.append(Spacer(1, 20))
    
    # Node Details Table
    elements.append(PageBreak())
    elements.append(Paragraph("Node Inventory", heading_style))
    
    node_data = [["Hostname", "OS", "Version", "Agent", "Status", "Last Seen"]]
    for node in nodes[:50]:  # Limit to 50 for PDF size
        status = "🟢" if node["is_online"] else "🔴"
        last_seen = node["last_seen"].strftime("%Y-%m-%d %H:%M") if node["last_seen"] else "Never"
        node_data.append([
            node["hostname"] or "N/A",
            (node["os_name"] or "Unknown")[:30],
            (node["os_version"] or "-")[:15],
            node["agent_version"] or "-",
            status,
            last_seen
        ])
    
    node_table = Table(node_data, colWidths=[1.3*inch, 1.8*inch, 0.9*inch, 0.6*inch, 0.5*inch, 1.2*inch])
    node_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('PADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
        ('ALIGN', (4, 0), (4, -1), 'CENTER'),
    ]))
    elements.append(node_table)
    
    # Footer note
    elements.append(Spacer(1, 30))
    elements.append(Paragraph(f"Report generated by Octofleet v0.5.0 • {len(nodes)} total nodes", 
                              ParagraphStyle('Footer', fontSize=8, textColor=colors.gray)))
    
    doc.build(elements)
    buffer.seek(0)
    
    # Cleanup temp files
    import os
    for f in ["/tmp/fleet_status_chart.png"]:
        try:
            os.remove(f)
        except:
            pass
    
    filename = f"octofleet_fleet_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/v1/reports/security/pdf", dependencies=[Depends(verify_api_key)], tags=["Reports"])
async def generate_security_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """Generate a Security & Compliance PDF report."""
    async with db.acquire() as conn:
        # Get vulnerability summary
        vuln_summary = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE severity = 'CRITICAL') as critical,
                COUNT(*) FILTER (WHERE severity = 'HIGH') as high,
                COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium,
                COUNT(*) FILTER (WHERE severity = 'LOW') as low
            FROM vulnerabilities
        """)
        
        # Get top CVEs by affected nodes
        top_cves = await conn.fetch("""
            SELECT v.cve_id, v.severity, v.cvss_score, v.software_name,
                   COUNT(DISTINCT na.node_id) as affected_nodes
            FROM vulnerabilities v
            LEFT JOIN node_vulnerabilities na ON na.vulnerability_id = v.id
            GROUP BY v.id, v.cve_id, v.severity, v.cvss_score, v.software_name
            ORDER BY 
                CASE v.severity 
                    WHEN 'CRITICAL' THEN 1 
                    WHEN 'HIGH' THEN 2 
                    WHEN 'MEDIUM' THEN 3 
                    ELSE 4 
                END,
                affected_nodes DESC
            LIMIT 20
        """)
        
        # Get nodes with most vulnerabilities
        vuln_by_node = await conn.fetch("""
            SELECT n.hostname, 
                   COUNT(*) FILTER (WHERE v.severity = 'CRITICAL') as critical,
                   COUNT(*) FILTER (WHERE v.severity = 'HIGH') as high,
                   COUNT(*) FILTER (WHERE v.severity = 'MEDIUM') as medium,
                   COUNT(*) as total
            FROM nodes n
            JOIN node_vulnerabilities nv ON nv.node_id = n.id
            JOIN vulnerabilities v ON v.id = nv.vulnerability_id
            GROUP BY n.id, n.hostname
            ORDER BY critical DESC, high DESC, total DESC
            LIMIT 15
        """)
        
        # Get compliance status (security settings)
        security_stats = await conn.fetch("""
            SELECT 
                (s.data->>'firewallEnabled')::boolean as firewall_enabled,
                (s.data->>'antivirusEnabled')::boolean as antivirus_enabled,
                (s.data->>'autoUpdateEnabled')::boolean as auto_update,
                COUNT(*) as count
            FROM security_current s
            GROUP BY firewall_enabled, antivirus_enabled, auto_update
        """)
        
        # Calculate compliance metrics
        total_with_security = sum(r["count"] for r in security_stats) if security_stats else 0
        firewall_enabled = sum(r["count"] for r in security_stats if r["firewall_enabled"]) if security_stats else 0
        av_enabled = sum(r["count"] for r in security_stats if r["antivirus_enabled"]) if security_stats else 0
    
    # Generate PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=24, spaceAfter=30, textColor=colors.HexColor('#dc2626'))
    heading_style = ParagraphStyle('Heading', parent=styles['Heading1'], fontSize=16, spaceBefore=20, spaceAfter=10, textColor=colors.HexColor('#1e3a5f'))
    normal_style = styles['Normal']
    
    elements = []
    
    # Title
    elements.append(Paragraph("🛡️ Octofleet Security Report", title_style))
    elements.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", normal_style))
    elements.append(Spacer(1, 20))
    
    # Risk Summary
    elements.append(Paragraph("Vulnerability Summary", heading_style))
    
    risk_data = [
        ["Severity", "Count", "Risk Level"],
        ["🔴 Critical", str(vuln_summary["critical"] if vuln_summary else 0), "Immediate Action Required"],
        ["🟠 High", str(vuln_summary["high"] if vuln_summary else 0), "Action Required"],
        ["🟡 Medium", str(vuln_summary["medium"] if vuln_summary else 0), "Plan Remediation"],
        ["🟢 Low", str(vuln_summary["low"] if vuln_summary else 0), "Monitor"],
        ["Total", str(vuln_summary["total"] if vuln_summary else 0), ""]
    ]
    
    risk_table = Table(risk_data, colWidths=[1.5*inch, 1*inch, 3*inch])
    risk_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#fef2f2')),  # Critical row
        ('BACKGROUND', (0, 2), (-1, 2), colors.HexColor('#fff7ed')),  # High row
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f0f4f8')),  # Total row
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]))
    elements.append(risk_table)
    elements.append(Spacer(1, 20))
    
    # Vulnerability Chart
    try:
        vuln_chart = create_pie_chart(
            {
                "Critical": vuln_summary["critical"] if vuln_summary else 0,
                "High": vuln_summary["high"] if vuln_summary else 0,
                "Medium": vuln_summary["medium"] if vuln_summary else 0,
                "Low": vuln_summary["low"] if vuln_summary else 0
            },
            "Vulnerabilities by Severity",
            "security_vuln_chart.png"
        )
        elements.append(Image(vuln_chart, width=3*inch, height=3*inch))
        elements.append(Spacer(1, 20))
    except Exception as e:
        pass
    
    # Top CVEs Table
    elements.append(Paragraph("Top Vulnerabilities", heading_style))
    cve_data = [["CVE ID", "Software", "Severity", "CVSS", "Affected"]]
    for cve in top_cves:
        severity_color = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}.get(cve["severity"], "⚪")
        cve_data.append([
            cve["cve_id"],
            (cve["software_name"] or "-")[:25],
            f"{severity_color} {cve['severity']}",
            f"{cve['cvss_score']:.1f}" if cve["cvss_score"] else "-",
            str(cve["affected_nodes"])
        ])
    
    cve_table = Table(cve_data, colWidths=[1.5*inch, 1.8*inch, 1.2*inch, 0.6*inch, 0.8*inch])
    cve_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('PADDING', (0, 0), (-1, -1), 5),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
    ]))
    elements.append(cve_table)
    
    # Nodes at Risk
    elements.append(PageBreak())
    elements.append(Paragraph("Nodes at Risk", heading_style))
    
    node_risk_data = [["Hostname", "Critical", "High", "Medium", "Total"]]
    for node in vuln_by_node:
        node_risk_data.append([
            node["hostname"],
            str(node["critical"]),
            str(node["high"]),
            str(node["medium"]),
            str(node["total"])
        ])
    
    node_risk_table = Table(node_risk_data, colWidths=[2*inch, 1*inch, 1*inch, 1*inch, 1*inch])
    node_risk_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ]))
    elements.append(node_risk_table)
    elements.append(Spacer(1, 20))
    
    # Compliance Overview
    elements.append(Paragraph("Compliance Overview", heading_style))
    compliance_data = [
        ["Security Control", "Compliant", "Percentage"],
        ["Firewall Enabled", str(firewall_enabled), f"{firewall_enabled/total_with_security*100:.1f}%" if total_with_security > 0 else "N/A"],
        ["Antivirus Active", str(av_enabled), f"{av_enabled/total_with_security*100:.1f}%" if total_with_security > 0 else "N/A"],
    ]
    
    compliance_table = Table(compliance_data, colWidths=[2.5*inch, 1.5*inch, 1.5*inch])
    compliance_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('PADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
    ]))
    elements.append(compliance_table)
    
    # Footer
    elements.append(Spacer(1, 30))
    elements.append(Paragraph(f"Report generated by Octofleet v0.5.0 • Security assessment as of {datetime.utcnow().strftime('%Y-%m-%d')}", 
                              ParagraphStyle('Footer', fontSize=8, textColor=colors.gray)))
    
    doc.build(elements)
    buffer.seek(0)
    
    # Cleanup
    import os
    for f in ["/tmp/security_vuln_chart.png"]:
        try:
            os.remove(f)
        except:
            pass
    
    filename = f"octofleet_security_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/v1/reports/inventory/pdf", dependencies=[Depends(verify_api_key)], tags=["Reports"])
async def generate_inventory_report_pdf(db: asyncpg.Pool = Depends(get_db)):
    """Generate a detailed Hardware Inventory PDF report."""
    async with db.acquire() as conn:
        # Get all nodes with hardware details
        nodes = await conn.fetch("""
            SELECT n.hostname, n.os_name, n.os_version, n.domain,
                   h.cpu->>'Name' as cpu_name,
                   (h.cpu->>'Cores')::int as cpu_cores,
                   (h.cpu->>'Threads')::int as cpu_threads,
                   (h.ram->>'TotalGB')::numeric as ram_gb,
                   h.mainboard->>'Manufacturer' as mb_manufacturer,
                   h.mainboard->>'Product' as mb_product,
                   h.bios->>'SerialNumber' as serial,
                   h.bios->>'Manufacturer' as bios_manufacturer,
                   h.bios->>'Version' as bios_version
            FROM nodes n
            LEFT JOIN hardware_current h ON h.node_id = n.id
            ORDER BY n.hostname
        """)
        
        # Get disk summary
        disk_stats = await conn.fetch("""
            SELECT n.hostname,
                   d.model, d.media_type, 
                   (d.size_bytes / 1073741824.0)::numeric as size_gb
            FROM physical_disks d
            JOIN nodes n ON n.id = d.node_id
            ORDER BY n.hostname, d.model
        """)
        
        # CPU distribution
        cpu_dist = await conn.fetch("""
            SELECT h.cpu->>'Name' as cpu_name, COUNT(*) as count
            FROM hardware_current h
            WHERE h.cpu->>'Name' IS NOT NULL
            GROUP BY h.cpu->>'Name'
            ORDER BY count DESC
            LIMIT 10
        """)
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=1*cm, bottomMargin=1*cm)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('Title', parent=styles['Title'], fontSize=24, spaceAfter=30, textColor=colors.HexColor('#1e3a5f'))
    heading_style = ParagraphStyle('Heading', parent=styles['Heading1'], fontSize=14, spaceBefore=15, spaceAfter=8, textColor=colors.HexColor('#1e3a5f'))
    
    elements = []
    
    # Title
    elements.append(Paragraph("📦 Octofleet Hardware Inventory Report", title_style))
    elements.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} • {len(nodes)} systems", styles['Normal']))
    elements.append(Spacer(1, 15))
    
    # Hardware Summary Table
    elements.append(Paragraph("System Inventory", heading_style))
    
    hw_data = [["Hostname", "OS", "CPU", "Cores", "RAM (GB)", "Manufacturer", "Serial"]]
    for node in nodes[:40]:  # Limit for PDF
        hw_data.append([
            (node["hostname"] or "N/A")[:20],
            (node["os_name"] or "Unknown")[:25],
            (node["cpu_name"] or "-")[:35],
            str(node["cpu_cores"]) if node["cpu_cores"] else "-",
            f"{node['ram_gb']:.1f}" if node["ram_gb"] else "-",
            (node["mb_manufacturer"] or "-")[:20],
            (node["serial"] or "-")[:20]
        ])
    
    hw_table = Table(hw_data, colWidths=[1.2*inch, 1.6*inch, 2.2*inch, 0.5*inch, 0.7*inch, 1.3*inch, 1.3*inch])
    hw_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('PADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9fafb')]),
    ]))
    elements.append(hw_table)
    
    # CPU Distribution
    if cpu_dist:
        elements.append(PageBreak())
        elements.append(Paragraph("CPU Distribution", heading_style))
        cpu_data = [["CPU Model", "Count"]]
        for cpu in cpu_dist:
            cpu_data.append([(cpu["cpu_name"] or "Unknown")[:50], str(cpu["count"])])
        
        cpu_table = Table(cpu_data, colWidths=[6*inch, 1*inch])
        cpu_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a5f')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('PADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ]))
        elements.append(cpu_table)
    
    # Footer
    elements.append(Spacer(1, 30))
    elements.append(Paragraph("Report generated by Octofleet v0.5.0", 
                              ParagraphStyle('Footer', fontSize=8, textColor=colors.gray)))
    
    doc.build(elements)
    buffer.seek(0)
    
    filename = f"octofleet_inventory_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# ============================================
# E19-06: Systems Registry API
# ============================================

@app.get("/api/v1/discovered-systems", tags=["Provisioning"])
async def list_discovered_systems(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: asyncpg.Pool = Depends(get_db)
):
    """List all discovered systems from PXE boot registry"""
    async with db.acquire() as conn:
        query = "SELECT * FROM discovered_systems WHERE 1=1"
        params = []
        param_idx = 1
        
        if status:
            query += f" AND status = ${param_idx}"
            params.append(status)
            param_idx += 1
        
        query += f" ORDER BY last_seen DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
        params.extend([limit, offset])
        
        rows = await conn.fetch(query, *params)
        total = await conn.fetchval("SELECT COUNT(*) FROM discovered_systems" + 
                                    (f" WHERE status = $1" if status else ""),
                                    *([status] if status else []))
        
        return {
            "systems": [dict(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset
        }

@app.get("/api/v1/discovered-systems/{system_id}", tags=["Provisioning"])
async def get_discovered_system(system_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a specific discovered system by ID or MAC address"""
    async with db.acquire() as conn:
        # Try by ID first, then by MAC
        row = await conn.fetchrow(
            "SELECT * FROM discovered_systems WHERE id::text = $1 OR mac_address = $1",
            system_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="System not found")
        return dict(row)

@app.post("/api/v1/discovered-systems/register", tags=["Provisioning"])
async def register_discovered_system(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """
    Register or update a discovered system (called by iPXE during boot).
    If MAC already exists, updates last_seen and increments boot_count.
    """
    mac = data.get("mac_address", "").upper().replace("-", ":").strip()
    if not mac:
        raise HTTPException(status_code=400, detail="mac_address is required")
    
    async with db.acquire() as conn:
        # Check if exists
        existing = await conn.fetchrow(
            "SELECT id, boot_count FROM discovered_systems WHERE mac_address = $1", mac
        )
        
        if existing:
            # Update existing
            await conn.execute("""
                UPDATE discovered_systems SET
                    ip_address = COALESCE($2, ip_address),
                    hostname = COALESCE($3, hostname),
                    manufacturer = COALESCE($4, manufacturer),
                    model = COALESCE($5, model),
                    serial_number = COALESCE($6, serial_number),
                    bios_version = COALESCE($7, bios_version),
                    cpu_info = COALESCE($8, cpu_info),
                    memory_mb = COALESCE($9, memory_mb),
                    disk_info = COALESCE($10::jsonb, disk_info),
                    boot_mode = COALESCE($11, boot_mode),
                    last_seen = NOW(),
                    boot_count = boot_count + 1
                WHERE mac_address = $1
            """, mac, data.get("ip_address"), data.get("hostname"),
                data.get("manufacturer"), data.get("model"), data.get("serial_number"),
                data.get("bios_version"), data.get("cpu_info"), data.get("memory_mb"),
                json.dumps(data.get("disk_info")) if data.get("disk_info") else None,
                data.get("boot_mode"))
            
            return {"status": "updated", "id": str(existing["id"]), "boot_count": existing["boot_count"] + 1}
        else:
            # Insert new
            row = await conn.fetchrow("""
                INSERT INTO discovered_systems (
                    mac_address, ip_address, hostname, manufacturer, model,
                    serial_number, bios_version, cpu_info, memory_mb, disk_info, boot_mode
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
                RETURNING id
            """, mac, data.get("ip_address"), data.get("hostname"),
                data.get("manufacturer"), data.get("model"), data.get("serial_number"),
                data.get("bios_version"), data.get("cpu_info"), data.get("memory_mb"),
                json.dumps(data.get("disk_info")) if data.get("disk_info") else None,
                data.get("boot_mode"))
            
            return {"status": "created", "id": str(row["id"]), "boot_count": 1}

@app.patch("/api/v1/discovered-systems/{system_id}", tags=["Provisioning"])
async def update_discovered_system(
    system_id: str, 
    data: Dict[str, Any], 
    db: asyncpg.Pool = Depends(get_db)
):
    """Update a discovered system (status, notes, tags)"""
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM discovered_systems WHERE id::text = $1 OR mac_address = $1",
            system_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="System not found")
        
        updates = []
        params = [str(row["id"])]
        param_idx = 2
        
        for field in ["status", "notes", "hostname"]:
            if field in data:
                updates.append(f"{field} = ${param_idx}")
                params.append(data[field])
                param_idx += 1
        
        if "tags" in data:
            updates.append(f"tags = ${param_idx}::text[]")
            params.append(data["tags"])
            param_idx += 1
        
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        await conn.execute(
            f"UPDATE discovered_systems SET {', '.join(updates)} WHERE id = $1::uuid",
            *params
        )
        
        return {"status": "updated", "id": str(row["id"])}

@app.delete("/api/v1/discovered-systems/{system_id}", tags=["Provisioning"])
async def delete_discovered_system(system_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a discovered system from the registry"""
    async with db.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM discovered_systems WHERE id::text = $1 OR mac_address = $1",
            system_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="System not found")
        return {"status": "deleted"}

@app.post("/api/v1/discovered-systems/{system_id}/provision", tags=["Provisioning"])
async def provision_discovered_system(
    system_id: str,
    data: Dict[str, Any],
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Create a provisioning task for a discovered system.
    Requires: hostname, image_id or template
    """
    async with db.acquire() as conn:
        system = await conn.fetchrow(
            "SELECT * FROM discovered_systems WHERE id::text = $1 OR mac_address = $1",
            system_id
        )
        if not system:
            raise HTTPException(status_code=404, detail="System not found")
        
        hostname = data.get("hostname") or system["hostname"]
        if not hostname:
            raise HTTPException(status_code=400, detail="hostname is required")
        
        # Update system status
        await conn.execute(
            "UPDATE discovered_systems SET status = 'pending', hostname = $2 WHERE id = $1",
            system["id"], hostname
        )
        
        # Return info for creating provisioning task
        return {
            "status": "ready",
            "system_id": str(system["id"]),
            "mac_address": system["mac_address"],
            "hostname": hostname,
            "message": "System marked for provisioning. Create a provisioning task with this MAC address."
        }

# ============================================
# E19-09: Linux Agent Download Endpoint
# ============================================

LINUX_AGENT_SCRIPT = '''#!/bin/bash
# Octofleet Linux Agent v1.0.0
# Auto-generated from provisioning endpoint

set -e

CONFIG_FILE="${CONFIG_FILE:-/opt/octofleet-agent/config.env}"

# Load config
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
fi

API_URL="${API_URL:-http://192.168.0.5:8080}"
API_KEY="${API_KEY:-octofleet-inventory-dev-key}"
NODE_ID="${NODE_ID:-$(hostname)}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Collect inventory
collect_inventory() {
    local os_name=$(lsb_release -d 2>/dev/null | cut -f2 || cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)
    local os_version=$(lsb_release -r 2>/dev/null | cut -f2 || cat /etc/os-release | grep VERSION_ID | cut -d'"' -f2)
    local kernel=$(uname -r)
    local hostname=$(hostname -f 2>/dev/null || hostname)
    local cpu_model=$(grep "model name" /proc/cpuinfo | head -1 | cut -d':' -f2 | xargs)
    local cpu_cores=$(nproc)
    local mem_total_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local mem_total_mb=$((mem_total_kb / 1024))
    local uptime_seconds=$(cat /proc/uptime | cut -d' ' -f1 | cut -d'.' -f1)
    
    cat << EOF
{
    "nodeId": "$NODE_ID",
    "hostname": "$hostname",
    "osFamily": "Linux",
    "osName": "$os_name",
    "osVersion": "$os_version",
    "kernel": "$kernel",
    "cpuModel": "$cpu_model",
    "cpuCores": $cpu_cores,
    "memoryMb": $mem_total_mb,
    "uptimeSeconds": $uptime_seconds,
    "agentVersion": "1.0.0"
}
EOF
}

# Push inventory to backend
push_inventory() {
    local data=$(collect_inventory)
    curl -s -X POST "$API_URL/api/v1/inventory" \\
        -H "Content-Type: application/json" \\
        -H "X-API-Key: $API_KEY" \\
        -d "$data" > /dev/null 2>&1 && log "Inventory pushed" || log "Inventory push failed"
}

# Poll for jobs
poll_jobs() {
    local response=$(curl -s "$API_URL/api/v1/jobs/pending/$NODE_ID" -H "X-API-Key: $API_KEY" 2>/dev/null)
    local count=$(echo "$response" | jq -r '.count // 0' 2>/dev/null)
    
    if [ "$count" -gt 0 ]; then
        log "Found $count pending jobs"
        echo "$response" | jq -c '.jobs[]' 2>/dev/null | while read job; do
            execute_job "$job"
        done
    fi
}

# Execute a job
execute_job() {
    local job="$1"
    local instance_id=$(echo "$job" | jq -r '.instanceId')
    local command_type=$(echo "$job" | jq -r '.commandType')
    local payload=$(echo "$job" | jq -r '.commandPayload')
    
    log "Executing job $instance_id (type: $command_type)"
    
    # Mark as started
    curl -s -X POST "$API_URL/api/v1/jobs/instances/$instance_id/start" \\
        -H "X-API-Key: $API_KEY" > /dev/null 2>&1
    
    local exit_code=0
    local stdout=""
    local stderr=""
    
    case "$command_type" in
        script|run)
            local script=$(echo "$payload" | jq -r '.script // .command // ""')
            stdout=$(bash -c "$script" 2>&1) || exit_code=$?
            ;;
        *)
            stderr="Unknown command type: $command_type"
            exit_code=1
            ;;
    esac
    
    # Report result
    curl -s -X POST "$API_URL/api/v1/jobs/instances/$instance_id/result" \\
        -H "Content-Type: application/json" \\
        -H "X-API-Key: $API_KEY" \\
        -d "{\\"exitCode\\": $exit_code, \\"stdout\\": \\"$(echo "$stdout" | head -c 10000 | sed 's/"/\\\\"/g' | tr '\\n' ' ')\\", \\"stderr\\": \\"$(echo "$stderr" | sed 's/"/\\\\"/g')\\"}" > /dev/null 2>&1
    
    log "Job $instance_id completed with exit code $exit_code"
}

# Main loop
log "Octofleet Linux Agent starting..."
log "API: $API_URL, Node: $NODE_ID"

push_inventory

while true; do
    poll_jobs
    sleep "$POLL_INTERVAL"
done
'''

@app.get("/api/v1/provisioning/linux-agent", tags=["Provisioning"])
async def get_linux_agent():
    """Download the Linux agent shell script for auto-installation"""
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        content=LINUX_AGENT_SCRIPT,
        media_type="text/x-shellscript",
        headers={"Content-Disposition": "attachment; filename=agent.sh"}
    )

@app.get("/api/v1/provisioning/autoinstall/{hostname}", tags=["Provisioning"])
async def get_autoinstall_config(
    hostname: str,
    api_url: str = "http://192.168.0.5:8080",
    api_key: str = "octofleet-inventory-dev-key",
    task_id: Optional[str] = None
):
    """Generate Ubuntu autoinstall config with Octofleet agent pre-installed"""
    
    template = """#cloud-config
autoinstall:
  version: 1
  locale: en_US.UTF-8
  keyboard:
    layout: de
  identity:
    hostname: {hostname}
    username: octofleet
    password: "$6$rounds=4096$salt$iqcgL5FX/a5Zq8e8Vz7x3FJsYJNBjrNhZNpzNgS1XHnWz/vZF8PUy3gH8rN5X3bN7qY4fJ5nM2kP9sL1hT6wK."
  ssh:
    install-server: true
    allow-pw: true
  storage:
    layout:
      name: lvm
  packages:
    - curl
    - jq
    - net-tools
  late-commands:
    - curtin in-target --target=/target -- mkdir -p /opt/octofleet-agent
    - |
      curl -fsSL "{api_url}/api/v1/provisioning/linux-agent" -o /target/opt/octofleet-agent/agent.sh
      chmod +x /target/opt/octofleet-agent/agent.sh
      cat > /target/opt/octofleet-agent/config.env << CONF
      API_URL={api_url}
      API_KEY={api_key}
      NODE_ID={hostname}
      POLL_INTERVAL=30
      CONF
      cat > /target/etc/systemd/system/octofleet-agent.service << SVC
      [Unit]
      Description=Octofleet Linux Agent
      After=network-online.target
      Wants=network-online.target
      [Service]
      Type=simple
      ExecStart=/opt/octofleet-agent/agent.sh
      Restart=always
      RestartSec=30
      WorkingDirectory=/opt/octofleet-agent
      [Install]
      WantedBy=multi-user.target
      SVC
    - curtin in-target --target=/target -- systemctl enable octofleet-agent
"""
    
    config = template.format(
        hostname=hostname,
        api_url=api_url,
        api_key=api_key
    )
    
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(content=config, media_type="text/yaml")


# ============================================================
# E21: Security Monitoring & Compliance
# ============================================================

# --- Monitoring Profiles ---

@app.get("/api/v1/monitoring/profiles", dependencies=[Depends(verify_api_key)])
async def list_monitoring_profiles():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM monitoring_profiles ORDER BY created_at DESC")
        return {"profiles": [dict(r) for r in rows]}

@app.get("/api/v1/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def get_monitoring_profile(profile_id: str):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM monitoring_profiles WHERE id = $1::uuid", profile_id)
        if not row:
            raise HTTPException(status_code=404, detail="Profile not found")
        return dict(row)

@app.post("/api/v1/monitoring/profiles", dependencies=[Depends(verify_api_key)])
async def create_monitoring_profile(req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO monitoring_profiles (name, description, sensors, sampling, include_paths, exclude_paths, created_by)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
            RETURNING *
        """, body.get("name", "Default"), body.get("description"),
            json.dumps(body.get("sensors", {})), json.dumps(body.get("sampling", {})),
            json.dumps(body.get("include_paths", [])), json.dumps(body.get("exclude_paths", [])),
            body.get("created_by"))
        return dict(row)

@app.put("/api/v1/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def update_monitoring_profile(profile_id: str, req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE monitoring_profiles SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                sensors = COALESCE($4::jsonb, sensors),
                sampling = COALESCE($5::jsonb, sampling),
                include_paths = COALESCE($6::jsonb, include_paths),
                exclude_paths = COALESCE($7::jsonb, exclude_paths),
                version = version + 1,
                updated_at = now()
            WHERE id = $1::uuid RETURNING *
        """, profile_id, body.get("name"), body.get("description"),
            json.dumps(body.get("sensors")) if "sensors" in body else None,
            json.dumps(body.get("sampling")) if "sampling" in body else None,
            json.dumps(body.get("include_paths")) if "include_paths" in body else None,
            json.dumps(body.get("exclude_paths")) if "exclude_paths" in body else None)
        if not row:
            raise HTTPException(status_code=404, detail="Profile not found")
        return dict(row)

@app.delete("/api/v1/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def delete_monitoring_profile(profile_id: str):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM monitoring_profiles WHERE id = $1::uuid", profile_id)
        return {"status": "deleted"}

# --- Monitoring Assignments ---

@app.get("/api/v1/monitoring/assignments", dependencies=[Depends(verify_api_key)])
async def list_monitoring_assignments():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT a.*, p.name as profile_name
            FROM monitoring_assignments a
            LEFT JOIN monitoring_profiles p ON p.id = a.profile_id
            ORDER BY a.priority DESC, a.created_at DESC
        """)
        return {"assignments": [dict(r) for r in rows]}

@app.post("/api/v1/monitoring/assignments", dependencies=[Depends(verify_api_key)])
async def create_monitoring_assignment(req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO monitoring_assignments (target_type, target_id, profile_id, priority, status, start_time, end_time)
            VALUES ($1, $2, $3::uuid, $4, $5, $6, $7)
            RETURNING *
        """, body["target_type"], body["target_id"], body["profile_id"],
            body.get("priority", 0), body.get("status", "active"),
            body.get("start_time"), body.get("end_time"))
        return dict(row)

@app.put("/api/v1/monitoring/assignments/{assignment_id}", dependencies=[Depends(verify_api_key)])
async def update_monitoring_assignment(assignment_id: str, req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE monitoring_assignments SET
                status = COALESCE($2, status),
                priority = COALESCE($3, priority),
                end_time = COALESCE($4, end_time),
                updated_at = now()
            WHERE id = $1::uuid RETURNING *
        """, assignment_id, body.get("status"), body.get("priority"), body.get("end_time"))
        if not row:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return dict(row)

@app.delete("/api/v1/monitoring/assignments/{assignment_id}", dependencies=[Depends(verify_api_key)])
async def delete_monitoring_assignment(assignment_id: str):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM monitoring_assignments WHERE id = $1::uuid", assignment_id)
        return {"status": "deleted"}

@app.get("/api/v1/monitoring/nodes/{node_id}/effective-policy", dependencies=[Depends(verify_api_key)])
async def get_effective_policy(node_id: str):
    async with db_pool.acquire() as conn:
        # Check direct node assignment first, then group assignments
        row = await conn.fetchrow("""
            SELECT a.*, p.name as profile_name, p.sensors, p.sampling, p.include_paths, p.exclude_paths
            FROM monitoring_assignments a
            JOIN monitoring_profiles p ON p.id = a.profile_id
            WHERE a.target_type = 'node' AND a.target_id = $1 AND a.status = 'active'
                AND (a.end_time IS NULL OR a.end_time > now())
            ORDER BY a.priority DESC LIMIT 1
        """, node_id)
        if not row:
            # Fallback to group assignments
            row = await conn.fetchrow("""
                SELECT a.*, p.name as profile_name, p.sensors, p.sampling, p.include_paths, p.exclude_paths
                FROM monitoring_assignments a
                JOIN monitoring_profiles p ON p.id = a.profile_id
                JOIN group_members gm ON gm.group_id = a.target_id::uuid
                WHERE a.target_type = 'group' AND gm.node_id = $1 AND a.status = 'active'
                    AND (a.end_time IS NULL OR a.end_time > now())
                ORDER BY a.priority DESC LIMIT 1
            """, node_id)
        if not row:
            return {"policy": None, "message": "No monitoring policy assigned"}
        return {"policy": dict(row)}

# --- Event Ingest ---

@app.post("/api/v1/ingest/events", dependencies=[Depends(verify_api_key)])
async def ingest_events(req: Request):
    body = await req.json()
    events = body.get("events", [body] if "event_type" in body else [])
    inserted = 0
    async with db_pool.acquire() as conn:
        for evt in events:
            event_type = evt.get("event_type", "unknown")
            # Route file events to file_events table
            if event_type.startswith("file."):
                await conn.execute("""
                    INSERT INTO file_events (node_id, user_id, op, path, old_path, new_path, process_name, pid, hash_before, hash_after, file_size, success)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """, evt.get("node_id"), evt.get("user_id"), evt.get("op", event_type),
                    evt.get("path"), evt.get("old_path"), evt.get("new_path"),
                    evt.get("process_name"), evt.get("pid"),
                    evt.get("hash_before"), evt.get("hash_after"),
                    evt.get("file_size"), evt.get("success", True))
            else:
                await conn.execute("""
                    INSERT INTO events_normalized (node_id, user_id, event_type, severity, payload)
                    VALUES ($1, $2, $3, $4, $5::jsonb)
                """, evt.get("node_id"), evt.get("user_id"), event_type,
                    evt.get("severity", "info"), json.dumps(evt.get("payload", {})))
            inserted += 1
    return {"inserted": inserted}

# --- Events Query ---

@app.get("/api/v1/events", dependencies=[Depends(verify_api_key)])
async def query_events(
    node_id: str = None, user_id: str = None, event_type: str = None,
    severity: str = None, since: str = None, until: str = None,
    limit: int = 100, offset: int = 0
):
    async with db_pool.acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if node_id:
            conditions.append(f"node_id = ${idx}")
            params.append(node_id); idx += 1
        if user_id:
            conditions.append(f"user_id = ${idx}")
            params.append(user_id); idx += 1
        if event_type:
            conditions.append(f"event_type = ${idx}")
            params.append(event_type); idx += 1
        if severity:
            conditions.append(f"severity = ${idx}")
            params.append(severity); idx += 1
        if since:
            conditions.append(f"ts >= ${idx}::timestamptz")
            params.append(since); idx += 1
        if until:
            conditions.append(f"ts <= ${idx}::timestamptz")
            params.append(until); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM events_normalized {where}
            ORDER BY ts DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        count = await conn.fetchval(f"SELECT count(*) FROM events_normalized {where}", *params[:-2])
        return {"events": [dict(r) for r in rows], "total": count}

# --- File Events Query ---

@app.get("/api/v1/events/files", dependencies=[Depends(verify_api_key)])
async def query_file_events(
    node_id: str = None, user_id: str = None, op: str = None,
    path: str = None, since: str = None, until: str = None,
    limit: int = 100, offset: int = 0
):
    async with db_pool.acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if node_id:
            conditions.append(f"node_id = ${idx}")
            params.append(node_id); idx += 1
        if user_id:
            conditions.append(f"user_id = ${idx}")
            params.append(user_id); idx += 1
        if op:
            conditions.append(f"op = ${idx}")
            params.append(op); idx += 1
        if path:
            conditions.append(f"path ILIKE ${idx}")
            params.append(f"%{path}%"); idx += 1
        if since:
            conditions.append(f"ts >= ${idx}::timestamptz")
            params.append(since); idx += 1
        if until:
            conditions.append(f"ts <= ${idx}::timestamptz")
            params.append(until); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM file_events {where}
            ORDER BY ts DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        count = await conn.fetchval(f"SELECT count(*) FROM file_events {where}", *params[:-2])
        return {"events": [dict(r) for r in rows], "total": count}

# --- Findings ---

@app.get("/api/v1/findings", dependencies=[Depends(verify_api_key)])
async def list_findings(
    status: str = None, severity: str = None, node_id: str = None,
    limit: int = 50, offset: int = 0
):
    async with db_pool.acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if status:
            conditions.append(f"status = ${idx}")
            params.append(status); idx += 1
        if severity:
            conditions.append(f"severity = ${idx}")
            params.append(severity); idx += 1
        if node_id:
            conditions.append(f"node_id = ${idx}")
            params.append(node_id); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM findings {where}
            ORDER BY score DESC NULLS LAST, last_seen DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        count = await conn.fetchval(f"SELECT count(*) FROM findings {where}", *params[:-2])
        return {"findings": [dict(r) for r in rows], "total": count}

@app.get("/api/v1/findings/{finding_id}", dependencies=[Depends(verify_api_key)])
async def get_finding(finding_id: str):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM findings WHERE id = $1::uuid", finding_id)
        if not row:
            raise HTTPException(status_code=404, detail="Finding not found")
        return dict(row)

@app.put("/api/v1/findings/{finding_id}", dependencies=[Depends(verify_api_key)])
async def update_finding(finding_id: str, req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE findings SET
                status = COALESCE($2, status),
                updated_at = now()
            WHERE id = $1::uuid RETURNING *
        """, finding_id, body.get("status"))
        if not row:
            raise HTTPException(status_code=404, detail="Finding not found")
        return dict(row)

# --- Security Policies ---

@app.get("/api/v1/security/policies", dependencies=[Depends(verify_api_key)])
async def list_security_policies():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM security_policies ORDER BY created_at DESC")
        return {"policies": [dict(r) for r in rows]}

@app.post("/api/v1/security/policies", dependencies=[Depends(verify_api_key)])
async def create_security_policy(req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO security_policies (name, description, definition, enabled, severity, created_by)
            VALUES ($1, $2, $3::jsonb, $4, $5, $6)
            RETURNING *
        """, body["name"], body.get("description"), json.dumps(body.get("definition", {})),
            body.get("enabled", True), body.get("severity", "medium"), body.get("created_by"))
        return dict(row)

@app.put("/api/v1/security/policies/{policy_id}", dependencies=[Depends(verify_api_key)])
async def update_security_policy(policy_id: str, req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE security_policies SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                definition = COALESCE($4::jsonb, definition),
                enabled = COALESCE($5, enabled),
                severity = COALESCE($6, severity),
                version = version + 1,
                updated_at = now()
            WHERE id = $1::uuid RETURNING *
        """, policy_id, body.get("name"), body.get("description"),
            json.dumps(body.get("definition")) if "definition" in body else None,
            body.get("enabled"), body.get("severity"))
        if not row:
            raise HTTPException(status_code=404, detail="Policy not found")
        return dict(row)

@app.delete("/api/v1/security/policies/{policy_id}", dependencies=[Depends(verify_api_key)])
async def delete_security_policy(policy_id: str):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM security_policies WHERE id = $1::uuid", policy_id)
        return {"status": "deleted"}

# --- Retention Config ---

@app.get("/api/v1/retention", dependencies=[Depends(verify_api_key)])
async def get_retention_config():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM retention_config ORDER BY category")
        return {"retention": [dict(r) for r in rows]}

@app.put("/api/v1/retention/{category}", dependencies=[Depends(verify_api_key)])
async def update_retention_config(category: str, req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE retention_config SET
                hot_days = COALESCE($2, hot_days),
                warm_days = COALESCE($3, warm_days),
                cold_days = COALESCE($4, cold_days),
                legal_hold = COALESCE($5, legal_hold),
                updated_at = now()
            WHERE category = $1 RETURNING *
        """, category, body.get("hot_days"), body.get("warm_days"),
            body.get("cold_days"), body.get("legal_hold"))
        if not row:
            raise HTTPException(status_code=404, detail="Category not found")
        return dict(row)

# --- Evidence Exports ---

@app.get("/api/v1/evidence/exports", dependencies=[Depends(verify_api_key)])
async def list_evidence_exports():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM evidence_exports ORDER BY created_at DESC LIMIT 50")
        return {"exports": [dict(r) for r in rows]}

@app.post("/api/v1/evidence/export", dependencies=[Depends(verify_api_key)])
async def create_evidence_export(req: Request):
    body = await req.json()
    async with db_pool.acquire() as conn:
        # Create export record
        row = await conn.fetchrow("""
            INSERT INTO evidence_exports (scope, filter_criteria, created_by)
            VALUES ($1, $2::jsonb, $3)
            RETURNING *
        """, body.get("scope", "manual"), json.dumps(body.get("filter", {})), body.get("created_by"))
        # Log UI audit event
        await conn.execute("""
            INSERT INTO ui_audit_events (actor_user_id, action, object_type, object_id, details)
            VALUES ($1, 'evidence_export', 'evidence_exports', $2, $3::jsonb)
        """, body.get("created_by", "system"), str(row["id"]), json.dumps({"scope": body.get("scope")}))
        return dict(row)

# --- UI Audit Events ---

@app.get("/api/v1/audit/ui-events", dependencies=[Depends(verify_api_key)])
async def query_ui_audit_events(
    actor: str = None, action: str = None, since: str = None,
    limit: int = 100, offset: int = 0
):
    async with db_pool.acquire() as conn:
        conditions = []
        params = []
        idx = 1
        if actor:
            conditions.append(f"actor_user_id = ${idx}")
            params.append(actor); idx += 1
        if action:
            conditions.append(f"action = ${idx}")
            params.append(action); idx += 1
        if since:
            conditions.append(f"ts >= ${idx}::timestamptz")
            params.append(since); idx += 1

        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT * FROM ui_audit_events {where}
            ORDER BY ts DESC LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        return {"events": [dict(r) for r in rows]}

# --- Security Dashboard Stats ---

@app.get("/api/v1/security/dashboard", dependencies=[Depends(verify_api_key)])
async def security_dashboard():
    async with db_pool.acquire() as conn:
        # Findings by severity
        findings_by_severity = await conn.fetch("""
            SELECT severity, status, count(*) as count
            FROM findings
            GROUP BY severity, status
        """)
        # Recent events count (24h)
        event_count_24h = await conn.fetchval("""
            SELECT count(*) FROM events_normalized WHERE ts > now() - interval '24 hours'
        """)
        file_event_count_24h = await conn.fetchval("""
            SELECT count(*) FROM file_events WHERE ts > now() - interval '24 hours'
        """)
        # Active monitoring assignments
        active_assignments = await conn.fetchval("""
            SELECT count(*) FROM monitoring_assignments WHERE status = 'active'
        """)
        # Top event types (24h)
        top_event_types = await conn.fetch("""
            SELECT event_type, count(*) as count
            FROM events_normalized WHERE ts > now() - interval '24 hours'
            GROUP BY event_type ORDER BY count DESC LIMIT 10
        """)
        return {
            "findings_by_severity": [dict(r) for r in findings_by_severity],
            "events_24h": event_count_24h,
            "file_events_24h": file_event_count_24h,
            "active_monitoring": active_assignments,
            "top_event_types": [dict(r) for r in top_event_types]
        }


# ============================================================
# E21 Story #83: Agent Capability & Health Reporting
# ============================================================

@app.post("/api/v1/agents/{node_id}/capabilities", dependencies=[Depends(verify_api_key)])
async def report_agent_capabilities(node_id: str, req: Request):
    """Agent reports its capabilities, OS info, and available sensors."""
    body = await req.json()
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO agent_capabilities (node_id, sensors, agent_version, os_type, os_version, kernel_build, permissions, last_seen)
            VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::jsonb, now())
            ON CONFLICT (node_id) DO UPDATE SET
                sensors = EXCLUDED.sensors,
                agent_version = EXCLUDED.agent_version,
                os_type = EXCLUDED.os_type,
                os_version = EXCLUDED.os_version,
                kernel_build = EXCLUDED.kernel_build,
                permissions = EXCLUDED.permissions,
                last_seen = now()
            RETURNING *
        """, node_id, json.dumps(body.get("sensors", {})), body.get("agent_version"),
            body.get("os_type"), body.get("os_version"), body.get("kernel_build"),
            json.dumps(body.get("permissions", {})))
        return dict(row)

@app.get("/api/v1/agents/{node_id}/capabilities", dependencies=[Depends(verify_api_key)])
async def get_agent_capabilities(node_id: str):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM agent_capabilities WHERE node_id = $1", node_id)
        if not row:
            raise HTTPException(status_code=404, detail="No capabilities reported for this node")
        return dict(row)

@app.get("/api/v1/agents/capabilities", dependencies=[Depends(verify_api_key)])
async def list_agent_capabilities():
    """List all agents with their capabilities and health status."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ac.*, n.hostname, n.os
            FROM agent_capabilities ac
            LEFT JOIN nodes n ON n.id = ac.node_id
            ORDER BY ac.last_seen DESC
        """)
        return {"agents": [dict(r) for r in rows]}

@app.post("/api/v1/agents/{node_id}/health", dependencies=[Depends(verify_api_key)])
async def report_agent_health(node_id: str, req: Request):
    """Agent reports health metrics: queue depth, drops, CPU overhead, etc."""
    body = await req.json()
    # Store as a normalized event
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO events_normalized (node_id, event_type, severity, payload)
            VALUES ($1, 'agent.health', $2, $3::jsonb)
        """, node_id,
            'warning' if body.get("drop_count", 0) > 100 or body.get("queue_depth", 0) > 1000 else 'info',
            json.dumps(body))
        # Update last_seen
        await conn.execute("""
            UPDATE agent_capabilities SET last_seen = now() WHERE node_id = $1
        """, node_id)
        # Auto-create finding if drops exceed threshold
        if body.get("drop_count", 0) > 100:
            await conn.execute("""
                INSERT INTO findings (type, title, description, severity, score, node_id)
                VALUES ('agent_health', 'High event drop count', $1, 'medium', $2, $3)
            """, f"Agent on {node_id} dropped {body['drop_count']} events. Queue depth: {body.get('queue_depth', 'unknown')}",
                min(body["drop_count"] / 10, 100), node_id)
        return {"status": "ok"}

# ============================================================
# E21 Story #86: Unified Event Schema (Normalizer)
# ============================================================

@app.post("/api/v1/ingest/events/normalized", dependencies=[Depends(verify_api_key)])
async def ingest_normalized_events(req: Request):
    """Batch ingest with full normalized schema support.
    
    Accepts events with rich structure: user{}, process{}, file{}, network{} sub-objects.
    Flattens into events_normalized or file_events based on event_type.
    """
    body = await req.json()
    events = body.get("events", [body] if "event_type" in body else [])
    inserted = 0
    findings_created = 0
    
    async with db_pool.acquire() as conn:
        for evt in events:
            event_type = evt.get("event_type", "unknown")
            event_subtype = evt.get("event_subtype", "")
            node_id = evt.get("node_id")
            
            # Extract user info
            user = evt.get("user", {})
            user_id = user.get("username") or user.get("sid") or user.get("uid") or evt.get("user_id")
            
            # Build enriched payload (keep process, network, raw_event_ref)
            payload = {}
            for key in ("process", "network", "user", "raw_event_ref", "metadata"):
                if key in evt:
                    payload[key] = evt[key]
            if event_subtype:
                payload["event_subtype"] = event_subtype
            # Merge any extra fields
            for key in evt:
                if key not in ("event_type", "event_subtype", "node_id", "user_id", "severity",
                               "timestamp", "process", "network", "user", "file", "raw_event_ref",
                               "metadata", "agent_id", "tenant_id"):
                    payload[key] = evt[key]
            
            severity = evt.get("severity", "info")
            ts = evt.get("timestamp")  # Optional: agent-provided timestamp
            
            # Route file events to file_events table
            if event_type.startswith("file.") or (event_type == "file" and event_subtype):
                file_info = evt.get("file", {})
                op = event_subtype or file_info.get("operation") or event_type
                proc = evt.get("process", {})
                
                if ts:
                    await conn.execute("""
                        INSERT INTO file_events (ts, node_id, user_id, op, path, old_path, new_path,
                            process_name, pid, hash_before, hash_after, file_size, success)
                        VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    """, ts, node_id, user_id, op,
                        file_info.get("path") or file_info.get("normalized_path"),
                        file_info.get("old_path"), file_info.get("new_path"),
                        proc.get("name"), proc.get("pid"),
                        file_info.get("hash_before"), file_info.get("hash_after"),
                        file_info.get("size"), evt.get("success", True))
                else:
                    await conn.execute("""
                        INSERT INTO file_events (node_id, user_id, op, path, old_path, new_path,
                            process_name, pid, hash_before, hash_after, file_size, success)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """, node_id, user_id, op,
                        file_info.get("path") or file_info.get("normalized_path"),
                        file_info.get("old_path"), file_info.get("new_path"),
                        proc.get("name"), proc.get("pid"),
                        file_info.get("hash_before"), file_info.get("hash_after"),
                        file_info.get("size"), evt.get("success", True))
            else:
                if ts:
                    await conn.execute("""
                        INSERT INTO events_normalized (ts, node_id, user_id, event_type, severity, payload)
                        VALUES ($1::timestamptz, $2, $3, $4, $5, $6::jsonb)
                    """, ts, node_id, user_id, event_type, severity, json.dumps(payload))
                else:
                    await conn.execute("""
                        INSERT INTO events_normalized (node_id, user_id, event_type, severity, payload)
                        VALUES ($1, $2, $3, $4, $5::jsonb)
                    """, node_id, user_id, event_type, severity, json.dumps(payload))
            
            inserted += 1
    
    return {"inserted": inserted, "findings_created": findings_created}

# ============================================================
# E21 Story #83: Monitoring Health Panel (per Node)
# ============================================================

@app.get("/api/v1/agents/{node_id}/health/history", dependencies=[Depends(verify_api_key)])
async def get_agent_health_history(node_id: str, limit: int = 50):
    """Get recent health reports for a node."""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ts, payload FROM events_normalized
            WHERE node_id = $1 AND event_type = 'agent.health'
            ORDER BY ts DESC LIMIT $2
        """, node_id, limit)
        return {"history": [{"ts": str(r["ts"]), **json.loads(r["payload"])} if isinstance(r["payload"], str) else {"ts": str(r["ts"]), **r["payload"]} for r in rows]}

# ============================================================
# E21 Story #84: Baseline Inventory & Config Posture Snapshots
# ============================================================

@app.post("/api/v1/posture/snapshots", dependencies=[Depends(verify_api_key)])
async def submit_posture_snapshot(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Agent submits a config posture snapshot"""
    node_id = data.get("nodeId") or data.get("node_id")
    if not node_id:
        raise HTTPException(status_code=400, detail="nodeId required")
    
    snapshot_type = data.get("snapshotType", "full")
    
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO config_posture_snapshots 
                (node_id, snapshot_type, os_info, installed_packages, running_services, config_settings, open_ports)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
            RETURNING id, created_at
        """, node_id, snapshot_type,
            json.dumps(data.get("osInfo", {})),
            json.dumps(data.get("installedPackages", [])),
            json.dumps(data.get("runningServices", [])),
            json.dumps(data.get("configSettings", {})),
            json.dumps(data.get("openPorts", [])))
        
        snapshot_id = str(row["id"])
        
        # Auto-generate diff against previous baseline if this is not the first snapshot
        if snapshot_type == "full":
            prev = await conn.fetchrow("""
                SELECT id, os_info, installed_packages, running_services, config_settings, open_ports
                FROM config_posture_snapshots 
                WHERE node_id = $1 AND id != $2::uuid
                ORDER BY created_at DESC LIMIT 1
            """, node_id, snapshot_id)
            
            if prev:
                diff = _compute_posture_diff(
                    {"osInfo": prev["os_info"], "installedPackages": prev["installed_packages"],
                     "runningServices": prev["running_services"], "configSettings": prev["config_settings"],
                     "openPorts": prev["open_ports"]},
                    {"osInfo": data.get("osInfo", {}), "installedPackages": data.get("installedPackages", []),
                     "runningServices": data.get("runningServices", []), "configSettings": data.get("configSettings", {}),
                     "openPorts": data.get("openPorts", [])}
                )
                if diff["changes"]:
                    severity = "info"
                    if any(c.get("severity") == "critical" for c in diff["changes"]):
                        severity = "critical"
                    elif any(c.get("severity") == "high" for c in diff["changes"]):
                        severity = "high"
                    elif any(c.get("severity") == "medium" for c in diff["changes"]):
                        severity = "medium"
                    
                    await conn.execute("""
                        INSERT INTO config_posture_diffs (node_id, baseline_snapshot_id, current_snapshot_id, diff_data, severity)
                        VALUES ($1, $2::uuid, $3::uuid, $4::jsonb, $5)
                    """, node_id, str(prev["id"]), snapshot_id, json.dumps(diff), severity)
        
        return {"id": snapshot_id, "createdAt": str(row["created_at"]), "type": snapshot_type}


def _compute_posture_diff(baseline: dict, current: dict) -> dict:
    """Compute structured diff between two posture snapshots"""
    changes = []
    
    # OS info changes
    b_os = baseline.get("osInfo") or {}
    c_os = current.get("osInfo") or {}
    if isinstance(b_os, str):
        try: b_os = json.loads(b_os)
        except: b_os = {}
    if isinstance(c_os, str):
        try: c_os = json.loads(c_os)
        except: c_os = {}
    for key in set(list(b_os.keys()) + list(c_os.keys())):
        if b_os.get(key) != c_os.get(key):
            changes.append({"category": "os", "field": key, "old": b_os.get(key), "new": c_os.get(key), "severity": "medium"})
    
    # Installed packages diff
    b_pkgs = set()
    c_pkgs = set()
    b_pkg_list = baseline.get("installedPackages") or []
    c_pkg_list = current.get("installedPackages") or []
    if isinstance(b_pkg_list, str):
        try: b_pkg_list = json.loads(b_pkg_list)
        except: b_pkg_list = []
    if isinstance(c_pkg_list, str):
        try: c_pkg_list = json.loads(c_pkg_list)
        except: c_pkg_list = []
    for p in b_pkg_list:
        name = p.get("name", p) if isinstance(p, dict) else str(p)
        b_pkgs.add(name)
    for p in c_pkg_list:
        name = p.get("name", p) if isinstance(p, dict) else str(p)
        c_pkgs.add(name)
    
    for pkg in c_pkgs - b_pkgs:
        changes.append({"category": "packages", "change": "added", "name": pkg, "severity": "low"})
    for pkg in b_pkgs - c_pkgs:
        changes.append({"category": "packages", "change": "removed", "name": pkg, "severity": "medium"})
    
    # Services diff
    b_svcs = set()
    c_svcs = set()
    b_svc_list = baseline.get("runningServices") or []
    c_svc_list = current.get("runningServices") or []
    if isinstance(b_svc_list, str):
        try: b_svc_list = json.loads(b_svc_list)
        except: b_svc_list = []
    if isinstance(c_svc_list, str):
        try: c_svc_list = json.loads(c_svc_list)
        except: c_svc_list = []
    for s in b_svc_list:
        name = s.get("name", s) if isinstance(s, dict) else str(s)
        b_svcs.add(name)
    for s in c_svc_list:
        name = s.get("name", s) if isinstance(s, dict) else str(s)
        c_svcs.add(name)
    
    for svc in c_svcs - b_svcs:
        changes.append({"category": "services", "change": "started", "name": svc, "severity": "low"})
    for svc in b_svcs - c_svcs:
        changes.append({"category": "services", "change": "stopped", "name": svc, "severity": "medium"})
    
    # Config setting changes (SSH, RDP, SMB, firewall, local admins)
    b_cfg = baseline.get("configSettings") or {}
    c_cfg = current.get("configSettings") or {}
    if isinstance(b_cfg, str):
        try: b_cfg = json.loads(b_cfg)
        except: b_cfg = {}
    if isinstance(c_cfg, str):
        try: c_cfg = json.loads(c_cfg)
        except: c_cfg = {}
    
    security_critical = {"rdpEnabled", "sshEnabled", "firewallEnabled", "guestAccount", "autoLogin"}
    for key in set(list(b_cfg.keys()) + list(c_cfg.keys())):
        if b_cfg.get(key) != c_cfg.get(key):
            sev = "high" if key in security_critical else "medium"
            changes.append({"category": "config", "field": key, "old": b_cfg.get(key), "new": c_cfg.get(key), "severity": sev})
    
    # Open ports diff
    b_ports = set()
    c_ports = set()
    b_port_list = baseline.get("openPorts") or []
    c_port_list = current.get("openPorts") or []
    if isinstance(b_port_list, str):
        try: b_port_list = json.loads(b_port_list)
        except: b_port_list = []
    if isinstance(c_port_list, str):
        try: c_port_list = json.loads(c_port_list)
        except: c_port_list = []
    for p in b_port_list:
        port_key = f"{p.get('port','?')}/{p.get('protocol','tcp')}" if isinstance(p, dict) else str(p)
        b_ports.add(port_key)
    for p in c_port_list:
        port_key = f"{p.get('port','?')}/{p.get('protocol','tcp')}" if isinstance(p, dict) else str(p)
        c_ports.add(port_key)
    
    for port in c_ports - b_ports:
        changes.append({"category": "ports", "change": "opened", "port": port, "severity": "high"})
    for port in b_ports - c_ports:
        changes.append({"category": "ports", "change": "closed", "port": port, "severity": "info"})
    
    return {"changes": changes, "totalChanges": len(changes)}


@app.get("/api/v1/posture/snapshots/{node_id}")
async def get_posture_snapshots(node_id: str, limit: int = 10, db: asyncpg.Pool = Depends(get_db)):
    """Get posture snapshots for a node"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, node_id, snapshot_type, os_info, installed_packages, running_services,
                   config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1)
            ORDER BY created_at DESC LIMIT $2
        """, node_id, limit)
        
        snapshots = []
        for r in rows:
            snapshots.append({
                "id": str(r["id"]),
                "nodeId": r["node_id"],
                "snapshotType": r["snapshot_type"],
                "osInfo": json.loads(r["os_info"]) if isinstance(r["os_info"], str) else r["os_info"],
                "installedPackages": json.loads(r["installed_packages"]) if isinstance(r["installed_packages"], str) else r["installed_packages"],
                "runningServices": json.loads(r["running_services"]) if isinstance(r["running_services"], str) else r["running_services"],
                "configSettings": json.loads(r["config_settings"]) if isinstance(r["config_settings"], str) else r["config_settings"],
                "openPorts": json.loads(r["open_ports"]) if isinstance(r["open_ports"], str) else r["open_ports"],
                "createdAt": str(r["created_at"])
            })
        return {"snapshots": snapshots}


@app.get("/api/v1/posture/snapshots/{node_id}/latest")
async def get_latest_posture(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get latest posture snapshot for a node"""
    async with db.acquire() as conn:
        r = await conn.fetchrow("""
            SELECT id, node_id, snapshot_type, os_info, installed_packages, running_services,
                   config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1)
            ORDER BY created_at DESC LIMIT 1
        """, node_id)
        
        if not r:
            return {"snapshot": None}
        
        return {"snapshot": {
            "id": str(r["id"]),
            "nodeId": r["node_id"],
            "snapshotType": r["snapshot_type"],
            "osInfo": json.loads(r["os_info"]) if isinstance(r["os_info"], str) else r["os_info"],
            "installedPackages": json.loads(r["installed_packages"]) if isinstance(r["installed_packages"], str) else r["installed_packages"],
            "runningServices": json.loads(r["running_services"]) if isinstance(r["running_services"], str) else r["running_services"],
            "configSettings": json.loads(r["config_settings"]) if isinstance(r["config_settings"], str) else r["config_settings"],
            "openPorts": json.loads(r["open_ports"]) if isinstance(r["open_ports"], str) else r["open_ports"],
            "createdAt": str(r["created_at"])
        }}


@app.get("/api/v1/posture/diffs/{node_id}")
async def get_posture_diffs(node_id: str, limit: int = 20, db: asyncpg.Pool = Depends(get_db)):
    """Get config posture diffs for a node"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, node_id, baseline_snapshot_id, current_snapshot_id, diff_data, severity, created_at
            FROM config_posture_diffs
            WHERE UPPER(node_id) = UPPER($1)
            ORDER BY created_at DESC LIMIT $2
        """, node_id, limit)
        
        return {"diffs": [{
            "id": str(r["id"]),
            "nodeId": r["node_id"],
            "baselineSnapshotId": str(r["baseline_snapshot_id"]) if r["baseline_snapshot_id"] else None,
            "currentSnapshotId": str(r["current_snapshot_id"]) if r["current_snapshot_id"] else None,
            "diffData": json.loads(r["diff_data"]) if isinstance(r["diff_data"], str) else r["diff_data"],
            "severity": r["severity"],
            "createdAt": str(r["created_at"])
        } for r in rows]}


@app.get("/api/v1/posture/compare/{node_id}")
async def compare_posture(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Compare baseline (oldest) vs current (latest) snapshot for a node"""
    async with db.acquire() as conn:
        baseline = await conn.fetchrow("""
            SELECT id, os_info, installed_packages, running_services, config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1) AND snapshot_type = 'full'
            ORDER BY created_at ASC LIMIT 1
        """, node_id)
        
        current = await conn.fetchrow("""
            SELECT id, os_info, installed_packages, running_services, config_settings, open_ports, created_at
            FROM config_posture_snapshots
            WHERE UPPER(node_id) = UPPER($1) AND snapshot_type = 'full'
            ORDER BY created_at DESC LIMIT 1
        """, node_id)
        
        if not baseline or not current:
            return {"baseline": None, "current": None, "diff": None, "message": "Need at least 2 snapshots to compare"}
        
        if str(baseline["id"]) == str(current["id"]):
            return {"baseline": str(baseline["id"]), "current": str(current["id"]), "diff": {"changes": [], "totalChanges": 0}, "message": "Only one snapshot exists"}
        
        def parse(v):
            return json.loads(v) if isinstance(v, str) else v
        
        diff = _compute_posture_diff(
            {"osInfo": parse(baseline["os_info"]), "installedPackages": parse(baseline["installed_packages"]),
             "runningServices": parse(baseline["running_services"]), "configSettings": parse(baseline["config_settings"]),
             "openPorts": parse(baseline["open_ports"])},
            {"osInfo": parse(current["os_info"]), "installedPackages": parse(current["installed_packages"]),
             "runningServices": parse(current["running_services"]), "configSettings": parse(current["config_settings"]),
             "openPorts": parse(current["open_ports"])}
        )
        
        return {
            "baselineId": str(baseline["id"]),
            "baselineDate": str(baseline["created_at"]),
            "currentId": str(current["id"]),
            "currentDate": str(current["created_at"]),
            "diff": diff
        }

# ============================================================
# E21 Story #85: Vulnerability Scan & CVE Mapping (Fleet View)
# ============================================================

@app.get("/api/v1/security/vulnerabilities/fleet")
async def fleet_vulnerability_summary(db: asyncpg.Pool = Depends(get_db)):
    """Fleet-wide vulnerability aggregation"""
    async with db.acquire() as conn:
        # By severity
        by_severity = await conn.fetch("""
            SELECT v.severity, COUNT(*) as count 
            FROM node_vulnerabilities nv
            JOIN vulnerabilities v ON v.id = nv.vulnerability_id
            GROUP BY v.severity ORDER BY 
                CASE v.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END
        """)
        
        # By node
        by_node = await conn.fetch("""
            SELECT nv.node_id, 
                   COUNT(*) as total,
                   COUNT(*) FILTER (WHERE v.severity = 'critical') as critical,
                   COUNT(*) FILTER (WHERE v.severity = 'high') as high
            FROM node_vulnerabilities nv
            JOIN vulnerabilities v ON v.id = nv.vulnerability_id
            GROUP BY nv.node_id ORDER BY critical DESC, high DESC, total DESC
        """)
        
        # Top CVEs across fleet
        top_cves = await conn.fetch("""
            SELECT v.cve_id, v.severity, v.software_name as package_name, 
                   COUNT(DISTINCT nv.node_id) as affected_nodes,
                   MAX(v.cvss_score) as cvss_score,
                   MAX(v.description) as description
            FROM node_vulnerabilities nv
            JOIN vulnerabilities v ON v.id = nv.vulnerability_id
            WHERE v.cve_id IS NOT NULL
            GROUP BY v.cve_id, v.severity, v.software_name
            ORDER BY 
                CASE v.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                affected_nodes DESC
            LIMIT 50
        """)
        
        # By package
        by_package = await conn.fetch("""
            SELECT v.software_name as package_name, COUNT(*) as vuln_count,
                   COUNT(DISTINCT nv.node_id) as affected_nodes,
                   MAX(v.severity) as max_severity
            FROM node_vulnerabilities nv
            JOIN vulnerabilities v ON v.id = nv.vulnerability_id
            GROUP BY v.software_name
            ORDER BY vuln_count DESC LIMIT 30
        """)
        
        total = await conn.fetchval("SELECT COUNT(*) FROM node_vulnerabilities")
        total_nodes = await conn.fetchval("SELECT COUNT(DISTINCT node_id) FROM node_vulnerabilities")
        
        return {
            "total": total,
            "affectedNodes": total_nodes,
            "bySeverity": [{"severity": r["severity"], "count": r["count"]} for r in by_severity],
            "byNode": [{"nodeId": r["node_id"], "total": r["total"], "critical": r["critical"], "high": r["high"]} for r in by_node],
            "topCves": [{
                "cveId": r["cve_id"], "severity": r["severity"], "packageName": r["package_name"],
                "affectedNodes": r["affected_nodes"], "cvssScore": float(r["cvss_score"]) if r["cvss_score"] else None,
                "description": r["description"]
            } for r in top_cves],
            "byPackage": [{"packageName": r["package_name"], "vulnCount": r["vuln_count"], 
                          "affectedNodes": r["affected_nodes"], "maxSeverity": r["max_severity"]} for r in by_package]
        }

# ============================================================
# E21: Monitoring Profiles & Assignments
# ============================================================

@app.get("/api/v1/security/monitoring/profiles", dependencies=[Depends(verify_api_key)])
async def list_monitoring_profiles(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM monitoring_profiles ORDER BY created_at DESC")
        return {"profiles": [dict(r) for r in rows]}

@app.post("/api/v1/security/monitoring/profiles", dependencies=[Depends(verify_api_key)])
async def create_monitoring_profile(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO monitoring_profiles (name, description, version, sensors, sampling, include_paths, exclude_paths, created_by)
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8) RETURNING *
        """, data.get("name"), data.get("description"), data.get("version", 1),
            json.dumps(data.get("sensors", {})), json.dumps(data.get("sampling", {})),
            json.dumps(data.get("includePaths", [])), json.dumps(data.get("excludePaths", [])),
            data.get("createdBy"))
        return dict(row)

@app.put("/api/v1/security/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def update_monitoring_profile(profile_id: str, req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        updates, params, idx = [], [profile_id], 2
        for field, col in [("name","name"),("description","description"),("version","version")]:
            if field in data:
                updates.append(f"{col} = ${idx}")
                params.append(data[field])
                idx += 1
        for field, col in [("sensors","sensors"),("sampling","sampling"),("includePaths","include_paths"),("excludePaths","exclude_paths")]:
            if field in data:
                updates.append(f"{col} = ${idx}::jsonb")
                params.append(json.dumps(data[field]))
                idx += 1
        if updates:
            updates.append("updated_at = NOW()")
            await conn.execute(f"UPDATE monitoring_profiles SET {', '.join(updates)} WHERE id = $1::uuid", *params)
        return {"updated": True}

@app.delete("/api/v1/security/monitoring/profiles/{profile_id}", dependencies=[Depends(verify_api_key)])
async def delete_monitoring_profile(profile_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM monitoring_profiles WHERE id = $1::uuid", profile_id)
        return {"deleted": True}

@app.get("/api/v1/security/monitoring/assignments", dependencies=[Depends(verify_api_key)])
async def list_monitoring_assignments(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ma.*, mp.name as profile_name FROM monitoring_assignments ma
            LEFT JOIN monitoring_profiles mp ON mp.id = ma.profile_id
            ORDER BY ma.created_at DESC
        """)
        return {"assignments": [dict(r) for r in rows]}

@app.post("/api/v1/security/monitoring/assignments", dependencies=[Depends(verify_api_key)])
async def create_monitoring_assignment(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO monitoring_assignments (target_type, target_id, profile_id, profile_version, priority, status)
            VALUES ($1, $2, $3::uuid, $4, $5, $6) RETURNING *
        """, data.get("targetType", "node"), data.get("targetId"),
            data.get("profileId"), data.get("profileVersion", 1),
            data.get("priority", 0), data.get("status", "active"))
        return dict(row)

@app.delete("/api/v1/security/monitoring/assignments/{assignment_id}", dependencies=[Depends(verify_api_key)])
async def delete_monitoring_assignment(assignment_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM monitoring_assignments WHERE id = $1::uuid", assignment_id)
        return {"deleted": True}

# ============================================================
# E21: Posture Snapshots & Diffs
# ============================================================

@app.get("/api/v1/security/posture/snapshots", dependencies=[Depends(verify_api_key)])
async def list_posture_snapshots(node_id: str = None, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        if node_id:
            rows = await conn.fetch("SELECT * FROM config_posture_snapshots WHERE node_id = $1 ORDER BY created_at DESC LIMIT $2", node_id, limit)
        else:
            rows = await conn.fetch("SELECT * FROM config_posture_snapshots ORDER BY created_at DESC LIMIT $1", limit)
        return {"snapshots": [dict(r) for r in rows]}

@app.post("/api/v1/security/posture/snapshots", dependencies=[Depends(verify_api_key)])
async def create_posture_snapshot(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO config_posture_snapshots (node_id, snapshot_type, os_info, installed_packages, running_services, config_settings, open_ports)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb) RETURNING *
        """, data.get("nodeId"), data.get("snapshotType", "full"),
            json.dumps(data.get("osInfo", {})), json.dumps(data.get("installedPackages", [])),
            json.dumps(data.get("runningServices", [])), json.dumps(data.get("configSettings", {})),
            json.dumps(data.get("openPorts", [])))
        return dict(row)

@app.get("/api/v1/security/posture/diffs", dependencies=[Depends(verify_api_key)])
async def list_posture_diffs(node_id: str = None, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        if node_id:
            rows = await conn.fetch("SELECT * FROM config_posture_diffs WHERE node_id = $1 ORDER BY created_at DESC LIMIT $2", node_id, limit)
        else:
            rows = await conn.fetch("SELECT * FROM config_posture_diffs ORDER BY created_at DESC LIMIT $1", limit)
        return {"diffs": [dict(r) for r in rows]}

# ============================================================
# E21: Events (normalized) & File Events
# ============================================================

@app.get("/api/v1/security/events", dependencies=[Depends(verify_api_key)])
async def list_security_events(node_id: str = None, event_type: str = None, severity: str = None,
                                hours: int = 24, limit: int = 100, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        where = "WHERE ts > NOW() - INTERVAL '1 hour' * $1"
        params = [hours]
        idx = 2
        if node_id:
            where += f" AND node_id = ${idx}"; params.append(node_id); idx += 1
        if event_type:
            where += f" AND event_type = ${idx}"; params.append(event_type); idx += 1
        if severity:
            where += f" AND severity = ${idx}"; params.append(severity); idx += 1
        rows = await conn.fetch(f"SELECT * FROM events_normalized {where} ORDER BY ts DESC LIMIT ${idx}", *params, limit)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM events_normalized {where}", *params)
        return {"events": [dict(r) for r in rows], "total": total}

@app.get("/api/v1/security/file-events", dependencies=[Depends(verify_api_key)])
async def list_file_events(node_id: str = None, op: str = None, path_filter: str = None,
                           hours: int = 24, limit: int = 100, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        where = "WHERE ts > NOW() - INTERVAL '1 hour' * $1"
        params = [hours]
        idx = 2
        if node_id:
            where += f" AND node_id = ${idx}"; params.append(node_id); idx += 1
        if op:
            where += f" AND op = ${idx}"; params.append(op); idx += 1
        if path_filter:
            where += f" AND path ILIKE ${idx}"; params.append(f"%{path_filter}%"); idx += 1
        rows = await conn.fetch(f"SELECT * FROM file_events {where} ORDER BY ts DESC LIMIT ${idx}", *params, limit)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM file_events {where}", *params)
        return {"events": [dict(r) for r in rows], "total": total}

# ============================================================
# E21: Evidence Export
# ============================================================

@app.get("/api/v1/security/evidence/export", dependencies=[Depends(verify_api_key)])
async def export_evidence(node_id: str = None, hours: int = 24, db: asyncpg.Pool = Depends(get_db)):
    """Export security evidence package (events + file events + findings) as JSON"""
    async with db.acquire() as conn:
        params_ev = [hours]
        filter_ev = "WHERE ts > NOW() - INTERVAL '1 hour' * $1"
        if node_id:
            filter_ev += " AND node_id = $2"; params_ev.append(node_id)

        events = await conn.fetch(f"SELECT * FROM events_normalized {filter_ev} ORDER BY ts DESC LIMIT 10000", *params_ev)
        file_evts = await conn.fetch(f"SELECT * FROM file_events {filter_ev} ORDER BY ts DESC LIMIT 10000", *params_ev)

        params_f = []
        filter_f = "WHERE 1=1"
        if node_id:
            filter_f += " AND node_id = $1"; params_f.append(node_id)
        findings = await conn.fetch(f"SELECT * FROM security_findings {filter_f} ORDER BY created_at DESC LIMIT 1000", *params_f)

        return {
            "exportedAt": str(datetime.now(timezone.utc)),
            "hours": hours,
            "nodeId": node_id,
            "events": [dict(r) for r in events],
            "fileEvents": [dict(r) for r in file_evts],
            "findings": [dict(r) for r in findings]
        }

# ============================================================
# E21: Agent Capabilities
# ============================================================

@app.get("/api/v1/security/agent/capabilities", dependencies=[Depends(verify_api_key)])
async def list_agent_capabilities(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM agent_capabilities ORDER BY last_seen DESC NULLS LAST")
        return {"capabilities": [dict(r) for r in rows]}

@app.post("/api/v1/security/agent/capabilities", dependencies=[Depends(verify_api_key)])
async def upsert_agent_capabilities(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO agent_capabilities (node_id, sensors, agent_version, os_type, os_version, kernel_build, permissions, last_seen)
            VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::jsonb, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                sensors = EXCLUDED.sensors, agent_version = EXCLUDED.agent_version,
                os_type = EXCLUDED.os_type, os_version = EXCLUDED.os_version,
                kernel_build = EXCLUDED.kernel_build, permissions = EXCLUDED.permissions, last_seen = NOW()
        """, data.get("nodeId"), json.dumps(data.get("sensors", {})),
            data.get("agentVersion"), data.get("osType"), data.get("osVersion"),
            data.get("kernelBuild"), json.dumps(data.get("permissions", {})))
        return {"updated": True}

# ============================================================
# E21: UI Audit Log
# ============================================================

@app.get("/api/v1/security/audit-log", dependencies=[Depends(verify_api_key)])
async def list_ui_audit_events(actor: str = None, action: str = None,
                                hours: int = 168, limit: int = 100, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        where = "WHERE ts > NOW() - INTERVAL '1 hour' * $1"
        params = [hours]
        idx = 2
        if actor:
            where += f" AND actor_user_id = ${idx}"; params.append(actor); idx += 1
        if action:
            where += f" AND action = ${idx}"; params.append(action); idx += 1
        rows = await conn.fetch(f"SELECT * FROM ui_audit_events {where} ORDER BY ts DESC LIMIT ${idx}", *params, limit)
        return {"events": [dict(r) for r in rows]}

@app.post("/api/v1/security/audit-log", dependencies=[Depends(verify_api_key)])
async def create_ui_audit_event(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO ui_audit_events (actor_user_id, action, object_type, object_id, details)
            VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *
        """, data.get("actor"), data.get("action"), data.get("objectType"),
            data.get("objectId"), json.dumps(data.get("details", {})))
        return dict(row)

# ============================================================
# E21: Detection Rules
# ============================================================

@app.get("/api/v1/security/detection-rules", dependencies=[Depends(verify_api_key)])
async def list_detection_rules(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM detection_rules ORDER BY rule_order, created_at DESC")
        return {"rules": [dict(r) for r in rows]}

@app.post("/api/v1/security/detection-rules", dependencies=[Depends(verify_api_key)])
async def create_detection_rule(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO detection_rules (package_version_id, rule_order, rule_type, config, operator)
            VALUES ($1::uuid, $2, $3, $4::jsonb, $5) RETURNING *
        """, data.get("packageVersionId"), data.get("ruleOrder", 0),
            data.get("ruleType"), json.dumps(data.get("config", {})),
            data.get("operator", "AND"))
        return dict(row)

# ============================================================
# E21: Retention Policies & Legal Holds
# ============================================================

@app.get("/api/v1/security/retention/policies", dependencies=[Depends(verify_api_key)])
async def list_retention_policies(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        try:
            rows = await conn.fetch("SELECT * FROM retention_policies ORDER BY created_at DESC")
            return {"policies": [dict(r) for r in rows]}
        except Exception:
            return {"policies": [], "note": "retention_policies table not yet created"}

@app.post("/api/v1/security/retention/policies", dependencies=[Depends(verify_api_key)])
async def create_retention_policy(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow("""
                INSERT INTO retention_policies (name, table_name, retention_days, enabled, created_by)
                VALUES ($1, $2, $3, $4, $5) RETURNING *
            """, data.get("name"), data.get("tableName"), data.get("retentionDays", 90),
                data.get("enabled", True), data.get("createdBy"))
            return dict(row)
        except Exception as e:
            return {"error": str(e), "note": "retention_policies table may not exist yet"}

@app.get("/api/v1/security/retention/holds", dependencies=[Depends(verify_api_key)])
async def list_legal_holds(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        try:
            rows = await conn.fetch("SELECT * FROM legal_holds ORDER BY created_at DESC")
            return {"holds": [dict(r) for r in rows]}
        except Exception:
            return {"holds": [], "note": "legal_holds table not yet created"}

@app.post("/api/v1/security/retention/holds", dependencies=[Depends(verify_api_key)])
async def create_legal_hold(req: Request, db: asyncpg.Pool = Depends(get_db)):
    data = await req.json()
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow("""
                INSERT INTO legal_holds (name, reason, table_names, node_ids, date_from, date_to, created_by)
                VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7) RETURNING *
            """, data.get("name"), data.get("reason"),
                json.dumps(data.get("tableNames", [])), json.dumps(data.get("nodeIds", [])),
                data.get("dateFrom"), data.get("dateTo"), data.get("createdBy"))
            return dict(row)
        except Exception as e:
            return {"error": str(e), "note": "legal_holds table may not exist yet"}

# ============================================================
# E21 Story #89: Behavior Rules - Policy Engine (MVP)
# ============================================================

@app.get("/api/v1/security/rules")
async def list_behavior_rules(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM behavior_rules ORDER BY created_at DESC")
        return {"rules": [{
            "id": str(r["id"]), "name": r["name"], "description": r["description"],
            "ruleType": r["rule_type"], "conditions": json.loads(r["conditions"]) if isinstance(r["conditions"], str) else r["conditions"],
            "actions": json.loads(r["actions"]) if isinstance(r["actions"], str) else r["actions"],
            "severity": r["severity"], "enabled": r["enabled"],
            "cooldownSeconds": r["cooldown_seconds"], "createdAt": str(r["created_at"])
        } for r in rows]}

@app.post("/api/v1/security/rules")
async def create_behavior_rule(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO behavior_rules (name, description, rule_type, conditions, actions, severity, enabled, cooldown_seconds, created_by)
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
            RETURNING id, created_at
        """, data.get("name", ""), data.get("description"),
            data.get("ruleType", "threshold"),
            json.dumps(data.get("conditions", {})),
            json.dumps(data.get("actions", [])),
            data.get("severity", "medium"),
            data.get("enabled", True),
            data.get("cooldownSeconds", 300),
            data.get("createdBy", "api"))
        return {"id": str(row["id"]), "createdAt": str(row["created_at"])}

@app.put("/api/v1/security/rules/{rule_id}")
async def update_behavior_rule(rule_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        await conn.execute("""
            UPDATE behavior_rules SET name=$2, description=$3, rule_type=$4, conditions=$5::jsonb,
                actions=$6::jsonb, severity=$7, enabled=$8, cooldown_seconds=$9, updated_at=NOW()
            WHERE id=$1::uuid
        """, rule_id, data.get("name"), data.get("description"),
            data.get("ruleType", "threshold"),
            json.dumps(data.get("conditions", {})),
            json.dumps(data.get("actions", [])),
            data.get("severity", "medium"),
            data.get("enabled", True),
            data.get("cooldownSeconds", 300))
        return {"updated": True}

@app.delete("/api/v1/security/rules/{rule_id}")
async def delete_behavior_rule(rule_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM behavior_rules WHERE id = $1::uuid", rule_id)
        return {"deleted": True}

@app.post("/api/v1/security/rules/evaluate")
async def evaluate_rules(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Evaluate all enabled behavior rules against recent events. Called periodically or on-demand."""
    async with db.acquire() as conn:
        rules = await conn.fetch("SELECT * FROM behavior_rules WHERE enabled = true")
        findings_created = 0
        
        for rule in rules:
            conditions = json.loads(rule["conditions"]) if isinstance(rule["conditions"], str) else rule["conditions"]
            actions = json.loads(rule["actions"]) if isinstance(rule["actions"], str) else rule["actions"]
            rule_type = rule["rule_type"]
            
            # Check cooldown
            last_finding = await conn.fetchval("""
                SELECT MAX(created_at) FROM security_findings WHERE rule_id = $1::uuid
            """, str(rule["id"]))
            if last_finding:
                from datetime import timezone
                cooldown = rule["cooldown_seconds"] or 300
                if last_finding.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc) - timedelta(seconds=cooldown):
                    continue
            
            triggered = False
            matched_events = []
            affected_node = None
            affected_user = None
            
            if rule_type == "threshold":
                # Count events matching criteria in time window
                event_type = conditions.get("eventType", "%")
                time_window = conditions.get("timeWindowSeconds", 600)
                threshold = conditions.get("threshold", 100)
                path_pattern = conditions.get("pathPattern")
                
                query = """
                    SELECT COUNT(*), MAX(node_id) as node_id
                    FROM events_normalized
                    WHERE ts > NOW() - INTERVAL '1 second' * $1
                      AND event_type LIKE $2
                """
                params = [time_window, event_type]
                if path_pattern:
                    query += " AND payload::text ~* $3"
                    params.append(path_pattern)
                
                row = await conn.fetchrow(query, *params)
                if row and row["count"] >= threshold:
                    triggered = True
                    affected_node = row["node_id"]
            
            elif rule_type == "pattern":
                # Match specific patterns in recent events
                pattern = conditions.get("pattern", "")
                lookback = conditions.get("lookbackSeconds", 300)
                
                rows = await conn.fetch("""
                    SELECT id, node_id, payload FROM events_normalized
                    WHERE ts > NOW() - INTERVAL '1 second' * $1
                      AND (payload::text ~* $2 OR event_type ~* $2)
                    LIMIT 10
                """, lookback, pattern)
                
                if rows:
                    triggered = True
                    affected_node = rows[0]["node_id"]
                    matched_events = [str(r["id"]) for r in rows]
            
            elif rule_type == "time":
                # Events outside business hours
                start_hour = conditions.get("businessHoursStart", 8)
                end_hour = conditions.get("businessHoursEnd", 18)
                event_type = conditions.get("eventType", "file.%")
                
                rows = await conn.fetch("""
                    SELECT id, node_id FROM events_normalized
                    WHERE ts > NOW() - INTERVAL '5 minutes'
                      AND event_type LIKE $1
                      AND (EXTRACT(HOUR FROM ts) < $2 OR EXTRACT(HOUR FROM ts) >= $3)
                    LIMIT 10
                """, event_type, start_hour, end_hour)
                
                if rows:
                    triggered = True
                    affected_node = rows[0]["node_id"]
                    matched_events = [str(r["id"]) for r in rows]
            
            if triggered:
                # Create finding
                title = f"Rule triggered: {rule['name']}"
                for action in actions:
                    if action.get("type") == "create_finding":
                        title = action.get("title", title)
                
                await conn.execute("""
                    INSERT INTO security_findings (title, finding_type, severity, node_id, user_name, 
                        rule_id, description, risk_score)
                    VALUES ($1, 'policy_violation', $2, $3, $4, $5::uuid, $6, $7)
                """, title, rule["severity"], affected_node, affected_user,
                    str(rule["id"]),
                    f"Behavior rule '{rule['name']}' ({rule_type}) triggered",
                    _calculate_risk_score(rule["severity"], len(matched_events)))
                findings_created += 1
        
        return {"evaluated": len(rules), "findingsCreated": findings_created}


def _calculate_risk_score(severity: str, event_count: int = 1) -> float:
    """Calculate risk score based on severity and frequency"""
    base = {"critical": 9.0, "high": 7.0, "medium": 5.0, "low": 3.0, "info": 1.0}.get(severity, 5.0)
    frequency_factor = min(1.0 + (event_count * 0.1), 2.0)
    return round(min(base * frequency_factor, 10.0), 1)


# ============================================================
# E21 Story #90: Findings & Risk Scoring
# ============================================================

@app.get("/api/v1/security/findings")
async def list_findings(
    status: str = None, severity: str = None, node_id: str = None,
    limit: int = 50, offset: int = 0,
    db: asyncpg.Pool = Depends(get_db)
):
    async with db.acquire() as conn:
        query = "SELECT * FROM security_findings WHERE 1=1"
        params = []
        idx = 1
        
        if status:
            query += f" AND status = ${idx}"
            params.append(status)
            idx += 1
        if severity:
            query += f" AND severity = ${idx}"
            params.append(severity)
            idx += 1
        if node_id:
            query += f" AND UPPER(node_id) = UPPER(${idx})"
            params.append(node_id)
            idx += 1
        
        count = await conn.fetchval(query.replace("SELECT *", "SELECT COUNT(*)"), *params)
        
        query += f" ORDER BY risk_score DESC, created_at DESC LIMIT ${idx} OFFSET ${idx+1}"
        params.extend([limit, offset])
        
        rows = await conn.fetch(query, *params)
        return {
            "findings": [{
                "id": str(r["id"]), "title": r["title"], "findingType": r["finding_type"],
                "severity": r["severity"], "riskScore": r["risk_score"], "status": r["status"],
                "nodeId": r["node_id"], "userName": r["user_name"],
                "ruleId": str(r["rule_id"]) if r["rule_id"] else None,
                "description": r["description"], "remediation": r["remediation"],
                "firstSeen": str(r["first_seen"]), "lastSeen": str(r["last_seen"]),
                "closedAt": str(r["closed_at"]) if r["closed_at"] else None,
                "createdAt": str(r["created_at"])
            } for r in rows],
            "total": count
        }

@app.get("/api/v1/security/findings/summary")
async def findings_summary(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        by_status = await conn.fetch("SELECT status, COUNT(*) as count FROM security_findings GROUP BY status")
        by_severity = await conn.fetch("SELECT severity, COUNT(*) as count FROM security_findings GROUP BY severity")
        by_type = await conn.fetch("SELECT finding_type, COUNT(*) as count FROM security_findings GROUP BY finding_type")
        top_nodes = await conn.fetch("""
            SELECT node_id, COUNT(*) as count, AVG(risk_score) as avg_risk
            FROM security_findings WHERE status != 'closed'
            GROUP BY node_id ORDER BY count DESC LIMIT 10
        """)
        trend = await conn.fetch("""
            SELECT DATE(created_at) as day, COUNT(*) as count
            FROM security_findings WHERE created_at > NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at) ORDER BY day
        """)
        return {
            "byStatus": [{"status": r["status"], "count": r["count"]} for r in by_status],
            "bySeverity": [{"severity": r["severity"], "count": r["count"]} for r in by_severity],
            "byType": [{"type": r["finding_type"], "count": r["count"]} for r in by_type],
            "topNodes": [{"nodeId": r["node_id"], "count": r["count"], "avgRisk": round(float(r["avg_risk"] or 0), 1)} for r in top_nodes],
            "trend": [{"day": str(r["day"]), "count": r["count"]} for r in trend]
        }

@app.put("/api/v1/security/findings/{finding_id}")
async def update_finding(finding_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        updates = []
        params = [finding_id]
        idx = 2
        
        for field in ["status", "severity", "remediation", "description"]:
            if field in data:
                updates.append(f"{field} = ${idx}")
                params.append(data[field])
                idx += 1
        
        if "status" in data and data["status"] in ("closed", "false_positive"):
            updates.append(f"closed_at = NOW()")
            updates.append(f"closed_by = ${idx}")
            params.append(data.get("closedBy", "api"))
            idx += 1
        
        if updates:
            await conn.execute(f"UPDATE security_findings SET {', '.join(updates)} WHERE id = $1::uuid", *params)
        return {"updated": True}

@app.post("/api/v1/security/findings")
async def create_finding(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        severity = data.get("severity", "medium")
        row = await conn.fetchrow("""
            INSERT INTO security_findings (title, finding_type, severity, risk_score, node_id, user_name, description, remediation)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        """, data.get("title", ""), data.get("findingType", "alert"),
            severity, _calculate_risk_score(severity),
            data.get("nodeId"), data.get("userName"),
            data.get("description"), data.get("remediation"))
        return {"id": str(row["id"])}


# ============================================================
# E21 Story #91: Dashboards - File Activity & User Activity
# ============================================================

@app.get("/api/v1/security/activity/files")
async def file_activity_dashboard(
    node_id: str = None, user: str = None, path_filter: str = None,
    hours: int = 24, limit: int = 100,
    db: asyncpg.Pool = Depends(get_db)
):
    """File activity dashboard data"""
    async with db.acquire() as conn:
        base_filter = "WHERE ts > NOW() - INTERVAL '1 hour' * $1"
        params = [hours]
        idx = 2
        
        if node_id:
            base_filter += f" AND node_id = ${idx}"
            params.append(node_id)
            idx += 1
        
        # Top paths
        top_paths = await conn.fetch(f"""
            SELECT path, COUNT(*) as count, 
                   array_agg(DISTINCT op) as ops
            FROM file_events {base_filter}
            AND path IS NOT NULL
            GROUP BY path
            ORDER BY count DESC LIMIT 20
        """, *params)
        
        # Operations distribution
        ops_dist = await conn.fetch(f"""
            SELECT op as event_type, COUNT(*) as count
            FROM file_events {base_filter}
            GROUP BY op ORDER BY count DESC
        """, *params)
        
        # Timeline (hourly buckets)
        timeline = await conn.fetch(f"""
            SELECT date_trunc('hour', ts) as hour, COUNT(*) as count
            FROM file_events {base_filter}
            GROUP BY date_trunc('hour', ts) ORDER BY hour
        """, *params)
        
        # Top users
        top_users = await conn.fetch(f"""
            SELECT user_id as username, COUNT(*) as count
            FROM file_events {base_filter}
            AND user_id IS NOT NULL
            GROUP BY user_id
            ORDER BY count DESC LIMIT 10
        """, *params)
        
        # Recent events
        limit_param = f"${idx}"
        recent = await conn.fetch(f"""
            SELECT event_id as id, ts, node_id, op as event_type, 
                   path, old_path, new_path, process_name, pid, user_id,
                   hash_before, hash_after, file_size
            FROM file_events {base_filter}
            ORDER BY ts DESC LIMIT {limit_param}
        """, *params, limit)
        
        return {
            "topPaths": [{"path": r["path"], "count": r["count"], "operations": list(r["ops"] or [])} for r in top_paths],
            "operationsDistribution": [{"operation": r["event_type"], "count": r["count"]} for r in ops_dist],
            "timeline": [{"hour": str(r["hour"]), "count": r["count"]} for r in timeline],
            "topUsers": [{"username": r["username"], "count": r["count"]} for r in top_users],
            "recentEvents": [{
                "id": str(r["id"]), "ts": str(r["ts"]), "nodeId": r["node_id"],
                "eventType": r["event_type"],
                "payload": {"path": r["path"], "oldPath": r["old_path"], "newPath": r["new_path"],
                            "process": r["process_name"], "pid": r["pid"], "user": r["user_id"],
                            "hashBefore": r["hash_before"], "hashAfter": r["hash_after"], "size": r["file_size"]}
            } for r in recent]
        }

@app.get("/api/v1/security/activity/users")
async def user_activity_dashboard(
    node_id: str = None, username: str = None, hours: int = 24,
    db: asyncpg.Pool = Depends(get_db)
):
    """User activity dashboard"""
    async with db.acquire() as conn:
        base_filter = "WHERE ts > NOW() - INTERVAL '1 hour' * $1"
        params = [hours]
        idx = 2
        
        if node_id:
            base_filter += f" AND node_id = ${idx}"
            params.append(node_id)
            idx += 1
        
        # User activity summary
        users = await conn.fetch(f"""
            SELECT user_id as username,
                   COUNT(*) as total_events,
                   COUNT(DISTINCT op) as unique_ops,
                   COUNT(DISTINCT path) as unique_files,
                   MIN(ts) as first_activity,
                   MAX(ts) as last_activity
            FROM file_events {base_filter}
            AND user_id IS NOT NULL
            GROUP BY user_id
            ORDER BY total_events DESC LIMIT 20
        """, *params)
        
        # Unusual hours activity (outside 8-18)
        after_hours = await conn.fetch(f"""
            SELECT user_id as username, COUNT(*) as count
            FROM file_events {base_filter}
            AND (EXTRACT(HOUR FROM ts) < 8 OR EXTRACT(HOUR FROM ts) >= 18)
            AND user_id IS NOT NULL
            GROUP BY user_id
            ORDER BY count DESC LIMIT 10
        """, *params)
        
        # Sensitive path access (e.g., /etc, Windows system dirs)
        sensitive = await conn.fetch(f"""
            SELECT user_id as username, path, COUNT(*) as count
            FROM file_events {base_filter}
            AND (path LIKE '/etc/%' OR path LIKE 'C:\\Windows\\%' 
                 OR path LIKE 'C:\\Program Files\\%')
            GROUP BY user_id, path
            ORDER BY count DESC LIMIT 20
        """, *params)
        
        return {
            "users": [{
                "username": r["username"], "totalEvents": r["total_events"],
                "uniqueOps": r["unique_ops"], "uniqueFiles": r["unique_files"],
                "firstActivity": str(r["first_activity"]), "lastActivity": str(r["last_activity"])
            } for r in users],
            "afterHoursActivity": [{"username": r["username"], "count": r["count"]} for r in after_hours],
            "sensitiveAccess": [{"username": r["username"], "path": r["path"], "count": r["count"]} for r in sensitive]
        }

@app.get("/api/v1/security/activity/export")
async def export_file_activity(
    node_id: str = None, hours: int = 24, format: str = "csv",
    db: asyncpg.Pool = Depends(get_db)
):
    """Export file activity as CSV"""
    async with db.acquire() as conn:
        query = "SELECT ts, node_id, op, path, user_id, process_name, file_size, hash_after FROM file_events WHERE ts > NOW() - INTERVAL '1 hour' * $1"
        params = [hours]
        if node_id:
            query += " AND node_id = $2"
            params.append(node_id)
        query += " ORDER BY ts DESC LIMIT 10000"
        
        rows = await conn.fetch(query, *params)
        
        if format == "csv":
            import io
            output = io.StringIO()
            output.write("timestamp,node_id,operation,path,user,file_size,hash\n")
            for r in rows:
                path = r.get("path", "") or ""
                user = r.get("user_id", "") or ""
                size = r.get("file_size", "") or ""
                fhash = r.get("hash_after", "") or ""
                output.write(f'{r["ts"]},"{r["node_id"]}","{r["op"]}","{path}","{user}",{size},"{fhash}"\n')
            
            from starlette.responses import Response
            return Response(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=file-activity-{datetime.now().strftime('%Y%m%d')}.csv"}
            )
        
        return {"events": [{"ts": str(r["ts"]), "nodeId": r["node_id"], "eventType": r["event_type"],
                           "payload": json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"]} for r in rows]}



@app.get("/api/v1/admin/agent-activity")
async def get_agent_activity(limit: int = 100, _: str = Depends(verify_api_key)):
    """Get recent agent activity from in-memory buffer."""
    items = list(_agent_activity_buffer)[-limit:]
    items.reverse()
    return {"events": items, "count": len(items)}


@app.get("/api/v1/admin/agent-status")
async def get_agent_status(_: str = Depends(verify_api_key)):
    """Get live status of all agents with their recent activity."""
    async with db_pool.acquire() as conn:
        nodes = await conn.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.agent_version, n.last_seen, n.is_online,
                   (SELECT COUNT(*) FROM job_instances ji WHERE ji.node_id = n.id::text AND ji.status = 'running') as running_jobs,
                   (SELECT COUNT(*) FROM job_instances ji WHERE ji.node_id = n.id::text AND ji.status = 'queued') as queued_jobs,
                   (SELECT COUNT(*) FROM remediation_jobs rj WHERE rj.node_id = n.id AND rj.status IN ('pending', 'approved')) as pending_remediation,
                   (SELECT COUNT(*) FROM remediation_jobs rj WHERE rj.node_id = n.id AND rj.status = 'running') as running_remediation
            FROM nodes n
            ORDER BY n.last_seen DESC NULLS LAST
        """)

        result = []
        for n in nodes:
            last_seen = n["last_seen"]
            now = datetime.now(timezone.utc)
            if last_seen:
                ago = (now - last_seen).total_seconds()
                if ago < 30:
                    status = "active"
                elif ago < 120:
                    status = "idle"
                elif ago < 600:
                    status = "stale"
                else:
                    status = "offline"
            else:
                status = "unknown"
                ago = None

            # Find recent activity from buffer
            recent_actions = [e for e in _agent_activity_buffer if e["hostname"] == n["hostname"]][-5:]

            result.append({
                "id": str(n["id"]),
                "hostname": n["hostname"],
                "os_name": n["os_name"],
                "agent_version": n["agent_version"],
                "last_seen": last_seen.isoformat() if last_seen else None,
                "seconds_ago": int(ago) if ago is not None else None,
                "status": status,
                "is_online": n["is_online"],
                "running_jobs": n["running_jobs"],
                "queued_jobs": n["queued_jobs"],
                "pending_remediation": n["pending_remediation"],
                "running_remediation": n["running_remediation"],
                "recent_actions": recent_actions
            })

        return {"agents": result}


@app.get("/api/v1/admin/agent-live")
async def agent_live_sse(request: Request, token: str = None):
    """SSE endpoint for live agent activity stream."""
    async def event_generator():
        last_idx = len(_agent_activity_buffer)
        last_node_check = 0

        while True:
            if await request.is_disconnected():
                break

            # Send new activity events
            current = list(_agent_activity_buffer)
            if len(current) > last_idx - (len(_agent_activity_buffer) - len(current)):
                new_events = current[-(len(current) - last_idx):] if last_idx < len(current) else current
                for evt in new_events[-10:]:
                    yield f"data: {json.dumps({'type': 'activity', 'event': evt}, default=str)}\n\n"
                last_idx = len(current)

            # Every 5 seconds, send node status update
            now = _time.time()
            if now - last_node_check > 5:
                last_node_check = now
                try:
                    async with db_pool.acquire() as conn:
                        nodes = await conn.fetch("""
                            SELECT hostname, last_seen, is_online, agent_version FROM nodes ORDER BY hostname
                        """)
                        statuses = []
                        for n in nodes:
                            ls = n["last_seen"]
                            ago = (datetime.now(timezone.utc) - ls).total_seconds() if ls else 9999
                            statuses.append({
                                "hostname": n["hostname"],
                                "last_seen": ls.isoformat() if ls else None,
                                "seconds_ago": int(ago),
                                "status": "active" if ago < 30 else "idle" if ago < 120 else "stale" if ago < 600 else "offline",
                                "agent_version": n["agent_version"]
                            })
                        yield f"data: {json.dumps({'type': 'status', 'agents': statuses}, default=str)}\n\n"
                except Exception as e:
                    logger.error(f"Agent SSE status error: {e}")

            await asyncio.sleep(2)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
