"""
E38: Software Metering & License Tracking
Catalog, normalization, licenses, compliance, usage, and reporting endpoints.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_db, not_found, verify_api_key

router = APIRouter(prefix="/api/v1/metering", dependencies=[Depends(verify_api_key)])


# ─── helpers ───────────────────────────────────────────────────────────────────

async def _installed_count_for_catalog(conn, catalog_id: UUID) -> int:
    """Count distinct nodes with software matching a catalog entry's normalization rules."""
    # First try normalization rules
    rules = await conn.fetch(
        "SELECT pattern, match_type FROM software_normalization_rules WHERE catalog_id = $1 ORDER BY priority DESC",
        catalog_id,
    )
    if rules:
        conditions = []
        for r in rules:
            if r["match_type"] == "exact":
                conditions.append(f"sc.name = '{_esc(r['pattern'])}'")
            elif r["match_type"] == "regex":
                conditions.append(f"sc.name ~ '{_esc(r['pattern'])}'")
            else:  # like
                conditions.append(f"sc.name ILIKE '{_esc(r['pattern'])}'")
        where = " OR ".join(conditions)
        return await conn.fetchval(
            f"SELECT COUNT(DISTINCT sc.node_id) FROM software_current sc WHERE {where}"
        ) or 0

    # Fallback: exact match on canonical_name
    cat = await conn.fetchrow("SELECT canonical_name FROM software_catalog WHERE id = $1", catalog_id)
    if not cat:
        return 0
    return await conn.fetchval(
        "SELECT COUNT(DISTINCT node_id) FROM software_current WHERE name ILIKE $1",
        cat["canonical_name"],
    ) or 0


async def _installed_nodes_for_catalog(conn, catalog_id: UUID) -> list:
    """Return list of node rows with software matching a catalog entry."""
    rules = await conn.fetch(
        "SELECT pattern, match_type FROM software_normalization_rules WHERE catalog_id = $1 ORDER BY priority DESC",
        catalog_id,
    )
    if rules:
        conditions = []
        for r in rules:
            if r["match_type"] == "exact":
                conditions.append(f"sc.name = '{_esc(r['pattern'])}'")
            elif r["match_type"] == "regex":
                conditions.append(f"sc.name ~ '{_esc(r['pattern'])}'")
            else:
                conditions.append(f"sc.name ILIKE '{_esc(r['pattern'])}'")
        where = " OR ".join(conditions)
        return await conn.fetch(f"""
            SELECT DISTINCT sc.node_id, n.hostname, sc.name, sc.version, sc.install_date
            FROM software_current sc
            JOIN nodes n ON n.id = sc.node_id
            WHERE {where}
        """)

    cat = await conn.fetchrow("SELECT canonical_name FROM software_catalog WHERE id = $1", catalog_id)
    if not cat:
        return []
    return await conn.fetch("""
        SELECT DISTINCT sc.node_id, n.hostname, sc.name, sc.version, sc.install_date
        FROM software_current sc JOIN nodes n ON n.id = sc.node_id
        WHERE sc.name ILIKE $1
    """, cat["canonical_name"])


def _esc(s: str) -> str:
    """Escape single quotes for safe SQL interpolation in dynamic WHERE clauses."""
    return s.replace("'", "''")


def _compliance_status(total_licenses: Optional[int], installed: int) -> str:
    if total_licenses is None:
        return "unlimited"
    if installed > total_licenses:
        return "under_licensed"
    if total_licenses > installed * 1.2 and total_licenses > installed + 2:
        return "over_licensed"
    return "compliant"


# ─── CATALOG ───────────────────────────────────────────────────────────────────

