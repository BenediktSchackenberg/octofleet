-- CI Seed Data: Create admin user with password 'Octofleet2026!'
-- bcrypt hash of 'Octofleet2026!' with cost 12
INSERT INTO users (username, email, password_hash, display_name, is_superuser, is_active)
VALUES ('admin', 'admin@test.local', '$2b$12$z3k2w9GL/4qeC21Lkrs0Y.gHLx53prrBbYqzYmX3RYT4gyz8j87cS', 'Test Admin', true, true)
ON CONFLICT DO NOTHING;

-- Create admin role if not exists
INSERT INTO roles (name, description)
VALUES ('admin', 'Full system administrator')
ON CONFLICT DO NOTHING;

-- Create other standard roles
INSERT INTO roles (name, description) VALUES 
  ('viewer', 'Read-only access'),
  ('operator', 'Can run jobs and view inventory'),
  ('deployer', 'Can manage packages and deployments')
ON CONFLICT DO NOTHING;
