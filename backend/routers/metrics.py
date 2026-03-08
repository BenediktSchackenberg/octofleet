from datetime import datetime, timedelta

import asyncpg
from fastapi import APIRouter, Depends

from dependencies import get_db, verify_api_key

router = APIRouter(
    prefix="/api/v1/metrics",
    tags=["metrics"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/summary")
async def get_metrics_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get summary metrics for dashboard with per-node data"""
    async with db.acquire() as conn:
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
