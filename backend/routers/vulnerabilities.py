"""
Octofleet API - Vulnerabilities Routes
"""
import logging

logger = logging.getLogger(__name__)
import os
import re
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import CurrentUser, require_permission
from dependencies import get_pool, verify_api_key
from remediation import RemediationEngine
from vulnerability import VulnerabilityScanner, get_node_vulnerabilities, get_vulnerability_summary

router = APIRouter(tags=["Vulnerabilities"])


class CpeMappingUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    publisher: str = Field(default="", max_length=255)
    cpe_vendor: str | None = None
    cpe_product: str | None = None
    skip: bool = False


@router.get("/api/v1/vulnerabilities/checks")
async def software_check_status(status: str | None = Query(None, pattern="^(checked|not_checked)$"),
                                limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0),
                                _: CurrentUser = Depends(require_permission("settings:write"))):
    """Show installed software that was checked or deliberately left unverified."""
    async with get_pool().acquire() as conn:
        inventory = """WITH inventory AS (
            SELECT DISTINCT name, version, COALESCE(publisher, '') AS publisher
            FROM software_current WHERE version IS NOT NULL AND version != ''
        )"""
        base = """FROM inventory i
            LEFT JOIN software_vulnerability_checks c ON c.name = i.name AND c.version = i.version AND c.publisher = i.publisher
            LEFT JOIN software_cpe_mappings m ON m.name = i.name AND m.publisher = i.publisher
            WHERE ($1::text IS NULL OR COALESCE(c.status, 'not_checked') = $1)"""
        total = await conn.fetchval(f"{inventory} SELECT COUNT(*) {base}", status)
        rows = await conn.fetch(f"""{inventory} SELECT i.name, i.version, i.publisher,
            COALESCE(c.status, 'not_checked') AS status,
            COALESCE(c.reason, 'Never checked') AS reason,
            c.cpe_name, c.checked_at, m.cpe_vendor, m.cpe_product, m.source
            {base} ORDER BY i.name, i.version LIMIT $2 OFFSET $3""", status, limit, offset)
    return {"items": [dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@router.put("/api/v1/vulnerabilities/cpe-mappings")
async def set_cpe_mapping(data: CpeMappingUpdate,
                          user: CurrentUser = Depends(require_permission("settings:write"))):
    """Set a reviewed application CPE vendor/product or skip the software."""
    if not data.skip and not all(re.fullmatch(r"[a-z0-9][a-z0-9._-]*", part or "")
                             for part in (data.cpe_vendor, data.cpe_product)):
        raise HTTPException(status_code=400, detail="CPE vendor and product must be lowercase CPE components")
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            exists = await conn.fetchval("""SELECT 1 FROM software_current
                WHERE name = $1 AND COALESCE(publisher, '') = $2 LIMIT 1""", data.name, data.publisher)
            if not exists:
                raise HTTPException(status_code=404, detail="Software not found")
            await conn.execute("""INSERT INTO software_cpe_mappings
                (name, publisher, cpe_vendor, cpe_product, status, source, updated_at, updated_by)
                VALUES ($1, $2, $3, $4, $5, 'manual', NOW(), $6)
                ON CONFLICT (name, publisher) DO UPDATE SET
                    cpe_vendor = EXCLUDED.cpe_vendor, cpe_product = EXCLUDED.cpe_product,
                    status = EXCLUDED.status, source = 'manual', updated_at = NOW(), updated_by = EXCLUDED.updated_by""",
                data.name, data.publisher, None if data.skip else data.cpe_vendor,
                None if data.skip else data.cpe_product, "skipped" if data.skip else "matched", user.username)
            await conn.execute("""UPDATE vulnerabilities SET match_source = 'stale'
                WHERE software_name = $1 AND match_source = 'nvd_cpe'""", data.name)
            await conn.execute("""UPDATE software_vulnerability_checks SET status = 'not_checked',
                reason = 'CPE mapping changed; rescan required', cpe_name = NULL
                WHERE name = $1 AND publisher = $2""", data.name, data.publisher)
    return {"status": "saved", "rescan_required": True}


@router.get("/api/v1/vulnerabilities/summary")
async def vulnerability_summary():
    """Get vulnerability dashboard summary."""
    return await get_vulnerability_summary(get_pool())


@router.get("/api/v1/vulnerabilities/by-node")
async def vulnerabilities_by_node(_: str = Depends(verify_api_key)):
    """Get vulnerability breakdown per node with severity counts."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.id, n.hostname, n.os_name, n.last_seen,
                COUNT(DISTINCT v.id) as total_vulns,
                COUNT(DISTINCT CASE WHEN v.severity='CRITICAL' THEN v.id END) as critical,
                COUNT(DISTINCT CASE WHEN v.severity='HIGH' THEN v.id END) as high,
                COUNT(DISTINCT CASE WHEN v.severity='MEDIUM' THEN v.id END) as medium,
                COUNT(DISTINCT CASE WHEN v.severity='LOW' THEN v.id END) as low,
                MAX(v.cvss_score) as max_cvss,
                COUNT(DISTINCT s.name) as affected_software_count
            FROM nodes n
            JOIN software_current s ON s.node_id = n.id
            JOIN verified_vulnerabilities v ON s.name = v.software_name AND s.version = v.software_version
            LEFT JOIN node_vulnerabilities nv ON nv.vulnerability_id = v.id AND nv.node_id = n.id::text
            WHERE nv.status IS NULL OR nv.status != 'fixed'
            GROUP BY n.id, n.hostname, n.os_name, n.last_seen
            ORDER BY total_vulns DESC
        """)
        return {"nodes": [{
            "id": str(r["id"]), "hostname": r["hostname"], "os_type": r["os_name"],
            "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
            "total_vulns": r["total_vulns"], "critical": r["critical"], "high": r["high"],
            "medium": r["medium"], "low": r["low"], "max_cvss": float(r["max_cvss"]) if r["max_cvss"] else 0,
            "affected_software_count": r["affected_software_count"]
        } for r in rows]}


@router.get("/api/v1/vulnerabilities/by-software")
async def vulnerabilities_by_software(_: str = Depends(verify_api_key)):
    """Get vulnerability breakdown per software with affected node names."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT v.software_name, v.software_version,
                COUNT(DISTINCT v.id) as vuln_count,
                MAX(v.cvss_score) as max_cvss,
                COUNT(DISTINCT CASE WHEN v.severity='CRITICAL' THEN v.id END) as critical,
                COUNT(DISTINCT CASE WHEN v.severity='HIGH' THEN v.id END) as high,
                array_agg(DISTINCT n.hostname) as affected_nodes
            FROM verified_vulnerabilities v
            JOIN software_current s ON s.name = v.software_name AND s.version = v.software_version
            JOIN nodes n ON n.id = s.node_id
            LEFT JOIN node_vulnerabilities nv ON nv.vulnerability_id = v.id AND nv.node_id = n.id::text
            WHERE nv.status IS NULL OR nv.status != 'fixed'
            GROUP BY v.software_name, v.software_version
            ORDER BY vuln_count DESC
            LIMIT 20
        """)
        return {"software": [{
            "software_name": r["software_name"], "software_version": r["software_version"],
            "vuln_count": r["vuln_count"], "max_cvss": float(r["max_cvss"]) if r["max_cvss"] else 0,
            "critical": r["critical"], "high": r["high"],
            "affected_nodes": list(r["affected_nodes"])
        } for r in rows]}


