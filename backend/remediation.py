"""
Auto-Remediation Module for Octofleet Inventory
===============================================

Automatically fixes vulnerabilities by:
1. Matching vulnerabilities to fix packages
2. Creating remediation jobs
3. Executing fixes via winget/choco/package deployments
4. Verifying fixes and rolling back on failure

Epic 14 Implementation
"""

import logging
import re
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import agent_wait

logger = logging.getLogger(__name__)


# ============================================
# Models (Pydantic)
# ============================================

from typing import Literal

from pydantic import BaseModel, Field

# A winget package identifier (`7zip.7zip`, `Notepad++.Notepad++`). It is put into a PowerShell
# command line unquoted, so only these characters are accepted.
WINGET_ID_PATTERN = r'^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$'


class RemediationPackageCreate(BaseModel):
    """Create a new remediation package (fix mapping)"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    target_software: str = Field(..., min_length=1, description="Software name pattern to match")
    min_fixed_version: Optional[str] = Field(None, description="Minimum version that's safe")
    fix_method: Literal['winget', 'choco', 'package', 'script']
    fix_command: Optional[str] = Field(None, description="Command to run for winget/choco/script")
    winget_id: Optional[str] = Field(None, pattern=WINGET_ID_PATTERN,
                                     description="winget package ID for the default winget command")
    package_id: Optional[UUID] = Field(None, description="Package ID for package method")
    enabled: bool = True


class RemediationPackageUpdate(BaseModel):
    """Update a remediation package"""
    name: Optional[str] = None
    description: Optional[str] = None
    target_software: Optional[str] = None
    min_fixed_version: Optional[str] = None
    fix_method: Optional[Literal['winget', 'choco', 'package', 'script']] = None
    fix_command: Optional[str] = None
    winget_id: Optional[str] = Field(None, pattern=WINGET_ID_PATTERN)
    package_id: Optional[UUID] = None
    enabled: Optional[bool] = None


class RemediationRuleCreate(BaseModel):
    """Create an auto-remediation rule"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    min_severity: Literal['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    software_pattern: Optional[str] = Field(None, description="Regex pattern for software names")
    auto_remediate: bool = False
    require_approval: bool = True
    maintenance_window_only: bool = True
    notify_on_new_vuln: bool = True
    notify_on_fix_success: bool = True
    notify_on_fix_failure: bool = True
    priority: int = Field(100, ge=1, le=1000)
    enabled: bool = True


class RemediationRuleUpdate(BaseModel):
    """Update a remediation rule"""
    name: Optional[str] = None
    description: Optional[str] = None
    min_severity: Optional[Literal['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']] = None
    software_pattern: Optional[str] = None
    auto_remediate: Optional[bool] = None
    require_approval: Optional[bool] = None
    maintenance_window_only: Optional[bool] = None
    notify_on_new_vuln: Optional[bool] = None
    notify_on_fix_success: Optional[bool] = None
    notify_on_fix_failure: Optional[bool] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None


class TriggerRemediationRequest(BaseModel):
    """Request to trigger remediation for specific vulnerabilities"""
    vulnerability_ids: Optional[list[int]] = None  # specific vulns
    severity_filter: Optional[list[str]] = None  # ['CRITICAL', 'HIGH']
    software_filter: Optional[str] = None  # software name pattern
    node_ids: Optional[list[UUID]] = None  # specific nodes
    dry_run: bool = False  # just show what would happen


class ApproveRemediationRequest(BaseModel):
    """Approve pending remediation jobs"""
    job_ids: list[int]
    approved_by: Optional[str] = None  # Legacy clients may send this; the server records the authenticated user.


# ============================================
# Schema, grouping and fix commands
# ============================================

