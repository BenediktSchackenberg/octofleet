"""
OpenClaw Inventory Backend
FastAPI server for receiving and storing inventory data from Windows Agents
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Header, status, Request
from fastapi.middleware.cors import CORSMiddleware
import asyncpg
from typing import Optional, Any, Dict
import os
import json
from uuid import UUID
import uuid
import re
import secrets
from datetime import datetime, timedelta

# Config
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://openclaw:openclaw_inventory_2026@127.0.0.1:5432/inventory"
)
API_KEY = os.getenv("INVENTORY_API_KEY", "openclaw-inventory-dev-key")

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


async def verify_api_key(x_api_key: str = Header(...)):
    """Verify API key from header"""
    if x_api_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )
    return x_api_key


def api_key_check(request: Request):
    """Synchronous API key check from request headers"""
    api_key = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if api_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )


def get_db():
    """Get synchronous database connection using psycopg2"""
    import psycopg2
    conn = psycopg2.connect(DATABASE_URL)
    return conn


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
    title="OpenClaw Inventory API",
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

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "ok", "service": "openclaw-inventory", "database": "connected"}
    except Exception as e:
        return {"status": "degraded", "service": "openclaw-inventory", "database": str(e)}


@app.get("/api/v1/nodes")
async def list_nodes(db: asyncpg.Pool = Depends(get_db)):
    """List all known nodes with summary info"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.id, n.node_id, n.hostname, n.os_name, n.os_version, n.os_build, 
                   n.first_seen, n.last_seen, n.is_online,
                   h.cpu->>'name' as cpu_name,
                   (h.ram->>'totalGb')::numeric as total_memory_gb
            FROM nodes n
            LEFT JOIN hardware_current h ON n.id = h.node_id
            ORDER BY n.last_seen DESC
        """)
        return {"nodes": [dict(r) for r in rows]}


@app.get("/api/v1/inventory/hardware/{node_id}")
async def get_hardware(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get hardware data for a node"""
    async with db.acquire() as conn:
        # Find node by node_id string or UUID
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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


@app.get("/api/v1/inventory/software/{node_id}")
async def get_software(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get software data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
            SELECT id, os_name, os_version, os_build FROM nodes WHERE node_id = $1
        """, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        row = await conn.fetchrow("""
            SELECT users, services, startup_items, scheduled_tasks, 
                   computer_name, domain, workgroup, domain_role, is_domain_joined, updated_at
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
            "users": json.loads(row['users']) if row and row['users'] else [],
            "services": json.loads(row['services']) if row and row['services'] else [],
            "startupItems": json.loads(row['startup_items']) if row and row['startup_items'] else [],
            "scheduledTasks": json.loads(row['scheduled_tasks']) if row and row['scheduled_tasks'] else []
        }}


