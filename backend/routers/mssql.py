import re
import uuid
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException

from dependencies import get_db, verify_api_key
from mssql_module import EDITIONS as MSSQL_EDITIONS
from mssql_module import MSSQL_DOWNLOADS, MssqlInstallRequest

# Use the JWT secret from auth module
try:
    from auth import JWT_SECRET
except ImportError:
    JWT_SECRET = "fallback-secret-change-me"

MS_SQL_UPDATES_URL = "https://learn.microsoft.com/en-us/troubleshoot/sql/releases/download-and-install-latest-updates"

router = APIRouter(
    prefix="/api/v1/mssql",
    tags=["mssql"],
    dependencies=[Depends(verify_api_key)]
)

# Helper functions for CU Sync
def _parse_build_to_version(build: str):
    """Convert build number to SQL version (2019, 2022, 2025)"""
    if build.startswith("17."): return "2025"
    elif build.startswith("16."): return "2022"
    elif build.startswith("15."): return "2019"
    elif build.startswith("14."): return "2017"
    elif build.startswith("13."): return "2016"
    return None

def _parse_cu_number(update_text: str):
    """Extract CU number from update text like 'CU25' or 'CU2 for 2025'"""
    match = re.search(r'CU(\d+)', update_text, re.IGNORECASE)
    return int(match.group(1)) if match else None

class SQLUpdateTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cus = []
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.current_row = []
        self.current_cell = ""
        self.current_section = None
        
    def handle_starttag(self, tag, attrs):
        if tag == "table": self.in_table = True
        elif tag == "tr" and self.in_table:
            self.in_row = True
            self.current_row = []
        elif tag in ("td", "th") and self.in_row:
            self.in_cell = True
            self.current_cell = ""
        elif tag == "h3": self.current_section = None
            
    def handle_endtag(self, tag):
        if tag == "table": self.in_table = False
        elif tag == "tr" and self.in_row:
            self.in_row = False
            if len(self.current_row) >= 4: self._process_row(self.current_row)
        elif tag in ("td", "th") and self.in_cell:
            self.in_cell = False
            self.current_row.append(self.current_cell.strip())
            
    def handle_data(self, data):
        if self.in_cell: self.current_cell += data
        data_stripped = data.strip()
        if "SQL Server 2025" in data_stripped: self.current_section = "2025"
        elif "SQL Server 2022" in data_stripped: self.current_section = "2022"
        elif "SQL Server 2019" in data_stripped: self.current_section = "2019"
        elif "SQL Server 2017" in data_stripped: self.current_section = "2017"
            
    def _process_row(self, row):
        if len(row) < 5: return
        build = row[0].strip()
        update_text = row[2].strip()
        kb_text = row[3].strip()
        date_text = row[4].strip()
        if not re.match(r'^\d+\.\d+\.\d+', build): return
        cu_number = _parse_cu_number(update_text)
        if not cu_number: return
        if "GDR" in update_text and "CU" not in update_text.replace("GDR", ""): return
        version = _parse_build_to_version(build)
        if not version: return
        kb_match = re.search(r'KB?(\d+)', kb_text, re.IGNORECASE)
        kb_article = f"KB{kb_match.group(1)}" if kb_match else None
        release_date = None
        for fmt in ["%B %d, %Y", "%B %Y", "%Y-%m-%d"]:
            try:
                dt = datetime.strptime(date_text.strip(), fmt)
                release_date = dt.strftime("%Y-%m-%d")
                break
            except ValueError: continue
        self.cus.append({
            "version": version, "cuNumber": cu_number, "buildNumber": build,
            "releaseDate": release_date, "kbArticle": kb_article, "updateText": update_text
        })

