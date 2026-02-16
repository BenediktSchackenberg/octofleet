# Architecture Overview

This document describes the architecture of Octofleet Inventory Platform.

## High-Level Architecture

```
                                    ┌─────────────────────┐
                                    │   Web Dashboard     │
                                    │   (Next.js 16)      │
                                    │   Port 3000         │
                                    └──────────┬──────────┘
                                               │ HTTP/REST
                                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Backend API (FastAPI)                          │
│                           Port 8080                                   │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Inventory  │  │    Jobs     │  │  Packages   │  │ Deployments │  │
│  │   Service   │  │   Service   │  │   Service   │  │   Service   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Groups    │  │  Alerting   │  │    RBAC     │  │  Rollouts   │  │
│  │   Service   │  │   Service   │  │   Service   │  │   Service   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                               │
                      ┌────────────────────────┼────────────────────────┐
                      │                        │                        │
                      ▼                        ▼                        ▼
           ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
           │   PostgreSQL     │    │ Octofleet Gateway │    │    Webhooks      │
           │   + TimescaleDB  │    │   Port 18789     │    │ (Discord/Slack)  │
           │   Port 5432      │    │                  │    │                  │
           └──────────────────┘    └────────┬─────────┘    └──────────────────┘
                                            │ WebSocket
                      ┌─────────────────────┼─────────────────────┐
                      │                     │                     │
                      ▼                     ▼                     ▼
              ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
              │   Windows    │      │   Windows    │      │    Linux     │
              │    Agent     │      │    Agent     │      │    Agent     │
              │   (.NET 8)   │      │   (.NET 8)   │      │   (Bash)     │
              └──────────────┘      └──────────────┘      └──────────────┘
```

## Components

### Frontend (Next.js 16)

The web dashboard is built with Next.js and provides:

- **Dashboard**: Fleet overview with key metrics
- **Nodes**: Device list with search, filtering, detail views
- **Groups**: Static and dynamic device groups
- **Jobs**: Remote command execution
- **Packages**: Software catalog management
- **Deployments**: Package rollouts with progress tracking
- **Alerts**: Alert management and notification channels
- **Settings**: User management, API keys, maintenance windows

**Tech Stack**:
- Next.js 16 with App Router
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Recharts for visualizations

### Backend API (FastAPI)

Python FastAPI application providing REST API:

**Services**:
- `inventory` - Store and query device inventory
- `jobs` - Queue and track remote commands
- `packages` - Software catalog CRUD
- `deployments` - Package rollout orchestration
- `groups` - Device grouping with dynamic rules
- `alerting` - Alert rules, notifications, webhooks
- `auth` - JWT authentication, RBAC
- `rollouts` - Deployment strategies (canary, staged, percentage)

**Key Files**:
- `main.py` - All API routes
- `alerting.py` - Alert engine
- `models.py` - Pydantic schemas
- `schema.sql` - Database schema

### Database (PostgreSQL + TimescaleDB)

PostgreSQL 16 with TimescaleDB extension for time-series data.

**Tables**:
| Table | Purpose |
|-------|---------|
| `nodes` | Device registry |
| `hardware` | Hardware inventory |
| `software` | Installed software |
| `security` | Security posture |
| `network` | Network configuration |
| `browser_data` | Browser extensions/cookies |
| `hotfixes` | Windows updates |
| `performance_metrics` | CPU/RAM/Disk (hypertable) |
| `groups` | Device groups |
| `group_rules` | Dynamic group rules |
| `packages` | Software catalog |
| `deployments` | Package rollouts |
| `deployment_statuses` | Per-node deployment status |
| `jobs` | Remote commands |
| `alerts` | Alert instances |
| `alert_rules` | Alert definitions |
| `notification_channels` | Webhook configs |
| `users` | User accounts |
| `api_keys` | API key registry |
| `audit_log` | Action audit trail |

### Octofleet Gateway

The communication hub that manages agent connections:

- WebSocket connections from agents
- Message routing between backend and agents
- Node pairing and authentication
- Command dispatching

### Windows Agent (.NET 8)

Windows Service that runs on managed devices:

**Components**:
- `NodeWorker` - Gateway connection management
- `InventoryScheduler` - Periodic inventory collection
- `JobPoller` - Command execution polling
- `DeploymentPoller` - Package deployment handling
- `AutoUpdater` - Self-update from GitHub releases

**Collectors**:
- `HardwareCollector` - WMI queries for hardware
- `SoftwareCollector` - Registry enumeration
- `SecurityCollector` - Firewall, BitLocker, UAC
- `NetworkCollector` - Adapters, connections
- `BrowserCollector` - Chrome/Edge/Firefox data
- `HotfixCollector` - Windows updates

### Linux Agent (Bash)

Lightweight Bash script for Linux servers:

- Uses `/proc`, `/sys`, `lsb_release` for inventory
- Runs as systemd service
- Polls API for jobs/deployments
- Supports: Ubuntu, Debian, RHEL, Fedora, CentOS, Arch, Alpine

## Data Flow

### Inventory Collection

```
Agent                    Gateway                Backend              Database
  │                         │                      │                    │
  │──inventory.push────────►│                      │                    │
  │                         │──POST /inventory────►│                    │
  │                         │                      │──INSERT/UPDATE────►│
  │                         │                      │◄───────OK──────────│
  │                         │◄──────200 OK─────────│                    │
  │◄──────────OK────────────│                      │                    │
```

### Job Execution

```
UI                      Backend                Gateway                Agent
│                          │                      │                      │
│──POST /jobs─────────────►│                      │                      │
│                          │──INSERT job──────────│                      │
│◄────201 Created──────────│                      │                      │
│                          │                      │                      │
│                          │                      │◄──poll jobs──────────│
│                          │◄─GET pending jobs────│                      │
│                          │──return job──────────►│                      │
│                          │                      │──execute job────────►│
│                          │                      │                      │
│                          │                      │◄──result─────────────│
│                          │◄─POST /jobs/result───│                      │
│                          │──UPDATE job status───│                      │
```

### Deployment Flow

```
1. Admin creates deployment (UI → Backend)
2. Backend calculates target nodes based on group/strategy
3. Agent polls for pending deployments
4. Agent downloads package from URL
5. Agent verifies hash
6. Agent runs install command
7. Agent reports status back to backend
8. Backend updates deployment progress
9. For staged rollouts: Backend schedules next batch
```

## Security

### Authentication

- **Users**: JWT tokens with role claims
- **Agents**: API keys with node binding
- **Gateway**: Signed challenges (Ed25519)

### Authorization (RBAC)

| Role | Permissions |
|------|-------------|
| Admin | Full access |
| Operator | Manage devices, deployments, jobs |
| Viewer | Read-only access |
| Auditor | View audit logs only |

### Data Protection

- Passwords hashed with bcrypt
- JWT secrets configurable
- API keys hashed in database
- All passwords in .env file

## Scalability

Current design targets small-to-medium fleets (100-1000 nodes).

**Bottlenecks**:
- Single PostgreSQL instance
- Single backend process
- Gateway connection limits

**Future Improvements**:
- Read replicas for database
- Backend horizontal scaling
- Gateway clustering
- Message queue for async operations

## Monitoring

### Built-in

- `/health` endpoint for liveness
- Performance metrics in TimescaleDB
- Audit log for all mutations
- Alert system for anomalies

### External Integration

- Prometheus metrics (planned)
- OpenTelemetry tracing (planned)
- Webhook alerts to external systems
