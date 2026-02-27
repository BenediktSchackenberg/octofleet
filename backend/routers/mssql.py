from fastapi import APIRouter, Depends, HTTPException, status
import asyncpg
from typing import Optional, List, Dict, Any
import uuid
from pydantic import BaseModel, Field
from datetime import datetime
from dependencies import get_db, verify_api_key, not_found
from mssql_module import (
    generate_disk_prep_script,
    generate_install_script,
    MssqlInstallRequest,
    MSSQL_DOWNLOADS,
    EDITIONS as MSSQL_EDITIONS
)

router = APIRouter(
    prefix="/api/v1/mssql",
    tags=["mssql"],
    dependencies=[Depends(verify_api_key)]
)

class CUCreate(BaseModel):
    version: str
    cuNumber: int
    buildNumber: str
    releaseDate: Optional[str] = None
    kbArticle: Optional[str] = None
    downloadUrl: Optional[str] = None

@router.get("/editions")
async def list_mssql_editions():
    return {"editions": MSSQL_EDITIONS}

@router.get("/downloads")
async def get_mssql_downloads():
    return {"downloads": MSSQL_DOWNLOADS}

@router.get("/cumulative-updates")
async def list_cumulative_updates(version: Optional[str] = None, status: Optional[str] = None, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        query = "SELECT * FROM mssql_cu_catalog WHERE 1=1"
        params = []
        if version:
            params.append(version); query += f" AND version = ${len(params)}"
        if status:
            params.append(status); query += f" AND status = ${len(params)}"
        query += " ORDER BY version DESC, cu_number DESC"
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]

@router.get("/cumulative-updates/{cu_id}")
async def get_cumulative_update(cu_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM mssql_cu_catalog WHERE id = $1::uuid", cu_id)
        if not row: raise not_found("Cumulative Update", cu_id)
        return dict(row)

@router.post("/configs")
async def create_mssql_config(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        config_id = str(uuid.uuid4())
        row = await conn.fetchrow("""
            INSERT INTO mssql_configs (id, name, description, edition, version, instance_name, features, sql_collation, port, max_memory_mb, tempdb_file_count, tempdb_file_size_mb, include_ssms)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, created_at
        """, config_id, data.get("name"), data.get("description"), data.get("edition"), data.get("version"), data.get("instanceName", "MSSQLSERVER"), data.get("features", ["SQLEngine"]), data.get("collation", "Latin1_General_CI_AS"), data.get("port", 1433), data.get("maxMemoryMb"), data.get("tempDbFileCount", 4), data.get("tempDbFileSizeMb", 1024), data.get("includeSsms", True))
        return {"id": config_id, "name": data.get("name"), "createdAt": row["created_at"].isoformat() if row["created_at"] else None}

@router.get("/configs")
async def list_mssql_configs(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM mssql_configs ORDER BY created_at DESC")
        return [dict(r) for r in rows]
