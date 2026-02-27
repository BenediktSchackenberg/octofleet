from fastapi import APIRouter, Depends, HTTPException
import asyncpg
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from dependencies import get_db, verify_api_key

router = APIRouter(
    prefix="/api/v1/metrics",
    tags=["metrics"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/summary")
async def get_metrics_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get summary metrics for dashboard"""
    async with db.acquire() as conn:
        counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '5 minutes') as online,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '60 minutes' AND last_seen <= NOW() - INTERVAL '5 minutes') as away,
                COUNT(*) FILTER (WHERE last_seen <= NOW() - INTERVAL '60 minutes' OR last_seen IS NULL) as offline
            FROM nodes
        """)
        
        avg_metrics = await conn.fetchrow("""
            SELECT 
                AVG(cpu_percent) as avg_cpu,
                AVG(ram_percent) as avg_ram,
                AVG(disk_percent) as avg_disk
            FROM node_metrics
            WHERE time > NOW() - INTERVAL '15 minutes'
        """)
        
        return {
            "nodes": dict(counts),
            "averages": {
                "cpu": float(avg_metrics["avg_cpu"]) if avg_metrics["avg_cpu"] else 0,
                "ram": float(avg_metrics["avg_ram"]) if avg_metrics["avg_ram"] else 0,
                "disk": float(avg_metrics["avg_disk"]) if avg_metrics["avg_disk"] else 0
            }
        }

@router.get("/timeseries")
async def get_metrics_timeseries(hours: int = 24, bucket_minutes: int = 30, group_id: str = None, db: asyncpg.Pool = Depends(get_db)):
    """Get aggregated timeseries metrics for charts"""
    async with db.acquire() as conn:
        start_time = datetime.utcnow() - timedelta(hours=hours)
        bucket_delta = timedelta(minutes=bucket_minutes)
        group_filter = ""
        params = [start_time, bucket_delta]
        if group_id:
            group_filter = "AND n.id IN (SELECT node_id FROM device_groups WHERE group_id = $3::uuid)"
            params.append(group_id)
            
        query = f"""
            SELECT time_bucket($2, m.time) as bucket, ROUND(AVG(m.cpu_percent)::numeric, 1) as avg_cpu, ROUND(AVG(m.ram_percent)::numeric, 1) as avg_ram, ROUND(AVG(m.disk_percent)::numeric, 1) as avg_disk, COUNT(DISTINCT m.node_id) as node_count
            FROM node_metrics m JOIN nodes n ON n.id = m.node_id WHERE m.time > $1 {group_filter} GROUP BY bucket ORDER BY bucket ASC
        """
        rows = await conn.fetch(query, *params)
        timeseries = [{"time": row["bucket"].isoformat(), "cpu": float(row["avg_cpu"]) if row["avg_cpu"] else None, "ram": float(row["avg_ram"]) if row["avg_ram"] else None, "disk": float(row["avg_disk"]) if row["avg_disk"] else None, "nodes": row["node_count"]} for row in rows]
        
        current = {"cpu": timeseries[-1]["cpu"] if timeseries else None, "ram": timeseries[-1]["ram"] if timeseries else None, "disk": timeseries[-1]["disk"] if timeseries else None}
        return {"hours": hours, "bucketMinutes": bucket_minutes, "groupId": group_id, "dataPoints": len(timeseries), "current": current, "timeseries": timeseries}