@app.get("/api/v1/inventory/security/{node_id}")
async def get_security(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get security data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        row = await conn.fetchrow("""
            SELECT defender, firewall, tpm, uac, bitlocker, updated_at
            FROM security_current WHERE node_id = $1
        """, node['id'])
        
        if not row:
            return {"data": None}
        
        return {"data": {
            "defender": json.loads(row['defender']) if row['defender'] else {},
            "firewall": json.loads(row['firewall']) if row['firewall'] else [],
            "tpm": json.loads(row['tpm']) if row['tpm'] else {},
            "uac": json.loads(row['uac']) if row['uac'] else {},
            "bitlocker": json.loads(row['bitlocker']) if row['bitlocker'] else []
        }}


@app.get("/api/v1/inventory/network/{node_id}")
async def get_network(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get network data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        
        rows = await conn.fetch("""
            SELECT browser, profile, profile_path, history_count, bookmark_count, 
                   password_count, extensions
            FROM browser_current WHERE node_id = $1
        """, node['id'])
        
        # Group by browser
        browsers = {}
        for row in rows:
            b = row['browser']
            if b not in browsers:
                browsers[b] = {"profiles": [], "extensionCount": 0}
            browsers[b]["profiles"].append({
                "name": row['profile'],
                "path": row['profile_path'],
                "historyCount": row['history_count'],
                "bookmarkCount": row['bookmark_count'],
                "passwordCount": row['password_count']
            })
            exts = json.loads(row['extensions']) if row['extensions'] else []
            browsers[b]["extensionCount"] += len(exts)
        
        return {"data": browsers}


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
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO system_current (node_id, users, services, startup_items, scheduled_tasks,
                os_name, os_version, os_build, computer_name, domain, workgroup, domain_role, is_domain_joined, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                users = $2, services = $3, startup_items = $4, scheduled_tasks = $5,
                os_name = $6, os_version = $7, os_build = $8, computer_name = $9,
                domain = $10, workgroup = $11, domain_role = $12, is_domain_joined = $13, updated_at = NOW()
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
            os_info.get("isDomainJoined")
        )
    
    return {"status": "ok", "node_id": str(uuid), "type": "system"}


@app.post("/api/v1/inventory/security", dependencies=[Depends(verify_api_key)])
async def submit_security(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit security inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO security_current (node_id, defender, firewall, tpm, uac, bitlocker, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                defender = $2, firewall = $3, tpm = $4, 
                uac = $5, bitlocker = $6, updated_at = NOW()
        """,
            uuid,
            json.dumps(data.get("defender", {})),
            json.dumps(data.get("firewall", [])),
            json.dumps(data.get("tpm", {})),
            json.dumps(data.get("uac", {})),
            json.dumps(data.get("bitlocker", []))
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
    
    uuid = await upsert_node(db, node_id_str, hostname)
    
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM browser_current WHERE node_id = $1", uuid)
        
        # Handle Windows Agent format: { chrome: {...}, edge: {...}, firefox: {...} }
        if isinstance(browsers, dict):
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
    br_data = data.get("browser", {})
    if br_data.get("chrome") or br_data.get("edge") or br_data.get("firefox"):
        flat_br = {
            "hostname": hostname,
            "nodeId": data.get("nodeId", hostname),
            "browsers": br_data
        }
        await submit_browser(flat_br, db)
        results["submitted"].append("browser")
    
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
    api_key_check(request)
    
    token_id = str(uuid.uuid4())
    token_value = secrets.token_urlsafe(32)
    
    # Token settings
    expires_hours = data.get("expiresHours", 24)  # Default 24h
    max_uses = data.get("maxUses", 10)  # Default 10 uses
    description = data.get("description", "")
    created_by = data.get("createdBy", "admin")
    
    expires_at = datetime.utcnow() + timedelta(hours=expires_hours)
    
    conn = get_db()
    cur = conn.cursor()
    
    # Create table if not exists
    cur.execute("""
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
    
    cur.execute("""
        INSERT INTO enrollment_tokens (id, token, description, expires_at, max_uses, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, token, expires_at
    """, (token_id, token_value, description, expires_at, max_uses, created_by))
    
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    
    return {
        "id": str(row[0]),
        "token": row[1],
        "expiresAt": row[2].isoformat(),
        "maxUses": max_uses,
        "description": description,
        "installCommand": f'irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1; .\\Install.ps1 -EnrollToken "{row[1]}"'
    }

@app.get("/api/v1/enrollment-tokens")
async def list_enrollment_tokens(request: Request):
    """List all enrollment tokens"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    # Check if table exists
    cur.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'enrollment_tokens'
        )
    """)
    if not cur.fetchone()[0]:
        cur.close()
        conn.close()
        return {"tokens": []}
    
    cur.execute("""
        SELECT id, token, description, expires_at, max_uses, use_count, created_by, created_at, revoked
        FROM enrollment_tokens
        ORDER BY created_at DESC
    """)
    
    tokens = []
    for row in cur.fetchall():
        is_expired = row[3] < datetime.now(row[3].tzinfo) if row[3].tzinfo else row[3] < datetime.utcnow()
        is_exhausted = row[5] >= row[4]
        
        tokens.append({
            "id": str(row[0]),
            "token": row[1][:8] + "..." if row[1] else None,  # Partial token for display
            "description": row[2],
            "expiresAt": row[3].isoformat() if row[3] else None,
            "maxUses": row[4],
            "useCount": row[5],
            "createdBy": row[6],
            "createdAt": row[7].isoformat() if row[7] else None,
            "revoked": row[8],
            "status": "revoked" if row[8] else ("expired" if is_expired else ("exhausted" if is_exhausted else "active"))
        })
    
    cur.close()
    conn.close()
    
    return {"tokens": tokens}

@app.delete("/api/v1/enrollment-tokens/{token_id}")
async def revoke_enrollment_token(token_id: str, request: Request):
    """Revoke an enrollment token"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        UPDATE enrollment_tokens SET revoked = TRUE WHERE id = %s
        RETURNING id
    """, (token_id,))
    
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Token not found")
    
    return {"status": "revoked", "id": str(row[0])}

@app.post("/api/v1/enroll")
async def enroll_device(request: Request):
    """Exchange enrollment token for device credentials"""
    data = await request.json()
    
    enroll_token = data.get("enrollToken")
    hostname = data.get("hostname", "unknown")
    
    if not enroll_token:
        raise HTTPException(status_code=400, detail="enrollToken required")
    
    conn = get_db()
    cur = conn.cursor()
    
    # Find and validate token
    cur.execute("""
        SELECT id, expires_at, max_uses, use_count, revoked
        FROM enrollment_tokens
        WHERE token = %s
    """, (enroll_token,))
    
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid enrollment token")
    
    token_id, expires_at, max_uses, use_count, revoked = row
    
    # Check if token is valid
    if revoked:
        cur.close()
        conn.close()
        raise HTTPException(status_code=401, detail="Enrollment token has been revoked")
    
    is_expired = expires_at < datetime.now(expires_at.tzinfo) if expires_at.tzinfo else expires_at < datetime.utcnow()
    if is_expired:
        cur.close()
        conn.close()
        raise HTTPException(status_code=401, detail="Enrollment token has expired")
    
    if use_count >= max_uses:
        cur.close()
        conn.close()
        raise HTTPException(status_code=401, detail="Enrollment token usage limit reached")
    
    # Increment use count
    cur.execute("""
        UPDATE enrollment_tokens SET use_count = use_count + 1 WHERE id = %s
    """, (token_id,))
    
    # Generate device credentials
    device_token = secrets.token_urlsafe(48)
    device_id = f"dev-{secrets.token_hex(8)}"
    
    # TODO: Store device registration in a devices table
    # For now, return the gateway token directly (from config)
    # In production, you'd generate a unique device token
    
    conn.commit()
    cur.close()
    conn.close()
    
    # Return credentials - for now, return the main gateway token
    # In a full implementation, this would be a device-specific token
    return {
        "status": "enrolled",
        "deviceId": device_id,
        "hostname": hostname,
        "gatewayUrl": "http://192.168.0.5:18789",  # TODO: From config
        "gatewayToken": "a9544b6300030bda29268e0f207b88ba446f6a31669a7c63",  # TODO: From config or generate
        "inventoryApiUrl": "http://192.168.0.5:8080",
        "message": f"Device {hostname} enrolled successfully"
    }

# ============================================
# E3: Job System API
# ============================================

@app.post("/api/v1/jobs")
async def create_job(request: Request):
    """Create a new job targeting devices, groups, or tags"""
    data = await request.json()
    api_key_check(request)
    
    job_id = str(uuid.uuid4())
    
    # Required fields
    target_type = data.get("targetType", "device")  # device, group, tag, all
    command_type = data.get("commandType", "run")   # run, script, inventory
    command_data = data.get("commandData", {})
    
    # Optional fields
    name = data.get("name", f"Job {job_id[:8]}")
    description = data.get("description", "")
    target_id = data.get("targetId")  # device or group UUID
    target_tag = data.get("targetTag")  # for tag targeting
    priority = data.get("priority", 5)
    scheduled_at = data.get("scheduledAt")
    expires_at = data.get("expiresAt")
    created_by = data.get("createdBy", "api")
    
    conn = get_db()
    cur = conn.cursor()
    
    # Insert job
    cur.execute("""
        INSERT INTO jobs (id, name, description, target_type, target_id, target_tag, 
                         command_type, command_data, priority, scheduled_at, expires_at, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, created_at
    """, (job_id, name, description, target_type, target_id, target_tag,
          command_type, json.dumps(command_data), priority, scheduled_at, expires_at, created_by))
    
    row = cur.fetchone()
    
    # Expand job to instances based on target
    instances_created = 0
    
    if target_type == "device" and target_id:
        # Single device - get node_id from system_current
        cur.execute("SELECT node_id FROM system_current WHERE node_id = %s", (target_id,))
        node = cur.fetchone()
        if node:
            cur.execute("""
                INSERT INTO job_instances (job_id, node_id, status)
                VALUES (%s, %s, 'pending')
            """, (job_id, node[0]))
            instances_created = 1
    
    elif target_type == "group" and target_id:
        # Group - get all devices in group
        cur.execute("""
            SELECT dg.node_id FROM device_groups dg
            WHERE dg.group_id = %s
        """, (target_id,))
        for node in cur.fetchall():
            cur.execute("""
                INSERT INTO job_instances (job_id, node_id, status)
                VALUES (%s, %s, 'pending')
            """, (job_id, node[0]))
            instances_created += 1
    
    elif target_type == "tag" and target_tag:
        # Tag - get all devices with tag
        cur.execute("""
            SELECT dt.node_id FROM device_tags dt
            JOIN tags t ON t.id = dt.tag_id
            WHERE t.name = %s
        """, (target_tag,))
        for node in cur.fetchall():
            cur.execute("""
                INSERT INTO job_instances (job_id, node_id, status)
                VALUES (%s, %s, 'pending')
            """, (job_id, node[0]))
            instances_created += 1
    
    elif target_type == "all":
        # All devices
        cur.execute("SELECT DISTINCT node_id FROM system_current")
        for node in cur.fetchall():
            cur.execute("""
                INSERT INTO job_instances (job_id, node_id, status)
                VALUES (%s, %s, 'pending')
            """, (job_id, node[0]))
            instances_created += 1
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {
        "id": job_id,
        "name": name,
        "targetType": target_type,
        "commandType": command_type,
        "instancesCreated": instances_created,
        "createdAt": row[1].isoformat() if row[1] else None
    }


@app.get("/api/v1/jobs")
async def list_jobs(request: Request, limit: int = 50, offset: int = 0):
    """List all jobs with summary"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        SELECT job_id, name, command_type, target_type, created_at,
               total_instances, pending, queued, running, success, failed, cancelled
        FROM job_summary
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
    """, (limit, offset))
    
    jobs = []
    for row in cur.fetchall():
        jobs.append({
            "id": str(row[0]),
            "name": row[1],
            "commandType": row[2],
            "targetType": row[3],
            "createdAt": row[4].isoformat() if row[4] else None,
            "summary": {
                "total": row[5],
                "pending": row[6],
                "queued": row[7],
                "running": row[8],
                "success": row[9],
                "failed": row[10],
                "cancelled": row[11]
            }
        })
    
    cur.close()
    conn.close()
    
    return {"jobs": jobs}


@app.get("/api/v1/jobs/{job_id}")
async def get_job(job_id: str, request: Request):
    """Get job details with all instances"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    # Get job
    cur.execute("""
        SELECT id, name, description, target_type, target_id, target_tag,
               command_type, command_data, priority, scheduled_at, expires_at,
               created_by, created_at
        FROM jobs WHERE id = %s
    """, (job_id,))
    
    job = cur.fetchone()
    if not job:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Get instances
    cur.execute("""
        SELECT id, node_id, status, queued_at, started_at, completed_at,
               exit_code, stdout, stderr, error_message, duration_ms, attempt
        FROM job_instances
        WHERE job_id = %s
        ORDER BY queued_at
    """, (job_id,))
    
    instances = []
    for row in cur.fetchall():
        instances.append({
            "id": str(row[0]),
            "nodeId": row[1],
            "status": row[2],
            "queuedAt": row[3].isoformat() if row[3] else None,
            "startedAt": row[4].isoformat() if row[4] else None,
            "completedAt": row[5].isoformat() if row[5] else None,
            "exitCode": row[6],
            "stdout": row[7],
            "stderr": row[8],
            "errorMessage": row[9],
            "durationMs": row[10],
            "attempt": row[11]
        })
    
    cur.close()
    conn.close()
    
    return {
        "id": str(job[0]),
        "name": job[1],
        "description": job[2],
        "targetType": job[3],
        "targetId": str(job[4]) if job[4] else None,
        "targetTag": job[5],
        "commandType": job[6],
        "commandData": job[7],
        "priority": job[8],
        "scheduledAt": job[9].isoformat() if job[9] else None,
        "expiresAt": job[10].isoformat() if job[10] else None,
        "createdBy": job[11],
        "createdAt": job[12].isoformat() if job[12] else None,
        "instances": instances
    }


@app.get("/api/v1/jobs/pending/{node_id}")
async def get_pending_jobs(node_id: str, request: Request):
    """Agent endpoint: Get pending jobs for a specific node"""
    # Note: Could add agent auth here instead of API key
    
    conn = get_db()
    cur = conn.cursor()
    
    # Get pending instances for this node, ordered by priority
    cur.execute("""
        SELECT ji.id, ji.job_id, j.command_type, j.command_data, j.priority,
               ji.attempt, ji.max_attempts
        FROM job_instances ji
        JOIN jobs j ON j.id = ji.job_id
        WHERE ji.node_id = %s 
          AND ji.status = 'pending'
          AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
          AND (j.expires_at IS NULL OR j.expires_at > NOW())
        ORDER BY j.priority ASC, ji.queued_at ASC
        LIMIT 10
    """, (node_id,))
    
    jobs = []
    for row in cur.fetchall():
        # Mark as queued
        cur.execute("""
            UPDATE job_instances SET status = 'queued', updated_at = NOW()
            WHERE id = %s
        """, (str(row[0]),))
        
        jobs.append({
            "instanceId": str(row[0]),
            "jobId": str(row[1]),
            "commandType": row[2],
            "commandData": row[3],
            "priority": row[4],
            "attempt": row[5],
            "maxAttempts": row[6]
        })
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {"jobs": jobs, "count": len(jobs)}


@app.post("/api/v1/jobs/instances/{instance_id}/start")
async def start_job_instance(instance_id: str, request: Request):
    """Agent endpoint: Mark job as started"""
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        UPDATE job_instances 
        SET status = 'running', started_at = NOW(), updated_at = NOW()
        WHERE id = %s
        RETURNING id, job_id, node_id
    """, (instance_id,))
    
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Instance not found")
    
    # Log start
    cur.execute("""
        INSERT INTO job_logs (instance_id, level, message)
        VALUES (%s, 'info', 'Job execution started')
    """, (instance_id,))
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {"status": "running", "instanceId": instance_id}