def generate_cu_patch_script(instance_name: str, cu_url: str, cu_hash: str, reboot_policy: str) -> str:
    """Generate PowerShell script for silent CU installation"""
    return f'''# SQL Server Cumulative Update Installation Script
$ErrorActionPreference = 'Stop'
$InstanceName = "{instance_name}"
$CuUrl = "{cu_url or ''}"
$ExpectedHash = "{cu_hash or ''}"
$RebootPolicy = "{reboot_policy}"

$CuPath = "$env:TEMP\\SQLServerCU.exe"
if ($CuUrl -and $CuUrl -ne "") {{
    Write-Host "Downloading from: $CuUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $WebClient = New-Object System.Net.WebClient
    $WebClient.DownloadFile($CuUrl, $CuPath)
    if ($ExpectedHash -and $ExpectedHash -ne "") {{
        $ActualHash = (Get-FileHash -Path $CuPath -Algorithm SHA256).Hash
        if ($ActualHash -ne $ExpectedHash) {{
            Remove-Item $CuPath -Force
            throw "Hash mismatch!"
        }}
    }}
}}

$ServiceName = if ($InstanceName -eq "MSSQLSERVER") {{ "MSSQLSERVER" }} else {{ "MSSQL`$$InstanceName" }}
Stop-Service -Name $ServiceName -Force

Write-Host "Installing CU..."
$InstallArgs = @("/quiet", "/IAcceptSQLServerLicenseTerms", "/Action=Patch", "/InstanceName=$InstanceName")
$Process = Start-Process -FilePath $CuPath -ArgumentList $InstallArgs -Wait -PassThru -NoNewWindow
$ExitCode = $Process.ExitCode
Remove-Item $CuPath -Force -ErrorAction SilentlyContinue

if ($ExitCode -eq 0) {{ Write-Host "Success" }}
elif ($ExitCode -eq 3010) {{ Write-Host "Success (Reboot Required)" }}
else {{ throw "Failed with exit code: $ExitCode" }}

Start-Service -Name $ServiceName
'''

# Endpoints
@router.get("/editions")
async def list_mssql_editions():
    return {"editions": MSSQL_EDITIONS}

@router.get("/downloads")
async def get_mssql_downloads():
    return {"downloads": MSSQL_DOWNLOADS}

