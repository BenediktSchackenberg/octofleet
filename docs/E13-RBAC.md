# E13: RBAC — Role-Based Access Control

## Übersicht

Multi-User System mit Rollen und Berechtigungen für das Inventory Dashboard.

## Rollen

| Rolle | Beschreibung |
|-------|--------------|
| **Admin** | Vollzugriff auf alles |
| **Operator** | Jobs ausführen, Packages deployen, Nodes verwalten |
| **Viewer** | Nur lesen, keine Änderungen |
| **Auditor** | Nur Compliance & Eventlog lesen |

## Berechtigungen (Permissions)

```
nodes:read          — Nodes anzeigen
nodes:write         — Nodes bearbeiten/löschen
nodes:assign        — Nodes zu Gruppen zuordnen

groups:read         — Gruppen anzeigen
groups:write        — Gruppen erstellen/bearbeiten/löschen

jobs:read           — Jobs anzeigen
jobs:create         — Jobs erstellen
jobs:execute        — Jobs ausführen
jobs:cancel         — Jobs abbrechen

packages:read       — Packages anzeigen
packages:write      — Packages erstellen/bearbeiten
packages:deploy     — Packages deployen

deployments:read    — Deployments anzeigen
deployments:write   — Deployments erstellen/abbrechen

alerts:read         — Alerts anzeigen
alerts:write        — Alert-Regeln verwalten

eventlog:read       — Eventlog anzeigen
compliance:read     — Compliance Dashboard anzeigen

settings:read       — Einstellungen anzeigen
settings:write      — Einstellungen ändern

users:read          — User anzeigen
users:write         — User verwalten
roles:write         — Rollen verwalten
```

## Rollen-Mapping

```python
ROLE_PERMISSIONS = {
    "admin": ["*"],  # Alles
    "operator": [
        "nodes:read", "nodes:write", "nodes:assign",
        "groups:read", "groups:write",
        "jobs:read", "jobs:create", "jobs:execute", "jobs:cancel",
        "packages:read", "packages:write", "packages:deploy",
        "deployments:read", "deployments:write",
        "alerts:read", "alerts:write",
        "eventlog:read", "compliance:read",
        "settings:read"
    ],
    "viewer": [
        "nodes:read", "groups:read", "jobs:read", "packages:read",
        "deployments:read", "alerts:read", "eventlog:read",
        "compliance:read", "settings:read"
    ],
    "auditor": [
        "eventlog:read", "compliance:read", "nodes:read"
    ]
}
```

## Database Schema

```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    is_superuser BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- Roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_system BOOLEAN DEFAULT false,  -- System-Rollen nicht löschbar
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User-Role Mapping (Many-to-Many)
CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, role_id)
);

-- API Keys (für Service Accounts)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    permissions TEXT[] DEFAULT '{}',  -- Optional: Key-spezifische Permissions
    expires_at TIMESTAMPTZ,
    last_used TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true
);

-- Sessions (für Web UI)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    user_agent TEXT,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Log
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    details JSONB,
    ip_address INET
);

-- Indexes
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
```

## API Endpoints

### Auth
```
POST /api/v1/auth/login          — Login (username/password → JWT)
POST /api/v1/auth/logout         — Logout (invalidate session)
POST /api/v1/auth/refresh        — Refresh JWT
GET  /api/v1/auth/me             — Current user info
PUT  /api/v1/auth/me             — Update own profile
PUT  /api/v1/auth/me/password    — Change own password
```

### Users (Admin only)
```
GET    /api/v1/users             — List users
POST   /api/v1/users             — Create user
GET    /api/v1/users/{id}        — Get user
PUT    /api/v1/users/{id}        — Update user
DELETE /api/v1/users/{id}        — Delete user
POST   /api/v1/users/{id}/roles  — Assign role
DELETE /api/v1/users/{id}/roles/{role_id} — Remove role
```

### Roles (Admin only)
```
GET    /api/v1/roles             — List roles
POST   /api/v1/roles             — Create role
GET    /api/v1/roles/{id}        — Get role
PUT    /api/v1/roles/{id}        — Update role
DELETE /api/v1/roles/{id}        — Delete role (not system roles)
```

### API Keys
```
GET    /api/v1/api-keys          — List own API keys
POST   /api/v1/api-keys          — Create API key
DELETE /api/v1/api-keys/{id}     — Revoke API key
```

## Implementation Plan

### Phase 1: Database & Models
- [ ] SQL Schema erstellen
- [ ] SQLAlchemy Models
- [ ] Default Rollen seeden (admin, operator, viewer, auditor)
- [ ] Default Admin User erstellen

### Phase 2: Auth Backend
- [ ] Password hashing (bcrypt)
- [ ] JWT Token Generation/Validation
- [ ] Login/Logout Endpoints
- [ ] Session Management
- [ ] API Key Authentication

### Phase 3: Authorization
- [ ] Permission Check Middleware
- [ ] `@require_permission("nodes:read")` Decorator
- [ ] Alle bestehenden Endpoints absichern

### Phase 4: Frontend
- [ ] Login Page
- [ ] User Management Page (Admin)
- [ ] Role Management Page (Admin)
- [ ] API Key Management (Settings)
- [ ] Permission-based UI (Buttons verstecken)

### Phase 5: Audit
- [ ] Audit Log bei allen Schreiboperationen
- [ ] Audit Log Viewer im Frontend

## Security Notes

- Passwords: bcrypt mit cost factor 12
- JWT: RS256, 15min Access Token, 7d Refresh Token
- API Keys: SHA256 Hash, nur bei Erstellung sichtbar
- Sessions: Automatic cleanup nach Expiry
- Rate Limiting: 5 failed logins → 15min lockout

## Migration

Bestehende API Key (`openclaw-inventory-dev-key`) wird zum ersten Admin User migriert.
