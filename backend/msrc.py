"""Microsoft's Security Update Guide (MSRC CVRF API) as the vulnerability source for Windows itself.

NVD stays the source for applications on Windows; for the operating system, Microsoft publishes
per CVE and Windows release the update (KB) that fixes it and the build that contains the fix,
plus severity, CVSS and whether the CVE is exploited or publicly disclosed
(https://api.msrc.microsoft.com/cvrf/v3.0/, public, one document per month).

- Sync (worker, in the background, not part of the vulnerability scan): the list of documents is
  read every few hours; a document is downloaded when it is new, when Microsoft revised it (its
  CurrentReleaseDate changed; at most daily for the last two months, weekly for older ones) or when
  the release mapping below changed. Only the Windows releases of WINDOWS_RELEASES are stored
  (msrc_windows_fixes, one row per document, CVE, product and KB). A revised document replaces its
  rows, so fixes Microsoft changed or withdrew change or disappear with the next download.
- Matching: msrc_windows_cves holds per product and CVE the first build that fixes it (the lowest
  fixed build of all its security updates). A Windows node is affected when its build has the
  product's build number and a lower revision (UBR). Cumulative updates contain every earlier fix,
  so the update to install for all of them is the newest one of the product (fix unit "KB…").
- A Windows node without a usable build, of a release that is not mapped, or of a release without
  synced data is "unknown", never "not affected" (node_status).
"""
import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

import httpx

log = logging.getLogger(__name__)

MSRC_API_BASE = "https://api.msrc.microsoft.com/cvrf/v3.0"
# MSRC_SYNC=off disables the download (installations without internet access, CI).
SYNC_ENABLED = os.environ.get("MSRC_SYNC", "on").strip().lower() not in ("off", "0", "false", "no")
# Monthly documents kept (newest first). A node further behind still shows every CVE of these
# months, and the update that fixes them is the same.
HISTORY_MONTHS = max(1, int(os.environ.get("MSRC_HISTORY_MONTHS", "24")))
START_DELAY_SECONDS = 60
CHECK_INTERVAL_SECONDS = 6 * 3600
RETRY_SECONDS = 30 * 60
# A revised document is downloaded again at most this often (they are revised almost daily and
# are about 30 MB each).
RECENT_DOCUMENT_DAYS = 62
RECENT_REFETCH = timedelta(days=1)
OLD_REFETCH = timedelta(days=7)
LOCK_KEY = "hashtextextended('msrc_sync', 0)"

# --- Windows releases --------------------------------------------------------------------------
# Build number and edition (server or client) of a node -> the MSRC product whose fixes apply.
# MSRC lists the same update and fixed build for the x64, ARM64 and 32-bit variant of a client
# release and for Server Core, so one product per release is enough. Product IDs are MSRC's
# (stable across documents). Releases without security updates (end of support) are left out.
WINDOWS_RELEASES = (
    # build, server, MSRC product ID, MSRC product name
    (14393, False, "10853", "Windows 10 Version 1607 for x64-based Systems"),
    (14393, True, "10816", "Windows Server 2016"),
    (17763, False, "11569", "Windows 10 Version 1809 for x64-based Systems"),
    (17763, True, "11571", "Windows Server 2019"),
    (19044, False, "11931", "Windows 10 Version 21H2 for x64-based Systems"),
    (19045, False, "12097", "Windows 10 Version 22H2 for x64-based Systems"),
    (20348, True, "11923", "Windows Server 2022"),
    (22631, False, "12243", "Windows 11 Version 23H2 for x64-based Systems"),
    (26100, False, "12390", "Windows 11 Version 24H2 for x64-based Systems"),
    (26100, True, "12436", "Windows Server 2025"),
    (26200, False, "20438", "Windows 11 Version 25H2 for x64-based Systems"),
    (26300, False, "21946", "Windows 11 Version 26H2 for x64-based Systems"),
    (28000, False, "20853", "Windows 11 Version 26H1 for x64-based Systems"),
)
PRODUCTS = {product_id: (build, server, name) for build, server, product_id, name in WINDOWS_RELEASES}

# Windows build of a node as reported (os_build "26100.33650", older agents "10.0.26100.33650")
NODE_BUILD_RE = re.compile(r"^(?:10\.0\.)?(\d{5})\.(\d+)$")
FIXED_BUILD_RE = re.compile(r"^10\.0\.(\d{5})\.(\d+)$")
DOCUMENT_ID_RE = re.compile(r"^\d{4}-[A-Z][a-z]{2}$")
MSRC_SEVERITIES = {"critical": "CRITICAL", "important": "HIGH", "moderate": "MEDIUM", "low": "LOW"}


