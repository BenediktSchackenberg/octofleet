# API Reference

Octofleet exposes a comprehensive REST API (340+ endpoints) built with FastAPI. Interactive documentation is available at:

- **Swagger UI:** http://localhost:8080/docs
- **ReDoc:** http://localhost:8080/redoc
- **OpenAPI JSON:** http://localhost:8080/openapi.json

## Authentication

Most endpoints require authentication via one of two methods:

| Method | Header | Usage |
|--------|--------|-------|
| **API Key** | `X-API-Key: <key>` | Agent-to-backend communication, scripts |
| **JWT Bearer** | `Authorization: Bearer <token>` | Frontend/user sessions |

To obtain a JWT token, use the login endpoint. API keys are configured via environment variables or the API Keys management endpoints.

---

## Core Endpoints

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Basic health check |
| GET | `/api/v1/health` | No | API health check |
| GET | `/api/v1/dashboard/summary` | API Key | Fleet dashboard summary |

### Auth & Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/login` | No | Login, returns JWT tokens |
| GET | `/api/v1/auth/me` | JWT | Get current user info |
| POST | `/api/v1/auth/setup` | No | Initial admin setup (first run only) |
| GET | `/api/v1/users` | JWT | List all users |
| POST | `/api/v1/users` | JWT | Create user |
| PUT | `/api/v1/users/{user_id}` | JWT | Update user |
| DELETE | `/api/v1/users/{user_id}` | JWT | Delete user |
| POST | `/api/v1/users/{user_id}/roles/{role_name}` | API Key | Assign role to user |
| DELETE | `/api/v1/users/{user_id}/roles/{role_name}` | API Key | Remove role from user |
| GET | `/api/v1/roles` | API Key | List roles |
| POST | `/api/v1/roles` | API Key | Create role |
| DELETE | `/api/v1/roles/{role_id}` | API Key | Delete role |
| GET | `/api/v1/api-keys` | API Key | List API keys |
| POST | `/api/v1/api-keys` | API Key | Create API key |
| DELETE | `/api/v1/api-keys/{key_id}` | API Key | Soft-delete API key |
| DELETE | `/api/v1/api-keys/{key_id}/permanent` | API Key | Permanently delete API key |

### Nodes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/nodes` | API Key | List all nodes |
| GET | `/api/v1/nodes/tree` | API Key | Node tree view (hierarchical) |
| GET | `/api/v1/nodes/search` | API Key | Search nodes |
| GET | `/api/v1/nodes/os-distribution` | API Key | OS distribution summary |
| GET | `/api/v1/nodes/{node_id}` | API Key | Get node details |
| GET | `/api/v1/nodes/{node_id}/history` | API Key | Node inventory history |
| POST | `/api/v1/nodes/register` | No | Agent self-registration |
| POST | `/api/v1/enroll` | No | Enroll node with token |
| GET | `/api/v1/pending-nodes` | API Key | List pending registrations |
| POST | `/api/v1/pending-nodes/{pending_id}/approve` | API Key | Approve pending node |
| DELETE | `/api/v1/pending-nodes/{pending_id}/reject` | API Key | Reject pending node |

### Enrollment Tokens

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/enrollment-tokens` | API Key | Create enrollment token |
| GET | `/api/v1/enrollment-tokens` | API Key | List enrollment tokens |
| DELETE | `/api/v1/enrollment-tokens/{token_id}` | API Key | Delete enrollment token |

### Inventory

Agents push inventory data; the frontend reads it.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/inventory/hardware/{node_id}` | — | Hardware inventory for node |
| GET | `/api/v1/inventory/software/{node_id}` | — | Installed software |
| GET | `/api/v1/inventory/hotfixes/{node_id}` | — | Windows hotfixes |
| GET | `/api/v1/inventory/system/{node_id}` | — | System info (OS, hostname, etc.) |
| GET | `/api/v1/inventory/security/{node_id}` | — | Security status (firewall, AV) |
| GET | `/api/v1/inventory/network/{node_id}` | — | Network interfaces & connections |
| GET | `/api/v1/inventory/linux/{node_id}` | — | Linux-specific inventory |
| GET | `/api/v1/inventory/browser/{node_id}` | — | Browser extensions |
| GET | `/api/v1/inventory/browser/{node_id}/cookies` | — | Browser cookies |
| GET | `/api/v1/inventory/browser/{node_id}/critical` | — | Critical browser findings |
| GET | `/api/v1/hardware/fleet` | — | Fleet-wide hardware summary |
| POST | `/api/v1/inventory/hardware` | API Key | Push hardware inventory (agent) |
| POST | `/api/v1/inventory/software` | API Key | Push software inventory |
| POST | `/api/v1/inventory/hotfixes` | API Key | Push hotfixes |
| POST | `/api/v1/inventory/system` | API Key | Push system info |
| POST | `/api/v1/inventory/security` | API Key | Push security status |
| POST | `/api/v1/inventory/network` | API Key | Push network data |
| POST | `/api/v1/inventory/browser` | API Key | Push browser data |
| POST | `/api/v1/inventory/full` | API Key | Push full inventory (all categories) |

