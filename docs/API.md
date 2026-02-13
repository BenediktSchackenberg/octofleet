# API Documentation

OpenClaw Inventory Platform exposes a RESTful API for all operations.

## Base URL

```
http://your-server:8080/api/v1
```

## Authentication

All endpoints require authentication via one of:

1. **JWT Token** (for UI/users):
   ```
   Authorization: Bearer <jwt-token>
   ```

2. **API Key** (for agents/automation):
   ```
   X-API-Key: <api-key>
   ```

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "username": "admin",
    "role": "admin"
  }
}
```

---

## Nodes (Devices)

### List Nodes

```http
GET /api/v1/nodes
```

Response:
```json
{
  "nodes": [
    {
      "node_id": "abc123",
      "hostname": "DESKTOP-PC1",
      "os_name": "Windows 11 Pro",
      "os_version": "10.0.22631",
      "last_seen": "2024-02-13T12:00:00Z",
      "agent_version": "0.4.5",
      "tags": ["production", "office"]
    }
  ]
}
```

### Get Node Details

```http
GET /api/v1/nodes/{node_id}
```

### Get Node Hardware

```http
GET /api/v1/hardware/{node_id}
```

### Get Node Software

```http
GET /api/v1/software/{node_id}
```

### Get Node Security

```http
GET /api/v1/security/{node_id}
```

---

## Groups

### List Groups

```http
GET /api/v1/groups
```

### Create Group

```http
POST /api/v1/groups
Content-Type: application/json

{
  "name": "Production Servers",
  "description": "All production servers",
  "is_dynamic": true,
  "rules": {
    "operator": "and",
    "conditions": [
      {"field": "hostname", "op": "contains", "value": "PROD"}
    ]
  }
}
```

### Get Group Members

```http
GET /api/v1/groups/{group_id}/members
```

---

## Packages

### List Packages

```http
GET /api/v1/packages
```

### Create Package

```http
POST /api/v1/packages
Content-Type: application/json

{
  "name": "7-Zip",
  "version": "23.01",
  "description": "File archiver",
  "download_url": "https://www.7-zip.org/a/7z2301-x64.msi",
  "install_command": "msiexec /i {file} /qn",
  "uninstall_command": "msiexec /x {ProductCode} /qn",
  "detection_script": "Get-ItemProperty HKLM:\\Software\\7-Zip",
  "sha256_hash": "abc123..."
}
```

---

## Deployments

### List Deployments

```http
GET /api/v1/deployments
```

### Create Deployment

```http
POST /api/v1/deployments
Content-Type: application/json

{
  "package_id": "uuid",
  "target_type": "group",
  "target_id": "group-uuid",
  "mode": "required",
  "strategy": "staged",
  "strategy_config": {
    "batch_size": 5,
    "delay_minutes": 30
  },
  "scheduled_start": "2024-02-14T22:00:00Z",
  "scheduled_end": "2024-02-15T06:00:00Z"
}
```

### Get Deployment Status

```http
GET /api/v1/deployments/{deployment_id}
```

Response includes per-node status:
```json
{
  "id": "uuid",
  "status": "in_progress",
  "progress": {
    "total": 50,
    "pending": 20,
    "downloading": 5,
    "installing": 3,
    "success": 20,
    "failed": 2
  },
  "node_statuses": [...]
}
```

---

## Jobs (Remote Commands)

### List Jobs

```http
GET /api/v1/jobs
```

### Create Job

```http
POST /api/v1/jobs
Content-Type: application/json

{
  "node_id": "abc123",
  "command": "Get-Process | Select-Object -First 10",
  "timeout_seconds": 60
}
```

### Get Job Result

```http
GET /api/v1/jobs/{job_id}
```

---

## Alerts

### List Alerts

```http
GET /api/v1/alerts
```

### Acknowledge Alert

```http
POST /api/v1/alerts/{alert_id}/acknowledge
```

### Resolve Alert

```http
POST /api/v1/alerts/{alert_id}/resolve
```

---

## Performance Metrics

### Get Node Metrics

```http
GET /api/v1/performance/{node_id}?days=7
```

Response:
```json
{
  "metrics": [
    {
      "timestamp": "2024-02-13T12:00:00Z",
      "cpu_percent": 45.2,
      "ram_percent": 67.8,
      "disk_percent": 55.0
    }
  ]
}
```

### Get Fleet Performance

```http
GET /api/v1/performance/fleet
```

---

## Agent Endpoints

These endpoints are called by agents, not the UI:

### Push Inventory

```http
POST /api/v1/inventory
X-API-Key: <api-key>
Content-Type: application/json

{
  "node_id": "abc123",
  "hardware": {...},
  "software": [...],
  "security": {...},
  "network": {...}
}
```

### Poll for Jobs

```http
GET /api/v1/jobs/pending/{node_id}
X-API-Key: <api-key>
```

### Report Job Result

```http
POST /api/v1/jobs/{job_id}/result
X-API-Key: <api-key>
Content-Type: application/json

{
  "exit_code": 0,
  "stdout": "...",
  "stderr": ""
}
```

### Poll for Deployments

```http
GET /api/v1/deployments/pending/{node_id}
X-API-Key: <api-key>
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "not_found",
  "message": "Node not found",
  "details": {}
}
```

Common error codes:
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

---

## Rate Limits

- UI endpoints: 100 requests/minute per user
- Agent endpoints: 1000 requests/minute per API key

---

## Webhooks (Outgoing)

Alerts can trigger webhooks to external services:

### Discord

```json
{
  "content": "🚨 Alert: Node DESKTOP-PC1 is offline"
}
```

### Slack

```json
{
  "text": "🚨 Alert: Node DESKTOP-PC1 is offline"
}
```

### Microsoft Teams

```json
{
  "@type": "MessageCard",
  "summary": "Alert",
  "sections": [...]
}
```