def release_for(os_name: str | None, os_build: str | None) -> tuple[Optional[tuple[int, int]], Optional[str]]:
    """(build number, revision) of a Windows node and its MSRC product ID (None if not mapped).
    Same rule as the SQL below (nodes.windows_build, msrc_windows_products)."""
    match = NODE_BUILD_RE.match((os_build or "").strip())
    if not match:
        return None, None
    build = (int(match.group(1)), int(match.group(2)))
    server = bool(re.search("server", os_name or "", re.I))
    product = next((pid for pid, (b, s, _) in PRODUCTS.items() if b == build[0] and s == server), None)
    return build, product


def _severity(cvss_score: float | None, msrc_rating: str | None) -> str:
    """CVSS base score in NVD's ranges (as the other sources); without one, Microsoft's rating."""
    if cvss_score is not None and cvss_score > 0:
        if cvss_score >= 9.0:
            return "CRITICAL"
        if cvss_score >= 7.0:
            return "HIGH"
        if cvss_score >= 4.0:
            return "MEDIUM"
        return "LOW"
    return MSRC_SEVERITIES.get((msrc_rating or "").strip().lower(), "UNKNOWN")


def _parse_date(value: str | None) -> Optional[datetime]:
    if not value or value.startswith("0001-"):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _release_stamp(value: str | None) -> str:
    """CurrentReleaseDate as compared between syncs ("2026-11-24T01:27:08Z" and the document's
    "2026-11-24T01:27:08" are the same)."""
    parsed = _parse_date(value)
    return parsed.isoformat() if parsed else (value or "")


def _for_product(items: list, product_id: str) -> list:
    """Threats / score sets that apply to a product (no ProductID: all of the CVE's products)."""
    return [item for item in items if not item.get("ProductID") or product_id in item["ProductID"]]


def parse_document(document: dict) -> list[dict]:
    """The Windows fixes of one CVRF document: one entry per CVE, mapped product and KB of a
    security update with a fixed build. A product counts only while the CVE lists it as known
    affected, so a withdrawn CVE or product has no entry."""
    released = _parse_date((document.get("DocumentTracking") or {}).get("InitialReleaseDate"))
    found: dict[tuple, dict] = {}
    for vuln in document.get("Vulnerability") or []:
        cve = (vuln.get("CVE") or "").strip().upper()
        if not cve.startswith("CVE-"):
            continue
        affected = {pid for status in vuln.get("ProductStatuses") or [] if status.get("Type") == 3
                    for pid in status.get("ProductID") or []}
        threats = vuln.get("Threats") or []
        scores = vuln.get("CVSSScoreSets") or []
        dates = [d for d in (_parse_date(r.get("Date")) for r in vuln.get("RevisionHistory") or []) if d]
        published = min(dates) if dates else released
        title = ((vuln.get("Title") or {}).get("Value") or "").strip() or None
        for remediation in vuln.get("Remediations") or []:
            if remediation.get("Type") != 2 or remediation.get("SubType") != "Security Update":
                continue  # vendor fixes only; hotpatches and servicing stack updates have other builds
            kb = str((remediation.get("Description") or {}).get("Value") or "").strip().upper().removeprefix("KB")
            fixed = FIXED_BUILD_RE.match((remediation.get("FixedBuild") or "").strip())
            if not kb.isdigit() or not fixed:
                continue
            for product_id in remediation.get("ProductID") or []:
                if product_id not in PRODUCTS or product_id not in affected:
                    continue
                build = PRODUCTS[product_id][0]
                if int(fixed.group(1)) != build:
                    continue  # a fixed build of another release: not comparable
                exploited = disclosed = False
                rating = None
                for threat in _for_product(threats, product_id):
                    text = ((threat.get("Description") or {}).get("Value") or "")
                    if threat.get("Type") == 1:
                        exploited = exploited or "exploited:yes" in text.lower().replace(" ", "")
                        disclosed = disclosed or "publiclydisclosed:yes" in text.lower().replace(" ", "")
                    elif threat.get("Type") == 3 and text:
                        rating = text
                score_set = max(_for_product(scores, product_id), key=lambda s: s.get("BaseScore") or 0, default=None)
                score = float(score_set["BaseScore"]) if score_set and score_set.get("BaseScore") else None
                key = (cve, product_id, kb)
                revision = int(fixed.group(2))
                if key in found and found[key]["fixed_revision"] <= revision:
                    continue
                found[key] = {
                    "cve_id": cve, "product_id": product_id, "kb": kb, "fixed_revision": revision,
                    "severity": _severity(score, rating), "msrc_severity": rating,
                    "cvss_score": round(score, 1) if score is not None else None,
                    "cvss_vector": (score_set or {}).get("Vector") or None,
                    "exploited": exploited, "publicly_disclosed": disclosed,
                    "title": title, "published": published,
                }
    return sorted(found.values(), key=lambda r: (r["cve_id"], r["product_id"], r["kb"]))