### Groups & Tags

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/groups` | API Key | List groups |
| GET | `/api/v1/groups/{group_id}` | API Key | Get group details |
| POST | `/api/v1/groups` | API Key | Create group |
| PUT | `/api/v1/groups/{group_id}` | API Key | Update group |
| DELETE | `/api/v1/groups/{group_id}` | API Key | Delete group |
| POST | `/api/v1/groups/preview-rule` | API Key | Preview dynamic group rule |
| POST | `/api/v1/groups/{group_id}/evaluate` | API Key | Evaluate group membership |
| POST | `/api/v1/groups/{group_id}/members` | API Key | Add members to group |
| DELETE | `/api/v1/groups/{group_id}/members` | API Key | Remove members from group |
| GET | `/api/v1/tags` | — | List tags |
| POST | `/api/v1/tags` | API Key | Create tag |
| DELETE | `/api/v1/tags/{tag_id}` | API Key | Delete tag |
| POST | `/api/v1/devices/{node_id}/tags` | API Key | Assign tags to node |
| DELETE | `/api/v1/devices/{node_id}/tags` | API Key | Remove tags from node |
| GET | `/api/v1/devices/{node_id}/groups` | — | Get node's groups |
| GET | `/api/v1/devices/{node_id}/tags` | — | Get node's tags |

### Jobs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/jobs` | API Key | Create a job |
| GET | `/api/v1/jobs` | API Key | List jobs |
| GET | `/api/v1/jobs/{job_id}` | API Key | Get job details |
| DELETE | `/api/v1/jobs/{job_id}` | API Key | Delete job |
| GET | `/api/v1/jobs/pending/{node_id}` | API Key | Get pending jobs for a node (agent poll) |
| POST | `/api/v1/jobs/instances/{instance_id}/start` | API Key | Mark job instance as started |
| POST | `/api/v1/jobs/instances/{instance_id}/result` | API Key | Submit job result |
| POST | `/api/v1/jobs/result` | API Key | Submit job result (alt) |
| POST | `/api/v1/jobs/instances/{instance_id}/retry` | API Key | Retry failed job instance |
| POST | `/api/v1/smart-install` | API Key | Smart install (auto-detect package manager) |
| GET | `/api/v1/smart-install/packages` | API Key | List available smart-install packages |

### Packages & Deployments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/packages` | API Key | List packages |
| POST | `/api/v1/packages` | API Key | Create package |
| GET | `/api/v1/packages/{package_id}` | API Key | Get package |
| PUT | `/api/v1/packages/{package_id}` | API Key | Update package |
| DELETE | `/api/v1/packages/{package_id}` | API Key | Delete package |
| POST | `/api/v1/packages/{package_id}/versions` | API Key | Add version |
| GET | `/api/v1/packages/{package_id}/versions/{version_id}` | API Key | Get version |
| PUT | `/api/v1/packages/{package_id}/versions/{version_id}` | API Key | Update version |
| DELETE | `/api/v1/packages/{package_id}/versions/{version_id}` | API Key | Delete version |
| POST | `/api/v1/deployments` | API Key | Create deployment |
| GET | `/api/v1/deployments` | API Key | List deployments |
| GET | `/api/v1/deployments/{deployment_id}` | API Key | Get deployment |
| PATCH | `/api/v1/deployments/{deployment_id}` | API Key | Update deployment |
| DELETE | `/api/v1/deployments/{deployment_id}` | API Key | Delete deployment |
| POST | `/api/v1/deployments/{deployment_id}/rollout` | API Key | Start rollout |
| GET | `/api/v1/deployments/{deployment_id}/rollout` | API Key | Get rollout status |
| POST | `/api/v1/deployments/{deployment_id}/rollout/advance` | API Key | Advance rollout stage |

