-- ============================================
-- OpenClaw Inventory Platform - Full Schema for CI
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enable TimescaleDB (optional, graceful if not available)
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'TimescaleDB not available, continuing without it';
END $$;

-- ============================================
-- Core Tables
-- ============================================

-- Nodes (endpoints/agents)
CREATE TABLE IF NOT EXISTS nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID UNIQUE NOT NULL,
    hostname TEXT NOT NULL,
    os_name TEXT,
    os_version TEXT,
    os_build TEXT,
    ip_address TEXT,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    is_online BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nodes_hostname ON nodes(hostname);
CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen);

-- Groups for organizing nodes
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    parent_id UUID REFERENCES groups(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Node-Group membership
CREATE TABLE IF NOT EXISTS node_groups (
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, group_id)
);

-- ============================================
-- Hardware & Software Inventory
-- ============================================

-- Current hardware state
CREATE TABLE IF NOT EXISTS hardware_current (
    node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    cpu_name TEXT,
    cpu_cores INTEGER,
    cpu_threads INTEGER,
    ram_total_gb NUMERIC(10,2),
    disk_total_gb NUMERIC(10,2),
    disk_free_gb NUMERIC(10,2),
    gpu_name TEXT,
    bios_version TEXT,
    serial_number TEXT,
    manufacturer TEXT,
    model TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hardware change history
CREATE TABLE IF NOT EXISTS hardware_changes (
    id SERIAL,
    node_id UUID NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    PRIMARY KEY (id, changed_at)
);

-- Current software inventory
CREATE TABLE IF NOT EXISTS software_current (
    id SERIAL,
    node_id UUID NOT NULL,
    name TEXT NOT NULL,
    version TEXT,
    publisher TEXT,
    install_date TEXT,
    install_location TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (node_id, name)
);

-- Security state
CREATE TABLE IF NOT EXISTS security_current (
    node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    defender JSONB DEFAULT '{}',
    firewall JSONB DEFAULT '{}',
    tpm JSONB DEFAULT '{}',
    uac JSONB DEFAULT '{}',
    bitlocker JSONB DEFAULT '{}',
    local_admins JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Jobs & Deployments
-- ============================================

-- Jobs (remote commands/scripts)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    job_type TEXT DEFAULT 'script',
    schedule TEXT,
    created_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Job execution results
CREATE TABLE IF NOT EXISTS job_results (
    id SERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    success BOOLEAN NOT NULL,
    logs TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job assignments
CREATE TABLE IF NOT EXISTS job_assignments (
    id SERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    status TEXT CHECK (status IN ('pending', 'assigned', 'running', 'completed', 'failed')) DEFAULT 'pending',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Packages & Deployments
-- ============================================

-- Package definitions
CREATE TABLE IF NOT EXISTS packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    install_command TEXT,
    uninstall_command TEXT,
    detect_script TEXT,
    requires_reboot BOOLEAN DEFAULT false,
    requires_admin BOOLEAN DEFAULT true,
    silent_install BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Package versions
CREATE TABLE IF NOT EXISTS package_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID REFERENCES packages(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    release_notes TEXT,
    download_url TEXT,
    checksum TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deployments
CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    package_id UUID REFERENCES packages(id),
    package_version_id UUID REFERENCES package_versions(id),
    target_type TEXT CHECK (target_type IN ('all', 'group', 'node')),
    target_id UUID,
    status TEXT DEFAULT 'pending',
    rollout_strategy TEXT DEFAULT 'immediate',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Deployment results per node
CREATE TABLE IF NOT EXISTS deployment_results (
    id SERIAL PRIMARY KEY,
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    logs TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- ============================================
-- RBAC (Roles & Users)
-- ============================================

-- Roles
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default roles
INSERT INTO roles (name, description, permissions) VALUES
    ('admin', 'Full system access', '["*"]'),
    ('operator', 'Can manage nodes and deployments', '["nodes:read", "nodes:write", "deployments:*", "jobs:*"]'),
    ('viewer', 'Read-only access', '["*:read"]'),
    ('deployer', 'Can create and manage deployments', '["deployments:*", "packages:read", "nodes:read"]')
ON CONFLICT (name) DO NOTHING;

-- Users
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

-- User-Role mapping
CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permissions JSONB DEFAULT '["*"]',
    expires_at TIMESTAMPTZ,
    last_used TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id UUID,
    username TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details JSONB,
    ip_address TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Alerts & Event Log
-- ============================================

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    message TEXT,
    severity TEXT CHECK (severity IN ('info', 'warning', 'critical')) DEFAULT 'info',
    source TEXT,
    node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event log
CREATE TABLE IF NOT EXISTS eventlog (
    id SERIAL PRIMARY KEY,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    event_type TEXT,
    source TEXT,
    message TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Vulnerabilities & Remediation
-- ============================================

-- Discovered vulnerabilities
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

CREATE INDEX IF NOT EXISTS idx_vulnerabilities_severity ON vulnerabilities(severity);
CREATE INDEX IF NOT EXISTS idx_vulnerabilities_software ON vulnerabilities(software_name, software_version);

-- Vulnerability scans
CREATE TABLE IF NOT EXISTS vulnerability_scans (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    packages_scanned INTEGER DEFAULT 0,
    vulnerabilities_found INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running'
);

-- Suppressed vulnerabilities
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

-- Remediation packages
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

-- Remediation history
CREATE TABLE IF NOT EXISTS remediation_history (
    id SERIAL PRIMARY KEY,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    vulnerability_id INTEGER REFERENCES vulnerabilities(id),
    remediation_package_id INTEGER REFERENCES remediation_packages(id),
    status TEXT DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    logs TEXT
);

-- ============================================
-- System Settings & Misc
-- ============================================

-- System settings
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

-- Enrollment tokens
CREATE TABLE IF NOT EXISTS enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT UNIQUE NOT NULL,
    description TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INT NOT NULL DEFAULT 10,
    use_count INT NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked BOOLEAN DEFAULT FALSE
);

-- Maintenance windows
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

-- Performance metrics (for TimescaleDB hypertable)
CREATE TABLE IF NOT EXISTS performance_metrics (
    time TIMESTAMPTZ NOT NULL,
    node_id UUID NOT NULL,
    cpu_percent NUMERIC(5,2),
    ram_percent NUMERIC(5,2),
    disk_percent NUMERIC(5,2),
    network_in_bytes BIGINT,
    network_out_bytes BIGINT
);

-- Try to create hypertable (TimescaleDB)
DO $$ BEGIN
    PERFORM create_hypertable('performance_metrics', 'time', if_not_exists => TRUE);
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Could not create hypertable (TimescaleDB may not be available)';
END $$;

CREATE INDEX IF NOT EXISTS idx_perf_node_time ON performance_metrics(node_id, time DESC);

-- ============================================
-- Done!
-- ============================================