def parse_document_bytes(body: bytes) -> list[dict]:
    return parse_document(json.loads(body))


# --- which documents to download ---------------------------------------------------------------

def wanted_documents(updates: list[dict], months: int = HISTORY_MONTHS) -> list[dict]:
    """The monthly security update documents to keep, the newest `months` of them, newest first."""
    docs = [u for u in updates if DOCUMENT_ID_RE.match(u.get("ID") or "")
            and "security updates" in (u.get("DocumentTitle") or "").lower()
            and _parse_date(u.get("InitialReleaseDate"))]
    docs.sort(key=lambda u: _parse_date(u["InitialReleaseDate"]), reverse=True)
    return docs[:months]


def documents_due(wanted: list[dict], stored: dict, now: datetime) -> list[dict]:
    """Documents to download: new ones, those parsed for another release mapping, and revised ones
    (another CurrentReleaseDate) once their last download is old enough. `stored`: id ->
    {current_release, fetched_at, products}."""
    due = []
    for update in wanted:
        known = stored.get(update["ID"])
        if known is None or sorted(known["products"] or []) != sorted(PRODUCTS):
            due.append(update)
            continue
        if _release_stamp(update.get("CurrentReleaseDate")) == known["current_release"]:
            continue
        recent = now - _parse_date(update["InitialReleaseDate"]) <= timedelta(days=RECENT_DOCUMENT_DAYS)
        if now - known["fetched_at"] >= (RECENT_REFETCH if recent else OLD_REFETCH):
            due.append(update)
    return due


def changed_products(old_rows: Iterable, new_rows: Iterable[dict]) -> set[str]:
    """Products whose stored fixes differ between two versions of a document."""
    def key(row):
        # stored scores come back as Decimal: compare as float
        return tuple(float(row[c]) if c == "cvss_score" and row[c] is not None else row[c] for c in FIX_COLUMNS)
    old = {key(r) for r in old_rows}
    new = {key(r) for r in new_rows}
    return {row[1] for row in old ^ new}


# --- storage -----------------------------------------------------------------------------------

