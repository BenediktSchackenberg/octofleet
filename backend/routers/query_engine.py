"""
E34: Real-time Query Engine
Safe DSL-to-SQL query builder with schema introspection and templates.
"""
import time
import json
import asyncio
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from dependencies import get_db, verify_api_key

router = APIRouter(prefix="/api/v1/query", dependencies=[Depends(verify_api_key)])

# ─── Allowed tables & columns ──────────────────────────────────────────────
# Security-critical: only these tables/columns may be queried.

ALLOWED_TABLES: Dict[str, Dict[str, str]] = {
    # ── Fleet ──
    "nodes": {
        "id": "uuid", "node_id": "text", "hostname": "text",
        "os_name": "text", "os_version": "text", "os_build": "text",
        "first_seen": "timestamptz", "last_seen": "timestamptz",
        "is_online": "boolean", "agent_version": "text",
        "created_at": "timestamptz", "updated_at": "timestamptz",
    },
    "hardware_current": {
        "node_id": "uuid", "cpu": "jsonb", "ram": "jsonb",
        "gpu": "jsonb", "mainboard": "jsonb", "bios": "jsonb",
        "disks": "jsonb", "updated_at": "timestamptz",
    },
    "network_current": {
        "node_id": "uuid", "adapters": "jsonb",
        "dns_servers": "jsonb", "updated_at": "timestamptz",
    },
    "physical_disks": {
        "node_id": "uuid", "disk_number": "integer", "model": "text",
        "media_type": "text", "size_gb": "numeric", "health_status": "text",
        "updated_at": "timestamptz",
    },
    # ── Software ──
    "software_current": {
        "node_id": "uuid", "name": "text", "version": "text",
        "publisher": "text", "install_date": "text",
        "install_location": "text", "updated_at": "timestamptz",
    },
    "hotfixes_current": {
        "node_id": "uuid", "hotfix_id": "text", "description": "text",
        "installed_on": "text", "updated_at": "timestamptz",
    },
    "software_changes": {
        "node_id": "uuid", "change_type": "text", "name": "text",
        "version": "text", "publisher": "text", "detected_at": "timestamptz",
    },
    # ── Security ──
    "vulnerabilities": {
        "id": "uuid", "cve_id": "text", "title": "text",
        "severity": "text", "cvss_score": "numeric",
        "description": "text", "published_date": "timestamptz",
        "created_at": "timestamptz",
    },
    "node_vulnerabilities": {
        "id": "uuid", "node_id": "uuid", "vulnerability_id": "uuid",
        "status": "text", "detected_at": "timestamptz",
        "resolved_at": "timestamptz",
    },
    "findings": {
        "id": "uuid", "node_id": "uuid", "finding_type": "text",
        "severity": "text", "title": "text", "description": "text",
        "status": "text", "detected_at": "timestamptz",
        "resolved_at": "timestamptz",
    },
    "security_current": {
        "node_id": "uuid", "antivirus": "jsonb", "firewall": "jsonb",
        "uac": "jsonb", "bitlocker": "jsonb", "updated_at": "timestamptz",
    },
    # ── System ──
    "system_current": {
        "node_id": "uuid", "os_name": "text", "os_version": "text",
        "os_build": "text", "computer_name": "text",
        "domain": "text", "last_boot": "timestamptz",
        "uptime_hours": "numeric", "updated_at": "timestamptz",
    },
    "services": {
        "node_id": "uuid", "name": "text", "display_name": "text",
        "status": "text", "start_type": "text", "account": "text",
        "updated_at": "timestamptz",
    },
    # ── Metrics ──
    "node_metrics": {
        "time": "timestamptz", "node_id": "uuid",
        "cpu_percent": "numeric", "ram_percent": "numeric",
        "disk_percent": "numeric", "network_in_mb": "numeric",
        "network_out_mb": "numeric",
    },
    # ── Events ──
    "eventlog_entries": {
        "id": "bigint", "node_id": "text", "log_name": "text",
        "event_id": "integer", "level": "integer", "level_name": "text",
        "source": "text", "message": "text", "event_time": "timestamptz",
        "collected_at": "timestamptz",
    },
    # ── Groups / Tags ──
    "groups": {
        "id": "uuid", "name": "text", "color": "text",
        "icon": "text", "created_at": "timestamptz",
    },
    "device_groups": {
        "node_id": "uuid", "group_id": "uuid",
    },
    "tags": {
        "id": "uuid", "name": "text", "color": "text",
    },
    "device_tags": {
        "node_id": "uuid", "tag_id": "uuid",
    },
    # ── Jobs ──
    "jobs": {
        "id": "uuid", "name": "text", "description": "text",
        "target_type": "text", "command_type": "text",
        "priority": "integer", "created_by": "text",
        "created_at": "timestamptz",
    },
    "job_instances": {
        "id": "text", "job_id": "uuid", "node_id": "text",
        "status": "text", "exit_code": "integer",
        "duration_ms": "integer", "started_at": "timestamptz",
        "completed_at": "timestamptz",
    },
    # ── Deployments ──
    "deployments": {
        "id": "uuid", "name": "text", "status": "text",
        "created_at": "timestamptz", "updated_at": "timestamptz",
    },
    "deployment_status": {
        "id": "uuid", "deployment_id": "uuid", "node_id": "uuid",
        "status": "text", "updated_at": "timestamptz",
    },
    # ── Alerting ──
    "alert_rules": {
        "id": "uuid", "name": "text", "severity": "text",
        "enabled": "boolean", "created_at": "timestamptz",
    },
    "alert_history": {
        "id": "uuid", "rule_id": "uuid", "node_id": "uuid",
        "severity": "text", "message": "text",
        "created_at": "timestamptz", "resolved_at": "timestamptz",
    },
}

