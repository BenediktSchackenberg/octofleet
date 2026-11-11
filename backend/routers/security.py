
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
        rows = await conn.fetch("""
            SELECT username, browser, profile, domain, name, expires_utc, is_secure, is_http_only, is_session, is_expired
            FROM browser_cookies WHERE node_id = $1 ORDER BY username, browser, domain, name
        """, node['id'])
    return classify_critical_cookies(node_id, rows)


# Domains whose cookies are worth protecting (sessions for money, identity, cloud, mail, passwords) –
# the list from before the router refactor 1f76ea9
CRITICAL_DOMAINS = {
    "paypal.com", "stripe.com", "coinbase.com", "binance.com", "kraken.com",
    "google.com", "accounts.google.com", "microsoft.com", "login.microsoftonline.com",
    "login.live.com", "github.com", "gitlab.com", "okta.com", "auth0.com",
    "aws.amazon.com", "console.aws.amazon.com", "azure.com", "portal.azure.com",
    "discord.com", "slack.com", "telegram.org", "web.telegram.org", "whatsapp.com",
    "mail.google.com", "outlook.com", "outlook.live.com", "protonmail.com",
    "1password.com", "lastpass.com", "bitwarden.com", "dashlane.com",
}
CATEGORIES = (
    ("Banking/Finance", ("paypal", "stripe", "coinbase", "binance", "kraken")),
    ("Password Manager", ("1password", "lastpass", "bitwarden", "dashlane")),
    ("Cloud Provider", ("aws", "azure", "cloud.google")),
    ("Email", ("mail.google", "outlook", "proton")),
    ("Auth Provider", ("google", "microsoft", "github", "gitlab", "okta", "auth0", "live.com")),
    ("Communication", ("discord", "slack", "telegram", "whatsapp")),
)


def is_critical_domain(domain: str) -> bool:
    d = (domain or "").lower().lstrip(".")
    return any(d == c or d.endswith("." + c) for c in CRITICAL_DOMAINS)


def domain_category(domain: str) -> str:
    d = (domain or "").lower().lstrip(".")
    return next((name for name, keys in CATEGORIES if any(k in d for k in keys)), "Sensitive")


def classify_critical_cookies(node_id: str, rows) -> dict:
    """Cookies of critical domains with category, a summary per category and warnings.

    `warningCodes` are for the UI (translated there); `warnings` keeps the English texts for API clients.
    """
    critical, summary = [], {}
    for row in rows:
        if not is_critical_domain(row["domain"]):
            continue
        category = domain_category(row["domain"])
        critical.append({
            "username": row["username"], "browser": row["browser"], "profile": row["profile"],
            "domain": row["domain"], "name": row["name"], "category": category,
            "isSecure": row["is_secure"], "isHttpOnly": row["is_http_only"],
            "isSession": row["is_session"], "isExpired": row["is_expired"],
            "expiresUtc": row["expires_utc"].isoformat() if row["expires_utc"] else None,
        })
        entry = summary.setdefault(category, {"count": 0, "domains": set()})
        entry["count"] += 1
        entry["domains"].add(row["domain"].lstrip("."))
    codes = []
    if any(not c["isSecure"] for c in critical):
        codes.append("notSecure")
    if any(not c["isHttpOnly"] for c in critical):
        codes.append("notHttpOnly")
    codes += [code for category, code in (("Password Manager", "passwordManager"), ("Banking/Finance", "banking"),
                                          ("Auth Provider", "authProvider")) if category in summary]
    texts = {
        "notSecure": "Some critical cookies are not marked Secure (vulnerable to MITM)",
        "notHttpOnly": "Some critical cookies are not HttpOnly (vulnerable to XSS)",
        "passwordManager": "Password manager cookies found - high-value target",
        "banking": "Banking/Finance cookies found - monitor for unauthorized access",
        "authProvider": "Auth provider cookies found - could be used for session hijacking",
    }
    return {
        "nodeId": node_id, "criticalCookies": critical, "count": len(critical),
        "summary": {k: {"count": v["count"], "domains": sorted(v["domains"])} for k, v in summary.items()},
        "warningCodes": codes, "warnings": [texts[c] for c in codes],
    }
