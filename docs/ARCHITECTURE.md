# Architecture Overview

This document describes the high-level architecture of Octofleet, how its components interact, and the key data flows.

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│                    Next.js + React + Tailwind                   │
│                        Port 3000                                │
│                                                                 │
│  Dashboard │ Nodes │ Jobs │ Packages │ Security Center │ ...    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API + WebSocket
┌──────────────────────────▼──────────────────────────────────────┐
│                         Backend                                  │
│                  FastAPI (Python 3.12)                           │
│                        Port 8080                                │
│                                                                 │
│  Routers: auth, nodes, inventory, jobs, security, provisioning,          │
│           query_engine, content_lifecycle, software_metering, dashboard   │
│  Services: alerting, vulnerability scanning, remediation, patch mgmt     │
│  Real-time: WebSocket (terminal, screen sharing, SSE)           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ SQL (asyncpg)
┌──────────────────────────▼──────────────────────────────────────┐
│                        Database                                  │
│              PostgreSQL 16 + TimescaleDB                        │
│                        Port 5432                                │
│                                                                 │
│  Hypertables: metrics, events (time-series optimized)           │
│  Regular tables: nodes, jobs, packages, findings, users, etc.   │
└─────────────────────────────────────────────────────────────────┘

    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
    │   Windows    │    │   Windows    │    │    Linux     │
    │    Agent     │    │    Agent     │    │    Agent     │
    │   (.NET 8)  │    │   (.NET 8)  │    │    (Bash)   │
    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
           │                   │                   │
           └───────────────────┴───────────────────┘
                    HTTPS → Backend API
```

### Frontend (Next.js)

- **Technology:** Next.js 14, React, Tailwind CSS, shadcn/ui
- **Role:** User-facing dashboard, all management UIs
- **Communication:** Calls the backend REST API; uses WebSocket for real-time features (terminal, screen sharing)
- **Key pages:** Dashboard, Node Details, Jobs, Packages, Security Center, Patch Management, Config Baselines, Content Lifecycle, Query Engine, Software Metering, Provisioning, Reports

### Backend (FastAPI)

- **Technology:** Python 3.12, FastAPI, asyncpg (async PostgreSQL driver)
- **Role:** Central API server, business logic, event processing, report generation
- **Key modules:**
  - `routers/` — Route handlers organized by domain (auth, nodes, jobs, security, etc.)
  - `auth.py` — Authentication (JWT + API Key), RBAC
  - `alerting.py` — Alert engine with Discord integration
  - `main.py` — App setup, middleware, and many inline route handlers (~450 endpoints)
- **Real-time:** WebSocket for terminal sessions and screen sharing; SSE for live updates

### Database (PostgreSQL + TimescaleDB)

- **Technology:** PostgreSQL 16 with TimescaleDB extension
- **Schema:** Defined in `backend/schema-full.sql`, seeded by `backend/ci-seed.sql`
- **TimescaleDB hypertables** are used for time-series data (metrics, events) enabling efficient time-range queries and automatic data retention
- **Connection:** Async via `asyncpg` connection pool

### Windows Agent (.NET 8)

- **Technology:** .NET 8, runs as a Windows service
- **Location:** `src/OctofleetAgent.Service/`
- **Features:**
  - Hardware/software/security inventory collection
  - Job polling and execution (PowerShell)
  - Performance metrics (CPU, RAM, disk, network)
  - File audit (NTFS change journal / ReadDirectoryChanges)
  - Screen sharing helper (separate process in user session)
  - Self-update from GitHub Releases
- **Communication:** HTTP REST to backend API, authenticated via API key

### Linux Agent (Bash)

- **Technology:** Bash script, runs as a systemd service
- **Location:** `linux-agent/`
- **Features:**
  - Hardware/software inventory (via standard Linux tools)
  - Performance metrics (load, CPU, memory, disk I/O)
  - Job polling and execution (Bash)
  - SMART disk health monitoring
- **Communication:** HTTP REST to backend API, authenticated via API key

---

## Key Data Flows

### Agent Registration Flow

```
  Agent                          Backend                      Database
    │                               │                            │
    │  POST /api/v1/nodes/register  │                            │
    │  (hostname, OS, hardware)     │                            │
    │──────────────────────────────►│                            │
    │                               │  INSERT pending_nodes      │
    │                               │───────────────────────────►│
    │                               │                            │
    │  202 Accepted (pending)       │                            │
    │◄──────────────────────────────│                            │
    │                               │                            │
    │         (Admin approves in UI)│                            │
    │                               │  INSERT nodes              │
    │                               │───────────────────────────►│
    │                               │                            │
    │  GET /api/v1/pending-nodes/{id}/config                     │
    │──────────────────────────────►│                            │
    │                               │                            │
    │  200 (api_key, config)        │                            │
    │◄──────────────────────────────│                            │