# Tables that may be joined, with their FK relationships
ALLOWED_JOINS: Dict[str, Dict[str, str]] = {
    # "left_table.right_table" → "left_col = right_col"
    "nodes": {
        "hardware_current": "nodes.id = hardware_current.node_id",
        "network_current": "nodes.id = network_current.node_id",
        "software_current": "nodes.id = software_current.node_id",
        "hotfixes_current": "nodes.id = hotfixes_current.node_id",
        "system_current": "nodes.id = system_current.node_id",
        "security_current": "nodes.id = security_current.node_id",
        "services": "nodes.id = services.node_id",
        "node_metrics": "nodes.id = node_metrics.node_id",
        "node_vulnerabilities": "nodes.id = node_vulnerabilities.node_id",
        "findings": "nodes.id = findings.node_id",
        "physical_disks": "nodes.id = physical_disks.node_id",
        "device_groups": "nodes.id = device_groups.node_id",
        "device_tags": "nodes.id = device_tags.node_id",
        "software_changes": "nodes.id = software_changes.node_id",
    },
    "node_vulnerabilities": {
        "vulnerabilities": "node_vulnerabilities.vulnerability_id = vulnerabilities.id",
        "nodes": "node_vulnerabilities.node_id = nodes.id",
    },
    "device_groups": {
        "groups": "device_groups.group_id = groups.id",
        "nodes": "device_groups.node_id = nodes.id",
    },
    "device_tags": {
        "tags": "device_tags.tag_id = tags.id",
        "nodes": "device_tags.node_id = nodes.id",
    },
    "job_instances": {
        "jobs": "job_instances.job_id = jobs.id",
    },
    "deployment_status": {
        "deployments": "deployment_status.deployment_id = deployments.id",
    },
    "alert_history": {
        "alert_rules": "alert_history.rule_id = alert_rules.id",
    },
    "findings": {
        "nodes": "findings.node_id = nodes.id",
    },
}

VALID_OPS = {
    "=", "!=", ">", "<", ">=", "<=",
    "like", "ilike", "in", "not_in",
    "is_null", "is_not_null",
}

MAX_LIMIT = 10_000
QUERY_TIMEOUT_S = 10

# ─── Schema categories for /schema endpoint ────────────────────────────────

