# Octofleet API Reference

The Octofleet backend provides a comprehensive REST API for endpoint management.

## 🔗 Interactive Documentation

When the backend is running, access the full interactive API documentation:

- **Swagger UI**: http://localhost:8080/docs
- **ReDoc**: http://localhost:8080/redoc
- **OpenAPI JSON**: http://localhost:8080/openapi.json

## 🔐 Authentication

All API endpoints require authentication via one of:

### API Key (Header)
```bash
curl -H "X-API-Key: your-api-key" http://localhost:8080/api/v1/nodes
```

### JWT Bearer Token
```bash
curl -H "Authorization: Bearer your-jwt-token" http://localhost:8080/api/v1/nodes
```

## 📊 Core Endpoints

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/dashboard/summary` | Node counts, vulnerability stats, job status |
| GET | `/api/v1/health` | Health check |

### Nodes (15 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/nodes` | List all nodes with pagination |
| GET | `/api/v1/nodes/tree` | Hierarchical node tree |
| GET | `/api/v1/nodes/search` | Search nodes by hostname, OS, etc. |
| GET | `/api/v1/nodes/{node_id}` | Get node details |
| GET | `/api/v1/nodes/{node_id}/history` | Node state history |
| GET | `/api/v1/nodes/{node_id}/service-assignments` | Services assigned to node |

### Inventory (17 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/inventory/full` | Submit full inventory (agent) |
| POST | `/api/v1/inventory/hardware` | Submit hardware info |
| POST | `/api/v1/inventory/software` | Submit installed software |
| POST | `/api/v1/inventory/hotfixes` | Submit Windows updates |
| POST | `/api/v1/inventory/security` | Submit security status |
| POST | `/api/v1/inventory/network` | Submit network info |
| POST | `/api/v1/inventory/browser` | Submit browser data |
| GET | `/api/v1/inventory/hardware/{node_id}` | Get hardware for node |
| GET | `/api/v1/inventory/software/{node_id}` | Get software for node |

### Jobs (10 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/jobs` | List all jobs |
| POST | `/api/v1/jobs` | Create new job |
| GET | `/api/v1/jobs/{job_id}` | Get job details |
| GET | `/api/v1/jobs/pending/{node_id}` | Get pending jobs for node |
| POST | `/api/v1/jobs/instances/{id}/result` | Submit job result (agent) |

### Packages (12 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/packages` | List all packages |
| POST | `/api/v1/packages` | Create package |
| GET | `/api/v1/packages/{id}` | Get package details |
| PUT | `/api/v1/packages/{id}` | Update package |
| DELETE | `/api/v1/packages/{id}` | Delete package |

### Vulnerabilities (6 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/vulnerabilities` | List vulnerabilities |
| GET | `/api/v1/vulnerabilities/{node_id}` | Vulnerabilities for node |
| POST | `/api/v1/vulnerabilities/{cve_id}/suppress` | Suppress a CVE |
| POST | `/api/v1/vulnerabilities/scan` | Trigger vulnerability scan |

### Remediation (23 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/remediation/rules` | List remediation rules |
| POST | `/api/v1/remediation/rules` | Create rule |
| GET | `/api/v1/remediation/jobs` | List remediation jobs |
| GET | `/api/v1/remediation/jobs/pending/{node_id}` | Pending remediation for node |
| POST | `/api/v1/remediation/jobs/{id}/result` | Submit remediation result |

### Services (10 endpoints)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/service-classes` | List service templates |
| POST | `/api/v1/service-classes` | Create service class |
| GET | `/api/v1/services` | List services |
| POST | `/api/v1/services` | Create service |
| POST | `/api/v1/services/{id}/nodes` | Assign nodes to service |
| POST | `/api/v1/services/{id}/reconcile` | Trigger reconciliation |

## 📝 Example: Create a Job

```bash
curl -X POST http://localhost:8080/api/v1/jobs \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Get System Info",
    "command_type": "powershell",
    "command": "Get-ComputerInfo | Select-Object CsName, WindowsVersion",
    "target_type": "node",
    "target_ids": ["node-uuid-here"]
  }'
```

## 🔄 WebSocket Endpoints

For real-time updates:

- `/api/v1/live/{node_id}` - Live node data stream (SSE)
- `/ws/screen/{node_id}` - Screen sharing (WebSocket)
- `/ws/terminal/{node_id}` - Remote terminal (WebSocket)

## ⚙️ Configuration

Environment variables for the API:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `INVENTORY_API_KEY` | `octofleet-inventory-dev-key` | Default API key |
| `OCTOFLEET_GATEWAY_URL` | `http://192.168.0.5:18789` | Gateway URL for enrollment |
| `OCTOFLEET_GATEWAY_TOKEN` | `` | Gateway token for enrollment |
| `OCTOFLEET_INVENTORY_URL` | `http://192.168.0.5:8080` | Inventory API URL |

---

For the complete API specification, visit the [Swagger UI](http://localhost:8080/docs) when the backend is running.