@router.get("/catalog")
async def list_catalog(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, canonical_name, publisher, category, is_tracked, notes, created_at, updated_at
            FROM software_catalog ORDER BY canonical_name
        """)
        result = []
        for r in rows:
            cid = r["id"]
            installed = await _installed_count_for_catalog(conn, cid)
            # license info
            lic = await conn.fetchrow("""
                SELECT COALESCE(SUM(total_licenses), 0) as total,
                       COUNT(*) as lic_count,
                       COALESCE(SUM(cost_per_license * COALESCE(total_licenses, 0)), 0) as total_cost
                FROM software_licenses WHERE catalog_id = $1
            """, cid)
            total_lic = int(lic["total"]) if lic["total"] else None
            # check if any license is unlimited (total_licenses IS NULL)
            has_unlimited = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM software_licenses WHERE catalog_id = $1 AND total_licenses IS NULL)", cid
            )
            if has_unlimited:
                total_lic = None
            status = _compliance_status(total_lic, installed)
            result.append({
                "id": str(cid),
                "canonicalName": r["canonical_name"],
                "publisher": r["publisher"],
                "category": r["category"],
                "isTracked": r["is_tracked"],
                "notes": r["notes"],
                "installedCount": installed,
                "licenseCount": int(lic["lic_count"]),
                "totalLicenses": total_lic,
                "totalCost": float(lic["total_cost"]),
                "complianceStatus": status,
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
            })
        return {"catalog": result, "count": len(result)}


@router.post("/catalog")
async def create_catalog_entry(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow("""
                INSERT INTO software_catalog (canonical_name, publisher, category, is_tracked, notes)
                VALUES ($1, $2, $3, $4, $5) RETURNING id
            """, data["canonicalName"], data.get("publisher"), data.get("category", "Other"),
                data.get("isTracked", True), data.get("notes"))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"Catalog entry '{data['canonicalName']}' already exists")
        return {"id": str(row["id"]), "status": "created"}


@router.put("/catalog/{catalog_id}")
async def update_catalog_entry(catalog_id: UUID, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE software_catalog SET
                canonical_name = COALESCE($2, canonical_name),
                publisher = COALESCE($3, publisher),
                category = COALESCE($4, category),
                is_tracked = COALESCE($5, is_tracked),
                notes = COALESCE($6, notes),
                updated_at = now()
            WHERE id = $1 RETURNING id
        """, catalog_id, data.get("canonicalName"), data.get("publisher"),
            data.get("category"), data.get("isTracked"), data.get("notes"))
        if not row:
            raise not_found("Catalog entry", str(catalog_id))
        return {"status": "updated"}


@router.delete("/catalog/{catalog_id}")
async def delete_catalog_entry(catalog_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM software_catalog WHERE id = $1 RETURNING canonical_name", catalog_id)
        if not row:
            raise not_found("Catalog entry", str(catalog_id))
        return {"status": "deleted", "name": row["canonical_name"]}


@router.post("/catalog/auto-discover")
async def auto_discover_catalog(
    min_installs: int = Query(2, description="Minimum install count to include"),
    limit: int = Query(100, description="Max entries to create"),
    db: asyncpg.Pool = Depends(get_db),
):
    """Auto-create catalog entries from software_current grouped by name."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT sc.name, sc.publisher, COUNT(DISTINCT sc.node_id) as node_count
            FROM software_current sc
            LEFT JOIN software_catalog cat ON LOWER(cat.canonical_name) = LOWER(sc.name)
            WHERE cat.id IS NULL
            GROUP BY sc.name, sc.publisher
            HAVING COUNT(DISTINCT sc.node_id) >= $1
            ORDER BY COUNT(DISTINCT sc.node_id) DESC
            LIMIT $2
        """, min_installs, limit)

        created = []
        for r in rows:
            try:
                cid = await conn.fetchval("""
                    INSERT INTO software_catalog (canonical_name, publisher, category)
                    VALUES ($1, $2, 'Other') RETURNING id
                """, r["name"], r["publisher"])
                created.append({"id": str(cid), "name": r["name"], "publisher": r["publisher"], "nodeCount": r["node_count"]})
            except asyncpg.UniqueViolationError:
                continue
        return {"created": created, "count": len(created)}


# ─── NORMALIZATION RULES ───────────────────────────────────────────────────────

@router.get("/rules")
async def list_rules(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT r.id, r.pattern, r.match_type, r.catalog_id, r.priority, r.created_at,
                   c.canonical_name
            FROM software_normalization_rules r
            JOIN software_catalog c ON c.id = r.catalog_id
            ORDER BY c.canonical_name, r.priority DESC
        """)
        return {"rules": [
            {"id": r["id"], "pattern": r["pattern"], "matchType": r["match_type"],
             "catalogId": str(r["catalog_id"]), "catalogName": r["canonical_name"],
             "priority": r["priority"],
             "createdAt": r["created_at"].isoformat() if r["created_at"] else None}
            for r in rows
        ]}


@router.post("/rules")
async def create_rule(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO software_normalization_rules (pattern, match_type, catalog_id, priority)
            VALUES ($1, $2, $3, $4) RETURNING id
        """, data["pattern"], data.get("matchType", "like"), UUID(data["catalogId"]),
            data.get("priority", 0))
        return {"id": row["id"], "status": "created"}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM software_normalization_rules WHERE id = $1 RETURNING id", rule_id)
        if not row:
            raise not_found("Rule", str(rule_id))
        return {"status": "deleted"}


