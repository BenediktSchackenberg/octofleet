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

1. Queries the Windows Update Agent API for available updates (every 6 hours, or on a `patch_scan` job), with the client's configured source – on WSUS clients only the updates approved in WSUS. The search has a 20-minute limit.
2. Reports missing patches to the backend via `POST /api/v1/patches/scan-results`, together with the search's status: `scan: {status, result_code, error, source, server, duration_seconds}` – `status` is `succeeded`, `partial` (result code 3, searched with errors) or `failed` (e.g. WSUS not reachable: `0x8024401C`), `source` is `wsus` (with the WSUS URL as `server`) or `windows_update`.
3. Receives pending patches via `GET /api/v1/patches/pending/{node_id}`
4. Reports installation results via `POST /api/v1/patches/results`

What the server does with a scan report:

| Status | Available updates (Patch Explorer) | Catalog entries of the node |
|---|---|---|
| `succeeded` | replaced by the report | entries still waiting (`detected`, `approved`) that are no longer offered are removed – installed outside Octofleet (WSUS, Windows Update, Defender), superseded or declined; entries of Octofleet's own deployments stay |
| `partial` | replaced | unchanged |
| `failed` | **kept** – the last successful search stays visible | unchanged |
| no `scan` block (older agents, catalog import) | replaced | unchanged |

The last search per node (time, status, source, error, number of updates) is shown at the top of the node's Updates tab and returned by `GET /api/v1/patches/scan-status/{node_id}`.

### Linux Nodes

The Linux agent reports the available package updates with every inventory push (apt, dnf, yum, pacman), from the package lists already on the machine. The node's Updates tab has two buttons (with the `jobs:create` permission):

- **Search for updates** – a `patch_scan` job. The agent refreshes the package lists (`apt-get update`, `dnf makecache` or `yum makecache`) and sends the inventory with the update list and the search's result. The result appears as the node's last update search, like on Windows:
  - `succeeded`;
  - `partial`: single repositories failed, shown as `Err:` / `W: Failed to fetch` lines;
  - `failed`, with the error. The job fails as well.

  pacman is not supported: refreshing without upgrading leaves a partially updated system.
- **Install updates** / **Install selected (n)** – a `patch_install` job, after a confirmation. Without a selection the agent installs all available updates; with packages ticked in the list, only those (the package manager may also upgrade packages they depend on):
  - apt: `apt-get --with-new-pkgs upgrade`, non-interactive, keeping changed configuration files;
  - dnf / yum: `upgrade`.

  The selection is sent as `{"packages": ["openssl", ...]}` in the job's payload (also through the API); the agent then upgrades only those packages: `apt-get install --only-upgrade` or `dnf upgrade <packages>`. The job's output ends with the package manager's last lines and `Reboot required: yes/no`. Afterwards the agent sends the inventory, so the list is current.

Time limits: the payload's `timeout`, else the job's `timeoutSeconds`, else 10 minutes for the search and 60 minutes for the installation. The buttons use 15 and 60 minutes. Under systemd the package manager runs in a transient unit (`systemd-run --wait --pipe`), because the agent service itself runs with `ProtectSystem=strict` and cannot write `/usr`, `/etc` or `/var/lib`. It runs with `NEEDRESTART_MODE=l`, so needrestart only lists services that use old libraries and does not restart them. The apt commands run with `-o DPkg::Lock::Timeout=120`, so they wait up to 2 minutes when another apt process (e.g. unattended-upgrades) holds the lock.

The node is never rebooted automatically. The inventory reports `rebootRequired`:
- Debian/Ubuntu: `/var/run/reboot-required`, with the packages from `reboot-required.pkgs`;
- dnf/yum: `needs-restarting -r`.

The Updates tab then shows **Reboot required**.

---

## API Reference

### Permissions

| What | Permission |
|---|---|
| Read the catalog, rings, deployments and the Patch Explorer | `packages:read` |
| Compliance views | `compliance:read` |
| Create, import, approve or exclude patches; manage rings | `packages:write` |
| Start, pause, resume or cancel deployments; Patch Explorer deploy, scan and verify | `packages:deploy` |
| Agent routes (`scan-results`, `pending/{node_id}`, `results`, `explorer/agent-updates`) | agent key |

The built-in `viewer` role can read; `operator` and `admin` can also change and deploy. The shared agent key cannot use the user routes.

### Catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/catalog` | List patches (with search, pagination; `node`: only patches still open on that node) |
| POST | `/api/v1/patches/catalog` | Create patch manually |
| POST | `/api/v1/patches/catalog/import` | Import patches from agent scan |
| GET | `/api/v1/patches/catalog/{patch_id}` | Get patch details with affected nodes |
| PATCH | `/api/v1/patches/catalog/{patch_id}/approve` | Approve patch for deployment |
| PATCH | `/api/v1/patches/catalog/{patch_id}/exclude` | Exclude patch from deployment |

### Compliance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/compliance` | Fleet-wide patch compliance summary (`node_id`: only that node) |
| GET | `/api/v1/patches/compliance/nodes` | Per-node compliance breakdown |
| GET | `/api/v1/patches/scan-status/{node_id}` | The node's last Windows Update search: time, status, source (WSUS/Windows Update), error, update count |

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