@router.get("/api/v1/vulnerabilities/node/{node_id}")
async def node_vulnerabilities(node_id: str, limit: Optional[int] = Query(None, ge=1, le=1000)):
    """Vulnerabilities affecting one node (id or hostname), most severe first.

    count is the total for the node; with limit only the first entries are returned
    (e.g. a preview of the most severe ones).
    """
    result = await get_node_vulnerabilities(get_pool(), node_id, limit)
    if result is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/api/v1/vulnerabilities")
async def list_vulnerabilities(
    severity: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """List all discovered vulnerabilities with optional filtering."""
    async with get_pool().acquire() as conn:
        query = """
            SELECT v.*, COALESCE(installs.affected_nodes, 0) AS affected_nodes
            FROM verified_vulnerabilities v
            LEFT JOIN (
                SELECT name, version, COUNT(DISTINCT node_id) AS affected_nodes
                FROM software_current GROUP BY name, version
            ) installs ON installs.name = v.software_name AND installs.version = v.software_version
        """
        params = []
        
        if severity:
            query += " WHERE v.severity = $1"
            params.append(severity.upper())
        
        query += """
            ORDER BY v.cvss_score DESC NULLS LAST, v.discovered_at DESC
            LIMIT $%d OFFSET $%d
        """ % (len(params) + 1, len(params) + 2)
        params.extend([limit, offset])
        
        rows = await conn.fetch(query, *params)
        
        # Get total count
        count_query = "SELECT COUNT(*) FROM verified_vulnerabilities"
        if severity:
            count_query += " WHERE severity = $1"
            total = await conn.fetchval(count_query, severity.upper()) if severity else await conn.fetchval(count_query)
        else:
            total = await conn.fetchval(count_query)
        
        return {
            "vulnerabilities": [dict(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset
        }


@router.post("/api/v1/vulnerabilities/scan")
async def trigger_vulnerability_scan(background_tasks: BackgroundTasks,
                                     _: CurrentUser = Depends(require_permission("settings:write"))):
    """Trigger a full vulnerability scan of all software inventory."""
    nvd_api_key = os.environ.get("NVD_API_KEY")
    scanner = VulnerabilityScanner(get_pool(), nvd_api_key)
    
    # Create scan record
    async with get_pool().acquire() as conn:
        scan_id = await conn.fetchval("""
            INSERT INTO vulnerability_scans (status) VALUES ('running') RETURNING id
        """)
    
    async def run_scan():
        try:
            result = await scanner.scan_all_nodes()
            async with get_pool().acquire() as conn:
                await conn.execute("""
                    UPDATE vulnerability_scans SET
                        completed_at = NOW(),
                        packages_scanned = $1,
                        vulnerabilities_found = $2,
                        critical_count = $3,
                        high_count = $4,
                        status = 'completed'
                    WHERE id = $5
                """, 
                    result["scanned_packages"],
                    result["total_vulnerabilities"],
                    result["critical"],
                    result["high"],
                    scan_id
                )
            
            # AUTO-REMEDIATION: After vuln scan completes, create remediation jobs
            try:
                engine = RemediationEngine(get_pool())
                remediation_result = await engine.scan_and_create_jobs(
                    severity_filter=['CRITICAL', 'HIGH'],
                    dry_run=False
                )
                logger.info(f"Auto-remediation: Created {remediation_result['jobs_created']} jobs for {remediation_result['with_fix_available']} fixable vulns")
            except Exception as re:
                logger.error(f"Auto-remediation failed: {re}")
                
        except Exception as e:
            async with get_pool().acquire() as conn:
                await conn.execute("""
                    UPDATE vulnerability_scans SET
                        completed_at = NOW(),
                        status = 'failed',
                        error_message = $1
                    WHERE id = $2
                """, str(e), scan_id)
    
    background_tasks.add_task(run_scan)
    
    return {"scan_id": scan_id, "status": "started", "message": "Vulnerability scan started in background"}


@router.get("/api/v1/vulnerabilities/scans")
async def list_vulnerability_scans(limit: int = 10):
    """Get vulnerability scan history."""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM vulnerability_scans
            ORDER BY started_at DESC
            LIMIT $1
        """, limit)
        return {"scans": [dict(row) for row in rows]}


@router.post("/api/v1/vulnerabilities/{cve_id}/suppress")
async def suppress_vulnerability(
    cve_id: str,
    reason: str = Body(...),
    software_name: Optional[str] = Body(None),
    expires_days: Optional[int] = Body(None),
    auth: Any = Depends(verify_api_key)
):
    """Suppress a vulnerability (mark as accepted risk or false positive)."""
    # Get username from JWT payload or default to 'api-key'
    username = "api-key"
    if isinstance(auth, dict):
        username = auth.get("sub") or auth.get("username") or auth.get("email", "unknown")
    
    expires_at = None
    if expires_days:
        expires_at = datetime.utcnow() + timedelta(days=expires_days)
    
    async with get_pool().acquire() as conn:
        await conn.execute("""
            INSERT INTO vulnerability_suppressions (cve_id, software_name, reason, suppressed_by, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (cve_id, software_name) DO UPDATE SET
                reason = EXCLUDED.reason,
                suppressed_by = EXCLUDED.suppressed_by,
                suppressed_at = NOW(),
                expires_at = EXCLUDED.expires_at
        """, cve_id, software_name, reason, username, expires_at)
        
    return {"status": "suppressed", "cve_id": cve_id}