FIX_COLUMNS = ("cve_id", "product_id", "kb", "fixed_revision", "severity", "msrc_severity", "cvss_score",
               "cvss_vector", "exploited", "publicly_disclosed", "title", "published")

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS msrc_windows_products (
        product_id TEXT PRIMARY KEY, build INT NOT NULL, server BOOLEAN NOT NULL, name TEXT NOT NULL,
        latest_kb TEXT, latest_revision INT,
        UNIQUE (build, server))""",
    """CREATE TABLE IF NOT EXISTS msrc_documents (
        id TEXT PRIMARY KEY, title TEXT, initial_release TIMESTAMPTZ, current_release TEXT,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), products TEXT[], fixes INT NOT NULL DEFAULT 0)""",
    # One row per document, CVE, product and KB, as Microsoft lists it.
    """CREATE TABLE IF NOT EXISTS msrc_windows_fixes (
        document_id TEXT NOT NULL REFERENCES msrc_documents(id) ON DELETE CASCADE,
        cve_id TEXT NOT NULL, product_id TEXT NOT NULL, kb TEXT NOT NULL, fixed_revision INT NOT NULL,
        severity TEXT, msrc_severity TEXT, cvss_score NUMERIC(3,1), cvss_vector TEXT,
        exploited BOOLEAN NOT NULL DEFAULT FALSE, publicly_disclosed BOOLEAN NOT NULL DEFAULT FALSE,
        title TEXT, published TIMESTAMPTZ,
        PRIMARY KEY (document_id, cve_id, product_id, kb))""",
    "CREATE INDEX IF NOT EXISTS idx_msrc_windows_fixes_product ON msrc_windows_fixes (product_id)",
    # Per product and CVE the first build with the fix (from msrc_windows_fixes, rebuilt per product
    # after a sync): what nodes are matched against.
    """CREATE TABLE IF NOT EXISTS msrc_windows_cves (
        product_id TEXT NOT NULL, cve_id TEXT NOT NULL, kb TEXT NOT NULL, fixed_revision INT NOT NULL,
        severity TEXT, msrc_severity TEXT, cvss_score NUMERIC(3,1), cvss_vector TEXT,
        exploited BOOLEAN NOT NULL, publicly_disclosed BOOLEAN NOT NULL, title TEXT, published TIMESTAMPTZ,
        PRIMARY KEY (product_id, cve_id))""",
    "CREATE INDEX IF NOT EXISTS idx_msrc_windows_cves_revision ON msrc_windows_cves (product_id, fixed_revision)",
    "CREATE INDEX IF NOT EXISTS idx_msrc_windows_cves_cve ON msrc_windows_cves (cve_id)",
    'CREATE INDEX IF NOT EXISTS idx_msrc_windows_cves_cve_c ON msrc_windows_cves (cve_id COLLATE "C")',
    """CREATE TABLE IF NOT EXISTS msrc_sync_status (
        id INT PRIMARY KEY CHECK (id = 1), checked_at TIMESTAMPTZ, succeeded_at TIMESTAMPTZ, error TEXT)""",
    "INSERT INTO msrc_sync_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    # Build number and revision of a Windows node (os_build 26100.33650 -> {26100,33650}).
    r"""ALTER TABLE nodes ADD COLUMN IF NOT EXISTS windows_build INT[]
        GENERATED ALWAYS AS (CASE WHEN COALESCE(os_name, '') ~* 'windows' THEN string_to_array(
            (regexp_match(COALESCE(os_build, ''), '^(?:10\.0\.)?(\d{5}\.\d+)$'))[1], '.')::int[] END) STORED""",
    "CREATE INDEX IF NOT EXISTS idx_nodes_windows_build ON nodes ((windows_build[1])) WHERE windows_build IS NOT NULL",
    # A Windows node's MSRC findings: CVEs of its release fixed in a later build than its own.
    # The update to install is the release's newest one (cumulative updates contain every fix).
    """CREATE OR REPLACE VIEW msrc_node_findings AS
        SELECT n.id AS node_id, c.cve_id, c.severity, c.cvss_score, c.cvss_vector, c.title AS description,
            c.published, p.name AS product,
            '10.0.' || n.windows_build[1] || '.' || n.windows_build[2] AS node_build,
            '10.0.' || p.build || '.' || c.fixed_revision AS fixed_build, c.kb,
            'KB' || p.latest_kb AS fix_unit, '10.0.' || p.build || '.' || p.latest_revision AS fix_unit_version,
            c.exploited, c.publicly_disclosed
        FROM nodes n
        JOIN msrc_windows_products p ON p.build = n.windows_build[1]
            AND p.server = (COALESCE(n.os_name, '') ~* 'server')
        JOIN msrc_windows_cves c ON c.product_id = p.product_id AND c.fixed_revision > n.windows_build[2]""",
]


async def ensure_schema(conn) -> None:
    """Tables, the node build column and the findings view; the release mapping from WINDOWS_RELEASES."""
    for statement in SCHEMA:
        await conn.execute(statement)
    await conn.execute("DELETE FROM msrc_windows_products WHERE NOT (product_id = ANY($1::text[]))", list(PRODUCTS))
    for build, server, product_id, name in WINDOWS_RELEASES:
        await conn.execute("""INSERT INTO msrc_windows_products (product_id, build, server, name) VALUES ($1, $2, $3, $4)
            ON CONFLICT (product_id) DO UPDATE SET build = EXCLUDED.build, server = EXCLUDED.server, name = EXCLUDED.name""",
                           product_id, build, server, name)
    await conn.execute("DELETE FROM msrc_windows_cves WHERE NOT (product_id = ANY($1::text[]))", list(PRODUCTS))


STORED_ROWS_SQL = f"SELECT {', '.join(FIX_COLUMNS)} FROM msrc_windows_fixes WHERE document_id = $1"
INSERT_FIX_SQL = f"""INSERT INTO msrc_windows_fixes (document_id, {', '.join(FIX_COLUMNS)})
    VALUES ($1, {', '.join(f'${i + 2}' for i in range(len(FIX_COLUMNS)))})"""


async def store_document(conn, update: dict, rows: list[dict]) -> set[str]:
    """Replace a document's fixes; returns the products whose fixes changed."""
    async with conn.transaction():
        old = await conn.fetch(STORED_ROWS_SQL, update["ID"])
        await conn.execute("""INSERT INTO msrc_documents (id, title, initial_release, current_release, fetched_at, products, fixes)
            VALUES ($1, $2, $3, $4, NOW(), $5, $6)
            ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, initial_release = EXCLUDED.initial_release,
                current_release = EXCLUDED.current_release, fetched_at = NOW(), products = EXCLUDED.products,
                fixes = EXCLUDED.fixes""",
                           update["ID"], update.get("DocumentTitle"), _parse_date(update.get("InitialReleaseDate")),
                           _release_stamp(update.get("CurrentReleaseDate")), sorted(PRODUCTS), len(rows))
        await conn.execute("DELETE FROM msrc_windows_fixes WHERE document_id = $1", update["ID"])
        if rows:
            await conn.executemany(INSERT_FIX_SQL, [(update["ID"], *(row[c] for c in FIX_COLUMNS)) for row in rows])
    return changed_products(old, rows)


