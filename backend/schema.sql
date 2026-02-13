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
