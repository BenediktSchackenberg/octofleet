# Changelog

## [0.4.52] - 2026-02-19

### Added - SQL Server Epic (#49)

#### CU Catalog + Approval Workflow (#50)
- New database tables: `mssql_cu_catalog`, `mssql_cu_history`
- API endpoints for CU management:
  - `GET/POST /api/v1/mssql/cumulative-updates` - List/create CUs
  - `GET/PUT /api/v1/mssql/cumulative-updates/{id}` - Get/update CU
  - `POST /api/v1/mssql/cumulative-updates/{id}/approve` - Approve CU for deployment ring
  - `POST /api/v1/mssql/cumulative-updates/{id}/block` - Block problematic CU
  - `GET /api/v1/mssql/cumulative-updates/latest/{version}` - Get latest approved CU
  - `GET /api/v1/mssql/cu-compliance` - Fleet compliance overview

#### CU Detection + Silent Patch Orchestrator (#51)
- `POST /api/v1/mssql/report-sql-build` - Agent reports current SQL build
- `POST /api/v1/mssql/create-patch-job` - Create patch job for single instance
- `POST /api/v1/mssql/patch-outdated` - Bulk patch all outdated instances
- `generate_cu_patch_script()` - PowerShell for silent CU installation with:
  - Pre-flight checks (disk space, services)
  - Hash verification
  - Service management
  - Reboot policy support (never/ifRequired/always)

#### Installation Idempotency (#53)
- `POST /api/v1/mssql/detect/{node_id}` - Detect existing SQL installations
- `POST /api/v1/mssql/instances/{id}/verify` - Verify config matches expected profile
- `POST /api/v1/mssql/instances/{id}/repair` - Repair drifted configuration
- Helper functions:
  - `generate_sql_detection_script()` - Registry + live query detection
  - `generate_sql_verify_script()` - Configuration drift detection
  - `generate_sql_reconfigure_script()` - Memory/port reconfiguration
  - `generate_sql_rebuild_script()` - System database rebuild

#### Service Accounts + Firewall (#54)
- New config fields: `sql_service_account`, `agent_service_account`, `create_firewall_rule`
- `generate_firewall_script()` - Windows Firewall rule creation
- `generate_service_account_config()` - ConfigurationFile.ini entries for domain accounts
- Firewall rules auto-created during installation (includes SQL Browser for named instances)

#### SQL Dashboard UI (#52)
- New `CuManagement.tsx` component with:
  - CU Catalog view (list, filter, approve/block)
  - Compliance view (summary cards, outdated instances)
  - Add CU modal
  - Bulk patch action
- Integrated as "Updates" tab in SQL Server page

## [0.4.51] - 2026-02-19