```

Alternatively, agents can use **enrollment tokens** to auto-register without manual approval:

```
  Agent                          Backend
    │                               │
    │  POST /api/v1/enroll          │
    │  (token, hostname, OS)        │
    │──────────────────────────────►│
    │                               │
    │  200 (node_id, api_key)       │
    │◄──────────────────────────────│
```

### Inventory Push Cycle

Agents push inventory on a regular interval (default: 30 minutes):

```
  Agent                          Backend                      Database
    │                               │                            │
    │  POST /api/v1/inventory/full  │                            │
    │  { hardware, software,        │                            │
    │    system, network, security }│                            │
    │──────────────────────────────►│                            │
    │                               │  UPSERT inventory tables   │
    │                               │───────────────────────────►│
    │                               │                            │
    │  200 OK                       │                            │
    │◄──────────────────────────────│                            │
```

### Job Execution Flow

```
  Admin (UI)              Backend                Agent              Database
    │                        │                     │                   │
    │  POST /api/v1/jobs     │                     │                   │
    │  (script, targets)     │                     │                   │
    │───────────────────────►│                     │                   │
    │                        │  INSERT job +       │                   │
    │                        │  job_instances       │                   │
    │                        │────────────────────────────────────────►│
    │                        │                     │                   │
    │                        │    (Agent polls)    │                   │
    │                        │  GET /jobs/pending  │                   │
    │                        │◄────────────────────│                   │
    │                        │                     │                   │
    │                        │  200 (job details)  │                   │
    │                        │────────────────────►│                   │
    │                        │                     │  Execute script   │
    │                        │                     │  ──────────►      │
    │                        │                     │                   │
    │                        │  POST /jobs/result  │                   │
    │                        │◄────────────────────│                   │
    │                        │  UPDATE job_instance│                   │
    │                        │────────────────────────────────────────►│
```

### Security Event Pipeline

```
  Agent                     Backend                          Database
    │                          │                                │
    │  POST /ingest/events     │                                │
    │  (file changes, process  │                                │
    │   events, login events)  │                                │
    │─────────────────────────►│                                │
    │                          │  Store events                  │
    │                          │───────────────────────────────►│
    │                          │                                │
    │                          │  Evaluate behavior rules       │
    │                          │  ──────────────►               │
    │                          │                                │
    │                          │  (If rule matches)             │
    │                          │  INSERT finding                │
    │                          │───────────────────────────────►│
    │                          │                                │
    │                          │  Trigger alerts                │
    │                          │  (Discord, etc.)               │
    │                          │  ──────────────►               │
```

---

## Network Architecture

```
                    ┌─────────────────┐
                    │   Reverse Proxy  │  (Optional: nginx/Caddy)
                    │   :443 (HTTPS)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼──────┐  ┌───▼────────┐
     │  Frontend  │  │   Backend   │  │   PXE/     │
     │   :3000    │  │   :8080     │  │  Tentacle  │
     └────────────┘  └──────┬──────┘  └────────────┘
                            │
                     ┌──────▼──────┐
                     │  PostgreSQL │
                     │   :5432     │
                     │  (localhost │
                     │    only)    │
                     └─────────────┘
```

- The database port is bound to `127.0.0.1` only (not exposed externally)
- For production, use a reverse proxy with TLS termination
- Agents connect to the backend on port 8080 (or through the reverse proxy)
- The frontend communicates with the backend either directly or via Docker internal networking (`http://backend:8080`)

---

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14, React, Tailwind, shadcn/ui | User interface |
| Backend | FastAPI, Python 3.12, asyncpg | API server, business logic |
| Database | PostgreSQL 16 + TimescaleDB | Data storage, time-series |
| Windows Agent | .NET 8, C# | Endpoint management (Windows) |
| Linux Agent | Bash | Endpoint management (Linux) |
| Containerization | Docker, Docker Compose | Deployment |
| PDF Reports | ReportLab | Report generation |
| Vulnerability Data | NVD/CVE (NIST) | CVE scanning |

---

## New Systems in v0.6.0

### Patch Management (E30)

Provides end-to-end Windows patch orchestration:

```
Agent (PatchScanner.cs)  →  Scan Results  →  Patch Catalog
                                                    ↓
                                              Rings (Canary/Pilot/Broad)
                                                    ↓
                                              Deployments → Compliance
```

- Patch catalog auto-populated by agent scans
- Ring-based deployment strategy
- Full deployment lifecycle (create/pause/resume/cancel)
- Per-node and fleet-wide compliance tracking

### Configuration Baselines (E31)

CIS benchmark-based configuration compliance:

