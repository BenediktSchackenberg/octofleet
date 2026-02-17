-- Schema for Job Execution and Tracking

-- Existing database setup assumed
-- Adding new table: job_assignments
CREATE TABLE IF NOT EXISTS job_assignments (
    id SERIAL PRIMARY KEY,
    job_id UUID NOT NULL,
    node_id UUID NOT NULL,
    status TEXT CHECK (status IN ('pending', 'assigned', 'running', 'completed', 'failed')) DEFAULT 'pending',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
);

-- Adding new table: job_results
CREATE TABLE IF NOT EXISTS job_results (
    id SERIAL PRIMARY KEY,
    job_id UUID NOT NULL,
    node_id UUID NOT NULL,
    success BOOLEAN NOT NULL,
    logs TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (node_id) REFERENCES nodes (id) ON DELETE CASCADE
);
-- ============================================
-- E13: Vulnerability Tracking
-- ============================================

-- Discovered vulnerabilities from NVD scans
CREATE TABLE IF NOT EXISTS vulnerabilities (
    id SERIAL PRIMARY KEY,
    software_name TEXT NOT NULL,
    software_version TEXT NOT NULL,
    cve_id TEXT NOT NULL,
    description TEXT,
    cvss_score NUMERIC(3,1),
    cvss_vector TEXT,
    severity TEXT, -- CRITICAL, HIGH, MEDIUM, LOW, UNKNOWN
    published_date TIMESTAMPTZ,
    reference_urls JSONB DEFAULT '[]',
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    last_checked TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(software_name, software_version, cve_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_cvss ON vulnerabilities(cvss_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_software ON vulnerabilities(software_name, software_version);

-- Vulnerability scan history
CREATE TABLE IF NOT EXISTS vulnerability_scans (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    packages_scanned INTEGER DEFAULT 0,
    vulnerabilities_found INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    high_count INTEGER DEFAULT 0,
    medium_count INTEGER DEFAULT 0,
    low_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running', -- running, completed, failed
    error_message TEXT
);

-- Acknowledged/suppressed vulnerabilities (for false positives or accepted risks)
CREATE TABLE IF NOT EXISTS vulnerability_suppressions (
    id SERIAL PRIMARY KEY,
    cve_id TEXT NOT NULL,
    software_name TEXT, -- NULL means suppress for all software
    reason TEXT NOT NULL,
    suppressed_by TEXT NOT NULL,
    suppressed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- NULL means permanent
    
    UNIQUE(cve_id, software_name)
);

-- System settings (key-value store)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

-- ============================================
-- E14: Auto-Remediation
-- ============================================

-- Fix packages that can remediate vulnerabilities
CREATE TABLE IF NOT EXISTS remediation_packages (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,                    -- e.g. "7zip-update"
    description TEXT,
    
    -- What this package fixes
    target_software TEXT NOT NULL,         -- e.g. "7-Zip" (matches software_name pattern)
    min_fixed_version TEXT,                -- e.g. "24.09" - versions >= this are safe
    
    -- How to fix
    fix_method TEXT NOT NULL CHECK (fix_method IN ('winget', 'choco', 'package', 'script')),
    fix_command TEXT,                      -- e.g. "winget upgrade 7zip.7zip --silent"
    package_id UUID REFERENCES packages(id),  -- if fix_method = 'package'
    
    -- Metadata
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(name)
);

-- Rules for automatic remediation
CREATE TABLE IF NOT EXISTS remediation_rules (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    
    -- Conditions
    min_severity TEXT NOT NULL CHECK (min_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    software_pattern TEXT,                 -- NULL = all software, or regex pattern
    
    -- Actions
    auto_remediate BOOLEAN DEFAULT false,  -- true = auto-fix, false = alert only
    require_approval BOOLEAN DEFAULT true, -- require manual approval before fix
    maintenance_window_only BOOLEAN DEFAULT true, -- only during maintenance windows
    
    -- Notifications
    notify_on_new_vuln BOOLEAN DEFAULT true,
    notify_on_fix_success BOOLEAN DEFAULT true,
    notify_on_fix_failure BOOLEAN DEFAULT true,
    notification_channel_id INTEGER,       -- FK to notification_channels if exists
    
    -- Metadata
    priority INTEGER DEFAULT 100,          -- lower = higher priority
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Remediation jobs/history
CREATE TABLE IF NOT EXISTS remediation_jobs (
    id SERIAL PRIMARY KEY,
    
    -- What triggered this
    vulnerability_id INTEGER REFERENCES vulnerabilities(id),
    remediation_package_id INTEGER REFERENCES remediation_packages(id),
    rule_id INTEGER REFERENCES remediation_rules(id),
    
    -- Target
    node_id UUID REFERENCES nodes(id),
    software_name TEXT NOT NULL,
    software_version TEXT NOT NULL,
    cve_id TEXT NOT NULL,
    
    -- Execution
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',           -- waiting for approval or maintenance window
        'approved',          -- approved, waiting to execute
        'running',           -- currently executing
        'success',           -- fix applied successfully
        'failed',            -- fix failed
        'rolled_back',       -- rolled back after failure
        'skipped'            -- skipped (e.g. already fixed)
    )),
    
    -- Approval workflow
    requires_approval BOOLEAN DEFAULT false,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    
    -- Execution details
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    exit_code INTEGER,
    output_log TEXT,
    error_message TEXT,
    
    -- Rollback info
    rollback_attempted BOOLEAN DEFAULT false,
    rollback_success BOOLEAN,
    
    -- Health check
    health_check_passed BOOLEAN,
    health_check_message TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for remediation
CREATE INDEX IF NOT EXISTS idx_remediation_packages_software ON remediation_packages(target_software);
CREATE INDEX IF NOT EXISTS idx_remediation_jobs_status ON remediation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_remediation_jobs_node ON remediation_jobs(node_id);
CREATE INDEX IF NOT EXISTS idx_remediation_jobs_cve ON remediation_jobs(cve_id);

-- Maintenance windows for safe remediation
CREATE TABLE IF NOT EXISTS maintenance_windows (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    
    -- Schedule (cron-like)
    day_of_week INTEGER[],                 -- 0=Sunday, 1=Monday, etc. NULL=every day
    start_time TIME NOT NULL,              -- e.g. '02:00'
    end_time TIME NOT NULL,                -- e.g. '06:00'
    timezone TEXT DEFAULT 'UTC',
    
    -- Scope
    applies_to_all BOOLEAN DEFAULT true,
    group_ids INTEGER[],                   -- specific groups if not all
    
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- View: Vulnerable software with available fixes
CREATE OR REPLACE VIEW v_remediable_vulnerabilities AS
SELECT 
    v.id as vulnerability_id,
    v.software_name,
    v.software_version,
    v.cve_id,
    v.cvss_score,
    v.severity,
    rp.id as remediation_package_id,
    rp.name as fix_package_name,
    rp.fix_method,
    rp.fix_command,
    rp.min_fixed_version,
    CASE 
        WHEN rp.id IS NOT NULL THEN true 
        ELSE false 
    END as has_fix_available
FROM vulnerabilities v
LEFT JOIN remediation_packages rp ON (
    v.software_name ILIKE '%' || rp.target_software || '%'
    AND rp.enabled = true
)
WHERE v.severity IN ('CRITICAL', 'HIGH')
ORDER BY v.cvss_score DESC NULLS LAST;

-- ============================================================================
-- E18: Service Orchestration Tables
-- ============================================================================

-- Service class templates (blueprints for services)
CREATE TABLE IF NOT EXISTS service_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    service_type VARCHAR(50) DEFAULT 'standalone' CHECK (service_type IN ('standalone', 'cluster', 'replicated')),
    min_nodes INTEGER DEFAULT 1,
    max_nodes INTEGER DEFAULT 100,
    roles JSONB DEFAULT '["primary"]'::JSONB,
    required_packages JSONB,
    config_template TEXT,
    health_check JSONB,
    drift_policy VARCHAR(20) DEFAULT 'warn' CHECK (drift_policy IN ('ignore', 'warn', 'strict')),
    update_strategy VARCHAR(20) DEFAULT 'rolling' CHECK (update_strategy IN ('rolling', 'blue-green', 'canary')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT
);

-- Service instances
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES service_classes(id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'provisioning' CHECK (status IN (
        'provisioning', 'healthy', 'degraded', 'failed', 'stopped', 'reconciling'
    )),
    desired_state_version INTEGER DEFAULT 1,
    config_values JSONB,
    secrets_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT
);

-- Node-to-service assignments
CREATE TABLE IF NOT EXISTS service_node_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'primary',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', 'provisioning', 'active', 'draining', 'removed'
    )),
    current_state_version INTEGER DEFAULT 0,
    last_reconciled_at TIMESTAMPTZ,
    last_reconciled_version INTEGER,
    health_status VARCHAR(20) DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'unhealthy', 'unknown')),
    health_message TEXT,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(service_id, node_id)
);

-- Reconciliation audit log
CREATE TABLE IF NOT EXISTS service_reconciliation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    message TEXT,
    details JSONB,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for service orchestration
CREATE INDEX IF NOT EXISTS idx_services_class ON services(class_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_service_node_assignments_service ON service_node_assignments(service_id);
CREATE INDEX IF NOT EXISTS idx_service_node_assignments_node ON service_node_assignments(node_id);
CREATE INDEX IF NOT EXISTS idx_service_reconciliation_log_service ON service_reconciliation_log(service_id);
CREATE INDEX IF NOT EXISTS idx_service_reconciliation_log_node ON service_reconciliation_log(node_id);

-- E18 Constraint updates (run after table creation)
-- Add 'service_reconcile' to command_type
-- ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_command_type_check;
-- ALTER TABLE jobs ADD CONSTRAINT jobs_command_type_check CHECK (
--     command_type IN ('run', 'script', 'inventory', 'install_package', 'uninstall_package', 'update_package', 'restart-agent', 'service_reconcile')
-- );

-- Add 'node' to target_type
-- ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_target_type_check;
-- ALTER TABLE jobs ADD CONSTRAINT jobs_target_type_check CHECK (
--     target_type IN ('device', 'group', 'tag', 'all', 'node')
-- );