@app.post("/api/v1/jobs/instances/{instance_id}/result")
async def submit_job_result(instance_id: str, request: Request):
    """Agent endpoint: Submit job execution result"""
    data = await request.json()
    
    success = data.get("success", False)
    exit_code = data.get("exitCode", -1)
    stdout = data.get("stdout", "")
    stderr = data.get("stderr", "")
    error_message = data.get("errorMessage", "")
    duration_ms = data.get("durationMs", 0)
    
    status = "success" if success else "failed"
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        UPDATE job_instances 
        SET status = %s, completed_at = NOW(), updated_at = NOW(),
            exit_code = %s, stdout = %s, stderr = %s, 
            error_message = %s, duration_ms = %s
        WHERE id = %s
        RETURNING id, job_id, attempt, max_attempts
    """, (status, exit_code, stdout, stderr, error_message, duration_ms, instance_id))
    
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Instance not found")
    
    # Log completion
    cur.execute("""
        INSERT INTO job_logs (instance_id, level, message, data)
        VALUES (%s, %s, %s, %s)
    """, (instance_id, 'info' if success else 'error', 
          f'Job completed with exit code {exit_code}',
          json.dumps({"exitCode": exit_code, "durationMs": duration_ms})))
    
    # Handle retry logic if failed
    should_retry = False
    if not success and row[2] < row[3]:  # attempt < max_attempts
        should_retry = True
        cur.execute("""
            UPDATE job_instances 
            SET status = 'pending', attempt = attempt + 1, 
                next_retry_at = NOW() + INTERVAL '30 seconds',
                updated_at = NOW()
            WHERE id = %s
        """, (instance_id,))
        
        cur.execute("""
            INSERT INTO job_logs (instance_id, level, message)
            VALUES (%s, 'info', %s)
        """, (instance_id, f'Scheduling retry (attempt {row[2]+1}/{row[3]})'))
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {
        "status": status,
        "instanceId": instance_id,
        "willRetry": should_retry
    }


@app.delete("/api/v1/jobs/{job_id}")
async def cancel_job(job_id: str, request: Request):
    """Cancel a job and all pending instances"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    # Cancel all pending/queued instances
    cur.execute("""
        UPDATE job_instances 
        SET status = 'cancelled', updated_at = NOW()
        WHERE job_id = %s AND status IN ('pending', 'queued')
        RETURNING id
    """, (job_id,))
    
    cancelled = len(cur.fetchall())
    
    conn.commit()
    cur.close()
    conn.close()
    
    return {"status": "cancelled", "instancesCancelled": cancelled}


