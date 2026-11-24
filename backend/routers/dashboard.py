
import asyncpg
from fastapi import APIRouter, Depends

import vulnerability_cache
from auth import require_user_permission
from dependencies import get_db, verify_api_key
from node_status import status_sql

router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/summary", dependencies=[Depends(require_user_permission("nodes:read"))])
async def get_dashboard_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get dashboard summary with counts and recent events"""
    async with db.acquire() as conn:
        # Get node counts by status
        # (the same status as the Nodes list and the Fleet tree, which the card links to)
        counts = await conn.fetchrow(f"""
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE status = 'online') AS online,
                   COUNT(*) FILTER (WHERE status = 'away') AS away,
                   COUNT(*) FILTER (WHERE status = 'offline') AS offline
            FROM (SELECT {status_sql("n")} AS status FROM nodes n) s
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
        
        # Counts from the vulnerability cache (one row), as of when
        fleet = await conn.fetchrow("SELECT critical, high, medium, low, unknown FROM vulnerability_fleet_summary WHERE id = 1")
        severity_counts = {"CRITICAL": fleet["critical"], "HIGH": fleet["high"], "MEDIUM": fleet["medium"],
                           "LOW": fleet["low"], "UNKNOWN": fleet["unknown"]} if fleet else {}
        cache = await vulnerability_cache.status(conn)
        scan_completed_at = await conn.fetchval("""
            SELECT MAX(completed_at) FROM vulnerability_scans
            WHERE status IN ('completed', 'partial') AND completed_at IS NOT NULL
        """)

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
                "low": severity_counts.get("LOW", 0),
                # From the vulnerability cache: as of when, nodes waiting for a rebuild, last scan
                "as_of": cache["refreshed_at"],
                "refreshing": cache["refreshing"],
                "pending_nodes": cache["pending_nodes"],
                "scan_completed_at": scan_completed_at.isoformat() if scan_completed_at else None
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