@router.post("/rules/test")
async def test_rule(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Test a pattern against software_current and return matches."""
    pattern = data["pattern"]
    match_type = data.get("matchType", "like")
    async with db.acquire() as conn:
        if match_type == "exact":
            rows = await conn.fetch(
                "SELECT DISTINCT name, publisher, COUNT(DISTINCT node_id) as node_count FROM software_current WHERE name = $1 GROUP BY name, publisher ORDER BY node_count DESC LIMIT 50",
                pattern)
        elif match_type == "regex":
            rows = await conn.fetch(
                "SELECT DISTINCT name, publisher, COUNT(DISTINCT node_id) as node_count FROM software_current WHERE name ~ $1 GROUP BY name, publisher ORDER BY node_count DESC LIMIT 50",
                pattern)
        else:
            rows = await conn.fetch(
                "SELECT DISTINCT name, publisher, COUNT(DISTINCT node_id) as node_count FROM software_current WHERE name ILIKE $1 GROUP BY name, publisher ORDER BY node_count DESC LIMIT 50",
                pattern)
        return {"matches": [{"name": r["name"], "publisher": r["publisher"], "nodeCount": r["node_count"]} for r in rows],
                "totalMatches": len(rows)}


# ─── LICENSES ──────────────────────────────────────────────────────────────────

@router.get("/licenses")
async def list_licenses(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT l.*, c.canonical_name
            FROM software_licenses l
            JOIN software_catalog c ON c.id = l.catalog_id
            ORDER BY c.canonical_name
        """)
        result = []
        for r in rows:
            installed = await _installed_count_for_catalog(conn, r["catalog_id"])
            status = _compliance_status(r["total_licenses"], installed)
            result.append({
                "id": str(r["id"]), "catalogId": str(r["catalog_id"]),
                "catalogName": r["canonical_name"],
                "licenseType": r["license_type"], "totalLicenses": r["total_licenses"],
                "costPerLicense": float(r["cost_per_license"]) if r["cost_per_license"] else None,
                "currency": r["currency"], "vendor": r["vendor"],
                "contractId": r["contract_id"],
                "expiresAt": r["expires_at"].isoformat() if r["expires_at"] else None,
                "notes": r["notes"],
                "installedCount": installed, "complianceStatus": status,
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
            })
        return {"licenses": result, "count": len(result)}


