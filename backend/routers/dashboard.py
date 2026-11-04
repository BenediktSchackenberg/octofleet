
import asyncpg
from fastapi import APIRouter, Depends

from dependencies import get_db, verify_api_key
from vulnerability import get_vulnerability_summary

router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/summary")
async def get_dashboard_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get dashboard summary with counts and recent events"""
    # Before acquiring a connection here: the summary acquires its own, and holding two per request
    # could exhaust the pool under concurrent dashboard requests.
    severity_counts = (await get_vulnerability_summary(db))["severity_counts"]
    async with db.acquire() as conn:
        # Get node counts by status
        counts = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '5 minutes') as online,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '60 minutes' 
                                   AND last_seen <= NOW() - INTERVAL '5 minutes') as away,
                COUNT(*) FILTER (WHERE last_seen <= NOW() - INTERVAL '60 minutes' 
                                   OR last_seen IS NULL) as offline
            FROM nodes
        """)
        
        # Get unassigned count
        unassigned = await conn.fetchval("""
            SELECT COUNT(*) FROM nodes n
            WHERE NOT EXISTS (
                SELECT 1 FROM device_groups dg WHERE dg.node_id = n.id
            )
        """)
        
        # Get job stats (last 24h)
        job_stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'success') as success,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'running') as running,
                COUNT(*) FILTER (WHERE status = 'pending') as pending
            FROM job_instances
            WHERE created_at > NOW() - INTERVAL '24 hours'
        """)
        
        # Get active alerts count
        active_alerts = await conn.fetchval("""
            SELECT COUNT(*) FROM alerts WHERE status = 'active'
        """) or 0
        
        # Get recent events (last 10)
        events = await conn.fetch("""
            SELECT 
                'node_seen' as event_type,
                hostname as subject,
                node_id as subject_id,
                last_seen as timestamp
            FROM nodes
            ORDER BY last_seen DESC
            LIMIT 10
        """)
        
        return {
            "counts": {
                "total": counts["total"],
                "online": counts["online"],
                "away": counts["away"],
                "offline": counts["offline"],
                "unassigned": unassigned
            },
            # Same counts as the vulnerabilities page (per node, not per stored row).
            "vulnerabilities": {
                "total": sum(severity_counts.values()),
                "critical": severity_counts.get("CRITICAL", 0),
                "high": severity_counts.get("HIGH", 0),
                "medium": severity_counts.get("MEDIUM", 0),
                "low": severity_counts.get("LOW", 0)
            },
            "jobs": {
                "total": job_stats["total"] if job_stats else 0,
                "success": job_stats["success"] if job_stats else 0,
                "failed": job_stats["failed"] if job_stats else 0,
                "running": job_stats["running"] if job_stats else 0,
                "pending": job_stats["pending"] if job_stats else 0
            },
            "alerts": {
                "active": active_alerts
            },
            "recent_events": [
                {
                    "type": e["event_type"],
                    "subject": e["subject"],
                    "subject_id": e["subject_id"],
                    "timestamp": e["timestamp"].isoformat() if e["timestamp"] else None
                }
                for e in events
            ]
        }
