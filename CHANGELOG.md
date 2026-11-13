# Changelog

All notable changes to Octofleet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Agents update from the Octofleet server: the server serves verified releases, and the Windows agent checks for a newer one every 6 hours or on a `restart-agent` job ([#158](https://github.com/BenediktSchackenberg/octofleet/pull/158), [#168](https://github.com/BenediktSchackenberg/octofleet/pull/168), [#173](https://github.com/BenediktSchackenberg/octofleet/pull/173)).
- Self-service password change; no shared default admin password. On the first start the backend uses `ADMIN_PASSWORD` from `.env` or prints a one-time password ([#167](https://github.com/BenediktSchackenberg/octofleet/pull/167), [#210](https://github.com/BenediktSchackenberg/octofleet/pull/210)).
- Password reset, password policy and forced password changes ([#177](https://github.com/BenediktSchackenberg/octofleet/pull/177), [#183](https://github.com/BenediktSchackenberg/octofleet/pull/183)).
- Remove a node with a confirmed agent teardown ([#171](https://github.com/BenediktSchackenberg/octofleet/pull/171)).
- Add Device dialog and server installer for Linux nodes ([#176](https://github.com/BenediktSchackenberg/octofleet/pull/176)).
- Vulnerabilities:
  - a CVE view per node with accurate counts ([#180](https://github.com/BenediktSchackenberg/octofleet/pull/180));
  - vulnerability groups ([#198](https://github.com/BenediktSchackenberg/octofleet/pull/198));
  - OSV CVSS scores ([#204](https://github.com/BenediktSchackenberg/octofleet/pull/204), [#208](https://github.com/BenediktSchackenberg/octofleet/pull/208));
  - Patch Explorer CVE counts ([#225](https://github.com/BenediktSchackenberg/octofleet/pull/225)).
- The node tree groups nodes by OS product and version ([#193](https://github.com/BenediktSchackenberg/octofleet/pull/193)).
- Remediation controls with approval and maintenance safeguards ([#212](https://github.com/BenediktSchackenberg/octofleet/pull/212)).
- Dates follow the UI language, with a per-user 12/24-hour format; CI rejects new hardcoded UI text ([#211](https://github.com/BenediktSchackenberg/octofleet/pull/211), [#215](https://github.com/BenediktSchackenberg/octofleet/pull/215)).
- Translations (en/de/es) of the node pages, dashboard, navigation, widgets and node tools; tabs are kept in the URL ([#217](https://github.com/BenediktSchackenberg/octofleet/pull/217), [#224](https://github.com/BenediktSchackenberg/octofleet/pull/224), [#233](https://github.com/BenediktSchackenberg/octofleet/pull/233)).
- Node page:
  - a shared **Services** tab for Windows and Linux nodes; the Linux tab keeps only the Linux-specific cards; a tab whose data is missing stays visible with a notice ([#243](https://github.com/BenediktSchackenberg/octofleet/pull/243));
  - **Collect inventory** asks the agent for a fresh inventory and waits for it, instead of only reloading the stored data ([#248](https://github.com/BenediktSchackenberg/octofleet/pull/248));
  - the **Jobs** and **Patches** counts and links cover only that node; `GET /api/v1/jobs` accepts `node` and returns `total` ([#235](https://github.com/BenediktSchackenberg/octofleet/pull/235), [#251](https://github.com/BenediktSchackenberg/octofleet/pull/251));
  - the Updates tab of Windows nodes shows the last update search: time, status, source (WSUS server or Windows Update) and error ([#250](https://github.com/BenediktSchackenberg/octofleet/pull/250));
  - the Updates tab lists **Installed updates** with title, type (cumulative update, servicing stack, .NET, security update, update) and status instead of "Installed hotfixes" ([#252](https://github.com/BenediktSchackenberg/octofleet/pull/252)).
- The Linux agent runs `run`, `inventory` and `restart-agent` jobs; the database accepts `service_reconcile` jobs ([#244](https://github.com/BenediktSchackenberg/octofleet/pull/244), [#245](https://github.com/BenediktSchackenberg/octofleet/pull/245), [#246](https://github.com/BenediktSchackenberg/octofleet/pull/246)).

### Fixed
- Linux job results are recorded as success ([#162](https://github.com/BenediktSchackenberg/octofleet/pull/162)).
- Structured API errors are shown as text ([#163](https://github.com/BenediktSchackenberg/octofleet/pull/163)).
- The standard roles are created at startup ([#169](https://github.com/BenediktSchackenberg/octofleet/pull/169)).
- Password dialog: endpoint path, form reset, and messages in the UI language ([#172](https://github.com/BenediktSchackenberg/octofleet/pull/172)).
- Linux: the apt update's package version is reported ([#174](https://github.com/BenediktSchackenberg/octofleet/pull/174)), and package updates are shown in the Updates tab ([#175](https://github.com/BenediktSchackenberg/octofleet/pull/175)).
- Vulnerability matching:
  - versioned CPE matches ([#181](https://github.com/BenediktSchackenberg/octofleet/pull/181));
  - Linux packages are scanned with OSV distro data ([#182](https://github.com/BenediktSchackenberg/octofleet/pull/182));
  - scan errors are handled and OSV scans stay responsive ([#185](https://github.com/BenediktSchackenberg/octofleet/pull/185));
  - findings are ordered by severity and missing scores are shown ([#186](https://github.com/BenediktSchackenberg/octofleet/pull/186));
  - Chromium Edge matches `edge_chromium` ([#190](https://github.com/BenediktSchackenberg/octofleet/pull/190));
  - common Windows applications map to their NVD product ([#200](https://github.com/BenediktSchackenberg/octofleet/pull/200)).
- Dashboard numbers and event window ([#191](https://github.com/BenediktSchackenberg/octofleet/pull/191)).
- The Windows OS build revision is kept ([#194](https://github.com/BenediktSchackenberg/octofleet/pull/194)).
- Jobs are cancelled and deleted by the state of their instances ([#201](https://github.com/BenediktSchackenberg/octofleet/pull/201)).
- Hardware:
  - placeholder values from the firmware are no longer shown as data ([#226](https://github.com/BenediktSchackenberg/octofleet/pull/226));
  - virtual and physical disks are labeled consistently ([#229](https://github.com/BenediktSchackenberg/octofleet/pull/229));
  - Linux VMs report correct CPU, memory and disk values, with one entry per disk ([#232](https://github.com/BenediktSchackenberg/octofleet/pull/232), [#240](https://github.com/BenediktSchackenberg/octofleet/pull/240)).
- Security, network and browser inventory is stored and shown again, with a Linux layout for the Security tab ([#231](https://github.com/BenediktSchackenberg/octofleet/pull/231), [#241](https://github.com/BenediktSchackenberg/octofleet/pull/241)).
- Copy buttons work over plain HTTP, and the full node ID is shown ([#234](https://github.com/BenediktSchackenberg/octofleet/pull/234)).
- Package versions store their download URL; a Windows job whose package has no download URL fails visibly ([#238](https://github.com/BenediktSchackenberg/octofleet/pull/238), [#242](https://github.com/BenediktSchackenberg/octofleet/pull/242)).
- Windows disk health is matched to the disk by its number (it was missing on Hyper-V VMs); virtual disks with unspecified media are no longer reported as HDD ([#247](https://github.com/BenediktSchackenberg/octofleet/pull/247)).
- Windows agent hangs: a hanging WMI provider or helper process no longer blocks the inventory push or the job loop, and sections left out are named in the push result ([#249](https://github.com/BenediktSchackenberg/octofleet/pull/249)). The limits are:
  - 30 s per WMI query;
  - 60 s per helper process;
  - 3 min per collector;
  - the job's timeout for an `inventory` job (300 s by default).
- A failed Windows update search no longer clears the node's available updates, and catalog entries that are no longer offered are removed after a successful search ([#250](https://github.com/BenediktSchackenberg/octofleet/pull/250)).
- The **Start job** dialog sends the selected node or group, so the job runs there; before, it got no target ([#251](https://github.com/BenediktSchackenberg/octofleet/pull/251)).

### Upgrade
- The backend applies its database changes (new tables, columns and the job type constraint) at startup; no manual SQL is needed.
- The agent-side changes need the new agent versions. Agents with server-based updates install a newer release published on the server within 6 hours, or right away on a `restart-agent` job.

## [0.8.1] - 2026-10-26

### Fixed
- Correct Python import ordering so the backend passes the CI Ruff command.
- Keep the Windows agent and screen helper product versions consistent with the requested release version, including local builds.
- Normalize PXE configuration and boot-template line endings in Docker builds from Windows checkouts.
- Fresh Docker installs now create the Content Lifecycle tables, so `/api/v1/content/*` no longer fails with 500 ([#142](https://github.com/BenediktSchackenberg/octofleet/pull/142)).
- The dashboard's "Scan Vulnerabilities" button calls the existing scan endpoint instead of returning 404 ([#141](https://github.com/BenediktSchackenberg/octofleet/pull/141)).
- The Windows agent reports Hyper-V VMs as Hyper-V instead of VMware ([#145](https://github.com/BenediktSchackenberg/octofleet/pull/145)).

### Upgrade
- Existing installations: Docker runs the database init scripts only on an empty volume, so create the Content Lifecycle tables once after updating the checkout. Run from the repository root; the script only uses `CREATE TABLE IF NOT EXISTS` and inserts with `ON CONFLICT DO NOTHING`, so it is safe to run again:

  ```bash
  docker exec -i octofleet-inventory-db psql -U octofleet -d inventory -v ON_ERROR_STOP=1 -1 < backend/schema/e33-content-lifecycle.sql
  ```

  Adjust the container name if you changed it in `docker-compose.yml`.

### Release
- Built locally from the current main line, including its Windows installation, Linux inventory, onboarding and dependency fixes. The unmerged server-based agent update PRs #151 and #152 are not included.
- Windows packages can be signed and timestamped locally; server images can be built and distributed without GitHub Actions. See [manual release instructions](docs/MANUAL-RELEASE.md).

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
