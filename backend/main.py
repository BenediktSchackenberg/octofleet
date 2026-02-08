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


@app.get("/api/v1/nodes/{node_id}")
async def get_node_detail(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get detailed info for a single node"""
    async with db.acquire() as conn:
        # Get node basic info
        node = await conn.fetchrow("""
            SELECT id, node_id, hostname, os_name, os_version, os_build, 
                   first_seen, last_seen, is_online, created_at, updated_at
            FROM nodes WHERE node_id = $1
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
            users[username][b]["extensionCount"] += len(exts)
        
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1", node_id)
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
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR hostname = $1", node_id)
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
        await conn.execute("""
            INSERT INTO system_current (node_id, users, services, startup_items, scheduled_tasks,
                os_name, os_version, os_build, computer_name, domain, workgroup, domain_role, is_domain_joined,
                uptime_hours, uptime_formatted, last_boot_time, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                users = $2, services = $3, startup_items = $4, scheduled_tasks = $5,
                os_name = $6, os_version = $7, os_build = $8, computer_name = $9,
                domain = $10, workgroup = $11, domain_role = $12, is_domain_joined = $13,
                uptime_hours = $14, uptime_formatted = $15, last_boot_time = $16, updated_at = NOW()
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
            last_boot_time
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
                        cookies = profile.get("cookies", [])
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
        target_id = data.get("targetId")
        target_tag = data.get("targetTag")
        priority = data.get("priority", 5)
        scheduled_at = data.get("scheduledAt")
        expires_at = data.get("expiresAt")
        created_by = data.get("createdBy", "api")
        timeout_seconds = data.get("timeoutSeconds", 300)
        
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
        
        if target_type == "device" and target_id:
            node = await conn.fetchrow("SELECT node_id FROM system_current WHERE node_id = $1", target_id)
            if node:
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, str(job_uuid), str(node["node_id"]))
                instances_created = 1
        
        elif target_type == "group" and target_id:
            nodes = await conn.fetch("""
                SELECT dg.node_id FROM device_groups dg
                WHERE dg.group_id = $1
            """, target_id)
            for node in nodes:
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, str(job_uuid), str(node["node_id"]))
                instances_created += 1
        
        elif target_type == "tag" and target_tag:
            nodes = await conn.fetch("""
                SELECT dt.node_id FROM device_tags dt
                JOIN tags t ON t.id = dt.tag_id
                WHERE t.name = $1
            """, target_tag)
            for node in nodes:
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, str(job_uuid), str(node["node_id"]))
                instances_created += 1
        
        elif target_type == "all":
            nodes = await conn.fetch("SELECT DISTINCT node_id FROM system_current")
            for node in nodes:
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, str(job_uuid), str(node["node_id"]))
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
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ji.id, ji.job_id, j.name, j.command_type, j.command_data, j.priority,
                   ji.attempt, ji.max_attempts, j.timeout_seconds
            FROM job_instances ji
            JOIN jobs j ON j.id = ji.job_id
            WHERE ji.node_id = $1 
              AND ji.status = 'pending'
              AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
              AND (j.expires_at IS NULL OR j.expires_at > NOW())
            ORDER BY j.priority ASC, ji.queued_at ASC
            LIMIT 10
        """, node_id)
        
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
            
            jobs.append({
                "instanceId": str(row["id"]),
                "jobId": str(row["job_id"]),
                "jobName": row["name"] or "Unnamed Job",
                "commandType": row["command_type"] or "command",
                "commandPayload": json.dumps(command_data) if isinstance(command_data, dict) else str(command_data),
                "priority": row["priority"],
                "attempt": row["attempt"],
                "maxAttempts": row["max_attempts"],
                "timeoutSeconds": row["timeout_seconds"] or 300
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