- **Templates** — Pre-built CIS benchmarks (Win Server 2022/2025, Win 11)
- **Baseline Rules** — Registry keys, service states, security policies
- **Evaluation Engine** — Evaluates nodes against baselines, generates drift events
- **Auto-Remediation** — Automatically fix drifted settings via agent jobs
- **Compliance Dashboard** — Trend charts showing compliance over time

### Content Lifecycle (E33)

Repository and content management with environment pipelines. See [CONTENT-LIFECYCLE.md](CONTENT-LIFECYCLE.md).

### Query Engine (E34)

Safe DSL-to-SQL query builder with whitelist-based security:

```
User Query (JSON DSL) → Parser → Whitelist Check → Parameterized SQL → PostgreSQL
```

- 22 queryable tables, all columns whitelisted
- Pre-defined join relationships
- 18 built-in query templates
- Live agent queries for real-time data

See [QUERY-ENGINE.md](QUERY-ENGINE.md).

### Software Metering (E38)

License compliance and usage tracking. See [SOFTWARE-METERING.md](SOFTWARE-METERING.md).

---

## Directory Structure

```
octofleet/
├── backend/                  # FastAPI backend
│   ├── main.py              # Main application (routes + startup)
│   ├── auth.py              # Authentication & RBAC
│   ├── alerting.py          # Alert engine
│   ├── routers/             # Route modules
│   │   ├── auth.py          # Auth endpoints
│   │   ├── nodes.py         # Node management
│   │   ├── inventory.py     # Inventory endpoints
│   │   ├── jobs.py          # Job management
│   │   ├── security.py      # Security/compliance
│   │   ├── deployments.py   # Software deployment
│   │   ├── provisioning.py  # PXE provisioning
│   │   ├── dashboard.py     # Dashboard summary
│   │   ├── groups.py        # Groups & tags
│   │   ├── query_engine.py  # Real-time query engine
│   │   ├── content_lifecycle.py # Content repos & environments
│   │   ├── software_metering.py # License tracking
│   │   └── ...
│   ├── schema-full.sql      # Database schema
│   ├── Dockerfile           # Backend container
│   └── requirements.txt     # Python dependencies
├── frontend/                 # Next.js frontend
│   ├── src/app/             # App router pages
│   ├── src/components/      # React components
│   └── Dockerfile           # Frontend container
├── src/                      # Windows agent (.NET 8)
│   ├── OctofleetAgent.Service/
│   └── OctofleetScreenHelper/
├── linux-agent/              # Linux agent (Bash)
│   ├── agent.sh
│   └── install.sh
├── provisioning/             # PXE/Tentacle setup
├── docs/                     # Documentation
├── tests/                    # API + E2E tests
└── docker-compose.yml        # Main compose file
```

## Backend Modularization (v0.6.0)

The monolithic `main.py` has been progressively refactored. Extracted modules:

| Module | Path | Responsibility |
|--------|------|----------------|
| Dashboard | `backend/routers/dashboard.py` | Dashboard summary API |
| Groups | `backend/routers/groups.py` | Group CRUD, dynamic groups, tag management |
| Query Engine | `backend/routers/query_engine.py` | DSL-to-SQL query builder, schema introspection, templates, live queries |
| Content Lifecycle | `backend/routers/content_lifecycle.py` | Content repos, items, snapshots, environments, promotion |
| Software Metering | `backend/routers/software_metering.py` | Software catalog, licenses, normalization, compliance, usage |
| Rules Engine | `backend/app/core/rules.py` | Dynamic group rule evaluation |
| Node DB Helpers | `backend/app/db/nodes.py` | Node upsert, auto-onboard, dynamic groupships |
| Dependencies | `backend/dependencies.py` | Shared deps: `get_db`, `verify_api_key`, error helpers |
| Config | `backend/app/core/config.py` | Centralized settings from environment |

Inline in `main.py` (still the largest file):
- Patch management (catalog, rings, deployments, compliance, agent scan results)
- Configuration baselines (templates, evaluations, drift, remediation)
- Hardware fleet aggregation
- All original core endpoints (nodes, inventory, jobs, security, etc.)

Existing routers (`nodes`, `inventory`, `jobs`, `mssql`) were also extended with code moved from `main.py`.

## Agent Activity Monitor

Real-time monitoring of agent polling and job execution:

- **HTTP Middleware** captures all agent requests (polls, health reports, results)
- **In-memory ring buffer** (500 events) for instant access
- **SSE endpoint** (`/api/v1/admin/agent-live`) streams activity + node status
- **REST endpoints** for current status and historical activity
- **Frontend** at `/admin/agents` with node filtering and live feed

## Command Palette (Ctrl+K)

Global search overlay for quick navigation:
- Search nodes by hostname with live status indicators
- Navigate to any page via keyboard
- Accessible from anywhere with `Ctrl+K` / `⌘+K`