# ============================================
# E4: Package Management API
# ============================================

# --- Package Sources ---

@app.get("/api/v1/package-sources")
async def list_package_sources(request: Request):
    """List all package sources"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        SELECT id, name, source_type, base_url, priority, requires_auth, is_active, created_at
        FROM package_sources
        ORDER BY priority, name
    """)
    
    sources = []
    for row in cur.fetchall():
        sources.append({
            "id": str(row[0]),
            "name": row[1],
            "sourceType": row[2],
            "baseUrl": row[3],
            "priority": row[4],
            "requiresAuth": row[5],
            "isActive": row[6],
            "createdAt": row[7].isoformat() if row[7] else None
        })
    
    cur.close()
    conn.close()
    
    return {"sources": sources}


@app.post("/api/v1/package-sources")
async def create_package_source(request: Request):
    """Create a new package source"""
    data = await request.json()
    api_key_check(request)
    
    source_id = str(uuid.uuid4())
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        INSERT INTO package_sources (id, name, source_type, base_url, priority, requires_auth, is_active)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id, created_at
    """, (source_id, data["name"], data["sourceType"], data["baseUrl"],
          data.get("priority", 5), data.get("requiresAuth", False), data.get("isActive", True)))
    
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    
    return {"id": str(row[0]), "createdAt": row[1].isoformat()}


# --- Packages ---

@app.get("/api/v1/packages")
async def list_packages(request: Request, category: str = None, search: str = None):
    """List all packages with optional filtering"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    query = """
        SELECT id, name, display_name, vendor, description, category, os_type,
               icon_url, tags, is_active, latest_version, latest_version_id, 
               release_date, version_count
        FROM package_catalog
        WHERE 1=1
    """
    params = []
    
    if category:
        query += " AND category = %s"
        params.append(category)
    
    if search:
        query += " AND (name ILIKE %s OR display_name ILIKE %s OR vendor ILIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
    
    query += " ORDER BY display_name"
    
    cur.execute(query, params)
    
    packages = []
    for row in cur.fetchall():
        packages.append({
            "id": str(row[0]),
            "name": row[1],
            "displayName": row[2],
            "vendor": row[3],
            "description": row[4],
            "category": row[5],
            "osType": row[6],
            "iconUrl": row[7],
            "tags": row[8] or [],
            "isActive": row[9],
            "latestVersion": row[10],
            "latestVersionId": str(row[11]) if row[11] else None,
            "releaseDate": row[12].isoformat() if row[12] else None,
            "versionCount": row[13]
        })
    
    cur.close()
    conn.close()
    
    return {"packages": packages, "count": len(packages)}


@app.post("/api/v1/packages")
async def create_package(request: Request):
    """Create a new package"""
    data = await request.json()
    api_key_check(request)
    
    package_id = str(uuid.uuid4())
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        INSERT INTO packages (id, name, display_name, vendor, description, category,
                             os_type, os_min_version, architecture, homepage_url, icon_url, tags, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, created_at
    """, (package_id, data["name"], data["displayName"], data.get("vendor"),
          data.get("description"), data.get("category"), data.get("osType", "windows"),
          data.get("osMinVersion"), data.get("architecture", "any"),
          data.get("homepageUrl"), data.get("iconUrl"), data.get("tags", []),
          data.get("createdBy", "api")))
    
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    
    return {"id": str(row[0]), "createdAt": row[1].isoformat()}


