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

import asyncio
import logging
import re
from datetime import datetime, time, timezone
from typing import Optional
from uuid import UUID

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================
# Models (Pydantic)
# ============================================

from pydantic import BaseModel, Field
from typing import Literal


class RemediationPackageCreate(BaseModel):
    """Create a new remediation package (fix mapping)"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    target_software: str = Field(..., min_length=1, description="Software name pattern to match")
    min_fixed_version: Optional[str] = Field(None, description="Minimum version that's safe")
    fix_method: Literal['winget', 'choco', 'package', 'script']
    fix_command: Optional[str] = Field(None, description="Command to run for winget/choco/script")
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


class MaintenanceWindowCreate(BaseModel):
    """Create a maintenance window"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    day_of_week: Optional[list[int]] = Field(None, description="0=Sun, 6=Sat. None=every day")
    start_time: str = Field(..., description="HH:MM format")
    end_time: str = Field(..., description="HH:MM format")
    timezone: str = "UTC"
    applies_to_all: bool = True
    group_ids: Optional[list[int]] = None
    enabled: bool = True


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
    approved_by: str


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
            (name, description, target_software, min_fixed_version, fix_method, fix_command, package_id, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        """, data.name, data.description, data.target_software, data.min_fixed_version,
             data.fix_method, data.fix_command, data.package_id, data.enabled)
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


async def create_maintenance_window(db_pool, data: MaintenanceWindowCreate) -> dict:
    """Create a maintenance window"""
    async with db_pool.acquire() as conn:
        # Parse time strings
        start = time.fromisoformat(data.start_time)
        end = time.fromisoformat(data.end_time)
        
        row = await conn.fetchrow("""
            INSERT INTO maintenance_windows 
            (name, description, day_of_week, start_time, end_time, timezone, applies_to_all, group_ids, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        """, data.name, data.description, data.day_of_week, start, end,
             data.timezone, data.applies_to_all, data.group_ids, data.enabled)
        return dict(row)


async def is_in_maintenance_window(db_pool, node_id: Optional[UUID] = None) -> bool:
    """Check if current time is within any active maintenance window"""
    async with db_pool.acquire() as conn:
        now = datetime.now(timezone.utc)
        current_time = now.time()
        current_dow = now.weekday()  # 0=Monday in Python, but we store 0=Sunday
        # Convert Python weekday to our format (0=Sunday)
        current_dow = (current_dow + 1) % 7
        
        # Check both old and new schema
        try:
            rows = await conn.fetch("""
                SELECT * FROM maintenance_windows 
                WHERE is_active = true
                AND $1 = ANY(days_of_week)
                AND start_time <= $2 AND end_time >= $2
            """, current_dow, current_time)
        except Exception:
            # Fallback for new schema
            rows = await conn.fetch("""
                SELECT * FROM maintenance_windows 
                WHERE enabled = true
                AND (day_of_week IS NULL OR $1 = ANY(day_of_week))
                AND start_time <= $2 AND end_time >= $2
            """, current_dow, current_time)
        
        return len(rows) > 0


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
    requires_approval: bool = True
) -> dict:
    """Create a remediation job"""
    async with db_pool.acquire() as conn:
        status = 'pending' if requires_approval else 'approved'
        row = await conn.fetchrow("""
            INSERT INTO remediation_jobs 
            (vulnerability_id, remediation_package_id, rule_id, node_id,
             software_name, software_version, cve_id, status, requires_approval)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        """, vulnerability_id, remediation_package_id, rule_id, node_id,
             software_name, software_version, cve_id, status, requires_approval)
        return dict(row)


async def approve_remediation_jobs(db_pool, job_ids: list[int], approved_by: str) -> int:
    """Approve multiple remediation jobs"""
    async with db_pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE remediation_jobs 
            SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
            WHERE id = ANY($2) AND status = 'pending'
        """, approved_by, job_ids)
        return int(result.split()[-1])


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
    
    async def get_matching_rule(self, vuln: dict) -> Optional[dict]:
        """
        Find the highest-priority rule that matches this vulnerability.
        """
        rules = await get_remediation_rules(self.db_pool, enabled_only=True)
        
        severity_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3}
        vuln_severity = vuln.get('severity', 'UNKNOWN')
        vuln_severity_rank = severity_order.get(vuln_severity, 999)
        
        for rule in sorted(rules, key=lambda r: r['priority']):
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
        dry_run: bool = False
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
                    sc.node_id
                FROM vulnerabilities v
                JOIN software_current sc ON (
                    sc.name ILIKE '%' || v.software_name || '%'
                    OR v.software_name ILIKE '%' || sc.name || '%'
                )
                WHERE v.severity IS NOT NULL
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
        
        results = {
            'scanned': len(rows),
            'with_fix_available': 0,
            'jobs_created': 0,
            'jobs_skipped_existing': 0,
            'jobs_skipped_no_rule': 0,
            'details': []
        }
        
        for row in rows:
            vuln = dict(row)
            
            # Find fix package
            fix_pkg = await self.find_fix_for_vulnerability(vuln)
            if not fix_pkg:
                continue
            
            results['with_fix_available'] += 1
            
            # Find matching rule
            rule = await self.get_matching_rule(vuln)
            if not rule:
                results['jobs_skipped_no_rule'] += 1
                continue
            
            # Check if job already exists
            async with self.db_pool.acquire() as conn:
                existing = await conn.fetchrow("""
                    SELECT id FROM remediation_jobs 
                    WHERE node_id = $1 AND cve_id = $2 AND status NOT IN ('failed', 'rolled_back')
                """, vuln['node_id'], vuln['cve_id'])
                
                if existing:
                    results['jobs_skipped_existing'] += 1
                    continue
            
            detail = {
                'vulnerability_id': vuln['vulnerability_id'],
                'node_id': str(vuln['node_id']),
                'software': vuln['software_name'],
                'version': vuln['software_version'],
                'cve': vuln['cve_id'],
                'severity': vuln['severity'],
                'fix_package': fix_pkg['name'],
                'fix_method': fix_pkg['fix_method'],
                'rule': rule['name'],
                'requires_approval': rule['require_approval']
            }
            
            if not dry_run:
                job = await create_remediation_job(
                    self.db_pool,
                    vulnerability_id=vuln['vulnerability_id'],
                    remediation_package_id=fix_pkg['id'],
                    rule_id=rule['id'],
                    node_id=vuln['node_id'],
                    software_name=vuln['software_name'],
                    software_version=vuln['software_version'],
                    cve_id=vuln['cve_id'],
                    requires_approval=rule['require_approval']
                )
                detail['job_id'] = job['id']
                results['jobs_created'] += 1
            else:
                detail['job_id'] = None  # Dry run
                results['jobs_created'] += 1
            
            results['details'].append(detail)
        
        return results
    
    async def generate_fix_command(self, job: dict, fix_pkg: dict) -> str:
        """
        Generate the command to execute for a remediation job.
        """
        method = fix_pkg['fix_method']
        
        if method == 'winget':
            cmd = fix_pkg.get('fix_command')
            if not cmd:
                # Auto-generate winget command
                # Try to find winget package ID from software name
                software = job['software_name'].lower()
                if '7-zip' in software or '7zip' in software:
                    cmd = 'winget upgrade 7zip.7zip --silent --accept-source-agreements'
                elif 'chrome' in software:
                    cmd = 'winget upgrade Google.Chrome --silent --accept-source-agreements'
                elif 'firefox' in software:
                    cmd = 'winget upgrade Mozilla.Firefox --silent --accept-source-agreements'
                else:
                    cmd = f'winget upgrade --name "{job["software_name"]}" --silent --accept-source-agreements'
            return cmd
        
        elif method == 'choco':
            cmd = fix_pkg.get('fix_command')
            if not cmd:
                software = job['software_name'].lower()
                if '7-zip' in software or '7zip' in software:
                    cmd = 'choco upgrade 7zip -y'
                else:
                    cmd = f'choco upgrade {job["software_name"]} -y'
            return cmd
        
        elif method == 'script':
            return fix_pkg.get('fix_command', 'echo "No script defined"')
        
        elif method == 'package':
            # This would trigger a package deployment
            return f'DEPLOY_PACKAGE:{fix_pkg["package_id"]}'
        
        return 'echo "Unknown fix method"'


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
            FROM vulnerabilities v
            JOIN remediation_packages rp ON (
                v.software_name ILIKE '%' || rp.target_software || '%'
                AND rp.enabled = true
            )
            WHERE v.severity IN ('CRITICAL', 'HIGH')
        """)
        
        return {
            'job_counts': {row['status']: row['count'] for row in status_counts},
            'recent_jobs': [dict(row) for row in recent_jobs],
            'active_packages': package_count,
            'active_rules': rule_count,
            'fixable_vulnerabilities': fixable,
            'in_maintenance_window': await is_in_maintenance_window(db_pool)
        }
