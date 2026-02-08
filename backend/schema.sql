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