### Fixed
- **API Key Consistency (#56)**: Centralized API key validation across all endpoints
  - Removed duplicate `API_KEY` definitions from `main.py` (now imported from `dependencies.py`)
  - Fixed `auth.py` to use centralized `API_KEY` instead of hardcoded value
  - Fixed Screen WebSocket endpoint (was using wrong `API_KEY` env var)
  - Fixed Remediation Live SSE endpoint (was using `octofleet-dev-key` default)
  - All endpoints now consistently use `INVENTORY_API_KEY` environment variable
  - Default key: `octofleet-inventory-dev-key`

### Added
- **API Key Consistency Tests**: New test class `TestAPIKeyConsistency` in `tests/api/test_endpoints.py`
  - Verifies old inconsistent key is rejected
  - Verifies correct key is accepted on all protected endpoints
  - Parametrized tests for all major API endpoints

### Improved
- **Documentation**: Added Environment Variables section to README.md
  - Documents `INVENTORY_API_KEY` as the correct variable
  - Warning about using correct env var name

## [0.4.43] - 2026-02-17

### Fixed
- **Installer**: Removed OpenClaw Gateway WebSocket from default config
- **Installer**: Find first release with ZIP asset (not just latest)
- **Installer**: TLS 1.2 forced for GitHub downloads
- **Installer**: Better error handling for large file downloads

### Added
- **E20: Software Baselines & Auto-Onboarding**
  - New nodes automatically added to onboarding group
  - Software baselines (package collections) assignable to groups
  - Baseline reconcile deploys missing packages via Chocolatey
  - API endpoints: `/api/v1/baselines/*`, `/api/v1/onboarding/config`

### Changed
- Agent config now uses `ApiUrl` instead of `GatewayUrl` for Octofleet HTTP API
- OpenClaw Gateway integration is now optional (commented out in config)

## [0.4.40] - 2026-02-17

### Fixed
- **Service Assignments API**: Now accepts hostname (case-insensitive) in addition to node UUID
- **API Key Alignment**: Default API key changed to `octofleet-inventory-dev-key` to match agent default
- **Enrollment Tokens**: Fixed column mapping for `name`, `current_uses`, `revoked_at`, `is_active`

### Improved
- Agents no longer get "Failed to get service assignments: InternalServerError"
- Inventory push requests no longer return 401 Unauthorized

## [0.4.39] - 2026-02-17

### Fixed
- **Persistent WebSocket connection** with keep-alive heartbeats (#48)
  - Sends ping every 30 seconds to keep connection alive
  - Detects dead connections after 90 seconds of silence
  - Reduced max reconnect delay from 5 minutes to 60 seconds
  - Auto-reconnect when connection goes stale

## [0.4.38] - 2026-02-16

### Added
- **E18: Service Orchestration** 🎯
  - Service Classes (templates for desired state)
  - Services with node assignments
  - Agent-side reconciliation poller
  - Reconciliation audit log


## [0.4.32] - 2026-02-16

### Added
- **Beautiful Console UI Dashboard** 🐙
  - Live dashboard with connection status (Gateway, Inventory API)
  - Statistics panel (bytes sent/received, requests, errors)
  - Activity log with color-coded entries
  - Keyboard shortcuts: [P]ush inventory, [L]ive data, [R]efresh, [C]lear log, [Q]uit
  - Shows current user account and active operation
  - Last action timestamps (inventory, live data, job poll)
- **Uninstall-LegacyAgent.ps1** script for clean migration from OpenClaw to Octofleet

### Changed
- All docs and scripts now use `OCTOFLEET_*` environment variables
- Installer points to new `octofleet` repo name
- Console output now feeds unified dashboard in interactive mode

## [0.4.27] - 2026-02-16

### Added
- **E17 Screen Mirroring**: Linux desktop capture (scrot/gnome-screenshot/grim)
- **E17 Screen Mirroring**: Screen tab in Live View with quality controls
- **Homepage 2.0**: System Health widget (API, Database, Agents status)
- **Service Orchestration**: Config template variable rendering
- **Service Orchestration**: Reconcile button in UI

### Changed
- Wiki expanded to 10 pages with full documentation
- Agent screen capture polling in service loop

### Fixed
- Missing software/vulnerability_matches database tables
- Service reconciliation database constraints

## [0.4.26] — 2026-02-14

### Fixed
- **Screen sharing auth**: Agent now sends API key when polling and connecting WebSocket
- Backend validates API key on agent WebSocket connection

## [0.4.25] — 2026-02-14

### Fixed
- **Chocolatey auto-install in remediation**: If `choco.exe` not found, auto-install Chocolatey before running remediation
- Fallback to refreshed PATH if Chocolatey install fails
- This fixes all "choco not recognized" remediation failures


## [0.4.24] — 2026-02-14

### Added
- **E17: Screen Mirroring** (MVP)
  - Real-time desktop streaming from Windows agents to browser
  - GDI+ based screen capture (DXGI planned for Phase 2)
  - WebSocket relay through Gateway
  - Quality presets: Low (720p), Medium (1080p), High (1440p)
  - Configurable FPS (5-30)
  - Multi-monitor support
- **Backend**: Screen session management API (`/api/v1/screen/*`)
- **Agent**: `ScreenStreamService` background service
- **Frontend**: Screen viewer page (`/nodes/{id}/screen`)
- **UI**: "🖥️ Screen" button on node detail page

### Technical
- JPEG compression for bandwidth efficiency (30-75% quality)
- Session state management (pending → active → closed)
- Auto-cleanup of stale sessions

## [0.4.23] — 2026-02-14

### Added
- **Agent Service Logs**: LiveDataPoller now collects and streams logs from the Octofleet Agent Windows Event Log
- **Agent Logs Tab**: New "🤖 Agent" tab in Live View showing agent service logs
- Logs include timestamp, level (Info/Warning/Error), source, and message

## [0.4.22] — 2026-02-14

### Added
- **Auto-fallback to Chocolatey**: When winget fails with "No installed package found", automatically tries Chocolatey
- **Auto-install Chocolatey**: If Chocolatey not present, installs it automatically before fallback

### Fixed
- Chrome/other software not installed via winget can now be remediated via Chocolatey fallback

## [0.4.21] — 2026-02-14

### Fixed
- **Network SSE events** now properly streamed (timer bug fixed)
- **LiveDataPoller** includes network interface stats (was missing in v0.4.19)

### Changed
- Removed duplicate `/metrics/history` endpoint

- AutoUpdater now accepts ZIP assets without `win-x64` in filename
- This allows updates from releases with simplified asset naming

## [0.4.19] - 2026-02-14

## [0.4.19] - 2026-02-14

### Added
- **E16 Live View**: Real-time monitoring dashboard
  - SSE streaming endpoint for live data
  - Tab-based UI: Overview | Logs | Processes
  - Live event logs with filter/search
  - Top 20 processes by CPU usage
  - Sparkline charts for CPU/Memory history
- **LiveDataPoller**: Agent sends metrics every 5 seconds
- **ProcessCollector**: Captures process CPU%, memory, user, threads

### Changed
- Live View button (🔴) added to node detail page


All notable changes to the Octofleet Windows Agent.

## [Unreleased]

---

## [0.4.18] — 2026-02-14

### Added
- **SMART/Health Monitoring** — Physical disk health data collection
  - Health status (Healthy/Warning/Unhealthy) via MSFT_PhysicalDisk
  - Bus type detection (NVMe, SATA, SAS, USB, etc.)
  - SSD vs HDD identification
  - Temperature monitoring (where available)
  - Power-on hours tracking
  - SSD wear level percentage

### Changed
- Hardware inventory now includes detailed physical disk health data

---

## [0.4.17] — 2026-02-14

### Added
- **Remote Restart Command** — `restart-agent` job type for remote agent restarts
  - Uses detached PowerShell script to ensure job completion before restart

---

## [0.4.16] — 2026-02-14

### Changed
- **Faster Auto-Updates** — Check interval reduced from 1 hour to 15 minutes
- Initial update check now 30 seconds after service start (was 2 minutes)

---

## [0.4.15] — 2026-02-14

### Fixed
- **Version Reporting** — Agent now reports actual version from assembly
  - Previously hardcoded as "0.3.12" regardless of installed version
  - Now correctly shows installed version in Inventory Platform

---

## [0.4.14] — 2026-02-13

### Added
- **Auto-Remediation** — Automatic vulnerability fixes
  - Winget → Chocolatey fallback for package updates
  - Auto-install Chocolatey if needed
  - RemediationPoller for scheduled scans

---

## [0.4.0 - 0.4.13] — 2026-02-09 to 2026-02-13

### Added
- **Vulnerability Tracking** — NVD API integration, CVSS scoring
- **Eventlog Collection** — Windows Event Log forwarding
- **Zero-Touch Installation** — Enrollment tokens, one-liner install
- **RBAC** — JWT auth, 4 roles, audit logging, API keys
- **Rollout Strategies** — Canary, Staged, Percentage deployments
- **Maintenance Windows** — Scheduled deployment windows
- **Alerting System** — Alert rules, notification channels

### Changed
- Backend API dynamically reads agent version from database
- Improved CI/CD pipeline with Docker Compose tests

---

## [0.3.0] — 2026-02-07

### Added
- **System Tray Integration** — Minimize to tray, double-click to restore
  - Right-click context menu (Open, Dashboard, Connector, Status, Exit)
  - Connection status in tooltip
  - Balloon tip on first minimize
- **Auto-Reconnect** — Exponential backoff (1s → 5min)
  - Resets after 1+ min connected
  - Graceful cancellation handling
- **Scheduled Inventory Push** — Automatic push every X minutes
  - Configurable interval (default: 30 min)
  - Hot-reload of config changes
  - Push count tracking
- **File Logging** — Serilog with daily rolling files
  - Log path: `C:\ProgramData\Octofleet\logs\`
  - 14 days retention, 10 MB max per file
- **UI Icons** — Segoe Fluent Icons throughout (replacing emojis)
- **App Icon** — Custom openclaw.ico for EXE and window
- **Windows Update History** — Extended HotfixCollector

### Changed
- ShutdownMode changed to OnExplicitShutdown (for tray support)
- Service config extended with scheduling options

---

## [0.2.0] — 2026-02-06

### Added
- **Inventory System** — Full hardware/software/security data collection
  - 7 Collectors: Hardware, Software, Hotfixes, System, Security, Network, Browser
  - `inventory.push` command sends all data to backend API
  - PostgreSQL + TimescaleDB for storage
  - Next.js frontend with Dashboard + Node Detail views
- **Windows Service** — Background service for 24/7 node connection
  - Runs as SYSTEM, persists across reboots
  - GUI controls: Install/Start/Stop/Restart/Uninstall
  - UAC elevation via sc.exe
- **Dashboard View** — Live status cards + log viewer
  - Gateway status, Service status, Sessions, Cron Jobs
  - Auto-refresh every 5 seconds
- **Background mode for system.run** — Start GUI apps without blocking
- Service config stored in `C:\ProgramData\Octofleet\service-config.json`

### Fixed
- Node invoke result format (id/nodeId/payload structure)
- paramsJSON double-parsing from Gateway
- RefreshServiceStatus runs on background thread
- LogEntry model moved to shared location

---

## [0.1.0] — 2026-02-05

### Added
- Initial WPF application structure
- Gateway connection via WebSocket
- Views: Dashboard, Gateways, Hosts, Commands, Logs
- MVVM architecture with CommunityToolkit.Mvvm
- Credential storage with DPAPI encryption
- Node registration and pairing flow
- `system.run`, `system.which`, `node.ping` commands

---

## Version Numbering

- **Major**: Breaking changes or major feature sets
- **Minor**: New features, backwards compatible
- **Patch**: Bug fixes, small improvements

---
*Format based on [Keep a Changelog](https://keepachangelog.com/)*

## [0.4.17] - 2026-02-14

### Added
- **Remote Agent Restart**: New `restart-agent` job command type
  - Restart agent service remotely via job system
  - Spawns detached PowerShell script for safe restart
  - Usage: `POST /api/v1/jobs { "commandType": "restart-agent", "targetType": "device", "targetId": "<uuid>" }`

## [0.4.38] - 2026-02-17

### Added
- **E18 Service Orchestration**: ServiceReconciliationPoller in Agent
  - Polls assigned services from `/api/v1/nodes/{id}/service-assignments`
  - Automatic package installation (winget → choco fallback)
  - Health checks: HTTP, TCP, Process, Windows Service
  - Drift detection for strict policy
  - Status reporting to API
- DB Schema for E18: service_classes, services, service_node_assignments
- 9 new E2E tests for Services UI
- 4 new API tests for Service Orchestration

### Fixed
- DB constraints for `service_reconcile` command type
- DB constraints for `node` target type
- Services status constraint for `reconciling`

## [0.4.41] - 2026-02-17

### Added
- **Dashboard Security Stats**: Vulnerability counts (Critical/High/Medium) and Job stats (Success/Failed 24h)
- **API Documentation**: Comprehensive docs/API.md with all 158 endpoints

### Changed
- Dashboard summary API now includes vulnerability counts, job stats, and active alerts
- README updated with API documentation links

### Fixed
- Gateway URL/Token now configurable via environment variables
- suppress_vulnerability now uses authenticated username instead of hardcoded "admin"

## [0.4.42] - 2026-02-17

### Fixed
- Security tab test now handles Linux nodes (no Windows Defender)
- All 36 E2E tests passing

### Added
- `MetricsHistoryChart` component for historical performance trends
- `dependencies.py` with standardized API error handling
- Error factory functions: `not_found()`, `bad_request()`, `conflict()`

### Improved
- API error responses now include error codes and identifiers
- 60+ generic errors replaced with structured responses