### Vulnerabilities & Remediation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/vulnerabilities/summary` | API Key | Fleet vulnerability summary |
| GET | `/api/v1/vulnerabilities` | API Key | List all vulnerabilities |
| GET | `/api/v1/vulnerabilities/node/{node_id}` | API Key | Vulnerabilities for a node |
| POST | `/api/v1/vulnerabilities/scan` | API Key | Trigger vulnerability scan |
| GET | `/api/v1/vulnerabilities/scans` | API Key | List past scans |
| POST | `/api/v1/vulnerabilities/{cve_id}/suppress` | API Key | Suppress a CVE |
| GET | `/api/v1/remediation/packages` | API Key | Remediation packages |
| POST | `/api/v1/remediation/scan` | API Key | Scan for remediable vulns |
| POST | `/api/v1/remediation/fix/{vulnerability_id}` | API Key | Auto-fix vulnerability |
| GET | `/api/v1/remediation/jobs` | API Key | List remediation jobs |
| POST | `/api/v1/remediation/jobs/approve` | API Key | Approve remediation job |

### Security Center

See [SECURITY-CENTER.md](SECURITY-CENTER.md) for feature details.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/security/dashboard` | API Key | Security dashboard overview |
| GET | `/api/v1/security/rules` | API Key | List behavior rules |
| POST | `/api/v1/security/rules` | API Key | Create behavior rule |
| PUT | `/api/v1/security/rules/{rule_id}` | API Key | Update rule |
| DELETE | `/api/v1/security/rules/{rule_id}` | API Key | Delete rule |
| POST | `/api/v1/security/rules/evaluate` | API Key | Evaluate rules against events |
| GET | `/api/v1/security/findings` | API Key | List security findings |
| GET | `/api/v1/security/findings/summary` | API Key | Findings summary |
| POST | `/api/v1/security/findings` | API Key | Create finding manually |
| PUT | `/api/v1/security/findings/{finding_id}` | API Key | Update finding status |
| GET | `/api/v1/security/policies` | API Key | List security policies |
| POST | `/api/v1/security/policies` | API Key | Create policy |
| PUT | `/api/v1/security/policies/{policy_id}` | API Key | Update policy |
| DELETE | `/api/v1/security/policies/{policy_id}` | API Key | Delete policy |
| GET | `/api/v1/security/activity/files` | API Key | File activity log |
| GET | `/api/v1/security/activity/users` | API Key | User activity log |
| GET | `/api/v1/security/activity/export` | API Key | Export activity data |
| GET | `/api/v1/security/vulnerabilities/fleet` | — | Fleet vulnerability overview |

### Monitoring Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/monitoring/profiles` | API Key | List monitoring profiles |
| GET | `/api/v1/monitoring/profiles/{profile_id}` | API Key | Get profile details |
| POST | `/api/v1/monitoring/profiles` | API Key | Create profile |
| PUT | `/api/v1/monitoring/profiles/{profile_id}` | API Key | Update profile |
| DELETE | `/api/v1/monitoring/profiles/{profile_id}` | API Key | Delete profile |
| GET | `/api/v1/monitoring/assignments` | API Key | List profile assignments |
| POST | `/api/v1/monitoring/assignments` | API Key | Assign profile to nodes |
| PUT | `/api/v1/monitoring/assignments/{assignment_id}` | API Key | Update assignment |
| DELETE | `/api/v1/monitoring/assignments/{assignment_id}` | API Key | Remove assignment |
| GET | `/api/v1/monitoring/nodes/{node_id}/effective-policy` | API Key | Get effective policy for node |

