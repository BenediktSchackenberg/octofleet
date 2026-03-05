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