async def ensure_schema(db_pool) -> None:
    """Columns added after the initial schema (existing installations)."""
    async with db_pool.acquire() as conn:
        await conn.execute("ALTER TABLE remediation_packages ADD COLUMN IF NOT EXISTS winget_id TEXT")
        # One job per node and update (#197): the CVEs and findings the update closes.
        await conn.execute("ALTER TABLE remediation_jobs ADD COLUMN IF NOT EXISTS cve_ids TEXT[]")
        await conn.execute("ALTER TABLE remediation_jobs ADD COLUMN IF NOT EXISTS vulnerability_ids INTEGER[]")
        # 'x86' for a 32-bit installation on the node (winget --architecture x86), else NULL
        await conn.execute("ALTER TABLE remediation_jobs ADD COLUMN IF NOT EXISTS architecture TEXT")
        # Jobs from before: one CVE each
        await conn.execute("""UPDATE remediation_jobs SET cve_ids = ARRAY[cve_id],
            vulnerability_ids = CASE WHEN vulnerability_id IS NULL THEN '{}'::integer[] ELSE ARRAY[vulnerability_id] END
            WHERE cve_ids IS NULL""")
        await conn.execute("""CREATE INDEX IF NOT EXISTS idx_remediation_jobs_node_software
            ON remediation_jobs (node_id, software_name, software_version)""")


# Jobs that still run or wait: a scan adds new CVEs of the same update to them instead of a new job.
WAITING_JOB_STATUSES = ('pending', 'approved')
# Jobs that block a new job for the same node and update (failed / rolled back ones do not).
OPEN_OR_DONE_JOB_STATUSES = ('pending', 'approved', 'running', 'success', 'skipped')

_SEVERITY_RANK = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}


def group_findings(rows: list[dict]) -> list[dict]:
    """One group per node and installed application version (= one update), in the order of the
    rows (highest CVSS first): the update closes all of the group's CVEs. The first finding stays
    the job's main CVE (`cve_id`, `vulnerability_id`); `severity` is the group's highest."""
    groups: dict[tuple, dict] = {}
    for row in rows:
        key = (str(row['node_id']), row['software_name'], row['software_version'])
        group = groups.get(key)
        if group is None:
            group = groups[key] = {
                'node_id': row['node_id'],
                'software_name': row['software_name'],
                'software_version': row['software_version'],
                'architecture': row.get('architecture'),
                'vulnerability_id': row['vulnerability_id'],
                'cve_id': row['cve_id'],
                'severity': row.get('severity'),
                'cve_ids': [],
                'vulnerability_ids': [],
            }
        if row['cve_id'] not in group['cve_ids']:
            group['cve_ids'].append(row['cve_id'])
            group['vulnerability_ids'].append(row['vulnerability_id'])
        if _SEVERITY_RANK.get(row.get('severity'), 999) < _SEVERITY_RANK.get(group['severity'], 999):
            group['severity'] = row.get('severity')
        if not group['architecture'] and row.get('architecture'):
            group['architecture'] = row['architecture']
    return list(groups.values())


# PowerShell also takes the typographic single quotes (U+2018, U+2019, U+201A, U+201B) as quotes
_PS_QUOTES = re.compile("['" + "".join(map(chr, (0x2018, 0x2019, 0x201A, 0x201B))) + "]")


def _ps_quote(value: str) -> str:
    """A PowerShell single-quoted string literal. Application names come from the node's inventory
    (any local user can write one under HKCU), so they must never end up in the command unquoted.
    Each quote inside is doubled."""
    return "'" + _PS_QUOTES.sub(lambda m: m.group(0) * 2, value or '') + "'"


def build_fix_command(fix_method: Optional[str], fix_command: Optional[str], winget_id: Optional[str],
                      software_name: str, architecture: Optional[str] = None) -> str:
    """The command the agent runs for a job. A fix command of the package is used as it is.
    Without one, winget updates the package by its winget ID (exact match) or, for packages
    without an ID, by the application's display name; a 32-bit installation gets
    `--architecture x86`, so winget does not pick the 64-bit package."""
    if fix_command:
        return fix_command
    if fix_method == 'winget':
        target = f'--id {winget_id} --exact' if winget_id else f'--name {_ps_quote(software_name)}'
        arch = ' --architecture x86' if architecture == 'x86' else ''
        return f'winget upgrade {target}{arch} --silent --accept-source-agreements'
    if fix_method == 'choco':
        return f'choco upgrade {_ps_quote(software_name)} -y'
    return f'echo {_ps_quote("No fix command for " + (software_name or ""))}'


# ============================================
# Database Functions
# ============================================

async def get_remediation_packages(db_pool, enabled_only: bool = False) -> list[dict]:
    """Get all remediation packages"""
    async with db_pool.acquire() as conn:
        query = "SELECT * FROM remediation_packages"
        if enabled_only:
            query += " WHERE enabled = true"
        query += " ORDER BY target_software, name"
        rows = await conn.fetch(query)
        return [dict(row) for row in rows]


