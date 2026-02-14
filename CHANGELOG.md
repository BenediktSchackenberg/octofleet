# CHANGELOG.md — Release History

All notable changes to the OpenClaw Windows Agent.

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
  - Log path: `C:\ProgramData\OpenClaw\logs\`
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
- Service config stored in `C:\ProgramData\OpenClaw\service-config.json`

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
