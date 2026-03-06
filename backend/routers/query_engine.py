"""
E34: Real-time Query Engine
Safe DSL-to-SQL query builder with schema introspection and templates.
Phase 2: Saved queries, history, schedules, dashboards & stats.
"""
import time
import json
import asyncio
import uuid
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Query
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


class ExecuteQueryRequest(QueryRequest):
    explain: bool = Field(default=False, description="If true, return generated SQL without executing")

    model_config = {"populate_by_name": True}


class SavedQueryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    query_dsl: Dict[str, Any]
    category: str = "Custom"
    tags: List[str] = Field(default_factory=list)
    is_public: bool = False


class SavedQueryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    query_dsl: Optional[Dict[str, Any]] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    is_public: Optional[bool] = None


class ScheduleCreate(BaseModel):
    saved_query_id: str
    name: str
    cron_expression: str
    output_format: str = "json"
    output_config: Dict[str, Any] = Field(default_factory=dict)


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    cron_expression: Optional[str] = None
    enabled: Optional[bool] = None
    output_format: Optional[str] = None
    output_config: Optional[Dict[str, Any]] = None


class DashboardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    layout: List[Any] = Field(default_factory=list)
    is_default: bool = False


class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    layout: Optional[List[Any]] = None
    is_default: Optional[bool] = None


class WidgetCreate(BaseModel):
    saved_query_id: str
    title: Optional[str] = None
    visualization: str = "table"
    position: Dict[str, Any] = Field(default_factory=lambda: {"x": 0, "y": 0, "w": 6, "h": 4})
    config: Dict[str, Any] = Field(default_factory=dict)


class WidgetUpdate(BaseModel):
    title: Optional[str] = None
    visualization: Optional[str] = None
    position: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None


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

async def _log_query_history(db, query_dsl, sql_generated, row_count, runtime_ms, status, error_message=None):
    """Log a query execution to query_history and return the history entry ID."""
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO query_history (query_dsl, sql_generated, row_count, runtime_ms, status, error_message)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
            json.dumps(query_dsl) if isinstance(query_dsl, dict) else query_dsl,
            sql_generated, row_count, runtime_ms, status, error_message,
        )
        return str(row["id"])


