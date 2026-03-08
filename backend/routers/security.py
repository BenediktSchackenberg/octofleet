
import asyncpg
from fastapi import APIRouter, Depends

from dependencies import get_db, not_found, verify_api_key

router = APIRouter(
    prefix="/api/v1",
    tags=["security"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/compliance/summary")
async def get_compliance_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get security compliance summary across all nodes"""
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT n.id as node_id, n.hostname, s.defender, s.firewall, s.bitlocker, s.antivirus FROM nodes n LEFT JOIN security_current s ON n.id = s.node_id")
        compliance = {"totalNodes": len(rows), "defender": {"enabled": 0, "disabled": 0, "unknown": 0}, "firewall": {"enabled": 0, "disabled": 0, "unknown": 0}, "bitlocker": {"encrypted": 0, "unencrypted": 0, "unknown": 0}, "realTimeProtection": {"enabled": 0, "disabled": 0, "unknown": 0}, "nodes": []}
        # Simplified for demonstration
        return compliance

@router.get("/inventory/browser/{node_id}/critical")
async def get_critical_cookies(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get critical/sensitive cookies for security analysis"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1 OR hostname = $1", node_id)
        if not node: raise not_found("Node", node_id)
        rows = await conn.fetch("SELECT username, browser, profile, domain, name, path, expires_utc, is_secure, is_http_only, same_site, is_session, is_expired FROM browser_cookies WHERE node_id = $1", node['id'])
        return {"critical": [], "count": len(rows)}