@app.get("/api/v1/packages/{package_id}")
async def get_package(package_id: str, request: Request):
    """Get package details with all versions"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    # Get package
    cur.execute("""
        SELECT id, name, display_name, vendor, description, category, os_type,
               os_min_version, architecture, homepage_url, icon_url, tags, is_active, created_at
        FROM packages WHERE id = %s
    """, (package_id,))
    
    pkg = cur.fetchone()
    if not pkg:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Package not found")
    
    # Get versions
    cur.execute("""
        SELECT id, version, filename, file_size, sha256_hash, install_command,
               requires_reboot, requires_admin, silent_install, is_latest, is_active,
               release_date, release_notes
        FROM package_versions
        WHERE package_id = %s
        ORDER BY release_date DESC NULLS LAST, version DESC
    """, (package_id,))
    
    versions = []
    for row in cur.fetchall():
        versions.append({
            "id": str(row[0]),
            "version": row[1],
            "filename": row[2],
            "fileSize": row[3],
            "sha256Hash": row[4],
            "installCommand": row[5],
            "requiresReboot": row[6],
            "requiresAdmin": row[7],
            "silentInstall": row[8],
            "isLatest": row[9],
            "isActive": row[10],
            "releaseDate": row[11].isoformat() if row[11] else None,
            "releaseNotes": row[12]
        })
    
    cur.close()
    conn.close()
    
    return {
        "id": str(pkg[0]),
        "name": pkg[1],
        "displayName": pkg[2],
        "vendor": pkg[3],
        "description": pkg[4],
        "category": pkg[5],
        "osType": pkg[6],
        "osMinVersion": pkg[7],
        "architecture": pkg[8],
        "homepageUrl": pkg[9],
        "iconUrl": pkg[10],
        "tags": pkg[11] or [],
        "isActive": pkg[12],
        "createdAt": pkg[13].isoformat() if pkg[13] else None,
        "versions": versions
    }


@app.put("/api/v1/packages/{package_id}")
async def update_package(package_id: str, request: Request):
    """Update package details"""
    data = await request.json()
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        UPDATE packages SET
            display_name = COALESCE(%s, display_name),
            vendor = COALESCE(%s, vendor),
            description = COALESCE(%s, description),
            category = COALESCE(%s, category),
            homepage_url = COALESCE(%s, homepage_url),
            icon_url = COALESCE(%s, icon_url),
            tags = COALESCE(%s, tags),
            is_active = COALESCE(%s, is_active),
            updated_at = NOW()
        WHERE id = %s
        RETURNING id
    """, (data.get("displayName"), data.get("vendor"), data.get("description"),
          data.get("category"), data.get("homepageUrl"), data.get("iconUrl"),
          data.get("tags"), data.get("isActive"), package_id))
    
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Package not found")
    
    return {"status": "updated", "id": str(row[0])}