async def remove_documents(conn, ids: list[str]) -> set[str]:
    """Documents no longer kept (older than the history, or no longer listed)."""
    if not ids:
        return set()
    async with conn.transaction():
        rows = await conn.fetch("SELECT DISTINCT product_id FROM msrc_windows_fixes WHERE document_id = ANY($1::text[])", ids)
        await conn.execute("DELETE FROM msrc_documents WHERE id = ANY($1::text[])", ids)
    return {row["product_id"] for row in rows}


# Per product and CVE: the lowest fixed build with its KB, the worst severity, the highest score
# (with its vector), exploited / disclosed in any document.
REBUILD_CVES_SQL = """
    INSERT INTO msrc_windows_cves (product_id, cve_id, kb, fixed_revision, severity, msrc_severity, cvss_score,
        cvss_vector, exploited, publicly_disclosed, title, published)
    SELECT product_id, cve_id,
        (array_agg(kb ORDER BY fixed_revision, kb))[1], MIN(fixed_revision),
        (array_agg(severity ORDER BY array_position(ARRAY['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], severity) NULLS LAST))[1],
        (array_agg(msrc_severity ORDER BY array_position(ARRAY['Critical', 'Important', 'Moderate', 'Low'], msrc_severity) NULLS LAST))[1],
        MAX(cvss_score),
        (array_agg(cvss_vector ORDER BY cvss_score DESC NULLS LAST, cvss_vector))[1],
        BOOL_OR(exploited), BOOL_OR(publicly_disclosed),
        (array_agg(title ORDER BY published DESC NULLS LAST) FILTER (WHERE title IS NOT NULL))[1], MIN(published)
    FROM msrc_windows_fixes WHERE product_id = ANY($1::text[])
    GROUP BY product_id, cve_id"""

# The newest update of each product: the one to install.
LATEST_UPDATE_SQL = """
    UPDATE msrc_windows_products p SET latest_kb = l.kb, latest_revision = l.fixed_revision
    FROM (SELECT p2.product_id, c.kb, c.fixed_revision FROM msrc_windows_products p2
          LEFT JOIN LATERAL (SELECT kb, fixed_revision FROM msrc_windows_fixes f WHERE f.product_id = p2.product_id
                             ORDER BY fixed_revision DESC, kb DESC LIMIT 1) c ON TRUE
          WHERE p2.product_id = ANY($1::text[])) l
    WHERE p.product_id = l.product_id"""

# Windows nodes of these products: their findings change.
MARK_NODES_SQL = """
    SELECT mark_vulnerability_nodes(ARRAY(
        SELECT n.id FROM nodes n JOIN msrc_windows_products p ON p.build = n.windows_build[1]
            AND p.server = (COALESCE(n.os_name, '') ~* 'server')
        WHERE n.windows_build IS NOT NULL AND p.product_id = ANY($1::text[])))"""


