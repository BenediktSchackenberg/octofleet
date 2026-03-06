-- E33: Content Repository & Lifecycle Management
-- Phase 1 (MVP) Schema

-- Content Repositories (upstream sources)
CREATE TABLE IF NOT EXISTS content_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    repo_type TEXT NOT NULL CHECK (repo_type IN ('apt', 'yum', 'chocolatey', 'nuget', 'generic', 'winget')),
    upstream_url TEXT,
    sync_enabled BOOLEAN DEFAULT false,
    sync_interval_hours INTEGER DEFAULT 24,
    last_synced_at TIMESTAMPTZ,
    gpg_key TEXT,
    auth_config JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Content Items (packages/files within a repo)
CREATE TABLE IF NOT EXISTS content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES content_repositories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    architecture TEXT,
    description TEXT,
    file_size BIGINT,
    sha256_hash TEXT,
    storage_path TEXT,
    source_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(repository_id, name, version, architecture)
);

-- Content Snapshots (frozen point-in-time view)
CREATE TABLE IF NOT EXISTS content_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES content_repositories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    snapshot_type TEXT DEFAULT 'manual' CHECK (snapshot_type IN ('manual', 'auto', 'pre-promotion')),
    item_count INTEGER DEFAULT 0,
    total_size BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by TEXT,
    UNIQUE(repository_id, name)
);

-- Snapshot Items (links snapshot to specific content items)
CREATE TABLE IF NOT EXISTS content_snapshot_items (
    snapshot_id UUID NOT NULL REFERENCES content_snapshots(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, item_id)
);

-- Environments (Dev → Test → Prod pipeline)
CREATE TABLE IF NOT EXISTS content_environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color TEXT DEFAULT '#6b7280',
    active_snapshot_id UUID REFERENCES content_snapshots(id),
    promoted_at TIMESTAMPTZ,
    promoted_by TEXT,
    prior_snapshot_id UUID REFERENCES content_snapshots(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default environments
INSERT INTO content_environments (name, description, sort_order, color) VALUES
    ('Development', 'Latest packages, unstable', 0, '#f59e0b'),
    ('Testing', 'QA validation stage', 1, '#3b82f6'),
    ('Production', 'Stable, approved packages', 2, '#10b981')
ON CONFLICT (name) DO NOTHING;
-- E33 Phase 2: Approval Gates, Content Policies & Promotion Audit Log

CREATE TABLE IF NOT EXISTS content_promotion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES content_environments(id) ON DELETE CASCADE,
    snapshot_id UUID NOT NULL REFERENCES content_snapshots(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approvers JSONB DEFAULT '[]',
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    rejected_by TEXT,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_approval_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES content_environments(id) ON DELETE CASCADE,
    required_approvals INTEGER DEFAULT 1,
    allowed_approvers JSONB DEFAULT '[]',
    auto_approve_from TEXT,
    notify_on_request BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(environment_id)
);

CREATE TABLE IF NOT EXISTS content_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    policy_type TEXT NOT NULL CHECK (policy_type IN ('minimum_age', 'required_packages', 'blocked_packages', 'size_limit', 'vulnerability_check', 'custom')),
    config JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    enforcement TEXT DEFAULT 'enforce' CHECK (enforcement IN ('enforce', 'warn', 'audit')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_policy_assignments (
    policy_id UUID NOT NULL REFERENCES content_policies(id) ON DELETE CASCADE,
    environment_id UUID NOT NULL REFERENCES content_environments(id) ON DELETE CASCADE,
    PRIMARY KEY (policy_id, environment_id)
);

CREATE TABLE IF NOT EXISTS content_promotion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES content_environments(id),
    snapshot_id UUID NOT NULL REFERENCES content_snapshots(id),
    action TEXT NOT NULL CHECK (action IN ('promoted', 'rolled_back', 'request_created', 'request_approved', 'request_rejected', 'policy_violated', 'policy_warning')),
    actor TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default approval rules
INSERT INTO content_approval_rules (environment_id, required_approvals, auto_approve_from)
SELECT id, 2, NULL FROM content_environments WHERE name = 'Production'
ON CONFLICT (environment_id) DO NOTHING;

INSERT INTO content_approval_rules (environment_id, required_approvals, auto_approve_from)
SELECT id, 0, 'Development' FROM content_environments WHERE name = 'Testing'
ON CONFLICT (environment_id) DO NOTHING;

-- Seed default policies
INSERT INTO content_policies (name, description, policy_type, config, enforcement) VALUES
('Minimum Snapshot Age', 'Snapshots must be at least 24h old before promotion to Production', 'minimum_age', '{"hours": 24}', 'enforce'),
('Max Content Size', 'Content must not exceed 10GB per snapshot', 'size_limit', '{"max_bytes": 10737418240}', 'warn'),
('Block Known-Vulnerable', 'Block packages with known critical vulnerabilities', 'vulnerability_check', '{"max_severity": "critical", "block": true}', 'enforce')
ON CONFLICT (name) DO NOTHING;

-- Assign policies to Production
INSERT INTO content_policy_assignments (policy_id, environment_id)
SELECT cp.id, ce.id FROM content_policies cp CROSS JOIN content_environments ce WHERE ce.name = 'Production'
ON CONFLICT (policy_id, environment_id) DO NOTHING;
