-- CI Seed Data: Create admin user with password 'admin'
-- bcrypt hash of 'admin' with cost 12
INSERT INTO users (username, email, password_hash, display_name, is_superuser, is_active)
VALUES ('admin', 'admin@test.local', '$2b$12$rYyY2JO.Uh/NBVp7kXBlY.p9Iv.S0GeIZbgttoYjjyS.hQQQJkkJK', 'Test Admin', true, true)
ON CONFLICT DO NOTHING;

-- The standard roles are created by the backend at startup.