### Posture Snapshots

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/posture/snapshots` | API Key | Create posture snapshot |
| GET | `/api/v1/posture/snapshots/{node_id}` | — | List snapshots for node |
| GET | `/api/v1/posture/snapshots/{node_id}/latest` | — | Get latest snapshot |
| GET | `/api/v1/posture/diffs/{node_id}` | — | Get posture diffs (changes over time) |
| GET | `/api/v1/posture/compare/{node_id}` | — | Compare two snapshots |

### Events & Findings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/ingest/events` | API Key | Ingest raw events from agent |
| POST | `/api/v1/ingest/events/normalized` | API Key | Ingest normalized events |
| GET | `/api/v1/events` | API Key | Query events |
| GET | `/api/v1/events/files` | API Key | File-specific events |
| GET | `/api/v1/findings` | API Key | List findings |
| GET | `/api/v1/findings/{finding_id}` | API Key | Get finding details |
| PUT | `/api/v1/findings/{finding_id}` | API Key | Update finding |

### Evidence & Retention

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/evidence/exports` | API Key | List evidence exports |
| POST | `/api/v1/evidence/export` | API Key | Create evidence export |
| GET | `/api/v1/retention` | API Key | Get retention policies |
| PUT | `/api/v1/retention/{category}` | API Key | Update retention for category |

### Audit Log

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/audit` | API Key | Backend audit log |
| GET | `/api/v1/audit/ui-events` | API Key | UI interaction audit log |

### Metrics & Performance

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/nodes/{node_id}/metrics` | API Key | Push node metrics (agent) |
| GET | `/api/v1/nodes/{node_id}/metrics` | API Key | Get node metrics |
| GET | `/api/v1/metrics/summary` | API Key | Fleet metrics summary |
| GET | `/api/v1/metrics/fleet` | API Key | Fleet-wide metrics |
| GET | `/api/v1/metrics/timeseries` | API Key | Time-series metric data |

### Alerts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/alerts` | API Key | List alerts |
| GET | `/api/v1/alerts/stats` | API Key | Alert statistics |
| GET | `/api/v1/alert-channels` | API Key | List alert channels (Discord, etc.) |
| POST | `/api/v1/alert-channels` | API Key | Create alert channel |
| DELETE | `/api/v1/alert-channels/{channel_id}` | API Key | Delete alert channel |
| POST | `/api/v1/alert-channels/{channel_id}/test` | API Key | Test alert channel |
| GET | `/api/v1/alert-rules` | API Key | List alert rules |
| POST | `/api/v1/alert-rules` | API Key | Create alert rule |
| DELETE | `/api/v1/alert-rules/{rule_id}` | API Key | Delete alert rule |
| GET | `/api/v1/alert-history` | API Key | Alert history |

### Remote Terminal

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/terminal/start/{node_id}` | API Key | Start terminal session |
| GET | `/api/v1/terminal/sessions` | API Key | List active sessions |
| DELETE | `/api/v1/terminal/session/{session_id}` | API Key | End session |
| POST | `/api/v1/terminal/session/{session_id}/input` | API Key | Send input to session |
| GET | `/api/v1/terminal/session/{session_id}/output` | API Key | Get session output |
| WS | `/api/v1/terminal/ws/{session_id}` | — | WebSocket terminal stream |

### Event Log (Windows)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/nodes/{node_id}/eventlog` | API Key | Push event log entries |
| GET | `/api/v1/nodes/{node_id}/eventlog` | API Key | Get event log entries |
| GET | `/api/v1/eventlog/summary` | API Key | Event log summary |
| GET | `/api/v1/eventlog/important-events` | API Key | Important events |
| GET | `/api/v1/eventlog/trends` | API Key | Event log trends |

### SQL Server Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/mssql/editions` | API Key | Available SQL Server editions |
| GET | `/api/v1/mssql/downloads` | API Key | Download links |
| POST | `/api/v1/mssql/configs` | API Key | Create install configuration |
| GET | `/api/v1/mssql/configs` | API Key | List configurations |
| POST | `/api/v1/mssql/install` | API Key | Trigger SQL Server installation |
| GET | `/api/v1/mssql/instances` | API Key | List discovered instances |
| GET | `/api/v1/mssql/cumulative-updates` | API Key | List cumulative updates |
| POST | `/api/v1/mssql/deploy-cu` | API Key | Deploy cumulative update |
| GET | `/api/v1/mssql/cu-compliance` | API Key | CU compliance report |