async def get_remediation_package(db_pool, package_id: int) -> Optional[dict]:
    """Get a single remediation package"""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM remediation_packages WHERE id = $1", package_id
        )
        return dict(row) if row else None


async def create_remediation_package(db_pool, data: RemediationPackageCreate) -> dict:
    """Create a new remediation package"""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO remediation_packages 
            (name, description, target_software, min_fixed_version, fix_method, fix_command, winget_id,
             package_id, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        """, data.name, data.description, data.target_software, data.min_fixed_version,
             data.fix_method, data.fix_command, data.winget_id, data.package_id, data.enabled)
        return dict(row)


async def update_remediation_package(db_pool, package_id: int, data: RemediationPackageUpdate) -> Optional[dict]:
    """Update a remediation package"""
    async with db_pool.acquire() as conn:
        # Build dynamic update
        updates = []
        values = []
        idx = 1
        for field, value in data.model_dump(exclude_unset=True).items():
            updates.append(f"{field} = ${idx}")
            values.append(value)
            idx += 1
        
        if not updates:
            return await get_remediation_package(db_pool, package_id)
        
        values.append(package_id)
        query = f"""
            UPDATE remediation_packages 
            SET {', '.join(updates)}, updated_at = NOW()
            WHERE id = ${idx}
            RETURNING *
        """
        row = await conn.fetchrow(query, *values)
        return dict(row) if row else None


async def delete_remediation_package(db_pool, package_id: int) -> bool:
    """Delete a remediation package"""
    async with db_pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM remediation_packages WHERE id = $1", package_id
        )
        return result == "DELETE 1"


# Remediation Rules
async def get_remediation_rules(db_pool, enabled_only: bool = False) -> list[dict]:
    """Get all remediation rules"""
    async with db_pool.acquire() as conn:
        query = "SELECT * FROM remediation_rules"
        if enabled_only:
            query += " WHERE enabled = true"
        query += " ORDER BY priority, name"
        rows = await conn.fetch(query)
        return [dict(row) for row in rows]


async def get_remediation_rule(db_pool, rule_id: int) -> Optional[dict]:
    """Get a single remediation rule"""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM remediation_rules WHERE id = $1", rule_id
        )
        return dict(row) if row else None


async def create_remediation_rule(db_pool, data: RemediationRuleCreate) -> dict:
    """Create a new remediation rule"""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO remediation_rules 
            (name, description, min_severity, software_pattern, auto_remediate, 
             require_approval, maintenance_window_only, notify_on_new_vuln,
             notify_on_fix_success, notify_on_fix_failure, priority, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        """, data.name, data.description, data.min_severity, data.software_pattern,
             data.auto_remediate, data.require_approval, data.maintenance_window_only,
             data.notify_on_new_vuln, data.notify_on_fix_success, data.notify_on_fix_failure,
             data.priority, data.enabled)
        return dict(row)


async def update_remediation_rule(db_pool, rule_id: int, data: RemediationRuleUpdate) -> Optional[dict]:
    """Update a remediation rule"""
    async with db_pool.acquire() as conn:
        updates = []
        values = []
        idx = 1
        for field, value in data.model_dump(exclude_unset=True).items():
            updates.append(f"{field} = ${idx}")
            values.append(value)
            idx += 1
        
        if not updates:
            return await get_remediation_rule(db_pool, rule_id)
        
        values.append(rule_id)
        query = f"""
            UPDATE remediation_rules 
            SET {', '.join(updates)}, updated_at = NOW()
            WHERE id = ${idx}
            RETURNING *
        """
        row = await conn.fetchrow(query, *values)
        return dict(row) if row else None


async def delete_remediation_rule(db_pool, rule_id: int) -> bool:
    """Delete a remediation rule"""
    async with db_pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM remediation_rules WHERE id = $1", rule_id
        )
        return result == "DELETE 1"


# Maintenance Windows
async def get_maintenance_windows(db_pool) -> list[dict]:
    """Get all maintenance windows"""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM maintenance_windows ORDER BY name"
        )
        return [dict(row) for row in rows]