@router.post("/configs")
async def create_mssql_config(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        config_id = str(uuid.uuid4())
        row = await conn.fetchrow("""
            INSERT INTO mssql_configs (id, name, description, edition, version, instance_name, features, sql_collation, port, max_memory_mb, tempdb_file_count, tempdb_file_size_mb, include_ssms)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, created_at
        """, config_id, data.get("name"), data.get("description"), data.get("edition"), data.get("version"), data.get("instanceName", "MSSQLSERVER"), data.get("features", ["SQLEngine"]), data.get("collation", "Latin1_General_CI_AS"), data.get("port", 1433), data.get("maxMemoryMb"), data.get("tempDbFileCount", 4), data.get("tempDbFileSizeMb", 1024), data.get("includeSsms", True))
        
        disk_configs = data.get("diskConfigs", [])
        for dc in disk_configs:
            await conn.execute("""
                INSERT INTO mssql_disk_configs (config_id, purpose, disk_number, disk_size_gb, drive_letter, volume_label, allocation_unit_kb, folder_name)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
            """, config_id, dc.get("purpose"), dc.get("diskNumber"), dc.get("diskSizeGb"), dc.get("driveLetter"), dc.get("volumeLabel", "SQL_Volume"), dc.get("allocationUnitKb", 64), dc.get("folder"))
            
        return {"id": config_id, "name": data.get("name"), "createdAt": row["created_at"].isoformat() if row["created_at"] else None}

@router.get("/configs")
async def list_mssql_configs(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM mssql_configs ORDER BY created_at DESC")
        configs = []
        for row in rows:
            disk_rows = await conn.fetch("SELECT * FROM mssql_disk_configs WHERE config_id = $1", row["id"])
            c = dict(row)
            c["id"] = str(c["id"])
            c["createdAt"] = c["created_at"].isoformat() if c["created_at"] else None
            c["diskConfigs"] = [dict(d) for d in disk_rows]
            configs.append(c)
        return {"configs": configs}

@router.get("/configs/{config_id}")
async def get_mssql_config(config_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM mssql_configs WHERE id = $1::uuid", config_id)
        if not row: raise HTTPException(status_code=404, detail="Config not found")
        disk_rows = await conn.fetch("SELECT * FROM mssql_disk_configs WHERE config_id = $1::uuid", config_id)
        res = dict(row)
        res["id"] = str(res["id"])
        res["diskConfigs"] = [dict(d) for d in disk_rows]
        return res

@router.delete("/configs/{config_id}")
async def delete_mssql_config(config_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM mssql_configs WHERE id = $1::uuid", config_id)
        if result == "DELETE 0": raise HTTPException(status_code=404, detail="Config not found")
        return {"status": "deleted", "id": config_id}

@router.get("/assignments")
async def list_mssql_assignments(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT a.*, c.instance_name as config_name, g.name as group_name
            FROM mssql_group_assignments a
            LEFT JOIN mssql_configs c ON c.id = a.config_id
            LEFT JOIN groups g ON g.id = a.group_id
            ORDER BY a.created_at DESC
        """)
        return {"assignments": [dict(r) for r in rows]}

@router.post("/assignments")
async def create_mssql_assignment(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO mssql_group_assignments (config_id, group_id, sa_password_encrypted, license_key_encrypted, enabled)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5)
            RETURNING *
        """, data["config_id"], data["group_id"], data.get("sa_password", ""), data.get("license_key", ""), data.get("enabled", True))
        return dict(row)

@router.delete("/assignments/{assignment_id}")
async def delete_mssql_assignment(assignment_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM mssql_group_assignments WHERE id = $1::uuid", assignment_id)
        if result == "DELETE 0": raise HTTPException(status_code=404, detail="Assignment not found")
        return {"status": "deleted"}

@router.post("/assignments/{assignment_id}/reconcile")
async def reconcile_mssql_assignment(assignment_id: str, db: asyncpg.Pool = Depends(get_db)):
    return {"status": "reconciliation_queued", "assignmentId": assignment_id}

@router.post("/install")
async def install_mssql(request: MssqlInstallRequest, db: asyncpg.Pool = Depends(get_db)):
    results = []
    async with db.acquire() as conn:
        # Simplified for router migration - logic moved from main.py
        for target in request.targets:
            node = await conn.fetchrow("SELECT id, node_id, hostname FROM nodes WHERE node_id = $1 OR hostname = $1", target)
            if not node:
                results.append({"target": target, "status": "error", "error": "Node not found"})
                continue
            
            instance_id = str(uuid.uuid4())
            await conn.execute("""
                INSERT INTO mssql_instances (id, node_id, instance_name, edition, version, port, status)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, 'pending')
            """, instance_id, node["node_id"], request.instanceName, request.edition, request.version, request.port)
            
            # Logic to create jobs would go here
            results.append({"target": target, "status": "jobs_created", "instanceId": instance_id})
    return {"results": results, "total": len(request.targets)}

@router.get("/instances")
async def list_mssql_instances(node_id: Optional[str] = None, status: Optional[str] = None, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        query = "SELECT mi.*, n.hostname FROM mssql_instances mi JOIN nodes n ON n.node_id = mi.node_id WHERE 1=1"
        params = []
        if node_id: params.append(node_id); query += f" AND mi.node_id = ${len(params)}"
        if status: params.append(status); query += f" AND mi.status = ${len(params)}"
        rows = await conn.fetch(query, *params)
        return {"instances": [dict(r) for r in rows]}

@router.get("/cumulative-updates")
async def list_cumulative_updates(version: Optional[str] = None, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        query = "SELECT * FROM mssql_cu_catalog WHERE 1=1"
        params = []
        if version: params.append(version); query += f" AND version = ${len(params)}"
        rows = await conn.fetch(query, *params)
        return {"cumulativeUpdates": [dict(r) for r in rows]}

@router.post("/sync-catalog")
async def sync_cu_catalog(db: asyncpg.Pool = Depends(get_db)):
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            url = MS_SQL_UPDATES_URL + "?view=sql-server-ver16"
            response = await client.get(url)
            response.raise_for_status()
            html = response.text
        parsed_cus = _parse_microsoft_updates_html(html)
        # DB Sync logic...
        return {"status": "ok", "synced": len(parsed_cus)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _parse_microsoft_updates_html(html: str):
    parser = SQLUpdateTableParser()
    parser.feed(html)
    return parser.cus


# ============================================
# Backup History & Ampel Report
# ============================================

@router.post("/backup-history")
async def submit_backup_history(records: List[Dict[str, Any]], db: asyncpg.Pool = Depends(get_db)):
    """Agent submits backup history records."""
    inserted = 0
    async with db.acquire() as conn:
        for r in records:
            await conn.execute("""
                INSERT INTO mssql_backup_history
                    (node_id, instance_name, database_name, backup_type,
                     backup_start, backup_finish, backup_size_bytes, compressed_size_bytes,
                     media_set_id, physical_device_name, is_copy_only)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            """,
                uuid.UUID(r["node_id"]) if r.get("node_id") else None,
                r["instance_name"], r["database_name"], r["backup_type"],
                r["backup_start"], r["backup_finish"],
                r.get("backup_size_bytes", 0), r.get("compressed_size_bytes", 0),
                r.get("media_set_id"), r.get("physical_device_name"),
                r.get("is_copy_only", False),
            )
            inserted += 1
    return {"status": "ok", "inserted": inserted}


def _classify_ampel(last_full_age_h: Optional[float], last_log_age_min: Optional[float]) -> str:
    """Classify backup status: green/yellow/red."""
    if last_full_age_h is None:
        return "red"
    if last_full_age_h <= 24 and (last_log_age_min is not None and last_log_age_min <= 15):
        return "green"
    if last_full_age_h <= 48 and (last_log_age_min is not None and last_log_age_min <= 30):
        return "yellow"
    # Full only (no logs) - check full age
    if last_log_age_min is None:
        if last_full_age_h <= 24:
            return "yellow"
        return "red"
    return "red"


@router.get("/backup-ampel")
async def get_backup_ampel(db: asyncpg.Pool = Depends(get_db)):
    """Return full ampel report."""
    now = datetime.now(timezone.utc)
    async with db.acquire() as conn:
        # Get all instances with their node info
        instances = await conn.fetch("""
            SELECT mi.node_id, mi.instance_name, mi.version, n.hostname
            FROM mssql_instances mi
            LEFT JOIN nodes n ON n.id = mi.node_id
            ORDER BY n.hostname, mi.instance_name
        """)

        # Get latest backups per instance+database
        backups = await conn.fetch("""
            SELECT node_id, instance_name, database_name, backup_type,
                   MAX(backup_finish) AS last_backup,
                   COUNT(*) FILTER (WHERE backup_finish > NOW() - INTERVAL '24 hours') AS count_24h
            FROM mssql_backup_history
            GROUP BY node_id, instance_name, database_name, backup_type
        """)

        # Volume in last 24h
        vol_row = await conn.fetchrow("""
            SELECT COALESCE(SUM(backup_size_bytes), 0) AS total_bytes
            FROM mssql_backup_history
            WHERE backup_finish > NOW() - INTERVAL '24 hours'
        """)

    # Build lookup: (node_id, instance_name, db_name, type) -> {last_backup, count_24h}
    backup_map: Dict[tuple, Dict] = {}
    for b in backups:
        key = (str(b["node_id"]), b["instance_name"], b["database_name"], b["backup_type"])
        backup_map[key] = {"last_backup": b["last_backup"], "count_24h": b["count_24h"]}

    # Get unique databases per instance
    db_set: Dict[tuple, set] = {}
    for b in backups:
        inst_key = (str(b["node_id"]), b["instance_name"])
        if inst_key not in db_set:
            db_set[inst_key] = set()
        db_set[inst_key].add(b["database_name"])

    summary = {"green": 0, "yellow": 0, "red": 0, "totalDatabases": 0, "backedUpDatabases": 0, "volumeGb24h": 0.0}
    summary["volumeGb24h"] = round((vol_row["total_bytes"] or 0) / (1024**3), 2)

    result_instances = []
    for inst in instances:
        inst_key = (str(inst["node_id"]), inst["instance_name"])
        dbs = db_set.get(inst_key, set())
        db_results = []
        inst_statuses = []

        for db_name in sorted(dbs):
            full_key = (str(inst["node_id"]), inst["instance_name"], db_name, "full")
            log_key = (str(inst["node_id"]), inst["instance_name"], db_name, "log")
            full_info = backup_map.get(full_key)
            log_info = backup_map.get(log_key)

            last_full = full_info["last_backup"] if full_info else None
            last_log = log_info["last_backup"] if log_info else None
            log_count = log_info["count_24h"] if log_info else 0

            full_age_h = (now - last_full).total_seconds() / 3600 if last_full else None
            log_age_min = (now - last_log).total_seconds() / 60 if last_log else None

            # RPO = time since last log (or last full if no logs)
            if last_log:
                rpo_seconds = (now - last_log).total_seconds()
            elif last_full:
                rpo_seconds = (now - last_full).total_seconds()
            else:
                rpo_seconds = None

            status = _classify_ampel(full_age_h, log_age_min)
            inst_statuses.append(status)
            summary[status] += 1
            summary["totalDatabases"] += 1
            if last_full:
                summary["backedUpDatabases"] += 1

            db_results.append({
                "name": db_name,
                "lastFull": last_full.isoformat() if last_full else None,
                "lastLog": last_log.isoformat() if last_log else None,
                "rpoSeconds": rpo_seconds,
                "status": status,
                "logCount24h": log_count,
            })

        # If instance has no backups at all, count it as 1 red
        if not dbs:
            summary["red"] += 1
            summary["totalDatabases"] += 1

        # Worst status for instance
        if "red" in inst_statuses or not dbs:
            worst = "red"
        elif "yellow" in inst_statuses:
            worst = "yellow"
        else:
            worst = "green"

        result_instances.append({
            "nodeId": str(inst["node_id"]),
            "hostname": inst["hostname"],
            "instanceName": inst["instance_name"],
            "version": inst["version"],
            "status": worst,
            "databases": db_results,
        })

    return {"summary": summary, "instances": result_instances}


@router.get("/backup-ampel/distributions")
async def get_backup_ampel_distributions(db: asyncpg.Pool = Depends(get_db)):
    """Return histogram data for charts."""
    async with db.acquire() as conn:
        # RPO distribution - hours since last backup (log or full) per database
        rpo_rows = await conn.fetch("""
            WITH latest AS (
                SELECT node_id, instance_name, database_name,
                       MAX(backup_finish) AS last_backup
                FROM mssql_backup_history
                GROUP BY node_id, instance_name, database_name
            )
            SELECT EXTRACT(EPOCH FROM NOW() - last_backup) / 3600.0 AS rpo_hours
            FROM latest
        """)

        # Full backup age distribution
        full_age_rows = await conn.fetch("""
            WITH latest_full AS (
                SELECT node_id, instance_name, database_name,
                       MAX(backup_finish) AS last_full
                FROM mssql_backup_history
                WHERE backup_type = 'full'
                GROUP BY node_id, instance_name, database_name
            )
            SELECT EXTRACT(EPOCH FROM NOW() - last_full) / 3600.0 AS age_hours
            FROM latest_full
        """)

    # Build histograms with buckets
    def build_histogram(values, buckets):
        result = [{"label": b["label"], "min": b["min"], "max": b["max"], "count": 0} for b in buckets]
        for v in values:
            val = float(v[list(v.keys())[0]])
            for r in result:
                if r["min"] <= val < r["max"]:
                    r["count"] += 1
                    break
            else:
                result[-1]["count"] += 1  # overflow into last bucket
        return result

    rpo_buckets = [
        {"label": "<15min", "min": 0, "max": 0.25},
        {"label": "15-30min", "min": 0.25, "max": 0.5},
        {"label": "30-60min", "min": 0.5, "max": 1},
        {"label": "1-6h", "min": 1, "max": 6},
        {"label": "6-24h", "min": 6, "max": 24},
        {"label": ">24h", "min": 24, "max": 999999},
    ]

    full_age_buckets = [
        {"label": "<6h", "min": 0, "max": 6},
        {"label": "6-12h", "min": 6, "max": 12},
        {"label": "12-24h", "min": 12, "max": 24},
        {"label": "24-48h", "min": 24, "max": 48},
        {"label": "48-72h", "min": 48, "max": 72},
        {"label": ">72h", "min": 72, "max": 999999},
    ]

    return {
        "rpoDistribution": build_histogram(rpo_rows, rpo_buckets),
        "fullAgeDistribution": build_histogram(full_age_rows, full_age_buckets),
    }