TABLE_CATEGORIES = {
    "Fleet": ["nodes", "hardware_current", "network_current", "physical_disks"],
    "Software": ["software_current", "hotfixes_current", "software_changes"],
    "Security": ["vulnerabilities", "node_vulnerabilities", "findings", "security_current"],
    "System": ["system_current", "services"],
    "Metrics": ["node_metrics"],
    "Events": ["eventlog_entries"],
    "Groups & Tags": ["groups", "device_groups", "tags", "device_tags"],
    "Jobs": ["jobs", "job_instances"],
    "Deployments": ["deployments", "deployment_status"],
    "Alerting": ["alert_rules", "alert_history"],
}

COLUMN_DESCRIPTIONS: Dict[str, Dict[str, str]] = {
    "nodes": {
        "id": "Internal UUID", "node_id": "Agent-assigned node identifier",
        "hostname": "Computer hostname", "os_name": "Operating system name",
        "os_version": "OS version string", "os_build": "OS build number",
        "first_seen": "First time agent contacted server",
        "last_seen": "Last agent contact", "is_online": "Currently online",
        "agent_version": "Octofleet agent version",
    },
    "software_current": {
        "name": "Software display name", "version": "Installed version",
        "publisher": "Software publisher", "install_date": "Date installed",
    },
    "vulnerabilities": {
        "cve_id": "CVE identifier", "severity": "Critical/High/Medium/Low",
        "cvss_score": "CVSS v3 score (0-10)",
    },
    "node_metrics": {
        "cpu_percent": "CPU utilisation %", "ram_percent": "RAM utilisation %",
        "disk_percent": "Disk utilisation %",
    },
}

# ─── Pydantic models ───────────────────────────────────────────────────────

class WhereClause(BaseModel):
    field: str
    op: str
    value: Any = None

    @field_validator("op")
    @classmethod
    def validate_op(cls, v: str) -> str:
        if v not in VALID_OPS:
            raise ValueError(f"Invalid operator: {v}. Must be one of {VALID_OPS}")
        return v


class JoinClause(BaseModel):
    table: str
    type: Literal["inner", "left", "right"] = "left"


class OrderByClause(BaseModel):
    field: str
    direction: Literal["asc", "desc"] = "asc"


class QueryRequest(BaseModel):
    from_table: str = Field(..., alias="from")
    select: List[str] = Field(default_factory=lambda: ["*"])
    joins: List[JoinClause] = Field(default_factory=list)
    where: List[WhereClause] = Field(default_factory=list)
    groupBy: List[str] = Field(default_factory=list)
    orderBy: List[OrderByClause] = Field(default_factory=list)
    limit: int = Field(default=100, le=MAX_LIMIT, ge=1)
    offset: int = Field(default=0, ge=0)

    model_config = {"populate_by_name": True}


class LiveQueryRequest(BaseModel):
    command: Literal["processes", "ports", "files", "services", "registry", "env"]
    targets: List[str] = Field(default_factory=list, description="node_ids or hostnames; empty = all online")
    params: Dict[str, Any] = Field(default_factory=dict)


# ─── Helpers ────────────────────────────────────────────────────────────────

def _validate_column(table: str, col: str) -> str:
    """Return fully-qualified column ref if valid, else raise."""
    # Handle table.column notation
    if "." in col:
        t, c = col.split(".", 1)
        if t not in ALLOWED_TABLES:
            raise HTTPException(400, f"Unknown table: {t}")
        if c != "*" and c not in ALLOWED_TABLES[t]:
            raise HTTPException(400, f"Column {c} not allowed on table {t}")
        return f'"{t}"."{c}"' if c != "*" else f'"{t}".*'
    # Plain column — resolve against primary table
    if col == "*":
        return f'"{table}".*'
    if col not in ALLOWED_TABLES.get(table, {}):
        raise HTTPException(400, f"Column {col} not allowed on table {table}")
    return f'"{table}"."{col}"'


