from fastapi import APIRouter, Depends, HTTPException
import asyncpg
from typing import Optional, List, Dict, Any
from dependencies import get_db, verify_api_key

router = APIRouter(
    prefix="/api/v1/deployments",
    tags=["deployments"],
    dependencies=[Depends(verify_api_key)]
)

@router.post("")
async def create_deployment(data: dict, db: asyncpg.Pool = Depends(get_db)):
    """Create a new deployment (package version -> target)"""
    required = ["name", "packageVersionId", "targetType"]
    for f in required:
        if f not in data: raise HTTPException(400, f"Missing required field: {f}")
    
    pv_id = data["packageVersionId"]
    target_type = data["targetType"]
    target_id = data.get("targetId")
    mode = data.get("mode", "required")
    
    async with db.acquire() as conn:
        dep_id = await conn.fetchval("""
            INSERT INTO deployments (name, description, package_version_id, target_type, target_id, mode, status, scheduled_start, scheduled_end, maintenance_window_only, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
        """, data["name"], data.get("description"), pv_id, target_type, target_id, mode, data.get("status", "active"), data.get("scheduledStart"), data.get("scheduledEnd"), data.get("maintenanceWindowOnly", False), data.get("createdBy"))
        
        if target_type == "all":
            await conn.execute("INSERT INTO deployment_status (deployment_id, node_id, status) SELECT $1, id, 'pending' FROM nodes", dep_id)
        elif target_type == "node":
            await conn.execute("INSERT INTO deployment_status (deployment_id, node_id, status) VALUES ($1, $2, 'pending')", dep_id, target_id)
        elif target_type == "group":
            await conn.execute("INSERT INTO deployment_status (deployment_id, node_id, status) SELECT $1, node_id, 'pending' FROM device_groups WHERE group_id = $2", dep_id, target_id)
        
        return {"id": str(dep_id), "status": "created"}

@router.get("")
async def list_deployments(status: str = None, limit: int = 50, db: asyncpg.Pool = Depends(get_db)):
    """List all deployments with aggregated status"""
    async with db.acquire() as conn:
        query = """
            SELECT d.*, p.name as package_name, pv.version as package_version,
                   COUNT(ds.id) as total_nodes,
                   COUNT(ds.id) FILTER (WHERE ds.status = 'success') as success_count,
                   COUNT(ds.id) FILTER (WHERE ds.status = 'failed') as failed_count,
                   COUNT(ds.id) FILTER (WHERE ds.status = 'pending') as pending_count,
                   COUNT(ds.id) FILTER (WHERE ds.status IN ('downloading', 'installing')) as in_progress_count
            FROM deployments d JOIN package_versions pv ON d.package_version_id = pv.id JOIN packages p ON pv.package_id = p.id LEFT JOIN deployment_status ds ON d.id = ds.deployment_id
        """
        params = []
        if status:
            query += " WHERE d.status = $1"
            params.append(status)
        query += " GROUP BY d.id, p.name, pv.version ORDER BY d.created_at DESC LIMIT $" + str(len(params) + 1)
        params.append(limit)
        
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]

@router.get("/{deployment_id}")
async def get_deployment(deployment_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get deployment details with per-node status"""
    async with db.acquire() as conn:
        dep = await conn.fetchrow("""
            SELECT d.*, p.name as package_name, pv.version as package_version FROM deployments d JOIN package_versions pv ON d.package_version_id = pv.id JOIN packages p ON pv.package_id = p.id WHERE d.id = $1
        """, deployment_id)
        if not dep: raise HTTPException(404, "Deployment not found")
        statuses = await conn.fetch("""
            SELECT ds.*, n.node_id as node_name, n.hostname FROM deployment_status ds JOIN nodes n ON ds.node_id = n.id WHERE ds.deployment_id = $1 ORDER BY ds.status, n.hostname
        """, deployment_id)
        result = dict(dep)
        result["nodes"] = [dict(s) for s in statuses]
        return result