### Provisioning

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/provisioning/images` | API Key | List OS images |
| POST | `/api/v1/provisioning/images` | API Key | Add OS image |
| GET | `/api/v1/provisioning/tasks` | — | List provisioning tasks |
| POST | `/api/v1/provisioning/tasks` | — | Create provisioning task |
| DELETE | `/api/v1/provisioning/tasks/{task_id}` | — | Delete task |
| GET | `/api/v1/pxe/{mac}` | No | PXE boot script for MAC address |
| GET | `/api/v1/provisioning/iso/scan` | API Key | Scan for ISOs |
| POST | `/api/v1/provisioning/iso/mount` | API Key | Mount ISO |
| POST | `/api/v1/provisioning/vm/create` | API Key | Create VM |
| GET | `/api/v1/discovered-systems` | — | List discovered systems |
| POST | `/api/v1/discovered-systems/{system_id}/provision` | — | Provision discovered system |

### Exports & Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/export/nodes` | API Key | Export nodes (JSON) |
| GET | `/api/v1/export/nodes/excel` | API Key | Export nodes (Excel) |
| GET | `/api/v1/export/software/excel` | API Key | Export software (Excel) |
| GET | `/api/v1/export/vulnerabilities/excel` | API Key | Export vulnerabilities (Excel) |
| GET | `/api/v1/export/jobs/excel` | API Key | Export jobs (Excel) |
| GET | `/api/v1/reports/fleet/pdf` | API Key | Fleet summary PDF |
| GET | `/api/v1/reports/security/pdf` | API Key | Security report PDF |
| GET | `/api/v1/reports/inventory/pdf` | API Key | Inventory report PDF |

### Settings & Maintenance

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/settings` | API Key | List all settings |
| GET | `/api/v1/settings/{key}` | API Key | Get setting value |
| PUT | `/api/v1/settings/{key}` | API Key | Update setting |
| DELETE | `/api/v1/settings/{key}` | API Key | Delete setting |
| GET | `/api/v1/maintenance-windows` | API Key | List maintenance windows |
| POST | `/api/v1/maintenance-windows` | API Key | Create maintenance window |
| PUT | `/api/v1/maintenance-windows/{window_id}` | API Key | Update window |
| DELETE | `/api/v1/maintenance-windows/{window_id}` | API Key | Delete window |
| GET | `/api/v1/maintenance-windows/check/{node_id}` | API Key | Check if node is in maintenance |
| GET | `/api/v1/onboarding/config` | API Key | Get onboarding configuration |
| PUT | `/api/v1/onboarding/config` | API Key | Update onboarding configuration |

### Agent Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/agent/version` | — | Get latest agent version |
| POST | `/api/v1/agents/{node_id}/capabilities` | API Key | Report agent capabilities |
| GET | `/api/v1/agents/{node_id}/capabilities` | API Key | Get agent capabilities |
| GET | `/api/v1/agents/capabilities` | API Key | Fleet-wide capabilities |
| POST | `/api/v1/agents/{node_id}/health` | API Key | Report agent health |
| GET | `/api/v1/agents/{node_id}/health/history` | API Key | Agent health history |

### File Repository

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/repo/upload` | API Key | Upload file |
| GET | `/api/v1/repo/files` | API Key | List files |
| GET | `/api/v1/repo/download/{file_id}` | API Key | Download file |
| DELETE | `/api/v1/repo/files/{file_id}` | API Key | Delete file |
| GET | `/api/v1/repo/stats` | API Key | Repository statistics |

---

## Error Responses

All endpoints return standard HTTP status codes:

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (missing/invalid auth) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 422 | Unprocessable entity (Pydantic validation) |
| 500 | Internal server error |

Error responses include a JSON body:

```json
{
  "detail": "Description of the error"
}
```

## Rate Limiting

There is currently no built-in rate limiting. For production deployments, consider placing a reverse proxy (nginx, Caddy) in front of the backend.