def _build_query(req: QueryRequest):
    """Translate DSL to parameterised SQL. Returns (sql, params)."""
    base = req.from_table
    if base not in ALLOWED_TABLES:
        raise HTTPException(400, f"Table '{base}' is not queryable")

    # Collect all tables involved (for column validation)
    involved_tables = {base}
    join_clauses: List[str] = []
    for j in req.joins:
        if j.table not in ALLOWED_TABLES:
            raise HTTPException(400, f"Join table '{j.table}' is not queryable")
        # Find join condition
        cond = (ALLOWED_JOINS.get(base, {}).get(j.table)
                or ALLOWED_JOINS.get(j.table, {}).get(base))
        if not cond:
            raise HTTPException(400, f"No allowed join between '{base}' and '{j.table}'")
        jtype = j.type.upper()
        join_clauses.append(f'{jtype} JOIN "{j.table}" ON {cond}')
        involved_tables.add(j.table)

    # SELECT
    if req.select == ["*"]:
        select_sql = f'"{base}".*'
    else:
        cols = [_validate_column(base, c) for c in req.select]
        select_sql = ", ".join(cols)

    # FROM
    from_sql = f'"{base}"'
    if join_clauses:
        from_sql += " " + " ".join(join_clauses)

    # WHERE
    params: List[Any] = []
    where_parts: List[str] = []
    for w in req.where:
        col_ref = _validate_column(base, w.field)
        op = w.op

        if op in ("is_null", "is_not_null"):
            sql_op = "IS NULL" if op == "is_null" else "IS NOT NULL"
            where_parts.append(f"{col_ref} {sql_op}")
        elif op == "in":
            if not isinstance(w.value, list):
                raise HTTPException(400, "'in' operator requires a list value")
            placeholders = ", ".join(f"${len(params)+i+1}" for i in range(len(w.value)))
            where_parts.append(f"{col_ref} IN ({placeholders})")
            params.extend(w.value)
        elif op == "not_in":
            if not isinstance(w.value, list):
                raise HTTPException(400, "'not_in' operator requires a list value")
            placeholders = ", ".join(f"${len(params)+i+1}" for i in range(len(w.value)))
            where_parts.append(f"{col_ref} NOT IN ({placeholders})")
            params.extend(w.value)
        elif op in ("like", "ilike"):
            params.append(w.value)
            where_parts.append(f"{col_ref} {op.upper()} ${len(params)}")
        else:
            params.append(w.value)
            where_parts.append(f"{col_ref} {op} ${len(params)}")

    where_sql = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""

    # GROUP BY
    group_sql = ""
    if req.groupBy:
        gcols = [_validate_column(base, g) for g in req.groupBy]
        group_sql = " GROUP BY " + ", ".join(gcols)

    # ORDER BY
    order_sql = ""
    if req.orderBy:
        ocols = []
        for o in req.orderBy:
            col_ref = _validate_column(base, o.field)
            ocols.append(f"{col_ref} {o.direction.upper()}")
        order_sql = " ORDER BY " + ", ".join(ocols)

    # LIMIT / OFFSET
    params.append(req.limit)
    limit_sql = f" LIMIT ${len(params)}"
    params.append(req.offset)
    offset_sql = f" OFFSET ${len(params)}"

    sql = f"SELECT {select_sql} FROM {from_sql}{where_sql}{group_sql}{order_sql}{limit_sql}{offset_sql}"
    return sql, params


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/execute")
async def execute_query(req: QueryRequest, db: asyncpg.Pool = Depends(get_db)):
    """Execute a safe DSL query translated to SQL."""
    sql, params = _build_query(req)

    t0 = time.monotonic()
    try:
        async with db.acquire() as conn:
            rows = await asyncio.wait_for(
                conn.fetch(sql, *params),
                timeout=QUERY_TIMEOUT_S,
            )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Query exceeded 10 s timeout")
    except asyncpg.PostgresError as e:
        raise HTTPException(400, f"Query error: {e}")

    elapsed = round((time.monotonic() - t0) * 1000, 1)

    if rows:
        columns = list(rows[0].keys())
        data = [_serialise_row(dict(r)) for r in rows]
    else:
        columns = []
        data = []

    return {
        "columns": columns,
        "rows": data,
        "rowCount": len(data),
        "executionMs": elapsed,
        "sql": sql,  # useful for debugging; remove in prod if desired
    }