async def rebuild_products(conn, products: Iterable[str]) -> None:
    """Recompute the CVEs and the newest update of these products, and mark their nodes."""
    import vulnerability_cache
    products = sorted(set(products))
    if not products:
        return
    async with conn.transaction():
        await conn.execute("DELETE FROM msrc_windows_cves WHERE product_id = ANY($1::text[])", products)
        await conn.execute(REBUILD_CVES_SQL, products)
        await conn.execute(LATEST_UPDATE_SQL, products)
        await conn.execute(MARK_NODES_SQL, products)
    vulnerability_cache.request_fleet_refresh(correct=True)


async def import_document(conn, document: dict) -> dict:
    """Store one CVRF document given as JSON (installations without access to the API, MSRC_SYNC=off).
    With the sync on, a document that is not among the kept months is removed by the next sync."""
    tracking = document.get("DocumentTracking") or {}
    doc_id = (((tracking.get("Identification") or {}).get("ID") or {}).get("Value") or "").strip()
    if not DOCUMENT_ID_RE.match(doc_id):
        raise ValueError("Not a monthly MSRC CVRF document (DocumentTracking.Identification.ID like 2026-Oct)")
    rows = await asyncio.to_thread(parse_document, document)
    title = document.get("DocumentTitle")
    update = {"ID": doc_id, "DocumentTitle": title.get("Value") if isinstance(title, dict) else title,
              "InitialReleaseDate": tracking.get("InitialReleaseDate"),
              "CurrentReleaseDate": tracking.get("CurrentReleaseDate")}
    changed = await store_document(conn, update, rows)
    await rebuild_products(conn, changed)
    return {"id": doc_id, "fixes": len(rows), "changed_products": sorted(changed)}


# --- sync --------------------------------------------------------------------------------------

async def _get(client: httpx.AsyncClient, url: str) -> bytes:
    response = await client.get(url, headers={"Accept": "application/json"})
    response.raise_for_status()
    return response.content


async def sync(pool, client: httpx.AsyncClient, now: Optional[datetime] = None) -> dict:
    """Download new and revised documents and store their Windows fixes. Returns what it did."""
    now = now or datetime.now(timezone.utc)
    updates = json.loads(await _get(client, f"{MSRC_API_BASE}/updates")).get("value") or []
    wanted = wanted_documents(updates)
    async with pool.acquire() as conn:
        stored = {row["id"]: dict(row) for row in
                  await conn.fetch("SELECT id, current_release, fetched_at, products FROM msrc_documents")}
    changed: set[str] = set()
    result = {"documents": len(wanted), "downloaded": [], "removed": []}
    try:
        gone = sorted(set(stored) - {u["ID"] for u in wanted})
        async with pool.acquire() as conn:
            changed |= await remove_documents(conn, gone)
        result["removed"] = gone
        for update in documents_due(wanted, stored, now):
            url = update.get("CvrfUrl") or f"{MSRC_API_BASE}/cvrf/{update['ID']}"
            if not url.startswith(MSRC_API_BASE + "/"):
                url = f"{MSRC_API_BASE}/cvrf/{update['ID']}"
            body = await _get(client, url)
            rows = await asyncio.to_thread(parse_document_bytes, body)
            del body
            async with pool.acquire() as conn:
                changed |= await store_document(conn, update, rows)
            result["downloaded"].append(update["ID"])
            log.info("MSRC %s: %d Windows fixes", update["ID"], len(rows))
    finally:
        if changed:
            async with pool.acquire() as conn:
                await rebuild_products(conn, changed)
    result["changed_products"] = sorted(changed)
    return result


async def run_once(pool) -> bool:
    """One sync, by one backend process at a time (advisory lock). Returns whether it succeeded."""
    async with pool.acquire() as lock_conn:
        if not await lock_conn.fetchval(f"SELECT pg_try_advisory_lock({LOCK_KEY})"):
            return True  # another process syncs
        try:
            await lock_conn.execute("UPDATE msrc_sync_status SET checked_at = NOW() WHERE id = 1")
            try:
                timeout = httpx.Timeout(60.0, read=300.0)
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    result = await sync(pool, client)
            except Exception as error:  # recorded for the status, retried later
                await lock_conn.execute("UPDATE msrc_sync_status SET error = $1 WHERE id = 1", (str(error) or repr(error))[:500])
                log.warning("MSRC sync failed: %s", error)
                return False
            await lock_conn.execute("UPDATE msrc_sync_status SET succeeded_at = NOW(), error = NULL WHERE id = 1")
            if result["downloaded"] or result["removed"]:
                log.info("MSRC sync: downloaded %s, removed %s", result["downloaded"], result["removed"])
            return True
        finally:
            await lock_conn.execute(f"SELECT pg_advisory_unlock({LOCK_KEY})")