@app.delete("/api/v1/packages/{package_id}")
async def delete_package(package_id: str, request: Request):
    """Delete a package and all its versions"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("DELETE FROM packages WHERE id = %s RETURNING id", (package_id,))
    row = cur.fetchone()
    
    conn.commit()
    cur.close()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Package not found")
    
    return {"status": "deleted", "id": str(row[0])}


# --- Package Versions ---

@app.post("/api/v1/packages/{package_id}/versions")
async def create_package_version(package_id: str, request: Request):
    """Add a new version to a package"""
    data = await request.json()
    api_key_check(request)
    
    version_id = str(uuid.uuid4())
    
    conn = get_db()
    cur = conn.cursor()
    
    # Check package exists
    cur.execute("SELECT id FROM packages WHERE id = %s", (package_id,))
    if not cur.fetchone():
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Package not found")
    
    # If this is marked as latest, unmark others
    if data.get("isLatest", False):
        cur.execute("UPDATE package_versions SET is_latest = FALSE WHERE package_id = %s", (package_id,))
    
    cur.execute("""
        INSERT INTO package_versions (id, package_id, version, filename, file_size, sha256_hash,
                                      install_command, install_args, uninstall_command, uninstall_args,
                                      requires_reboot, requires_admin, silent_install, is_latest, is_active,
                                      release_date, release_notes)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, created_at
    """, (version_id, package_id, data["version"], data["filename"],
          data.get("fileSize"), data.get("sha256Hash"), data.get("installCommand"),
          json.dumps(data.get("installArgs", {})), data.get("uninstallCommand"),
          json.dumps(data.get("uninstallArgs", {})), data.get("requiresReboot", False),
          data.get("requiresAdmin", True), data.get("silentInstall", True),
          data.get("isLatest", True), data.get("isActive", True),
          data.get("releaseDate"), data.get("releaseNotes")))
    
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    
    return {"id": str(row[0]), "createdAt": row[1].isoformat()}


@app.get("/api/v1/packages/{package_id}/versions/{version_id}")
async def get_package_version(package_id: str, version_id: str, request: Request):
    """Get version details with detection rules and sources"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    # Get version
    cur.execute("""
        SELECT id, package_id, version, filename, file_size, sha256_hash,
               install_command, install_args, uninstall_command, uninstall_args,
               requires_reboot, requires_admin, silent_install, is_latest, is_active,
               release_date, release_notes, created_at
        FROM package_versions
        WHERE id = %s AND package_id = %s
    """, (version_id, package_id))
    
    ver = cur.fetchone()
    if not ver:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Version not found")
    
    # Get detection rules
    cur.execute("""
        SELECT id, rule_order, rule_type, config, operator
        FROM detection_rules
        WHERE package_version_id = %s
        ORDER BY rule_order
    """, (version_id,))
    
    rules = []
    for row in cur.fetchall():
        rules.append({
            "id": str(row[0]),
            "order": row[1],
            "type": row[2],
            "config": row[3],
            "operator": row[4]
        })
    
    # Get sources
    cur.execute("""
        SELECT pvs.id, pvs.relative_path, pvs.is_primary, ps.name, ps.source_type, ps.base_url
        FROM package_version_sources pvs
        JOIN package_sources ps ON ps.id = pvs.source_id
        WHERE pvs.package_version_id = %s
    """, (version_id,))
    
    sources = []
    for row in cur.fetchall():
        sources.append({
            "id": str(row[0]),
            "relativePath": row[1],
            "isPrimary": row[2],
            "sourceName": row[3],
            "sourceType": row[4],
            "baseUrl": row[5]
        })
    
    cur.close()
    conn.close()
    
    return {
        "id": str(ver[0]),
        "packageId": str(ver[1]),
        "version": ver[2],
        "filename": ver[3],
        "fileSize": ver[4],
        "sha256Hash": ver[5],
        "installCommand": ver[6],
        "installArgs": ver[7],
        "uninstallCommand": ver[8],
        "uninstallArgs": ver[9],
        "requiresReboot": ver[10],
        "requiresAdmin": ver[11],
        "silentInstall": ver[12],
        "isLatest": ver[13],
        "isActive": ver[14],
        "releaseDate": ver[15].isoformat() if ver[15] else None,
        "releaseNotes": ver[16],
        "createdAt": ver[17].isoformat() if ver[17] else None,
        "detectionRules": rules,
        "sources": sources
    }