@router.get("/schema")
async def get_schema():
    """Return queryable tables grouped by category with column metadata."""
    categories = {}
    for cat, tables in TABLE_CATEGORIES.items():
        cat_tables = []
        for tbl in tables:
            cols = []
            for col_name, col_type in ALLOWED_TABLES.get(tbl, {}).items():
                desc = COLUMN_DESCRIPTIONS.get(tbl, {}).get(col_name, "")
                cols.append({"name": col_name, "type": col_type, "description": desc})
            cat_tables.append({
                "name": tbl,
                "columns": cols,
                "joins": list(ALLOWED_JOINS.get(tbl, {}).keys()),
            })
        categories[cat] = cat_tables

    return {"categories": categories, "totalTables": len(ALLOWED_TABLES)}


@router.get("/templates")
async def get_templates():
    """Pre-built query templates for common fleet questions."""
    return {"templates": QUERY_TEMPLATES}


@router.post("/live")
async def live_query(req: LiveQueryRequest, db: asyncpg.Pool = Depends(get_db)):
    """
    Phase 2: Live agent query via SSE.
    Currently returns inventory data from DB as a stand-in for real agent commands.
    """
    async def stream():
        async with db.acquire() as conn:
            # Resolve targets
            if req.targets:
                placeholders = ", ".join(f"${i+1}" for i in range(len(req.targets)))
                nodes = await conn.fetch(
                    f"SELECT id, node_id, hostname FROM nodes WHERE node_id = ANY($1) OR hostname = ANY($1)",
                    req.targets,
                )
            else:
                nodes = await conn.fetch(
                    "SELECT id, node_id, hostname FROM nodes WHERE is_online = true"
                )

            yield _sse("status", {"totalNodes": len(nodes), "command": req.command})

            for node in nodes:
                nid = node["id"]
                hostname = node["hostname"]
                try:
                    data = await _fetch_live_data(conn, req.command, nid, hostname)
                    yield _sse("result", {
                        "nodeId": node["node_id"],
                        "hostname": hostname,
                        "data": data,
                    })
                except Exception as e:
                    yield _sse("error", {
                        "nodeId": node["node_id"],
                        "hostname": hostname,
                        "error": str(e),
                    })

            yield _sse("done", {"totalNodes": len(nodes)})

    return StreamingResponse(stream(), media_type="text/event-stream")


# ─── Live-query data fetchers (DB-backed stubs) ────────────────────────────

async def _fetch_live_data(conn, command: str, node_id, hostname: str) -> Any:
    if command == "services":
        rows = await conn.fetch(
            'SELECT name, display_name, status, start_type, account FROM services WHERE node_id = $1',
            node_id,
        )
        return [dict(r) for r in rows]

    if command == "processes":
        rows = await conn.fetch(
            'SELECT process_name, pid, cpu_percent, memory_mb FROM node_processes WHERE node_id = $1 ORDER BY cpu_percent DESC NULLS LAST LIMIT 50',
            node_id,
        )
        return [dict(r) for r in rows] if rows else [{"note": "No process data in DB — requires live agent"}]

    if command == "ports":
        return [{"note": "Live port scan not yet implemented — requires agent-side execution"}]

    if command == "files":
        return [{"note": "File listing not yet implemented — requires agent-side execution"}]

    if command == "registry":
        return [{"note": "Registry query not yet implemented — requires agent-side execution"}]

    if command == "env":
        row = await conn.fetchrow(
            'SELECT os_name, os_version, os_build, computer_name, domain, last_boot, uptime_hours FROM system_current WHERE node_id = $1',
            node_id,
        )
        return dict(row) if row else {"note": "No system data available"}

    return {"note": f"Unknown command: {command}"}


# ─── SSE helper ─────────────────────────────────────────────────────────────

def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


# ─── Row serialisation (handle UUID, datetime etc.) ────────────────────────

def _serialise_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif hasattr(v, "hex"):  # UUID
            out[k] = str(v)
        else:
            out[k] = v
    return out


# ─── Query templates ───────────────────────────────────────────────────────