async def is_in_maintenance_window(db_pool, node_id: Optional[UUID] = None) -> bool:
    """Check the schedule and node scope of an active maintenance window."""
    async with db_pool.acquire() as conn:
        try:
            rows = await conn.fetch("""
                SELECT *, timezone(COALESCE(timezone, 'UTC'), NOW()) AS local_now
                FROM maintenance_windows WHERE is_active = TRUE
            """)
        except Exception:
            rows = await conn.fetch("""
                SELECT *, timezone(COALESCE(timezone, 'UTC'), NOW()) AS local_now
                FROM maintenance_windows WHERE enabled = TRUE
            """)

        group_ids: set[str] = set()
        if node_id is not None:
            node = await conn.fetchrow("SELECT node_id, hostname FROM nodes WHERE id = $1", node_id)
            if not node:
                return False
            identities = [str(node_id), node['node_id'], node['hostname']]
            try:
                memberships = await conn.fetch(
                    "SELECT group_id FROM group_members WHERE node_id = ANY($1::text[])", identities)
                group_ids = {str(member['group_id']) for member in memberships}
            except Exception:
                # Some older databases do not have group_members. Scoped windows fail closed.
                pass

        for record in rows:
            row = dict(record)
            local_now = row['local_now']
            start, end = row['start_time'], row['end_time']
            current = local_now.time()
            # The windows from Settings -> Maintenance windows (/api/v1/maintenance-windows) store
            # days_of_week as ISO weekdays, 1 = Monday ... 7 = Sunday, like its own check
            # (isoweekday). Older day_of_week columns count 0 = Sunday ... 6 = Saturday.
            iso = 'days_of_week' in row
            today = local_now.isoweekday() if iso else (local_now.weekday() + 1) % 7
            if start <= end:
                if not start <= current <= end:
                    continue
                scheduled_day = today
            elif current >= start:
                scheduled_day = today
            elif current <= end:
                # after midnight: the window belongs to the day it started
                scheduled_day = (today - 2) % 7 + 1 if iso else (today - 1) % 7
            else:
                continue
            days = row.get('days_of_week') if iso else row.get('day_of_week')
            if days is not None and scheduled_day not in days:
                continue
            if node_id is None:
                return True
            if 'applies_to_all' in row:
                if row['applies_to_all'] or group_ids.intersection(str(g) for g in (row.get('group_ids') or [])):
                    return True
            else:
                target = row.get('target_type') or 'all'
                if (target == 'all' or (target == 'node' and str(row.get('target_id')) == str(node_id))
                        or (target == 'group' and str(row.get('target_id')) in group_ids)):
                    return True
        return False


# Remediation Jobs
async def get_remediation_jobs(
    db_pool, 
    status: Optional[str] = None,
    node_id: Optional[UUID] = None,
    limit: int = 100
) -> list[dict]:
    """Get remediation jobs with filters"""
    async with db_pool.acquire() as conn:
        query = "SELECT * FROM remediation_jobs WHERE 1=1"
        params = []
        idx = 1
        
        if status:
            query += f" AND status = ${idx}"
            params.append(status)
            idx += 1
        
        if node_id:
            query += f" AND node_id = ${idx}"
            params.append(node_id)
            idx += 1
        
        query += f" ORDER BY created_at DESC LIMIT ${idx}"
        params.append(limit)
        
        rows = await conn.fetch(query, *params)
        return [dict(row) for row in rows]


async def get_remediation_job(db_pool, job_id: int) -> Optional[dict]:
    """Get a single remediation job"""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM remediation_jobs WHERE id = $1", job_id
        )
        return dict(row) if row else None


async def create_remediation_job(
    db_pool,
    vulnerability_id: int,
    remediation_package_id: int,
    rule_id: Optional[int],
    node_id: UUID,
    software_name: str,
    software_version: str,
    cve_id: str,
    requires_approval: bool = True,
    cve_ids: Optional[list[str]] = None,
    vulnerability_ids: Optional[list[int]] = None,
    architecture: Optional[str] = None,
    conn=None,
) -> dict:
    """Create a remediation job for one node and update; `cve_ids` lists all CVEs it closes
    (default: just `cve_id`). `conn`: insert on this connection (inside its transaction)."""
    status = 'pending' if requires_approval else 'approved'
    args = (vulnerability_id, remediation_package_id, rule_id, node_id, software_name, software_version,
            cve_id, status, requires_approval, cve_ids or [cve_id],
            vulnerability_ids if vulnerability_ids is not None else [vulnerability_id], architecture)
    sql = """
        INSERT INTO remediation_jobs
        (vulnerability_id, remediation_package_id, rule_id, node_id,
         software_name, software_version, cve_id, status, requires_approval,
         cve_ids, vulnerability_ids, architecture)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
    """
    if conn is not None:
        row = dict(await conn.fetchrow(sql, *args))
    else:
        async with db_pool.acquire() as conn:
            row = dict(await conn.fetchrow(sql, *args))
    if status == 'approved':
        agent_wait.notify(str(node_id), "remediation")  # agent long-poll (#283)
    return row


