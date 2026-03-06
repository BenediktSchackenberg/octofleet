-- E34 Phase 2: Saved Queries, History, Schedules, Dashboards
-- Run against: octofleet-inventory-db / inventory

CREATE TABLE IF NOT EXISTS saved_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    query_dsl JSONB NOT NULL,
    category TEXT DEFAULT 'Custom',
    tags TEXT[] DEFAULT '{}',
    is_public BOOLEAN DEFAULT false,
    created_by TEXT NOT NULL DEFAULT 'admin',
    last_run_at TIMESTAMPTZ,
    run_count INTEGER DEFAULT 0,
    avg_runtime_ms FLOAT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_dsl JSONB NOT NULL,
    sql_generated TEXT,
    row_count INTEGER,
    runtime_ms FLOAT,
    status TEXT DEFAULT 'success' CHECK (status IN ('success', 'error', 'timeout', 'cancelled')),
    error_message TEXT,
    run_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    saved_query_id UUID NOT NULL REFERENCES saved_queries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    output_format TEXT DEFAULT 'json' CHECK (output_format IN ('json', 'csv', 'email')),
    output_config JSONB DEFAULT '{}',
    last_run_at TIMESTAMPTZ,
    last_status TEXT,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_query_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_query_id UUID NOT NULL REFERENCES scheduled_queries(id) ON DELETE CASCADE,
    row_count INTEGER,
    runtime_ms FLOAT,
    status TEXT DEFAULT 'success',
    result_summary JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    layout JSONB DEFAULT '[]',
    is_default BOOLEAN DEFAULT false,
    created_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES query_dashboards(id) ON DELETE CASCADE,
    saved_query_id UUID NOT NULL REFERENCES saved_queries(id) ON DELETE CASCADE,
    title TEXT,
    visualization TEXT DEFAULT 'table' CHECK (visualization IN ('table', 'bar', 'line', 'pie', 'number', 'list')),
    position JSONB DEFAULT '{"x": 0, "y": 0, "w": 6, "h": 4}',
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed saved queries
INSERT INTO saved_queries (name, description, query_dsl, category, tags, is_public) VALUES
('Online Windows Nodes', 'All Windows nodes currently online', '{"from": "nodes", "select": ["hostname", "os_name", "agent_version", "last_seen"], "where": [{"field": "is_online", "op": "=", "value": true}, {"field": "os_name", "op": "LIKE", "value": "%Windows%"}]}', 'Fleet', '{fleet,windows}', true),
('Critical Vulnerabilities', 'All critical severity CVEs across fleet', '{"from": "vulnerabilities", "select": ["cve_id", "title", "severity", "published_at"], "where": [{"field": "severity", "op": "=", "value": "CRITICAL"}], "order_by": [{"field": "published_at", "direction": "DESC"}], "limit": 100}', 'Security', '{security,vulnerabilities}', true),
('Software Inventory Summary', 'Top installed software across fleet', '{"from": "software_current", "select": ["name", "version", "publisher"], "order_by": [{"field": "name", "direction": "ASC"}], "limit": 500}', 'Software', '{software,inventory}', true),
('Disk Space Warning', 'Nodes with potential disk issues', '{"from": "hardware_current", "select": ["node_id", "disks", "updated_at"], "limit": 100}', 'Hardware', '{hardware,disks}', true),
('Recent Security Events', 'Security events from last 24h', '{"from": "events_normalized", "select": ["event_type", "severity", "source", "message", "created_at"], "order_by": [{"field": "created_at", "direction": "DESC"}], "limit": 200}', 'Security', '{security,events}', true)
ON CONFLICT DO NOTHING;