QUERY_TEMPLATES = [
    {
        "id": "offline-nodes-24h",
        "name": "Offline nodes in last 24h",
        "description": "Nodes that were online but haven't reported in 24 hours",
        "category": "Fleet",
        "query": {
            "from": "nodes",
            "select": ["hostname", "node_id", "os_name", "last_seen", "agent_version"],
            "where": [
                {"field": "is_online", "op": "=", "value": False},
                {"field": "last_seen", "op": ">", "value": "NOW() - INTERVAL '24 hours'"}
            ],
            "orderBy": [{"field": "last_seen", "direction": "desc"}],
            "limit": 100,
        },
    },
    {
        "id": "all-windows-servers",
        "name": "All nodes running Windows Server",
        "description": "Find every node with a Windows Server OS",
        "category": "Fleet",
        "query": {
            "from": "nodes",
            "select": ["hostname", "os_name", "os_version", "last_seen", "is_online"],
            "where": [{"field": "os_name", "op": "ilike", "value": "%Windows Server%"}],
            "orderBy": [{"field": "hostname", "direction": "asc"}],
            "limit": 500,
        },
    },
    {
        "id": "disk-usage-high",
        "name": "Nodes with disk usage > 90%",
        "description": "Nodes where disk utilisation exceeds 90%",
        "category": "Metrics",
        "query": {
            "from": "node_metrics",
            "select": ["node_id", "disk_percent", "cpu_percent", "ram_percent", "time"],
            "where": [{"field": "disk_percent", "op": ">", "value": 90}],
            "orderBy": [{"field": "disk_percent", "direction": "desc"}],
            "limit": 100,
        },
    },
    {
        "id": "recent-software-7d",
        "name": "Recently installed software (last 7 days)",
        "description": "Software changes detected in the last 7 days",
        "category": "Software",
        "query": {
            "from": "software_changes",
            "select": ["node_id", "change_type", "name", "version", "publisher", "detected_at"],
            "where": [
                {"field": "change_type", "op": "=", "value": "added"},
            ],
            "orderBy": [{"field": "detected_at", "direction": "desc"}],
            "limit": 200,
        },
    },
    {
        "id": "software-by-count",
        "name": "Software installed on more than N nodes",
        "description": "Find widely-deployed software (adjust limit/where as needed)",
        "category": "Software",
        "query": {
            "from": "software_current",
            "select": ["name", "version", "publisher"],
            "groupBy": ["name", "version", "publisher"],
            "orderBy": [{"field": "name", "direction": "asc"}],
            "limit": 500,
        },
    },
    {
        "id": "software-specific-version",
        "name": "Nodes with specific software version",
        "description": "Search for a particular software name (change the where value)",
        "category": "Software",
        "query": {
            "from": "software_current",
            "select": ["node_id", "name", "version", "publisher", "install_date"],
            "where": [{"field": "name", "op": "ilike", "value": "%Chrome%"}],
            "orderBy": [{"field": "version", "direction": "desc"}],
            "limit": 500,
        },
    },
    {
        "id": "vuln-summary-severity",
        "name": "Vulnerability summary by severity",
        "description": "Count of vulnerabilities grouped by severity level",
        "category": "Security",
        "query": {
            "from": "vulnerabilities",
            "select": ["severity"],
            "groupBy": ["severity"],
            "limit": 100,
        },
    },
    {
        "id": "critical-vulns",
        "name": "Critical vulnerabilities",
        "description": "All critical-severity vulnerabilities with CVSS ≥ 9",
        "category": "Security",
        "query": {
            "from": "vulnerabilities",
            "select": ["cve_id", "title", "severity", "cvss_score", "published_date"],
            "where": [{"field": "cvss_score", "op": ">=", "value": 9.0}],
            "orderBy": [{"field": "cvss_score", "direction": "desc"}],
            "limit": 100,
        },
    },
    {
        "id": "unresolved-vulns-per-node",
        "name": "Unresolved vulnerabilities per node",
        "description": "Nodes with open vulnerability findings",
        "category": "Security",
        "query": {
            "from": "node_vulnerabilities",
            "select": ["node_id", "vulnerability_id", "status", "detected_at"],
            "where": [{"field": "status", "op": "!=", "value": "resolved"}],
            "orderBy": [{"field": "detected_at", "direction": "desc"}],
            "limit": 500,
        },
    },
    {
        "id": "open-findings",
        "name": "Open security findings",
        "description": "All unresolved security findings across the fleet",
        "category": "Security",
        "query": {
            "from": "findings",
            "select": ["node_id", "finding_type", "severity", "title", "status", "detected_at"],
            "where": [{"field": "status", "op": "!=", "value": "resolved"}],
            "orderBy": [{"field": "severity", "direction": "asc"}],
            "limit": 500,
        },
    },
    {
        "id": "hotfixes-installed",
        "name": "Hotfixes per node",
        "description": "List all installed hotfixes/patches",
        "category": "Software",
        "query": {
            "from": "hotfixes_current",
            "select": ["node_id", "hotfix_id", "description", "installed_on"],
            "orderBy": [{"field": "installed_on", "direction": "desc"}],
            "limit": 500,
        },
    },
    {
        "id": "nodes-by-os",
        "name": "Node count by OS",
        "description": "How many nodes per operating system",
        "category": "Fleet",
        "query": {
            "from": "nodes",
            "select": ["os_name"],
            "groupBy": ["os_name"],
            "limit": 100,
        },
    },
    {
        "id": "agents-outdated",
        "name": "Nodes with outdated agent versions",
        "description": "Find agents not on the latest version",
        "category": "Fleet",
        "query": {
            "from": "nodes",
            "select": ["hostname", "node_id", "agent_version", "last_seen"],
            "where": [{"field": "agent_version", "op": "is_not_null"}],
            "orderBy": [{"field": "agent_version", "direction": "asc"}],
            "limit": 500,
        },
    },
    {
        "id": "high-cpu-nodes",
        "name": "Nodes with high CPU usage",
        "description": "Recent metrics showing CPU > 80%",
        "category": "Metrics",
        "query": {
            "from": "node_metrics",
            "select": ["node_id", "cpu_percent", "ram_percent", "time"],
            "where": [{"field": "cpu_percent", "op": ">", "value": 80}],
            "orderBy": [{"field": "cpu_percent", "direction": "desc"}],
            "limit": 100,
        },
    },
    {
        "id": "failed-jobs",
        "name": "Failed job instances",
        "description": "Jobs that failed execution",
        "category": "Jobs",
        "query": {
            "from": "job_instances",
            "select": ["id", "job_id", "node_id", "status", "exit_code", "duration_ms", "completed_at"],
            "where": [{"field": "status", "op": "=", "value": "failed"}],
            "orderBy": [{"field": "completed_at", "direction": "desc"}],
            "limit": 100,
        },
    },
    {
        "id": "critical-eventlog",
        "name": "Critical & error events (last 24h)",
        "description": "Eventlog entries with level ≤ 2 (Critical/Error)",
        "category": "Events",
        "query": {
            "from": "eventlog_entries",
            "select": ["node_id", "log_name", "event_id", "level_name", "source", "message", "event_time"],
            "where": [{"field": "level", "op": "<=", "value": 2}],
            "orderBy": [{"field": "event_time", "direction": "desc"}],
            "limit": 200,
        },
    },
    {
        "id": "services-stopped",
        "name": "Stopped services across fleet",
        "description": "Services that are configured to auto-start but are currently stopped",
        "category": "System",
        "query": {
            "from": "services",
            "select": ["node_id", "name", "display_name", "status", "start_type"],
            "where": [
                {"field": "status", "op": "=", "value": "Stopped"},
                {"field": "start_type", "op": "=", "value": "Automatic"},
            ],
            "orderBy": [{"field": "name", "direction": "asc"}],
            "limit": 500,
        },
    },
    {
        "id": "nodes-domain-overview",
        "name": "Nodes by domain",
        "description": "Group nodes by their domain membership",
        "category": "System",
        "query": {
            "from": "system_current",
            "select": ["domain"],
            "groupBy": ["domain"],
            "limit": 100,
        },
    },
]
