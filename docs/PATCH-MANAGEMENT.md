# 🩹 Patch Management

> Introduced in **v0.6.0** (Epic E30)

Octofleet's Patch & Update Orchestration system provides end-to-end Windows patch management — from discovery through deployment to compliance reporting.

## Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Agent      │────►│  Patch       │────►│  Deployment  │────►│  Compliance  │
│ PatchScanner │     │  Catalog     │     │  Wizard      │     │  Tracking    │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

- **Patch Catalog** — Central registry of all known patches (KB articles), auto-populated by agent scans
- **Patch Rings** — Canary → Pilot → Broad rollout strategy
- **Deployment Wizard** — Create, schedule, pause, resume, and cancel patch deployments
- **Compliance Tracking** — Per-node and fleet-wide patch compliance dashboards
- **Agent Scanner** — `PatchScanner.cs` on the Windows agent scans for missing updates via the Windows Update API

---

## Concepts

### Patch Catalog

The catalog is populated in two ways:

1. **Agent scan results** — Agents run `PatchScanner.cs` to detect available Windows updates and POST results to `/api/v1/patches/scan-results`. The backend upserts patches into the catalog automatically.
2. **Manual creation** — Admins can add patches manually via the API or UI.

Each patch entry contains:
- KB ID, title, description
- Severity (Critical, Important, Moderate, Low)
- Category, OS targets
- Release date, supersedence info
- Approval/exclusion status

### Patch Rings

Rings control the rollout pace:

| Ring | Purpose | Typical Size |
|------|---------|-------------|
| **Canary** | Early testing | 1–5 nodes |
| **Pilot** | Wider validation | 5–20 nodes |
| **Broad** | Full fleet deployment | All remaining nodes |

Rings are configured with a name, description, and optional node/group targeting. You can create custom rings beyond the defaults.

### Deployments

A patch deployment targets one or more patches to a set of rings/nodes. Deployments support:

- **Pause / Resume / Cancel** — Full lifecycle control
- **Ring-based progression** — Deploy to Canary first, observe, then advance
- **Status tracking** — Per-node installation status

### Agent-Side Scanner

The Windows agent includes `PatchScanner.cs`, which:

1. Queries the Windows Update Agent API for available updates
2. Reports missing patches to the backend via `POST /api/v1/patches/scan-results`
3. Receives pending patches via `GET /api/v1/patches/pending/{node_id}`
4. Reports installation results via `POST /api/v1/patches/results`

---

## API Reference

### Catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/catalog` | List patches (with search, pagination) |
| POST | `/api/v1/patches/catalog` | Create patch manually |
| POST | `/api/v1/patches/catalog/import` | Import patches from agent scan |
| GET | `/api/v1/patches/catalog/{patch_id}` | Get patch details with affected nodes |
| PATCH | `/api/v1/patches/catalog/{patch_id}/approve` | Approve patch for deployment |
| PATCH | `/api/v1/patches/catalog/{patch_id}/exclude` | Exclude patch from deployment |

### Compliance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/compliance` | Fleet-wide patch compliance summary |
| GET | `/api/v1/patches/compliance/nodes` | Per-node compliance breakdown |

### Rings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/rings` | List patch rings |
| POST | `/api/v1/patches/rings` | Create ring |
| PUT | `/api/v1/patches/rings/{ring_id}` | Update ring |
| DELETE | `/api/v1/patches/rings/{ring_id}` | Delete ring |

### Deployments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/deployments` | List deployments |
| POST | `/api/v1/patches/deployments` | Create deployment |
| GET | `/api/v1/patches/deployments/{id}` | Get deployment details |
| POST | `/api/v1/patches/deployments/{id}/pause` | Pause deployment |
| POST | `/api/v1/patches/deployments/{id}/resume` | Resume deployment |
| POST | `/api/v1/patches/deployments/{id}/cancel` | Cancel deployment |

### Agent Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/patches/scan-results` | Agent submits scan results |
| GET | `/api/v1/patches/pending/{node_id}` | Get pending patches for node |
| POST | `/api/v1/patches/results` | Agent submits installation results |

---

## Workflow Example

```bash
# 1. Agent scans and reports available patches automatically

# 2. Review the catalog
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/patches/catalog

# 3. Approve a patch
curl -X PATCH -H "X-API-Key: $KEY" \
  http://localhost:8080/api/v1/patches/catalog/{patch_id}/approve

# 4. Create a deployment
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name": "March Patches", "patch_ids": ["..."], "ring_id": "..."}' \
  http://localhost:8080/api/v1/patches/deployments

# 5. Monitor compliance
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/patches/compliance
```
