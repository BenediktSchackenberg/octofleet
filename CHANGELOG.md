# Changelog

All notable changes to Octofleet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-09-11

### Added
- Settings → Provisioning: centrally persisted PXE/API/NFS addresses, DNS defaults, storage directories, Hyper-V/KVM paths, SMB shares and PXE service options.
- Validated PXE and WinPE configuration exports with previews, plus configurable iPXE/GRUB templates and Docker mounts.
- Spanish translations for all 221 existing i18n keys and language selection ([#127](https://github.com/BenediktSchackenberg/octofleet/pull/127)).

### Fixed
- Provisioning forms now send the requested HTTP method when saving instead of issuing GET requests.
- Boot generation, ISO imports and VM creation use the configured infrastructure instead of site-specific addresses and user paths. Invalid configuration does not advance a boot task.
- Removed the hardcoded domain login from the bundled Windows post-install script; domain and DNS settings come from task answer files.

### Upgrade
- Configure Settings → Provisioning before starting new deployments. Export `pxe.env` to the PXE host and recreate its container; existing custom WinPE images need the exported `octofleet-config.cmd`. Storage is not moved automatically.
- The PXE setup launcher now uses the maintained Compose stack. Prepare ISO/NFS mounts and bootloaders separately; import images through Provisioning → Administration.
- See [the provisioning configuration guide](docs/PROVISIONING-CONFIGURATION.md). This is the configuration foundation for #107; the Smart Proxy epic remains open.

## [0.7.1] - 2026-09-11

### Fixed
- Browser inventory no longer creates or deletes VSS snapshots or uses external lock-bypass tools. Locked cookie databases are reported as unavailable; readable empty databases return zero cookies ([#128](https://github.com/BenediktSchackenberg/octofleet/issues/128)).
- Windows agent releases use fresh staging directories and reject legacy OpenClaw artifacts and unexpected executables. Removed checked-in legacy binaries, unified release builders, and included the installer from its actual repository path.
- Local release builds can sign and verify executables before creating the ZIP and checksum. Removed the duplicate release-created workflow so manual releases are not rebuilt or overwritten by Actions.

## [0.5.2] - 2026-02-20

### Added
- **Zero-Touch Provisioning (E22)** - PXE boot Windows deployment
  - Docker-based PXE server (dnsmasq + TFTP + HTTP)
  - WinPE boot.wim with embedded VirtIO drivers
  - Automated disk partitioning and DISM image apply
  - VirtIO driver injection for KVM/QEMU VMs
  - Error handling with debug shell on failure
- Frontend: `/provisioning` page with deployment queue UI
  - Job creation modal with OS selection
  - Real-time progress tracking
  - Multi-VLAN Tentacle status view
  - Unknown MAC detection

### Fixed
- WinPE: Use `find` instead of `findstr` (not available in WinPE)
- WinPE: Use `net start lanmanworkstation` for SMB client
- INACCESSIBLE_BOOT_DEVICE: Driver injection after DISM, before bcdboot

### Documentation
- E22-UNIVERSAL-PROVISIONING.md: Lessons learned section
- README: Zero-Touch Provisioning section
- Blog post: PXE deep dive

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
