# E13: RBAC — Role-Based Access Control

**Status:** ✅ COMPLETE
**Date:** 2026-02-12

## Summary

Full multi-user authentication and authorization system implemented.

## Features

### Authentication
- [x] JWT-based login (`/api/v1/auth/login`)
- [x] Session management with localStorage
- [x] Login page (`/login`)
- [x] Automatic redirect if not authenticated
- [x] One-time admin setup (`/api/v1/auth/setup`)

### User Management
- [x] Create/Read/Update/Delete users (`/api/v1/users`)
- [x] Role assignment
- [x] User list page (`/users`)

### Roles
- [x] 4 system roles: admin, operator, viewer, auditor
- [x] Permission-based access control
- [x] Custom roles (CRUD)
- [x] Role permissions displayed in UI

### API Keys
- [x] Create API keys with optional expiration
- [x] Key only shown once on creation
- [x] Revoke/delete keys
- [x] Management page (`/api-keys`)

### Audit Log
- [x] Log all actions with user, timestamp, resource
- [x] Filter by action and resource type
- [x] Pagination
- [x] Audit page (`/audit`)

### Frontend Integration
- [x] All 17 pages migrated to JWT auth
- [x] Navbar hides items based on permissions
- [x] User menu with logout
- [x] Settings page with quick links

## Database Tables

- `users` — User accounts
- `roles` — System and custom roles  
- `user_roles` — User-role mapping
- `api_keys` — API access tokens
- `sessions` — Web sessions (prepared)
- `audit_log` — Activity log

## Default Credentials

```
Username: admin
Password: Octofleet2026!
```

## Permissions

| Permission | Description |
|------------|-------------|
| `nodes:read` | View nodes |
| `nodes:write` | Edit/delete nodes |
| `groups:read/write` | Manage groups |
| `jobs:read/create/execute` | Job management |
| `packages:read/write/deploy` | Package deployment |
| `alerts:read/write` | Alert rules |
| `eventlog:read` | View event logs |
| `compliance:read` | Security dashboard |
| `users:read/write` | User management |
| `audit:read` | View audit log |
| `*` | Full access (admin) |

## Role Mappings

- **admin:** `*` (full access)
- **operator:** nodes, groups, jobs, packages, alerts, eventlog, compliance
- **viewer:** read-only access
- **auditor:** eventlog, compliance, nodes (read)

## API Endpoints

### Auth
- `POST /api/v1/auth/login` — Login
- `POST /api/v1/auth/setup` — Initial admin setup
- `GET /api/v1/auth/me` — Current user

### Users
- `GET /api/v1/users` — List users
- `POST /api/v1/users` — Create user
- `PUT /api/v1/users/{id}` — Update user
- `DELETE /api/v1/users/{id}` — Delete user
- `POST /api/v1/users/{id}/roles/{role}` — Assign role
- `DELETE /api/v1/users/{id}/roles/{role}` — Remove role

### Roles
- `GET /api/v1/roles` — List roles
- `POST /api/v1/roles` — Create custom role
- `DELETE /api/v1/roles/{id}` — Delete role

### API Keys
- `GET /api/v1/api-keys` — List keys
- `POST /api/v1/api-keys` — Create key
- `DELETE /api/v1/api-keys/{id}` — Revoke key

### Audit
- `GET /api/v1/audit` — Query audit log

## Commits

- `91eb863` — feat(E13): RBAC - Role Based Access Control
- `587ec39` — fix: TypeScript type annotation
- `55d7167` — feat(E13): Complete RBAC implementation
- `bd32d5a` — fix: Migrate all pages from API key to JWT auth