async def approve_remediation_jobs(db_pool, job_ids: list[int], approved_by: str) -> int:
    """Approve multiple remediation jobs"""
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            UPDATE remediation_jobs 
            SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
            WHERE id = ANY($2) AND status = 'pending'
            RETURNING node_id
        """, approved_by, job_ids)
        agent_wait.notify([str(r["node_id"]) for r in rows], "remediation")
        return len(rows)


async def update_remediation_job_status(
    db_pool, 
    job_id: int, 
    status: str,
    exit_code: Optional[int] = None,
    output_log: Optional[str] = None,
    error_message: Optional[str] = None
) -> Optional[dict]:
    """Update remediation job status"""
    async with db_pool.acquire() as conn:
        now = datetime.now(timezone.utc)
        
        updates = ["status = $1", "updated_at = $2"]
        values = [status, now]
        idx = 3
        
        if status == 'running':
            updates.append(f"started_at = ${idx}")
            values.append(now)
            idx += 1
        elif status in ('success', 'failed', 'rolled_back', 'skipped'):
            updates.append(f"completed_at = ${idx}")
            values.append(now)
            idx += 1
        
        if exit_code is not None:
            updates.append(f"exit_code = ${idx}")
            values.append(exit_code)
            idx += 1
        
        if output_log is not None:
            updates.append(f"output_log = ${idx}")
            values.append(output_log)
            idx += 1
        
        if error_message is not None:
            updates.append(f"error_message = ${idx}")
            values.append(error_message)
            idx += 1
        
        values.append(job_id)
        query = f"""
            UPDATE remediation_jobs 
            SET {', '.join(updates)}
            WHERE id = ${idx}
            RETURNING *
        """
        row = await conn.fetchrow(query, *values)
        return dict(row) if row else None


# ============================================
# Remediation Engine
# ============================================

class RemediationEngine:
    """
    Core engine for automatic vulnerability remediation.
    
    Flow:
    1. Scan vulnerabilities for matching fix packages
    2. Apply rules to determine action (auto-fix, alert, skip)
    3. Create remediation jobs
    4. Execute fixes (respecting maintenance windows)
    5. Verify success and rollback on failure
    """
    
    def __init__(self, db_pool):
        self.db_pool = db_pool
    
    async def find_fix_for_vulnerability(self, vuln: dict) -> Optional[dict]:
        """
        Find a remediation package that can fix this vulnerability.
        """
        packages = await get_remediation_packages(self.db_pool, enabled_only=True)
        
        software_name = vuln.get('software_name', '').lower()
        
        for pkg in packages:
            target = pkg['target_software'].lower()
            # Check if software matches (case-insensitive substring)
            if target in software_name or software_name in target:
                # Check if version is already fixed
                if pkg['min_fixed_version']:
                    current = vuln.get('software_version', '0')
                    if self._compare_versions(current, pkg['min_fixed_version']) >= 0:
                        continue  # Already at or above fixed version
                return pkg
        
        return None
    
    def _compare_versions(self, v1: str, v2: str) -> int:
        """
        Compare two version strings.
        Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
        """
        def normalize(v):
            # Extract numeric parts
            parts = re.findall(r'\d+', v)
            return [int(p) for p in parts] if parts else [0]
        
        n1, n2 = normalize(v1), normalize(v2)
        
        # Pad shorter list
        max_len = max(len(n1), len(n2))
        n1.extend([0] * (max_len - len(n1)))
        n2.extend([0] * (max_len - len(n2)))
        
        for a, b in zip(n1, n2):
            if a < b:
                return -1
            if a > b:
                return 1
        return 0
    
    async def get_matching_rule(self, vuln: dict, auto_only: bool = False) -> Optional[dict]:
        """
        Find the highest-priority rule that matches this vulnerability.
        """
        rules = await get_remediation_rules(self.db_pool, enabled_only=True)
        
        severity_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
        vuln_severity = vuln.get('severity', 'UNKNOWN')
        vuln_severity_rank = severity_order.get(vuln_severity, 999)
        
        for rule in sorted(rules, key=lambda r: r['priority']):
            if auto_only and not rule['auto_remediate']:
                continue
            # Check severity threshold
            rule_severity_rank = severity_order.get(rule['min_severity'], 999)
            if vuln_severity_rank > rule_severity_rank:
                continue  # Vulnerability not severe enough
            
            # Check software pattern
            if rule['software_pattern']:
                pattern = rule['software_pattern']
                software = vuln.get('software_name', '')
                if not re.search(pattern, software, re.IGNORECASE):
                    continue
            
            return rule
        
        return None
    
    async def scan_and_create_jobs(
        self, 
        severity_filter: Optional[list[str]] = None,
        software_filter: Optional[str] = None,
        node_ids: Optional[list[UUID]] = None,
        dry_run: bool = False,
        auto_only: bool = False
    ) -> dict:
        """
        Scan vulnerabilities and create remediation jobs.
        
        Returns summary of what was/would be done.
        """
        async with self.db_pool.acquire() as conn:
            # Get vulnerable software with node info
            query = """
                SELECT DISTINCT
                    v.id as vulnerability_id,
                    v.software_name,
                    v.software_version,
                    v.cve_id,
                    v.cvss_score,
                    v.severity,
                    sc.node_id,
                    sc.architecture
                FROM verified_vulnerabilities v
                JOIN software_current sc ON sc.name = v.software_name AND sc.version = v.software_version
                WHERE v.severity IS NOT NULL AND v.match_source = 'nvd_cpe'
            """
            params = []
            idx = 1
            
            if severity_filter:
                query += f" AND v.severity = ANY(${idx})"
                params.append(severity_filter)
                idx += 1
            
            if software_filter:
                query += f" AND v.software_name ILIKE ${idx}"
                params.append(f"%{software_filter}%")
                idx += 1
            
            if node_ids:
                query += f" AND sc.node_id = ANY(${idx})"
                params.append(node_ids)
                idx += 1
            
            query += " ORDER BY v.cvss_score DESC NULLS LAST LIMIT 500"
            
            rows = await conn.fetch(query, *params)
        
        # One job per node and update (#197): the findings of one installed application version
        # are fixed by the same update, so they share a job that lists their CVEs.
        groups = group_findings([dict(row) for row in rows])
        results = {
            'scanned': len(rows),
            'with_fix_available': 0,
            'dry_run': dry_run,
            'jobs_created': 0,
            'would_create': 0,
            'jobs_skipped_existing': 0,
            'jobs_skipped_no_rule': 0,
            'cves_added': 0,
            'details': []
        }

        for group in groups:
            fix_pkg = await self.find_fix_for_vulnerability(group)
            if not fix_pkg:
                continue

            results['with_fix_available'] += len(group['cve_ids'])

            # The group's highest severity decides, like for its most severe CVE alone
            rule = await self.get_matching_rule(group, auto_only=auto_only)
            if not rule:
                results['jobs_skipped_no_rule'] += 1
                continue

            async with self.db_pool.acquire() as conn, conn.transaction():
                # Two scans at once (e.g. the automatic one after a vulnerability scan and one from
                # the page) must not both create a job for the same node and update.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))",
                                   f"remediation:{group['node_id']}:{group['software_name']}:{group['software_version']}")
                existing = await conn.fetch("""
                    SELECT id, status, COALESCE(cve_ids, ARRAY[cve_id]) AS cve_ids FROM remediation_jobs
                    WHERE node_id = $1 AND software_name = $2 AND software_version = $3
                      AND status = ANY($4::text[])
                    ORDER BY (status = 'pending') DESC, created_at DESC
                """, group['node_id'], group['software_name'], group['software_version'],
                    list(OPEN_OR_DONE_JOB_STATUSES))

                if existing:
                    # Also covers the jobs from before, one per CVE.
                    results['jobs_skipped_existing'] += 1
                    known = {cve for job in existing for cve in (job['cve_ids'] or [])}
                    new = [(cve, vid) for cve, vid in zip(group['cve_ids'], group['vulnerability_ids'])
                           if cve not in known]
                    waiting = next((job for job in existing if job['status'] in WAITING_JOB_STATUSES), None)
                    if waiting and new:
                        # A CVE found since the job was created: the waiting job closes it too.
                        results['cves_added'] += len(new)
                        if not dry_run:
                            await conn.execute("""
                                UPDATE remediation_jobs
                                SET cve_ids = COALESCE(cve_ids, ARRAY[cve_id]) || $2::text[],
                                    vulnerability_ids = COALESCE(vulnerability_ids, '{}'::integer[]) || $3::integer[],
                                    updated_at = NOW()
                                WHERE id = $1
                            """, waiting['id'], [cve for cve, _ in new], [vid for _, vid in new])
                    continue

                detail = {
                    'vulnerability_id': group['vulnerability_id'],
                    'node_id': str(group['node_id']),
                    'software': group['software_name'],
                    'version': group['software_version'],
                    'architecture': group['architecture'],
                    'cve': group['cve_id'],
                    'cves': group['cve_ids'],
                    'cve_count': len(group['cve_ids']),
                    'severity': group['severity'],
                    'fix_package': fix_pkg['name'],
                    'fix_method': fix_pkg['fix_method'],
                    'rule': rule['name'],
                    'requires_approval': rule['require_approval']
                }

                if not dry_run:
                    job = await create_remediation_job(
                        self.db_pool,
                        vulnerability_id=group['vulnerability_id'],
                        remediation_package_id=fix_pkg['id'],
                        rule_id=rule['id'],
                        node_id=group['node_id'],
                        software_name=group['software_name'],
                        software_version=group['software_version'],
                        cve_id=group['cve_id'],
                        requires_approval=rule['require_approval'],
                        cve_ids=group['cve_ids'],
                        vulnerability_ids=group['vulnerability_ids'],
                        architecture=group['architecture'],
                        conn=conn,
                    )
                    detail['job_id'] = job['id']
                    results['jobs_created'] += 1
                else:
                    detail['job_id'] = None  # Dry run: nothing is written
                    results['would_create'] += 1

            results['details'].append(detail)

        return results
    
    async def generate_fix_command(self, job: dict, fix_pkg: dict) -> str:
        """The command the agent runs for this job (the same one the agent poll hands out)."""
        return build_fix_command(fix_pkg.get('fix_method'), fix_pkg.get('fix_command'), fix_pkg.get('winget_id'),
                                 job['software_name'], job.get('architecture'))


# ============================================
# Summary/Dashboard Functions  
# ============================================

async def get_remediation_summary(db_pool) -> dict:
    """Get remediation dashboard summary"""
    async with db_pool.acquire() as conn:
        # Job counts by status
        status_counts = await conn.fetch("""
            SELECT status, COUNT(*) as count 
            FROM remediation_jobs 
            GROUP BY status
        """)
        
        # Recent jobs
        recent_jobs = await conn.fetch("""
            SELECT rj.*, rp.name as package_name, rp.fix_method
            FROM remediation_jobs rj
            LEFT JOIN remediation_packages rp ON rj.remediation_package_id = rp.id
            ORDER BY rj.created_at DESC
            LIMIT 10
        """)
        
        # Packages count
        package_count = await conn.fetchval(
            "SELECT COUNT(*) FROM remediation_packages WHERE enabled = true"
        )
        
        # Rules count
        rule_count = await conn.fetchval(
            "SELECT COUNT(*) FROM remediation_rules WHERE enabled = true"
        )
        
        # Vulnerabilities with available fixes
        fixable = await conn.fetchval("""
            SELECT COUNT(DISTINCT v.id)
            FROM verified_vulnerabilities v
            JOIN remediation_packages rp ON (
                v.software_name ILIKE '%' || rp.target_software || '%'
                AND rp.enabled = true
            )
            WHERE v.severity IN ('CRITICAL', 'HIGH') AND v.match_source = 'nvd_cpe'
        """)
        
        return {
            'job_counts': {row['status']: row['count'] for row in status_counts},
            'recent_jobs': [dict(row) for row in recent_jobs],
            'active_packages': package_count,
            'active_rules': rule_count,
            'fixable_vulnerabilities': fixable,
            'in_maintenance_window': await is_in_maintenance_window(db_pool)
        }