@router.post("/licenses")
async def create_license(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO software_licenses (catalog_id, license_type, total_licenses, cost_per_license,
                currency, vendor, contract_id, expires_at, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
        """, UUID(data["catalogId"]), data.get("licenseType", "per_device"),
            data.get("totalLicenses"), data.get("costPerLicense"),
            data.get("currency", "EUR"), data.get("vendor"), data.get("contractId"),
            data.get("expiresAt"), data.get("notes"))
        return {"id": str(row["id"]), "status": "created"}


@router.put("/licenses/{license_id}")
async def update_license(license_id: UUID, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            UPDATE software_licenses SET
                license_type = COALESCE($2, license_type),
                total_licenses = COALESCE($3, total_licenses),
                cost_per_license = COALESCE($4, cost_per_license),
                currency = COALESCE($5, currency),
                vendor = COALESCE($6, vendor),
                contract_id = COALESCE($7, contract_id),
                expires_at = COALESCE($8, expires_at),
                notes = COALESCE($9, notes),
                updated_at = now()
            WHERE id = $1 RETURNING id
        """, license_id, data.get("licenseType"), data.get("totalLicenses"),
            data.get("costPerLicense"), data.get("currency"), data.get("vendor"),
            data.get("contractId"), data.get("expiresAt"), data.get("notes"))
        if not row:
            raise not_found("License", str(license_id))
        return {"status": "updated"}


@router.delete("/licenses/{license_id}")
async def delete_license(license_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM software_licenses WHERE id = $1 RETURNING id", license_id)
        if not row:
            raise not_found("License", str(license_id))
        return {"status": "deleted"}


# ─── COMPLIANCE ────────────────────────────────────────────────────────────────

@router.get("/compliance")
async def compliance_summary(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        cats = await conn.fetch("SELECT id, canonical_name FROM software_catalog WHERE is_tracked = true")
        compliant = over_licensed = under_licensed = untracked = 0
        total_cost = 0.0
        potential_savings = 0.0

        for cat in cats:
            cid = cat["id"]
            installed = await _installed_count_for_catalog(conn, cid)
            lic = await conn.fetchrow("""
                SELECT COALESCE(SUM(total_licenses), 0) as total,
                       COALESCE(SUM(cost_per_license * COALESCE(total_licenses, 0)), 0) as cost
                FROM software_licenses WHERE catalog_id = $1
            """, cid)
            has_unlimited = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM software_licenses WHERE catalog_id = $1 AND total_licenses IS NULL)", cid)
            total_lic = None if has_unlimited else (int(lic["total"]) if lic["total"] else 0)
            total_cost += float(lic["cost"])

            if total_lic is None:
                compliant += 1
            elif installed > total_lic:
                under_licensed += 1
            elif total_lic > installed * 1.2 and total_lic > installed + 2:
                over_licensed += 1
                # savings = excess licenses * avg cost per license
                if total_lic > 0:
                    avg_cost = float(lic["cost"]) / total_lic
                    potential_savings += (total_lic - installed) * avg_cost
                compliant  # don't double count — this is over_licensed
            else:
                compliant += 1

        # untracked = catalog entries without any license
        untracked = await conn.fetchval("""
            SELECT COUNT(*) FROM software_catalog c
            WHERE c.is_tracked = true AND NOT EXISTS (SELECT 1 FROM software_licenses WHERE catalog_id = c.id)
        """)

        return {
            "compliant": compliant,
            "overLicensed": over_licensed,
            "underLicensed": under_licensed,
            "untracked": untracked,
            "totalCost": round(total_cost, 2),
            "potentialSavings": round(potential_savings, 2),
        }


@router.get("/compliance/{catalog_id}")
async def compliance_detail(catalog_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        cat = await conn.fetchrow("SELECT * FROM software_catalog WHERE id = $1", catalog_id)
        if not cat:
            raise not_found("Catalog entry", str(catalog_id))

        installed_nodes = await _installed_nodes_for_catalog(conn, catalog_id)
        lic = await conn.fetchrow("""
            SELECT COALESCE(SUM(total_licenses), 0) as total,
                   COALESCE(SUM(cost_per_license * COALESCE(total_licenses, 0)), 0) as cost
            FROM software_licenses WHERE catalog_id = $1
        """, catalog_id)
        has_unlimited = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM software_licenses WHERE catalog_id = $1 AND total_licenses IS NULL)", catalog_id)
        total_lic = None if has_unlimited else int(lic["total"])
        installed = len(set(r["node_id"] for r in installed_nodes))

        # usage data
        usage = await conn.fetch("""
            SELECT node_id, software_name, last_used, usage_count
            FROM software_usage WHERE catalog_id = $1 ORDER BY last_used DESC NULLS LAST
        """, catalog_id)

        return {
            "catalogId": str(catalog_id),
            "canonicalName": cat["canonical_name"],
            "publisher": cat["publisher"],
            "category": cat["category"],
            "installedCount": installed,
            "totalLicenses": total_lic,
            "complianceStatus": _compliance_status(total_lic, installed),
            "totalCost": float(lic["cost"]),
            "installedNodes": [
                {"nodeId": str(r["node_id"]), "hostname": r["hostname"],
                 "softwareName": r["name"], "version": r["version"],
                 "installDate": r["install_date"].isoformat() if r["install_date"] else None}
                for r in installed_nodes
            ],
            "usageData": [
                {"nodeId": str(u["node_id"]), "softwareName": u["software_name"],
                 "lastUsed": u["last_used"].isoformat() if u["last_used"] else None,
                 "usageCount": u["usage_count"]}
                for u in usage
            ],
        }


# ─── DASHBOARD ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        # top installed software
        top_installed = await conn.fetch("""
            SELECT name, publisher, COUNT(DISTINCT node_id) as node_count
            FROM software_current GROUP BY name, publisher
            ORDER BY node_count DESC LIMIT 20
        """)

        # compliance pie data
        cats = await conn.fetch("SELECT id FROM software_catalog WHERE is_tracked = true")
        comp = {"compliant": 0, "overLicensed": 0, "underLicensed": 0, "untracked": 0}
        cost_by_category: Dict[str, float] = {}

        for cat in cats:
            cid = cat["id"]
            installed = await _installed_count_for_catalog(conn, cid)
            lic = await conn.fetchrow("""
                SELECT COALESCE(SUM(total_licenses), 0) as total,
                       COALESCE(SUM(cost_per_license * COALESCE(total_licenses, 0)), 0) as cost
                FROM software_licenses WHERE catalog_id = $1
            """, cid)
            has_unlimited = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM software_licenses WHERE catalog_id = $1 AND total_licenses IS NULL)", cid)
            has_any_lic = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM software_licenses WHERE catalog_id = $1)", cid)
            total_lic = None if has_unlimited else int(lic["total"])

            if not has_any_lic:
                comp["untracked"] += 1
            elif total_lic is None:
                comp["compliant"] += 1
            elif installed > total_lic:
                comp["underLicensed"] += 1
            elif total_lic > installed * 1.2 and total_lic > installed + 2:
                comp["overLicensed"] += 1
            else:
                comp["compliant"] += 1

            # cost by category
            cat_row = await conn.fetchrow("SELECT category FROM software_catalog WHERE id = $1", cid)
            if cat_row:
                cat_name = cat_row["category"] or "Other"
                cost_by_category[cat_name] = cost_by_category.get(cat_name, 0) + float(lic["cost"])

        # recent catalog changes
        recent = await conn.fetch("""
            SELECT id, canonical_name, publisher, category, updated_at
            FROM software_catalog ORDER BY updated_at DESC LIMIT 10
        """)

        # top unused (in catalog, installed but no usage data or old usage)
        top_unused = await conn.fetch("""
            SELECT c.id, c.canonical_name, c.publisher,
                   COUNT(DISTINCT sc.node_id) as installed_count
            FROM software_catalog c
            JOIN software_current sc ON LOWER(sc.name) = LOWER(c.canonical_name)
            LEFT JOIN software_usage su ON su.catalog_id = c.id
            WHERE su.id IS NULL OR su.last_used IS NULL OR su.last_used < now() - interval '90 days'
            GROUP BY c.id, c.canonical_name, c.publisher
            ORDER BY installed_count DESC
            LIMIT 10
        """)

        return {
            "topInstalled": [{"name": r["name"], "publisher": r["publisher"], "nodeCount": r["node_count"]} for r in top_installed],
            "topUnused": [{"id": str(r["id"]), "canonicalName": r["canonical_name"], "publisher": r["publisher"], "installedCount": r["installed_count"]} for r in top_unused],
            "compliance": comp,
            "costByCategory": cost_by_category,
            "recentChanges": [{"id": str(r["id"]), "canonicalName": r["canonical_name"], "publisher": r["publisher"], "category": r["category"], "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None} for r in recent],
        }


# ─── USAGE ─────────────────────────────────────────────────────────────────────

@router.get("/usage")
async def list_usage(
    node_id: Optional[UUID] = None,
    catalog_id: Optional[UUID] = None,
    unused_days: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
    db: asyncpg.Pool = Depends(get_db),
):
    async with db.acquire() as conn:
        conditions = []
        params: list = []
        idx = 1
        if node_id:
            conditions.append(f"u.node_id = ${idx}")
            params.append(node_id)
            idx += 1
        if catalog_id:
            conditions.append(f"u.catalog_id = ${idx}")
            params.append(catalog_id)
            idx += 1
        if unused_days:
            conditions.append(f"(u.last_used IS NULL OR u.last_used < now() - interval '{int(unused_days)} days')")
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        params.extend([limit, offset])
        rows = await conn.fetch(f"""
            SELECT u.id, u.node_id, u.software_name, u.catalog_id, u.last_used,
                   u.usage_count, u.source, u.updated_at, n.hostname
            FROM software_usage u
            LEFT JOIN nodes n ON n.id = u.node_id
            {where}
            ORDER BY u.updated_at DESC
            LIMIT ${idx} OFFSET ${idx+1}
        """, *params)
        return {"usage": [
            {"id": r["id"], "nodeId": str(r["node_id"]), "hostname": r["hostname"],
             "softwareName": r["software_name"],
             "catalogId": str(r["catalog_id"]) if r["catalog_id"] else None,
             "lastUsed": r["last_used"].isoformat() if r["last_used"] else None,
             "usageCount": r["usage_count"], "source": r["source"],
             "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None}
            for r in rows
        ]}


@router.post("/usage/submit")
async def submit_usage(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Agent submits usage data: {nodeId, entries: [{softwareName, lastUsed, usageCount}]}"""
    node_id = UUID(data["nodeId"])
    entries = data.get("entries", [])
    async with db.acquire() as conn:
        upserted = 0
        for e in entries:
            sw_name = e["softwareName"]
            # try to resolve catalog_id
            cat_id = await conn.fetchval("""
                SELECT c.id FROM software_catalog c
                LEFT JOIN software_normalization_rules r ON r.catalog_id = c.id
                WHERE LOWER(c.canonical_name) = LOWER($1)
                   OR (r.match_type = 'exact' AND $1 = r.pattern)
                   OR (r.match_type = 'like' AND $1 ILIKE r.pattern)
                LIMIT 1
            """, sw_name)
            await conn.execute("""
                INSERT INTO software_usage (node_id, software_name, catalog_id, last_used, usage_count, source)
                VALUES ($1, $2, $3, $4, $5, 'agent')
                ON CONFLICT (node_id, software_name) WHERE node_id = $1 AND software_name = $2
                DO UPDATE SET last_used = COALESCE($4, software_usage.last_used),
                    usage_count = software_usage.usage_count + COALESCE($5, 0),
                    catalog_id = COALESCE($3, software_usage.catalog_id),
                    source = 'agent', updated_at = now()
            """, node_id, sw_name, cat_id, e.get("lastUsed"), e.get("usageCount", 0))
            upserted += 1
        return {"status": "ok", "upserted": upserted}


@router.get("/usage/reclaim")
async def reclaim_candidates(db: asyncpg.Pool = Depends(get_db)):
    """Software unused >90 days that has active licenses — reclamation candidates."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT c.id as catalog_id, c.canonical_name, c.publisher,
                   l.total_licenses, l.cost_per_license, l.currency,
                   COUNT(DISTINCT u.node_id) as unused_node_count
            FROM software_catalog c
            JOIN software_licenses l ON l.catalog_id = c.id
            JOIN software_usage u ON u.catalog_id = c.id
            WHERE (u.last_used IS NULL OR u.last_used < now() - interval '90 days')
              AND (l.expires_at IS NULL OR l.expires_at > now())
            GROUP BY c.id, c.canonical_name, c.publisher, l.total_licenses, l.cost_per_license, l.currency
            ORDER BY unused_node_count DESC
        """)
        return {"candidates": [
            {"catalogId": str(r["catalog_id"]), "canonicalName": r["canonical_name"],
             "publisher": r["publisher"], "totalLicenses": r["total_licenses"],
             "costPerLicense": float(r["cost_per_license"]) if r["cost_per_license"] else None,
             "currency": r["currency"], "unusedNodeCount": r["unused_node_count"]}
            for r in rows
        ]}


# ─── REPORTS ───────────────────────────────────────────────────────────────────

@router.get("/reports/true-up")
async def true_up_report(db: asyncpg.Pool = Depends(get_db)):
    """True-up report: for each licensed software, purchased vs installed vs used."""
    async with db.acquire() as conn:
        licensed_cats = await conn.fetch("""
            SELECT DISTINCT c.id, c.canonical_name, c.publisher, c.category
            FROM software_catalog c
            JOIN software_licenses l ON l.catalog_id = c.id
            ORDER BY c.canonical_name
        """)
        report = []
        for cat in licensed_cats:
            cid = cat["id"]
            installed = await _installed_count_for_catalog(conn, cid)
            lic = await conn.fetchrow("""
                SELECT COALESCE(SUM(total_licenses), 0) as purchased,
                       COALESCE(SUM(cost_per_license * COALESCE(total_licenses, 0)), 0) as total_cost
                FROM software_licenses WHERE catalog_id = $1
            """, cid)
            has_unlimited = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM software_licenses WHERE catalog_id = $1 AND total_licenses IS NULL)", cid)
            purchased = None if has_unlimited else int(lic["purchased"])

            # "used" = nodes with usage data where last_used is recent (< 90 days)
            used = await conn.fetchval("""
                SELECT COUNT(DISTINCT node_id) FROM software_usage
                WHERE catalog_id = $1 AND last_used > now() - interval '90 days'
            """, cid) or 0

            delta = None
            if purchased is not None:
                delta = purchased - installed

            report.append({
                "catalogId": str(cid),
                "canonicalName": cat["canonical_name"],
                "publisher": cat["publisher"],
                "category": cat["category"],
                "purchased": purchased,
                "installed": installed,
                "activelyUsed": used,
                "delta": delta,
                "totalCost": float(lic["total_cost"]),
                "complianceStatus": _compliance_status(purchased, installed),
            })
        return {"report": report, "generatedAt": datetime.now(timezone.utc).isoformat()}
