-- OpenClaw Inventory Platform - Full Database Schema
-- Extracted from production, cleaned for CI compatibility
-- Generated: 2026-02-14

-- ============================================
-- Core Tables
-- ============================================

-- Nodes (devices/endpoints)
CREATE TABLE IF NOT EXISTS nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id TEXT UNIQUE NOT NULL,
    hostname TEXT NOT NULL,
    display_name TEXT,
    os_name TEXT,
    os_version TEXT,
    os_build TEXT,
    architecture TEXT,
    domain TEXT,
    ip_address TEXT,
    mac_address TEXT,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    is_online BOOLEAN DEFAULT true,
    agent_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nodes_node_id ON nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_nodes_hostname ON nodes(hostname);
CREATE INDEX IF NOT EXISTS idx_nodes_is_online ON nodes(is_online);

-- Groups
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    parent_id UUID REFERENCES groups(id),
    is_dynamic BOOLEAN DEFAULT false,
    dynamic_query JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Device-Group membership
CREATE TABLE IF NOT EXISTS device_groups (
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    assigned_by TEXT,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (node_id, group_id)
);

-- ============================================
-- Inventory Data
-- ============================================

-- Hardware inventory
CREATE TABLE IF NOT EXISTS hardware_current (
    node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    cpu JSONB,
    ram JSONB,
    disks JSONB,
    mainboard JSONB,
    bios JSONB,
    gpu JSONB,
    nics JSONB,
    virtualization JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Software inventory
CREATE TABLE IF NOT EXISTS software_current (
    id SERIAL PRIMARY KEY,
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version TEXT,
    publisher TEXT,
    install_date TEXT,
    install_path TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(node_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_software_node ON software_current(node_id);
CREATE INDEX IF NOT EXISTS idx_software_name ON software_current(name);

-- Hotfixes
CREATE TABLE IF NOT EXISTS hotfixes_current (
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    kb_id TEXT NOT NULL,
    description TEXT,
    installed_on TEXT,
    installed_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (node_id, kb_id)
);

-- Security status
CREATE TABLE IF NOT EXISTS security_current (
    node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    defender JSONB,
    firewall JSONB,
    tpm JSONB,
    uac JSONB,
    bitlocker JSONB,
    local_admins JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- System info
CREATE TABLE IF NOT EXISTS system_current (
    node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    uptime_hours NUMERIC(10,2),
    uptime_formatted TEXT,
    last_boot_time TIMESTAMPTZ,
    agent_version TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Network info
CREATE TABLE IF NOT EXISTS network_current (
    node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    adapters JSONB DEFAULT '[]',
    connections JSONB DEFAULT '[]',
    listening_ports JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Browser info
CREATE TABLE IF NOT EXISTS browser_current (
    node_id UUID NOT NULL,
    browser TEXT NOT NULL,
    profile TEXT DEFAULT 'Default',
    username TEXT DEFAULT '',
    extensions JSONB,
    cookies_count INTEGER DEFAULT 0,
    history_count INTEGER DEFAULT 0,
    logins_count INTEGER DEFAULT 0,
    bookmarks_count INTEGER DEFAULT 0,
    bookmark_count INTEGER,
    password_count INTEGER,
    profile_path TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (node_id, browser, profile, username)
);

-- Browser cookies
CREATE TABLE IF NOT EXISTS browser_cookies_current (
    id BIGSERIAL PRIMARY KEY,
    node_id UUID,
    browser TEXT,
    profile TEXT DEFAULT 'Default',
    domain TEXT,
    name TEXT,
    value TEXT,
    expires TIMESTAMPTZ,
    secure BOOLEAN DEFAULT false,
    http_only BOOLEAN DEFAULT false,
    same_site TEXT,
    created_at TIMESTAMPTZ
);

-- ============================================
-- Jobs & Scheduling
-- ============================================

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    job_type TEXT NOT NULL,
    command TEXT,
    script TEXT,
    parameters JSONB DEFAULT '{}',
    schedule_type TEXT,
    schedule_value TEXT,
    target_type TEXT,
    target_id UUID,
    is_enabled BOOLEAN DEFAULT true,
    timeout_seconds INTEGER DEFAULT 300,
    run_as_system BOOLEAN DEFAULT true,
    created_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS job_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    triggered_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_results (
    id SERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    instance_id UUID REFERENCES job_instances(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    success BOOLEAN NOT NULL,
    exit_code INTEGER,
    output TEXT,
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS job_assignments (
    id SERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_logs (
    id SERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    instance_id UUID,
    node_id UUID,
    message TEXT,
    level TEXT DEFAULT 'info',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Packages & Deployments
-- ============================================

CREATE TABLE IF NOT EXISTS packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    publisher TEXT,
    category TEXT,
    install_command TEXT,
    uninstall_command TEXT,
    detect_script TEXT,
    icon_url TEXT,
    requires_reboot BOOLEAN DEFAULT false,
    requires_admin BOOLEAN DEFAULT true,
    silent_install BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID REFERENCES packages(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    release_notes TEXT,
    download_url TEXT,
    checksum TEXT,
    checksum_type TEXT DEFAULT 'sha256',
    file_size BIGINT,
    install_command TEXT,
    is_latest BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_version_sources (
    version_id UUID REFERENCES package_versions(id) ON DELETE CASCADE,
    source_id UUID REFERENCES package_sources(id) ON DELETE CASCADE,
    source_package_id TEXT,
    PRIMARY KEY (version_id, source_id)
);

CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    package_version_id UUID REFERENCES package_versions(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('node', 'group', 'all')),
    target_id UUID,
    mode TEXT DEFAULT 'required' CHECK (mode IN ('required', 'available', 'uninstall')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'completed', 'cancelled')),
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    maintenance_window_only BOOLEAN DEFAULT false,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deployment_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'downloading', 'installing', 'success', 'failed', 'skipped')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    exit_code INTEGER,
    output TEXT,
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMPTZ
);

-- ============================================
-- RBAC (Users, Roles, API Keys)
-- ============================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (name, description, permissions) VALUES
    ('admin', 'Full system access', '["*"]'),
    ('operator', 'Can manage nodes and deployments', '["nodes:read", "nodes:write", "deployments:*", "jobs:*"]'),
    ('viewer', 'Read-only access', '["*:read"]'),
    ('deployer', 'Can create and manage deployments', '["deployments:*", "packages:read", "nodes:read"]')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    is_superuser BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT[] DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    last_used TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    user_id UUID,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details JSONB,
    ip_address INET
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

-- ============================================
-- Alerts & Notifications
-- ============================================

CREATE TABLE IF NOT EXISTS notification_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    config JSONB DEFAULT '{}',
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    event_type TEXT NOT NULL,
    condition JSONB DEFAULT '{}',
    severity TEXT DEFAULT 'warning',
    is_enabled BOOLEAN DEFAULT true,
    cooldown_minutes INTEGER DEFAULT 60,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_rule_channels (
    rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES notification_channels(id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, channel_id)
);

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES alert_rules(id),
    rule_name TEXT,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    node_id UUID REFERENCES nodes(id),
    node_name TEXT,
    metadata JSONB DEFAULT '{}',
    status TEXT DEFAULT 'fired',
    fired_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Event Logging
-- ============================================

CREATE TABLE IF NOT EXISTS eventlog_entries (
    id BIGSERIAL PRIMARY KEY,
    node_id TEXT NOT NULL,
    log_name TEXT NOT NULL,
    event_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    level_name TEXT,
    source TEXT,
    message TEXT,
    event_time TIMESTAMPTZ NOT NULL,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_eventlog_node ON eventlog_entries(node_id);
CREATE INDEX IF NOT EXISTS idx_eventlog_time ON eventlog_entries(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_eventlog_level ON eventlog_entries(level);

CREATE TABLE IF NOT EXISTS eventlog_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    log_name TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT true,
    max_events INTEGER DEFAULT 1000,
    min_level INTEGER DEFAULT 2,
    sources TEXT[],
    event_ids INTEGER[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(node_id, log_name)
);

CREATE TABLE IF NOT EXISTS detection_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    log_name TEXT,
    event_id INTEGER,
    source TEXT,
    pattern TEXT,
    severity TEXT DEFAULT 'medium',
    is_enabled BOOLEAN DEFAULT true,
    alert_on_match BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Vulnerabilities & Remediation
-- ============================================

CREATE TABLE IF NOT EXISTS vulnerabilities (
    id SERIAL PRIMARY KEY,
    software_name TEXT NOT NULL,
    software_version TEXT NOT NULL,
    cve_id TEXT NOT NULL,
    description TEXT,
    cvss_score NUMERIC(3,1),
    cvss_vector TEXT,
    severity TEXT,
    published_date TIMESTAMPTZ,
    reference_urls JSONB DEFAULT '[]',
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    last_checked TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(software_name, software_version, cve_id)
);

CREATE INDEX IF NOT EXISTS idx_vuln_severity ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vuln_software ON vulnerabilities(software_name, software_version);

CREATE TABLE IF NOT EXISTS vulnerability_scans (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    packages_scanned INTEGER DEFAULT 0,
    vulnerabilities_found INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS vulnerability_suppressions (
    id SERIAL PRIMARY KEY,
    cve_id TEXT NOT NULL,
    software_name TEXT,
    reason TEXT NOT NULL,
    suppressed_by TEXT NOT NULL,
    suppressed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(cve_id, software_name)
);

CREATE TABLE IF NOT EXISTS remediation_packages (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    target_software TEXT NOT NULL,
    min_fixed_version TEXT,
    install_command TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remediation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    software_pattern TEXT NOT NULL,
    remediation_type TEXT NOT NULL,
    package_id INTEGER REFERENCES remediation_packages(id),
    custom_command TEXT,
    is_enabled BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS remediation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES remediation_rules(id),
    package_id INTEGER REFERENCES remediation_packages(id),
    software_name TEXT,
    software_version TEXT,
    status TEXT DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    exit_code INTEGER,
    output TEXT,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Tags
-- ============================================

CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#808080',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_tags (
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, tag_id)
);

-- ============================================
-- System Settings & Misc
-- ============================================

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    description TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 10,
    use_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS maintenance_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    days_of_week INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
    timezone TEXT DEFAULT 'Europe/Berlin',
    is_active BOOLEAN DEFAULT true,
    target_type TEXT CHECK (target_type IN ('all', 'group', 'node')),
    target_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Metrics & History (simplified for CI)
-- ============================================

CREATE TABLE IF NOT EXISTS node_metrics (
    time TIMESTAMPTZ NOT NULL,
    node_id UUID NOT NULL,
    cpu_percent REAL,
    ram_percent REAL,
    disk_percent REAL,
    network_in_mb REAL,
    network_out_mb REAL,
    PRIMARY KEY (time, node_id)
);

CREATE TABLE IF NOT EXISTS hardware_changes (
    time TIMESTAMPTZ NOT NULL,
    node_id UUID NOT NULL,
    change_type TEXT,
    component TEXT,
    old_value JSONB,
    new_value JSONB
);

CREATE TABLE IF NOT EXISTS software_changes (
    id SERIAL PRIMARY KEY,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    software_name TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_version TEXT,
    new_version TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS update_history (
    id SERIAL PRIMARY KEY,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    kb_id TEXT,
    title TEXT,
    description TEXT,
    operation TEXT,
    result_code INTEGER,
    installed_on TIMESTAMPTZ,
    support_url TEXT,
    categories JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS node_health (
    node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'unknown',
    last_check TIMESTAMPTZ DEFAULT NOW(),
    cpu_status TEXT,
    memory_status TEXT,
    disk_status TEXT,
    service_status TEXT,
    issues JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS node_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    snapshot_type TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Done!
-- ============================================

-- ============================================
-- Views for API compatibility
-- ============================================

-- Job summary view
CREATE OR REPLACE VIEW job_summary AS
SELECT 
    j.id,
    j.name,
    j.job_type,
    j.is_enabled,
    j.created_at,
    COUNT(ji.id) as total_runs,
    COUNT(CASE WHEN ji.status = 'completed' THEN 1 END) as successful_runs,
    MAX(ji.completed_at) as last_run
FROM jobs j
LEFT JOIN job_instances ji ON j.id = ji.job_id
GROUP BY j.id, j.name, j.job_type, j.is_enabled, j.created_at;

-- Add missing columns
ALTER TABLE packages ADD COLUMN IF NOT EXISTS display_name TEXT;
