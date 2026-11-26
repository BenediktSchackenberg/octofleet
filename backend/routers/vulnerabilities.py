"""
Octofleet API - Vulnerabilities Routes
"""
import logging

logger = logging.getLogger(__name__)
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import msrc
import vulnerability_cache
from auth import CurrentUser, require_user_permission
from dependencies import get_pool, verify_api_key
from remediation import RemediationEngine
from vulnerability import (
    VulnerabilityScanner,
    clear_osv_cache,
    get_cve_lookup,
    get_cve_suggestions,
    get_node_vulnerabilities,
    get_node_vulnerability_groups,
    get_scan_status,
    get_update_vulnerabilities,
    normalize_cve_id,
    normalize_cve_prefix,
    osv_cache_status,
    run_vulnerability_scan,
    verify_osv_cache,
)

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
                                _: CurrentUser = Depends(require_user_permission("settings:write"))):
    """Show installed software that was checked or deliberately left unverified."""
    async with get_pool().acquire() as conn:
        inventory = """WITH inventory AS (
            SELECT s.name, s.version, COALESCE(s.publisher, '') AS publisher,
                BOOL_OR(COALESCE(n.os_name, '') ~* '(linux|ubuntu|debian|red hat|rhel|fedora|centos|suse|alpine)') AS is_linux,
                BOOL_AND(COALESCE(n.os_name, '') ~* 'windows') AS is_windows
            FROM software_current s JOIN nodes n ON n.id = s.node_id
            WHERE s.version IS NOT NULL AND s.version != ''
            GROUP BY s.name, s.version, COALESCE(s.publisher, '')
        )"""
        base = """FROM inventory i
            LEFT JOIN software_vulnerability_checks c ON c.name = i.name AND c.version = i.version AND c.publisher = i.publisher
            LEFT JOIN software_cpe_mappings m ON m.name = i.name AND m.publisher = i.publisher
            WHERE ($1::text IS NULL OR COALESCE(c.status, 'not_checked') = $1)"""
        total = await conn.fetchval(f"{inventory} SELECT COUNT(*) {base}", status)
        rows = await conn.fetch(f"""{inventory} SELECT i.name, i.version, i.publisher, i.is_linux, i.is_windows,
            COALESCE(c.status, 'not_checked') AS status,
            COALESCE(c.reason, 'Never checked') AS reason,
            c.cpe_name, c.checked_at, m.cpe_vendor, m.cpe_product, m.source
            {base} ORDER BY i.name, i.version LIMIT $2 OFFSET $3""", status, limit, offset)
    return {"items": [dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}


@router.put("/api/v1/vulnerabilities/cpe-mappings")
async def set_cpe_mapping(data: CpeMappingUpdate,
                          user: CurrentUser = Depends(require_user_permission("settings:write"))):
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


@router.get("/api/v1/vulnerabilities/summary", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def vulnerability_summary_route():
    """Vulnerability summary from the vulnerability cache (`cache.refreshed_at`: as of when;
    `cache.pending_nodes`: nodes waiting for a rebuild). The scan status is live."""
    async with get_pool().acquire() as conn:
        return {**await get_scan_status(conn), **await vulnerability_cache.fleet_summary(conn),
                "cache": await vulnerability_cache.status(conn)}


@router.get("/api/v1/vulnerabilities/summary/status", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def vulnerability_summary_status():
    """As of when the cached numbers are complete, nodes waiting for a rebuild, whether the cache
    is being rebuilt, and the seconds until the refresh button may be used again."""
    async with get_pool().acquire() as conn:
        return {**await vulnerability_cache.status(conn),
                "retry_after": vulnerability_cache.seconds_until_manual_refresh()}


@router.post("/api/v1/vulnerabilities/summary/refresh", status_code=202)
async def refresh_vulnerability_summary(_: CurrentUser = Depends(require_user_permission("settings:write"))):
    """Rebuild the vulnerability cache of every node (in the background), at most once a minute.
    Poll /summary/status until `refreshing` is false."""
    wait = vulnerability_cache.seconds_until_manual_refresh()
    if wait:
        raise HTTPException(status_code=429, detail=f"The vulnerability numbers were recalculated less than a minute ago; try again in {wait} s",
                            headers={"Retry-After": str(wait)})
    await vulnerability_cache.refresh_all(get_pool())
    return {"status": "started"}


@router.get("/api/v1/vulnerabilities/msrc", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def msrc_status():
    """Microsoft's Security Update Guide as the source for Windows itself: the background sync
    (documents, stored fixes, last check, error), the mapped Windows releases, and how many
    Windows nodes were checked or are unknown (no build, release not mapped, no data yet)."""
    async with get_pool().acquire() as conn:
        return await msrc.status(conn)


@router.post("/api/v1/vulnerabilities/msrc/documents")
async def import_msrc_document(document: Dict[str, Any] = Body(...),
                               _: CurrentUser = Depends(require_user_permission("settings:write"))):
    """Store one monthly CVRF document (as downloaded from api.msrc.microsoft.com/cvrf/v3.0/cvrf/<id>),
    for installations without access to the API. It replaces an earlier version of the same month."""
    try:
        async with get_pool().acquire() as conn:
            return await msrc.import_document(conn, document)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.get("/api/v1/vulnerabilities/by-node", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def vulnerabilities_by_node(limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0),
                                  severity: Optional[str] = Query(None, pattern="^(critical|CRITICAL|high|HIGH)$"),
                                  _: str = Depends(verify_api_key)):
    """Vulnerability breakdown per node from the vulnerability cache, most findings first, one page
    (`total` nodes in all): distinct CVEs by their worst severity, affected updates.
    `severity=critical` / `high`: only nodes with CVEs of that severity, most first."""
    async with get_pool().acquire() as conn:
        return await vulnerability_cache.nodes_page(conn, limit, offset, severity=severity.lower() if severity else None)


@router.get("/api/v1/vulnerabilities/by-software", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def vulnerabilities_by_software(_: str = Depends(verify_api_key)):
    """The 20 updates (source package on Linux, product on Windows) with the most CVEs, from the
    vulnerability cache, with affected node names."""
    async with get_pool().acquire() as conn:
        return await vulnerability_cache.software_page(conn, 20)


@router.get("/api/v1/vulnerabilities/by-software/cves", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def update_vulnerabilities(unit: str, unit_version: str, _: str = Depends(verify_api_key)):
    """CVEs of one update (as listed by by-software) across all nodes, with the affected nodes."""
    vulnerabilities = await get_update_vulnerabilities(get_pool(), unit, unit_version)
    return {"vulnerabilities": vulnerabilities, "count": len(vulnerabilities)}


@router.get("/api/v1/vulnerabilities/cves", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def cve_suggestions(q: str = Query(..., max_length=40), limit: int = Query(10, ge=1, le=50)):
    """Known CVE IDs starting with q (at least the year: CVE-2026 or 2026-987), in ID order, for
    suggestions; at most limit."""
    prefix = normalize_cve_prefix(q)
    if not prefix:
        raise HTTPException(status_code=400, detail="Enter at least CVE-YYYY")
    return {"items": await get_cve_suggestions(get_pool(), prefix, limit)}


@router.get("/api/v1/vulnerabilities/cves/{cve_id}", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def cve_lookup(cve_id: str, limit: int = Query(500, ge=1, le=5000), offset: int = Query(0, ge=0)):
    """Which nodes one CVE affects now: the CVE's details, `affected_nodes` (total) and one page of
    the nodes with their affected packages, and the scan status. 404 if no scan has matched the CVE;
    a known CVE that affects no node has `affected_nodes` 0."""
    normalized = normalize_cve_id(cve_id)
    if not normalized:
        raise HTTPException(status_code=400, detail="Not a CVE ID (CVE-YYYY-NNNN)")
    result = await get_cve_lookup(get_pool(), normalized, limit, offset)
    if result is None:
        raise HTTPException(status_code=404, detail="CVE unknown to Octofleet")
    return result


@router.get("/api/v1/vulnerabilities/node/{node_id}", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def node_vulnerabilities(node_id: str, limit: Optional[int] = Query(None, ge=1, le=1000),
                               unit: Optional[str] = None, unit_version: Optional[str] = None):
    """CVEs affecting one node (id or hostname), most severe first, one entry per CVE.

    count is the total for the node; with limit only the first entries are returned
    (e.g. a preview of the most severe ones). unit and unit_version narrow the list to one
    update from /groups.
    """
    result = await get_node_vulnerabilities(get_pool(), node_id, limit, unit, unit_version)
    if result is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/api/v1/vulnerabilities/node/{node_id}/groups", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def node_vulnerability_groups(node_id: str, _: str = Depends(verify_api_key)):
    """CVEs of one node grouped by the update that fixes them."""
    result = await get_node_vulnerability_groups(get_pool(), node_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return result


@router.get("/api/v1/vulnerabilities", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
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
            ORDER BY array_position(ARRAY['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], v.severity) NULLS LAST, v.cvss_score DESC NULLS LAST, v.discovered_at DESC
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
                                     body: Optional[Dict[str, Any]] = Body(None),
                                     _: CurrentUser = Depends(require_user_permission("settings:write"))):
    """Trigger a full vulnerability scan of all software inventory.

    `{"refresh_cache": true}` ignores the OSV cache for this scan and stores every advisory again."""
    nvd_api_key = os.environ.get("NVD_API_KEY")
    scanner = VulnerabilityScanner(get_pool(), nvd_api_key)
    scanner.refresh_osv_cache = bool((body or {}).get("refresh_cache"))
    
    # Create scan record
    async with get_pool().acquire() as conn:
        scan_id = await conn.fetchval("""
            INSERT INTO vulnerability_scans (status, cache_refresh) VALUES ('running', $1) RETURNING id
        """, scanner.refresh_osv_cache)
    
    async def create_remediation_jobs():
        # AUTO-REMEDIATION: after a complete scan, create remediation jobs
        engine = RemediationEngine(get_pool())
        remediation_result = await engine.scan_and_create_jobs(
            severity_filter=['CRITICAL', 'HIGH'],
            dry_run=False,
            auto_only=True
        )
        logger.info(f"Auto-remediation: Created {remediation_result['jobs_created']} jobs for {remediation_result['with_fix_available']} fixable vulns")

    background_tasks.add_task(run_vulnerability_scan, get_pool(), scanner, scan_id, create_remediation_jobs)
    
    return {"scan_id": scan_id, "status": "started", "message": "Vulnerability scan started in background"}


@router.get("/api/v1/vulnerabilities/osv-cache", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
async def get_osv_cache_status():
    """Entries, age and size of the OSV advisory cache."""
    return await osv_cache_status(get_pool())


async def _scan_running() -> bool:
    async with get_pool().acquire() as conn:
        return bool(await conn.fetchval("SELECT 1 FROM vulnerability_scans WHERE status = 'running' LIMIT 1"))


@router.delete("/api/v1/vulnerabilities/osv-cache")
async def delete_osv_cache(_: CurrentUser = Depends(require_user_permission("settings:write"))):
    """Clear the OSV cache; the next scan downloads every advisory again."""
    if await _scan_running():
        raise HTTPException(status_code=409, detail="A scan is running; clear the cache after it has finished")
    return {"deleted": await clear_osv_cache(get_pool())}


@router.post("/api/v1/vulnerabilities/osv-cache/verify")
async def verify_osv_cache_sample(sample: int = Query(50, ge=1, le=500),
                                  _: CurrentUser = Depends(require_user_permission("settings:write"))):
    """Download a random sample of cached advisories again and compare; differing entries are corrected."""
    scanner = VulnerabilityScanner(get_pool())
    return await verify_osv_cache(get_pool(), scanner, sample)


@router.post("/api/v1/vulnerabilities/scans/{scan_id}/cancel")
async def cancel_vulnerability_scan(scan_id: int, _: CurrentUser = Depends(require_user_permission("settings:write"))):
    """Stop a running scan before its next software version; it ends as 'cancelled'."""
    async with get_pool().acquire() as conn:
        updated = await conn.fetchval("""UPDATE vulnerability_scans SET cancel_requested = TRUE
            WHERE id = $1 AND status = 'running' RETURNING id""", scan_id)
    if not updated:
        raise HTTPException(status_code=409, detail="Scan is not running")
    return {"scan_id": scan_id, "status": "cancelling"}


@router.get("/api/v1/vulnerabilities/scans", dependencies=[Depends(require_user_permission("vulnerabilities:read"))])
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
    user: CurrentUser = Depends(require_user_permission("settings:write"))
):
    """Suppress a vulnerability (mark as accepted risk or false positive)."""
    username = user.username
    
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
