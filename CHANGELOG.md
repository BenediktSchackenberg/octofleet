# Changelog

All notable changes to Octofleet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-02-20

### Added
- 🐙 New octopus icon for all applications (Agent, Service, ScreenHelper)
- Code signing scripts (`Create-CodeSigningCert.ps1`, `Sign-Release.ps1`)
- ScreenHelper tray icon now displays custom octopus icon

### Changed
- Improved WebSocket stability for screen sharing (120s timeout)
- Better session cleanup - multiple screen sessions without agent restart
- Enhanced logging for screen sharing diagnostics

### Fixed
- Screen streaming error spam (now stops after 3 consecutive failures)
- Session cleanup on WebSocket disconnect
- Viewer WebSocket keep-alive improvements

## [0.5.0] - 2026-02-20

### Added
- **Screen Sharing (E17)** - Real-time screen viewing in browser
  - OctofleetScreenHelper.exe for user session capture
  - Named Pipe IPC between Service and Helper
  - JPEG streaming via WebSocket
  - Auto-start at user login via Run key
- Hardware Fleet Dashboard with SMART disk monitoring
- Physical disk health tracking
- Export functionality for fleet data

### Architecture
- Helper process runs in user session (Session 1+)
- Service communicates via Named Pipe (`octofleet-screen`)
- Solves Windows Session 0 isolation for screen capture

## [0.4.x] - Previous Releases

### Completed Epics
- E1: Enhanced Inventory ✅
- E2: Device Grouping ✅
- E3: Job System Core ✅
- E4: Package Management ✅
- E5: Deployment Engine ✅
- E6: Linux Agent ✅
- E7: Alerting & Notifications ✅
- E8: Security & RBAC ✅
- E9: Rollout Strategies ✅
- E10: Zero-Touch Installation ✅
- E12: Eventlog Collection ✅
- E13: Vulnerability Tracking ✅
- E14: Auto-Remediation ✅
- E15: Hardware Fleet Dashboard ✅
- E16: Live View (SSE) ✅
- E18: Service Orchestration ✅

---

[0.5.1]: https://github.com/BenediktSchackenberg/octofleet/releases/tag/v0.5.1
[0.5.0]: https://github.com/BenediktSchackenberg/octofleet/releases/tag/v0.5.0
