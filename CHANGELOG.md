# Changelog

All notable changes to Octofleet will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Troubleshooting guide: Windows update installations that fail with `0x800F0823` or are offered again after the restart, where API installations show up (not in *Settings → Update history*), diagnosing an installation on the node (update history, Setup events, DISM, CBS and Windows Update logs, servicing processes that must never be stopped), component store cleanup after many cumulative updates, and the Linux agent's logs.
- Linux agent: its log (`/var/log/octofleet-agent.log`) is rotated. `install.sh` and the service (at every start, so also after a self-update) add `/etc/logrotate.d/octofleet-agent`: weekly or at 10 MB, 8 compressed files kept, `copytruncate`. Settings `LOG_ROTATE_COUNT`, `LOG_ROTATE_MAXSIZE`, `LOGROTATE_FILE` (empty: off). A configuration whose marker line was deleted is left alone; without logrotate the agent warns. The service writes `/etc` through a transient systemd unit, since it runs with `ProtectSystem=strict`. Uninstalling removes the rotated logs and the managed configuration.
- **Fleet updates** (Patches → Fleet updates, `/patches/updates`): all nodes, Windows and Linux, with their pending and security updates, the reboot state (pending, will need / may need one), the last update search with its status and source, and a running search or installation; cards that count and filter (with pending updates, security updates, reboot, failed search, no search for 7 days, offline), name and OS filter, sorting by column, all kept in the URL with Back working. Each node leads to its Updates tab. Tick nodes to **search for updates** or **install updates** on all of them – on Windows only the updates approved in the catalog, Linux nodes not in bulk yet (no approval path): the confirmation lists each node with its approved updates and reboot outlook, offers the reboot choice when a reboot can be needed, and leaves Defender signature updates out unless asked; the rows show the running search or installation and a failed one with a link to the job. An installation counts as running until the node reports after its restart (or while it waits for one), so it is not started again by mistake; it can be overridden. API: `GET /api/v1/patches/fleet`, `POST /api/v1/patches/fleet/search`, `POST /api/v1/patches/fleet/install` (the server builds each node's payload). Linux reboot estimate: `libssl3t64` (Ubuntu 24.04 and later) counts as OpenSSL ([#271](https://github.com/BenediktSchackenberg/octofleet/issues/271)).
- Windows nodes: the Updates tab gets **Search for updates** and **Install updates** / **Install selected (n)** like Linux nodes, with checkboxes on the available updates; the confirmation asks what to do when an update needs a reboot (no reboot, reboot at a set time, in one minute). After an installation the Windows agent searches again and sends a fresh inventory. The tab counts the pending updates on Windows too (it counted the installed ones and the history); a scheduled reboot time is read with its offset (it was taken as local time and compared with UTC). Linux nodes get the same reboot choice (a systemd timer runs `systemctl reboot`). A Windows installation that runs longer than 30 minutes is reported as still running, with the servicing processes, and never stopped. The update tables share their column widths; successful results are shown quietly, failed ones in red. The Windows installation result lists each KB's result code and HRESULT and is checked against the Windows Update history: a KB reported as installed but recorded as failed there (e.g. `0x800F0823`, a newer servicing stack installed first; the update has to be installed again after the restart) now fails the job with a hint, instead of being reported as installed. The update history keeps the newest entry per update and result (an update installed twice was stored once, and the older failed attempt overwrote the success), and the installed updates show the newest attempt's result. The install confirmation says whether a reboot is needed (Windows reports it per update and whether one is pending; on Linux it is estimated from the package names) and offers the reboot choice only then.
- Linux nodes: **Search for updates** (`patch_scan`: refresh the package lists with apt, dnf or yum and report the updates, with the result as the node's last update search) and **Install updates** (`patch_install`: all updates, or the packages selected in the list). The inventory reports whether a reboot is required. The Updates tab of Windows nodes lists the available updates of the last search. The tab of Windows and Linux nodes turns amber while updates are pending (not counting Defender signature updates) and red when the last update search failed ([#230](https://github.com/BenediktSchackenberg/octofleet/issues/230)).
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
- `docs/REMEDIATION.md`: Auto-Fix (fix packages, rules, maintenance windows, dry run, approval, job states including *skipped*, what the agent runs, permissions, limits; Windows only).
- Password rules where passwords are chosen: the change-password dialog, the required change on `/change-password` and an admin's create user and password reset list the rules of the password policy (length, required character types, the history) with a mark per rule while typing, and report the broken rule before sending. A password the server rejects shows its reason in the UI language (e.g. *password used recently*) instead of a generic error. `/change-password` is fully translated. New `GET /api/v1/auth/password-rules` for every signed-in user, also during a required change; changing the policy stays `settings:write` ([#177](https://github.com/BenediktSchackenberg/octofleet/pull/177)).
- Vulnerability scan: OSV advisories are cached between scans (`osv_advisories`) and downloaded again only when OSV reports a change or the entry is older than 30 days; a scan of 1,833 software versions downloaded 10,549 advisories every time. The scan history shows per scan the OSV advisories downloaded and taken from the cache, and marks scans that rebuilt the cache (they take longer), plus the cache with **Verify** (compare a random sample with OSV and correct differences), **Full scan without cache** and **Clear cache** (API: `GET/DELETE /api/v1/vulnerabilities/osv-cache`, `POST …/osv-cache/verify`, `refresh_cache` for `POST /api/v1/vulnerabilities/scan`).
- Agents (Windows and Linux): the scheduled inventory push is spread over the interval, and the default interval is 60 minutes (was 30). The push after the start waits a random 30–120 s (Linux 0–60 s), the first scheduled one comes at a random 50–150 % of the interval, later ones every interval ±10 %; nodes started together (agent update, power cut, patch reboots) no longer push in the same second. A failed Windows push is retried after about 5 minutes instead of every minute. Jobs and *Collect inventory* still push immediately (#283).

### Fixed
- Linux agent install: the command from *Add Device* (and in the docs) works in fish too (e.g. CachyOS, where fish is the default shell; it stopped at `f=$(mktemp)`). It downloads to `~/octofleet-install.sh` and uses no variables, so bash, zsh, sh and fish run it alike. On Arch-based systems the installer installs missing tools with `pacman -S --needed` instead of `pacman -Sy` (a partial upgrade); if that fails it asks for `pacman -Syu` first.
- Linux agent on Rocky/Alma/RHEL and other dnf/yum systems: updates were never reported and the update search and installation failed. The inventory's `dnf check-update` ran inside the agent's read-only sandbox (dnf needs its lock file even to list updates), and `systemd-run --pipe`, used for every package-manager call, could not start the unit from the service on systemd 252 (RHEL 9: "Connection reset by peer"). The package manager now always runs in the transient unit, which writes its output to a temporary file instead of `--pipe`. dnf/yum updates get a per-package security flag and severity from the security advisories (the count used to be the number of advisory lines). Package-manager output is read in English (`LC_ALL=C`) whatever the system language. The reboot check falls back to `dnf needs-restarting -r` on minimal installs without yum-utils.
- Windows agent: security events (logon, network, process, registry, service, file audit) are no longer lost while the server is not reachable. A batch that could not be uploaded is kept and sent first next time (bounded by the existing queue limit); a batch the server rejects (4xx) is still dropped, with the number of events in the warning. Every full batch also dropped one event; fixed.
- Windows agent: the log no longer fills with connection errors. The screen and live-data pollers asked the server every 5 seconds, just when the server closed the idle connection after 5 seconds (`SocketException 10053`, about 100 errors with stack traces a day). The agent now closes idle connections after 2 seconds, and all its HTTP calls share one connection pool (the security collectors opened a new connection for every upload). A server that is not reachable, a dropped connection or a timeout is logged as one warning line per part of the agent, then at most every 5 minutes with the count, and once when it works again; the pollers back off meanwhile (the terminal poller asked every 0.5 seconds while the server was down). "Service not configured" at every start is an information about the optional gateway connection when the Octofleet server is set up.
- Linux agent: a failed inventory push is retried after a minute (`PUSH_RETRY_INTERVAL`, doubling with every further failure up to the push interval, with random jitter), not after the full push interval. After a reboot, the first push often fails because the server is not reachable yet (on the Octofleet server itself, its containers are still starting); the node then showed the state from before the reboot, e.g. "Reboot required", for up to 30 minutes.
- The date format picked in the language menu shows as labeled in every language: with the UI in English or Spanish, "31.12.2026" gave 31/12/2026.
- Tasks page: failed jobs are really the failed ones (`GET /api/v1/jobs?status=failed&since_hours=`; before, the newest 20 jobs of any state were listed as "Job failed"); critical vulnerabilities per node from the same counts as the dashboard instead of repeated rows of the CVE table; every entry shows its status, date/time and links to the item itself; agents waiting for approval, security findings and failed alert deliveries are read correctly; translated (en/de/es). The dashboard widget is now "Open tasks": same numbers as the Tasks page (failed jobs of the last 7 days instead of 24 hours) and links to the matching Tasks filter. The sidebar badges say what they count (tooltip): the Jobs badge counts failed jobs of the last 7 days (it counted all failed jobs ever), the Alerts badge alerts that could not be sent (it counted the alert rules). The jobs page reads `?status=failed`.
- Jobs page: filter bar (search by name, status, type, time range – default the last 7 days, like the badge and the Tasks page), kept in the URL; the cards count jobs (not instances) of all matching jobs, not only the first 50, and set the status filter; paging; a status per job; node names instead of UUIDs; translated (en/de/es) together with the job detail page. `GET /api/v1/jobs` gets `status` (failed/running/pending/success/cancelled), `command_type`, `q`, `counts` and `command_types`. The job detail page's retry called a route that does not exist; the side panel's cancel/delete buttons depended on a job state the API does not return.
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
- Vulnerability scan: a single failed OSV request (e.g. `503 Service Unavailable` for one advisory) failed the whole scan after minutes of work. OSV requests are now retried like NVD requests (429, 5xx, connection errors); packages whose advisories still cannot be fetched keep their previous findings, and the scan ends as *Partial* with their number.

### Upgrade
- Inventory push interval: installations keep the interval in their configuration – older installers wrote 30 minutes (`ScheduledPushIntervalMinutes` / `PUSH_INTERVAL=1800`), and reinstalling keeps it. Remove the setting (or set 60 / 3600) to use the new default; the spreading applies either way with the new agent versions.
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