@router.post("/execute")
async def execute_query(req: ExecuteQueryRequest, db: asyncpg.Pool = Depends(get_db)):
    """Execute a safe DSL query translated to SQL. With explain=true, returns SQL only."""
    # Build the base query from parent class fields
    base_req = QueryRequest(
        **{"from": req.from_table, "select": req.select, "joins": req.joins,
           "where": req.where, "groupBy": req.groupBy, "orderBy": req.orderBy,
           "limit": req.limit, "offset": req.offset}
    )
    sql, params = _build_query(base_req)

    query_dsl = req.model_dump(by_alias=True, exclude={"explain"})

    # Explain mode: return SQL without executing
    if req.explain:
        return {"sql": sql, "params": [str(p) for p in params], "explain": True}

    t0 = time.monotonic()
    status = "success"
    error_msg = None
    rows = []
    try:
        async with db.acquire() as conn:
            rows = await asyncio.wait_for(
                conn.fetch(sql, *params),
                timeout=QUERY_TIMEOUT_S,
            )
    except asyncio.TimeoutError:
        status = "timeout"
        error_msg = "Query exceeded 10 s timeout"
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        await _log_query_history(db, query_dsl, sql, 0, elapsed, status, error_msg)
        raise HTTPException(504, error_msg)
    except asyncpg.PostgresError as e:
        status = "error"
        error_msg = str(e)
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        await _log_query_history(db, query_dsl, sql, 0, elapsed, status, error_msg)
        raise HTTPException(400, f"Query error: {e}")

    elapsed = round((time.monotonic() - t0) * 1000, 1)

    if rows:
        columns = list(rows[0].keys())
        data = [_serialise_row(dict(r)) for r in rows]
    else:
        columns = []
        data = []

    query_id = await _log_query_history(db, query_dsl, sql, len(data), elapsed, status)

    return {
        "columns": columns,
        "rows": data,
        "rowCount": len(data),
        "executionMs": elapsed,
        "sql": sql,
        "queryId": query_id,
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


# ─── Saved Queries ──────────────────────────────────────────────────────────

@router.get("/saved")
async def list_saved_queries(
    category: Optional[str] = None,
    tag: Optional[str] = None,
    is_public: Optional[bool] = None,
    db: asyncpg.Pool = Depends(get_db),
):
    conditions = []
    params = []
    if category:
        params.append(category)
        conditions.append(f"category = ${len(params)}")
    if tag:
        params.append(tag)
        conditions.append(f"${len(params)} = ANY(tags)")
    if is_public is not None:
        params.append(is_public)
        conditions.append(f"is_public = ${len(params)}")
    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    async with db.acquire() as conn:
        rows = await conn.fetch(f"SELECT * FROM saved_queries{where} ORDER BY created_at DESC", *params)
    return [_serialise_row(dict(r)) for r in rows]


@router.post("/saved")
async def create_saved_query(req: SavedQueryCreate, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO saved_queries (name, description, query_dsl, category, tags, is_public)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *""",
            req.name, req.description, json.dumps(req.query_dsl), req.category, req.tags, req.is_public,
        )
    return _serialise_row(dict(row))


@router.get("/saved/{query_id}")
async def get_saved_query(query_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM saved_queries WHERE id = $1", uuid.UUID(query_id))
    if not row:
        raise HTTPException(404, "Saved query not found")
    return _serialise_row(dict(row))


@router.put("/saved/{query_id}")
async def update_saved_query(query_id: str, req: SavedQueryUpdate, db: asyncpg.Pool = Depends(get_db)):
    updates = []
    params = []
    data = req.model_dump(exclude_none=True)
    for key, val in data.items():
        if key == "query_dsl":
            val = json.dumps(val)
        params.append(val)
        updates.append(f"{key} = ${len(params)}")
    if not updates:
        raise HTTPException(400, "No fields to update")
    params.append(uuid.UUID(query_id))
    updates.append(f"updated_at = now()")
    sql = f"UPDATE saved_queries SET {', '.join(updates)} WHERE id = ${len(params)} RETURNING *"
    async with db.acquire() as conn:
        row = await conn.fetchrow(sql, *params)
    if not row:
        raise HTTPException(404, "Saved query not found")
    return _serialise_row(dict(row))


@router.delete("/saved/{query_id}")
async def delete_saved_query(query_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM saved_queries WHERE id = $1", uuid.UUID(query_id))
    if result == "DELETE 0":
        raise HTTPException(404, "Saved query not found")
    return {"deleted": True}


@router.post("/saved/{query_id}/run")
async def run_saved_query(query_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Execute a saved query's DSL, update stats, log to history."""
    async with db.acquire() as conn:
        sq = await conn.fetchrow("SELECT * FROM saved_queries WHERE id = $1", uuid.UUID(query_id))
    if not sq:
        raise HTTPException(404, "Saved query not found")

    dsl = sq["query_dsl"] if isinstance(sq["query_dsl"], dict) else json.loads(sq["query_dsl"])
    query_req = QueryRequest(**{"from": dsl.get("from"), **{k: v for k, v in dsl.items() if k != "from"}})
    sql, params = _build_query(query_req)

    t0 = time.monotonic()
    status = "success"
    error_msg = None
    rows = []
    try:
        async with db.acquire() as conn:
            rows = await asyncio.wait_for(conn.fetch(sql, *params), timeout=QUERY_TIMEOUT_S)
    except asyncio.TimeoutError:
        status = "timeout"
        error_msg = "Query exceeded 10 s timeout"
    except asyncpg.PostgresError as e:
        status = "error"
        error_msg = str(e)

    elapsed = round((time.monotonic() - t0) * 1000, 1)
    row_count = len(rows)

    # Log to history
    history_id = await _log_query_history(db, dsl, sql, row_count, elapsed, status, error_msg)

    # Update saved query stats
    async with db.acquire() as conn:
        await conn.execute(
            """UPDATE saved_queries SET run_count = run_count + 1, last_run_at = now(),
               avg_runtime_ms = CASE WHEN avg_runtime_ms IS NULL THEN $1
                   ELSE (avg_runtime_ms * (run_count - 1) + $1) / run_count END,
               updated_at = now() WHERE id = $2""",
            elapsed, uuid.UUID(query_id),
        )

    if status != "success":
        raise HTTPException(504 if status == "timeout" else 400, error_msg)

    columns = list(rows[0].keys()) if rows else []
    data = [_serialise_row(dict(r)) for r in rows]

    return {
        "columns": columns, "rows": data, "rowCount": row_count,
        "executionMs": elapsed, "sql": sql, "queryId": history_id,
    }


@router.post("/saved/{query_id}/duplicate")
async def duplicate_saved_query(query_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        sq = await conn.fetchrow("SELECT * FROM saved_queries WHERE id = $1", uuid.UUID(query_id))
    if not sq:
        raise HTTPException(404, "Saved query not found")
    dsl = sq["query_dsl"] if isinstance(sq["query_dsl"], str) else json.dumps(sq["query_dsl"])
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO saved_queries (name, description, query_dsl, category, tags, is_public)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *""",
            f"{sq['name']} (copy)", sq["description"], dsl, sq["category"], sq["tags"], sq["is_public"],
        )
    return _serialise_row(dict(row))


# ─── Query History ──────────────────────────────────────────────────────────

@router.get("/history")
async def list_query_history(
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
    db: asyncpg.Pool = Depends(get_db),
):
    conditions = []
    params: list = []
    if status:
        params.append(status)
        conditions.append(f"status = ${len(params)}")
    if from_date:
        params.append(from_date)
        conditions.append(f"created_at >= ${len(params)}::timestamptz")
    if to_date:
        params.append(to_date)
        conditions.append(f"created_at <= ${len(params)}::timestamptz")
    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    params.extend([limit, offset])
    sql = f"SELECT * FROM query_history{where} ORDER BY created_at DESC LIMIT ${len(params)-1} OFFSET ${len(params)}"
    async with db.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        count_row = await conn.fetchrow(f"SELECT COUNT(*) as total FROM query_history{where}", *params[:-2])
    return {"items": [_serialise_row(dict(r)) for r in rows], "total": count_row["total"]}


@router.delete("/history")
async def clear_query_history(
    older_than: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_db),
):
    if older_than:
        async with db.acquire() as conn:
            result = await conn.execute("DELETE FROM query_history WHERE created_at < $1::timestamptz", older_than)
    else:
        async with db.acquire() as conn:
            result = await conn.execute("DELETE FROM query_history")
    count = int(result.split()[-1])
    return {"deleted": count}


# ─── Scheduled Queries ──────────────────────────────────────────────────────

@router.get("/schedules")
async def list_schedules(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """SELECT sq.*, s.name as saved_query_name FROM scheduled_queries sq
               LEFT JOIN saved_queries s ON sq.saved_query_id = s.id ORDER BY sq.created_at DESC"""
        )
    return [_serialise_row(dict(r)) for r in rows]


@router.post("/schedules")
async def create_schedule(req: ScheduleCreate, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        # Verify saved query exists
        sq = await conn.fetchrow("SELECT id FROM saved_queries WHERE id = $1", uuid.UUID(req.saved_query_id))
        if not sq:
            raise HTTPException(404, "Saved query not found")
        row = await conn.fetchrow(
            """INSERT INTO scheduled_queries (saved_query_id, name, cron_expression, output_format, output_config)
               VALUES ($1, $2, $3, $4, $5) RETURNING *""",
            uuid.UUID(req.saved_query_id), req.name, req.cron_expression,
            req.output_format, json.dumps(req.output_config),
        )
    return _serialise_row(dict(row))


@router.put("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, req: ScheduleUpdate, db: asyncpg.Pool = Depends(get_db)):
    updates = []
    params = []
    data = req.model_dump(exclude_none=True)
    for key, val in data.items():
        if key == "output_config":
            val = json.dumps(val)
        params.append(val)
        updates.append(f"{key} = ${len(params)}")
    if not updates:
        raise HTTPException(400, "No fields to update")
    params.append(uuid.UUID(schedule_id))
    sql = f"UPDATE scheduled_queries SET {', '.join(updates)} WHERE id = ${len(params)} RETURNING *"
    async with db.acquire() as conn:
        row = await conn.fetchrow(sql, *params)
    if not row:
        raise HTTPException(404, "Schedule not found")
    return _serialise_row(dict(row))


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM scheduled_queries WHERE id = $1", uuid.UUID(schedule_id))
    if result == "DELETE 0":
        raise HTTPException(404, "Schedule not found")
    return {"deleted": True}


@router.post("/schedules/{schedule_id}/run-now")
async def run_schedule_now(schedule_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Execute a scheduled query immediately."""
    async with db.acquire() as conn:
        sched = await conn.fetchrow(
            "SELECT sq.*, s.query_dsl FROM scheduled_queries sq JOIN saved_queries s ON sq.saved_query_id = s.id WHERE sq.id = $1",
            uuid.UUID(schedule_id),
        )
    if not sched:
        raise HTTPException(404, "Schedule not found")

    dsl = sched["query_dsl"] if isinstance(sched["query_dsl"], dict) else json.loads(sched["query_dsl"])
    query_req = QueryRequest(**{"from": dsl.get("from"), **{k: v for k, v in dsl.items() if k != "from"}})
    sql, params = _build_query(query_req)

    t0 = time.monotonic()
    status = "success"
    rows = []
    try:
        async with db.acquire() as conn:
            rows = await asyncio.wait_for(conn.fetch(sql, *params), timeout=QUERY_TIMEOUT_S)
    except Exception as e:
        status = "error"

    elapsed = round((time.monotonic() - t0) * 1000, 1)

    # Log result
    async with db.acquire() as conn:
        await conn.execute(
            """INSERT INTO scheduled_query_results (scheduled_query_id, row_count, runtime_ms, status, result_summary)
               VALUES ($1, $2, $3, $4, $5)""",
            uuid.UUID(schedule_id), len(rows), elapsed, status,
            json.dumps({"columns": list(rows[0].keys()) if rows else []}),
        )
        await conn.execute(
            "UPDATE scheduled_queries SET last_run_at = now(), last_status = $1 WHERE id = $2",
            status, uuid.UUID(schedule_id),
        )

    data = [_serialise_row(dict(r)) for r in rows]
    return {"rows": data, "rowCount": len(data), "executionMs": elapsed, "status": status}


@router.get("/schedules/{schedule_id}/results")
async def get_schedule_results(
    schedule_id: str,
    limit: int = Query(default=20, le=100),
    db: asyncpg.Pool = Depends(get_db),
):
    async with db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM scheduled_query_results WHERE scheduled_query_id = $1 ORDER BY created_at DESC LIMIT $2",
            uuid.UUID(schedule_id), limit,
        )
    return [_serialise_row(dict(r)) for r in rows]


# ─── Dashboards ─────────────────────────────────────────────────────────────

@router.get("/dashboards")
async def list_dashboards(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM query_dashboards ORDER BY created_at DESC")
    return [_serialise_row(dict(r)) for r in rows]


@router.post("/dashboards")
async def create_dashboard(req: DashboardCreate, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO query_dashboards (name, description, layout, is_default)
               VALUES ($1, $2, $3, $4) RETURNING *""",
            req.name, req.description, json.dumps(req.layout), req.is_default,
        )
    return _serialise_row(dict(row))


@router.get("/dashboards/{dashboard_id}")
async def get_dashboard(dashboard_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        dash = await conn.fetchrow("SELECT * FROM query_dashboards WHERE id = $1", uuid.UUID(dashboard_id))
        if not dash:
            raise HTTPException(404, "Dashboard not found")
        widgets = await conn.fetch(
            """SELECT w.*, s.name as query_name, s.query_dsl FROM query_dashboard_widgets w
               JOIN saved_queries s ON w.saved_query_id = s.id WHERE w.dashboard_id = $1 ORDER BY w.created_at""",
            uuid.UUID(dashboard_id),
        )
    result = _serialise_row(dict(dash))
    result["widgets"] = [_serialise_row(dict(w)) for w in widgets]
    return result


@router.put("/dashboards/{dashboard_id}")
async def update_dashboard(dashboard_id: str, req: DashboardUpdate, db: asyncpg.Pool = Depends(get_db)):
    updates = []
    params = []
    data = req.model_dump(exclude_none=True)
    for key, val in data.items():
        if key == "layout":
            val = json.dumps(val)
        params.append(val)
        updates.append(f"{key} = ${len(params)}")
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates.append("updated_at = now()")
    params.append(uuid.UUID(dashboard_id))
    sql = f"UPDATE query_dashboards SET {', '.join(updates)} WHERE id = ${len(params)} RETURNING *"
    async with db.acquire() as conn:
        row = await conn.fetchrow(sql, *params)
    if not row:
        raise HTTPException(404, "Dashboard not found")
    return _serialise_row(dict(row))


@router.delete("/dashboards/{dashboard_id}")
async def delete_dashboard(dashboard_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM query_dashboards WHERE id = $1", uuid.UUID(dashboard_id))
    if result == "DELETE 0":
        raise HTTPException(404, "Dashboard not found")
    return {"deleted": True}


@router.post("/dashboards/{dashboard_id}/widgets")
async def add_widget(dashboard_id: str, req: WidgetCreate, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        dash = await conn.fetchrow("SELECT id FROM query_dashboards WHERE id = $1", uuid.UUID(dashboard_id))
        if not dash:
            raise HTTPException(404, "Dashboard not found")
        row = await conn.fetchrow(
            """INSERT INTO query_dashboard_widgets (dashboard_id, saved_query_id, title, visualization, position, config)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING *""",
            uuid.UUID(dashboard_id), uuid.UUID(req.saved_query_id), req.title,
            req.visualization, json.dumps(req.position), json.dumps(req.config),
        )
    return _serialise_row(dict(row))


@router.put("/dashboards/{dashboard_id}/widgets/{widget_id}")
async def update_widget(dashboard_id: str, widget_id: str, req: WidgetUpdate, db: asyncpg.Pool = Depends(get_db)):
    updates = []
    params = []
    data = req.model_dump(exclude_none=True)
    for key, val in data.items():
        if key in ("position", "config"):
            val = json.dumps(val)
        params.append(val)
        updates.append(f"{key} = ${len(params)}")
    if not updates:
        raise HTTPException(400, "No fields to update")
    params.extend([uuid.UUID(dashboard_id), uuid.UUID(widget_id)])
    sql = f"UPDATE query_dashboard_widgets SET {', '.join(updates)} WHERE dashboard_id = ${len(params)-1} AND id = ${len(params)} RETURNING *"
    async with db.acquire() as conn:
        row = await conn.fetchrow(sql, *params)
    if not row:
        raise HTTPException(404, "Widget not found")
    return _serialise_row(dict(row))


@router.delete("/dashboards/{dashboard_id}/widgets/{widget_id}")
async def delete_widget(dashboard_id: str, widget_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM query_dashboard_widgets WHERE dashboard_id = $1 AND id = $2",
            uuid.UUID(dashboard_id), uuid.UUID(widget_id),
        )
    if result == "DELETE 0":
        raise HTTPException(404, "Widget not found")
    return {"deleted": True}


# ─── Query Stats ────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_query_stats(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        total = await conn.fetchrow("SELECT COUNT(*) as total, AVG(runtime_ms) as avg_ms FROM query_history")
        today = await conn.fetchrow(
            "SELECT COUNT(*) as total FROM query_history WHERE created_at >= CURRENT_DATE"
        )
        week = await conn.fetchrow(
            "SELECT COUNT(*) as total FROM query_history WHERE created_at >= date_trunc('week', CURRENT_DATE)"
        )
        top_saved = await conn.fetch(
            "SELECT id, name, run_count, avg_runtime_ms FROM saved_queries ORDER BY run_count DESC LIMIT 10"
        )
        # Top tables from query_dsl
        top_tables = await conn.fetch(
            """SELECT query_dsl->>'from' as table_name, COUNT(*) as cnt
               FROM query_history WHERE query_dsl->>'from' IS NOT NULL
               GROUP BY query_dsl->>'from' ORDER BY cnt DESC LIMIT 10"""
        )
    return {
        "totalQueries": total["total"],
        "avgRuntimeMs": round(total["avg_ms"], 1) if total["avg_ms"] else 0,
        "queriesToday": today["total"],
        "queriesThisWeek": week["total"],
        "topSavedQueries": [_serialise_row(dict(r)) for r in top_saved],
        "topTables": [{"table": r["table_name"], "count": r["cnt"]} for r in top_tables],
    }



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