# --- Detection Rules ---

@app.post("/api/v1/packages/{package_id}/versions/{version_id}/detection-rules")
async def add_detection_rule(package_id: str, version_id: str, request: Request):
    """Add a detection rule to a package version"""
    data = await request.json()
    api_key_check(request)
    
    rule_id = str(uuid.uuid4())
    
    conn = get_db()
    cur = conn.cursor()
    
    # Check version exists
    cur.execute("SELECT id FROM package_versions WHERE id = %s AND package_id = %s", (version_id, package_id))
    if not cur.fetchone():
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Version not found")
    
    # Get next order
    cur.execute("SELECT COALESCE(MAX(rule_order), 0) + 1 FROM detection_rules WHERE package_version_id = %s", (version_id,))
    next_order = cur.fetchone()[0]
    
    cur.execute("""
        INSERT INTO detection_rules (id, package_version_id, rule_order, rule_type, config, operator)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
    """, (rule_id, version_id, data.get("order", next_order), data["type"],
          json.dumps(data["config"]), data.get("operator", "AND")))
    
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    
    return {"id": str(row[0]), "order": next_order}


@app.delete("/api/v1/detection-rules/{rule_id}")
async def delete_detection_rule(rule_id: str, request: Request):
    """Delete a detection rule"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("DELETE FROM detection_rules WHERE id = %s RETURNING id", (rule_id,))
    row = cur.fetchone()
    
    conn.commit()
    cur.close()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    
    return {"status": "deleted"}


# --- Categories ---

@app.get("/api/v1/package-categories")
async def list_package_categories(request: Request):
    """List all used categories with counts"""
    api_key_check(request)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute("""
        SELECT category, COUNT(*) as count
        FROM packages
        WHERE category IS NOT NULL AND is_active = TRUE
        GROUP BY category
        ORDER BY count DESC, category
    """)
    
    categories = [{"name": row[0], "count": row[1]} for row in cur.fetchall()]
    
    cur.close()
    conn.close()
    
    return {"categories": categories}

