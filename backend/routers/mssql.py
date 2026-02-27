from fastapi import APIRouter, Depends, HTTPException
import asyncpg
from typing import Optional, List, Dict, Any
import uuid
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

@router.get("/editions")
async def list_mssql_editions():
    """List available SQL Server editions with details"""
    return {"editions": MSSQL_EDITIONS}

@router.get("/downloads")
async def get_mssql_downloads():
    """Get download URLs for Express/Developer editions"""
    return {"downloads": MSSQL_DOWNLOADS}

@router.post("/configs")
async def create_mssql_config(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a reusable MSSQL configuration profile"""
    async with db.acquire() as conn:
        config_id = str(uuid.uuid4())
        row = await conn.fetchrow("""
            INSERT INTO mssql_configs (
                id, name, description, edition, version, instance_name,
                features, sql_collation, port, max_memory_mb,
                tempdb_file_count, tempdb_file_size_mb, include_ssms
            ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id, created_at
        """, config_id, data.get("name"), data.get("description"), data.get("edition"), data.get("version"),
            data.get("instanceName", "MSSQLSERVER"), data.get("features", ["SQLEngine"]), data.get("collation", "Latin1_General_CI_AS"),
            data.get("port", 1433), data.get("maxMemoryMb"), data.get("tempDbFileCount", 4), data.get("tempDbFileSizeMb", 1024), data.get("includeSsms", True))
        
        disk_configs = data.get("diskConfigs", [])
        for dc in disk_configs:
            await conn.execute("""
                INSERT INTO mssql_disk_configs (config_id, purpose, disk_number, disk_size_gb, drive_letter, volume_label, allocation_unit_kb, folder_name)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
            """, config_id, dc.get("purpose"), dc.get("diskNumber"), dc.get("diskSizeGb"), dc.get("driveLetter"), dc.get("volumeLabel", "SQL_Volume"), dc.get("allocationUnitKb", 64), dc.get("folder"))
        
        return {"id": config_id, "name": data.get("name"), "createdAt": row["created_at"].isoformat() if row["created_at"] else None}

@router.get("/configs")
async def list_mssql_configs(db: asyncpg.Pool = Depends(get_db)):
    """List all MSSQL configuration profiles"""
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT id, name, description, edition, version, instance_name, features, sql_collation, port, max_memory_mb, tempdb_file_count, tempdb_file_size_mb, include_ssms, created_at FROM mssql_configs ORDER BY created_at DESC")
        configs = []
        for row in rows:
            disk_rows = await conn.fetch("SELECT purpose, disk_number, drive_letter, volume_label, folder_name FROM mssql_disk_configs WHERE config_id = $1", row["id"])
            configs.append({
                "id": str(row["id"]), "name": row["name"], "description": row["description"], "edition": row["edition"], "version": row["version"],
                "instanceName": row["instance_name"], "features": row["features"], "collation": row["sql_collation"], "port": row["port"],
                "maxMemoryMb": row["max_memory_mb"], "tempDbFileCount": row["tempdb_file_count"], "tempDbFileSizeMb": row["tempdb_file_size_mb"],
                "includeSsms": row["include_ssms"], "diskConfigs": [{"purpose": d["purpose"], "diskNumber": d["disk_number"], "driveLetter": d["drive_letter"], "volumeLabel": d["volume_label"], "folder": d["folder_name"]} for d in disk_rows],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None
            })
        return {"configs": configs}

@router.get("/configs/{config_id}")
async def get_mssql_config(config_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a specific MSSQL configuration profile"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM mssql_configs WHERE id = $1::uuid", config_id)
        if not row: raise HTTPException(status_code=404, detail="Config not found")
        disk_rows = await conn.fetch("SELECT * FROM mssql_disk_configs WHERE config_id = $1::uuid", config_id)
        return {
            "id": str(row["id"]), "name": row["name"], "description": row["description"], "edition": row["edition"], "version": row["version"],
            "instanceName": row["instance_name"], "features": row["features"], "collation": row["sql_collation"], "port": row["port"],
            "maxMemoryMb": row["max_memory_mb"], "diskConfigs": [dict(d) for d in disk_rows]
        }

@router.delete("/configs/{config_id}")
async def delete_mssql_config(config_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a MSSQL configuration profile"""
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM mssql_configs WHERE id = $1::uuid", config_id)
        if result == "DELETE 0": raise HTTPException(status_code=404, detail="Config not found")
        return {"status": "deleted", "id": config_id}