async def worker(pool) -> None:
    """Background sync: shortly after startup, then every few hours (sooner after a failure)."""
    if not SYNC_ENABLED:
        log.info("MSRC sync disabled (MSRC_SYNC=off)")
        return
    await asyncio.sleep(START_DELAY_SECONDS)
    while True:
        try:
            ok = await run_once(pool)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("MSRC sync failed")
            ok = False
        await asyncio.sleep(CHECK_INTERVAL_SECONDS if ok else RETRY_SECONDS)


# --- reading -----------------------------------------------------------------------------------

NODE_RELEASE_SQL = """
    SELECT COALESCE(n.os_name, '') ~* 'windows' AS windows, n.os_build, n.windows_build,
        p.product_id, p.name AS product, p.build, p.latest_kb, p.latest_revision
    FROM nodes n LEFT JOIN msrc_windows_products p ON p.build = n.windows_build[1]
        AND p.server = (COALESCE(n.os_name, '') ~* 'server')
    WHERE n.id = $1"""


def node_state(row) -> Optional[dict]:
    """Whether a node's Windows build could be checked against MSRC (None: not a Windows node).

    status "checked" (with the newest update and whether the node has it) or "unknown" with the
    reason: no_build (no build with revision reported yet), unsupported_release (no MSRC product
    for this build and edition) or no_data (no fixes synced for the release yet)."""
    if row is None or not row["windows"]:
        return None
    base = {"os_build": row["os_build"], "product": row["product"]}
    if not row["windows_build"]:
        return {**base, "status": "unknown", "reason": "no_build"}
    if row["product_id"] is None:
        return {**base, "status": "unknown", "reason": "unsupported_release"}
    if row["latest_kb"] is None:
        return {**base, "status": "unknown", "reason": "no_data"}
    return {**base, "status": "checked", "reason": None,
            "latest_kb": f"KB{row['latest_kb']}",
            "latest_build": f"10.0.{row['build']}.{row['latest_revision']}",
            "up_to_date": row["windows_build"][1] >= row["latest_revision"]}


async def node_status(conn, node_id) -> Optional[dict]:
    return node_state(await conn.fetchrow(NODE_RELEASE_SQL, node_id))


FLEET_STATES_SQL = """
    SELECT CASE WHEN n.windows_build IS NULL THEN 'no_build'
                WHEN p.product_id IS NULL THEN 'unsupported_release'
                WHEN p.latest_kb IS NULL THEN 'no_data'
                ELSE 'checked' END AS state, COUNT(*) AS nodes
    FROM nodes n LEFT JOIN msrc_windows_products p ON p.build = n.windows_build[1]
        AND p.server = (COALESCE(n.os_name, '') ~* 'server')
    WHERE COALESCE(n.os_name, '') ~* 'windows'
    GROUP BY 1"""


async def status(conn) -> dict:
    """The sync (documents, fixes, last check and error) and how many Windows nodes could be checked."""
    sync_row = await conn.fetchrow("SELECT checked_at, succeeded_at, error FROM msrc_sync_status WHERE id = 1")
    docs = await conn.fetchrow("""SELECT COUNT(*) AS documents, COALESCE(SUM(fixes), 0) AS fixes,
        MAX(initial_release) AS newest FROM msrc_documents""")
    states = {row["state"]: row["nodes"] for row in await conn.fetch(FLEET_STATES_SQL)}
    iso = lambda value: value.isoformat() if value else None  # noqa: E731
    return {
        "enabled": SYNC_ENABLED, "history_months": HISTORY_MONTHS,
        "checked_at": iso(sync_row and sync_row["checked_at"]),
        "succeeded_at": iso(sync_row and sync_row["succeeded_at"]),
        "error": sync_row["error"] if sync_row else None,
        "documents": docs["documents"], "fixes": int(docs["fixes"]), "newest_document": iso(docs["newest"]),
        "releases": [{"build": build, "server": server, "product_id": product_id, "product": name}
                     for build, server, product_id, name in WINDOWS_RELEASES],
        "windows_nodes": {"checked": states.get("checked", 0),
                          "unknown": {reason: states.get(reason, 0) for reason in ("no_build", "unsupported_release", "no_data")}},
    }
