# Octofleet Agent Setup Guide

This guide covers installing and configuring the Octofleet agent on Windows and Linux nodes.

## Prerequisites

- A running Octofleet server (Docker Compose stack on your server)
- Network access from agent to the Octofleet backend (default port `8080`)
- An API key (from your `docker-compose.yml` `API_KEY` env var, or generated under **Admin → API Keys** in the web UI)

---

## Windows Agent

### Quick Install (One-liner)

Run this in an **elevated PowerShell** (Run as Administrator):

```powershell
irm https://github.com/BenediktSchackenberg/octofleet/releases/latest/download/Install-OctofleetAgent.ps1 | iex
```

The installer will prompt you for the server URL and API key interactively.

### MSI (GPO, Intune, ConfigMgr)

Each release also has `OctofleetAgent-vX.Y.Z.msi`: a Windows Installer package that shows up in *Programs and Features* and installs silently with the server URL and agent key as properties:

```powershell
msiexec /i OctofleetAgent-v0.8.2.msi SERVER_URL=https://octofleet.example.com API_KEY=<agent key> /qn /l*v C:\Windows\Temp\octofleet-install.log
```

Optional: `DISPLAY_NAME`, `PUSH_INTERVAL` (minutes), `SCREEN_HELPER=1` (the screen helper is off by default). Upgrades (install the new MSI), repair (`msiexec /fa`) and uninstall (`msiexec /x`) keep `C:\ProgramData\Octofleet\service-config.json`; properties passed to `msiexec` replace only their own values. The MSI installs over a script install without re-enrolment. An agent installed by the MSI does **not** update itself: deploy the new MSI. Properties, return codes and step-by-step examples for **Intune** (LOB or Win32 app with product code detection), **ConfigMgr** and **GPO** (transform with the properties): [installer/README.md](../installer/README.md).

### Manual Install

1. Download `OctofleetAgent-vX.Y.Z.zip` from [GitHub Releases](https://github.com/BenediktSchackenberg/octofleet/releases)
2. Extract to `C:\Program Files\Octofleet\`
3. Install the Windows Service:
   ```powershell
   sc.exe create OctofleetNodeAgent binpath="C:\Program Files\Octofleet\OctofleetAgent.Service.exe" start=auto
   ```
4. Create the configuration (see below)
5. Start the service:
   ```powershell
   Start-Service OctofleetNodeAgent
   ```

### Configuration Files

The agent stores its configuration in:

```
C:\ProgramData\Octofleet\
├── service-config.json    # Main configuration
└── device-identity.json   # Auto-generated device identity (do not edit)
```

The folder holds the agent key. The installer and the service (at every start, and checked every hour) restrict it to SYSTEM and Administrators; do not widen its rules, the service restores them within an hour. The service also encrypts the key in `service-config.json` for SYSTEM (DPAPI): you can still put a new key into `InventoryApiKey` in plain text, and the service moves it into `InventoryApiKeyProtected` on its next start.

The logs are in `C:\Windows\Logs\Octofleet\`, one file per component, readable without elevation (see [Logs](#logs)). Older agents wrote them to `C:\ProgramData\Octofleet\logs\`; the first start of a current agent moves them.

#### `service-config.json`

Create or edit `C:\ProgramData\Octofleet\service-config.json`:

```json
{
  "InventoryApiUrl": "http://your-server:8080",
  "InventoryApiKey": "your-api-key",
  "GatewayUrl": "http://your-server:18789",
  "GatewayToken": "your-gateway-token",
  "DisplayName": "MY-SERVER-01",
  "AutoStart": true,
  "AutoPushInventory": true,
  "ScheduledPushEnabled": true,
  "ScheduledPushIntervalMinutes": 60
}
```

| Field | Description | Default | Required |
|-------|-------------|---------|----------|
| `InventoryApiUrl` | URL to the Octofleet backend API (no trailing slash) | — | **Yes** |
| `InventoryApiKey` | API key for authenticating with the backend | — | **Yes** |
| `GatewayUrl` | URL to the Octofleet Gateway (for remote access features) | — | No |
| `GatewayToken` | Authentication token for the Gateway | — | No (required if GatewayUrl set) |
| `DisplayName` | Display name for this node in the UI | Machine hostname | No |
| `AutoStart` | Automatically start all agent services on launch | `true` | No |
| `AutoPushInventory` | Push inventory data to backend on startup | `true` | No |
| `ScheduledPushEnabled` | Enable periodic inventory push | `true` | No |
| `ScheduledPushIntervalMinutes` | Inventory push interval in minutes; pushes are spread: the first after the start comes 30–120 s after it, the first scheduled one at a random 50–150 % of the interval, then every interval ±10 %; a failed push is retried after about 5 minutes. Jobs and *Collect inventory* push immediately. Older installers wrote `30`, which stays as a local override | `60` | No |
| `RepoUrl` | Custom URL for the software repository | Auto-detected | No |
| `PreferRepo` | Check local repo before external download URLs | `true` | No |
| `FallbackToSource` | Fall back to source URL if package not in repo | `true` | No |
| `Logging` | Log format, level per component, file size and old files kept, see [Logs](#logs) | CMTrace, `Information`, 2 MB, 4 | No |

Between scheduled pushes, **Collect inventory** on the node page sends the agent an `inventory` job: the agent collects and pushes its inventory right away, and the page shows it once the agent has reported back (the agent picks up jobs about once a minute). If a WMI query or helper process hangs, the collection has time limits, and the job fails after its timeout (300 s by default) instead of blocking the agent. See [Troubleshooting](TROUBLESHOOTING.md#inventory-incomplete-or-collect-inventory-times-out-windows).

> **Important:** `InventoryApiUrl` and `InventoryApiKey` are required for the agent to function. Without them, the agent will not push inventory data or poll for jobs.

#### `device-identity.json`

This file is **auto-generated** on first run and contains the device's unique identity (cryptographic key pair). Do not edit or delete this file — it is used for secure device authentication.

#### Logs

Like the ConfigMgr client, the agent writes **one log per component** to `C:\Windows\Logs\Octofleet\` ([#330](https://github.com/BenediktSchackenberg/octofleet/issues/330)):

| File | What |
|---|---|
| `Agent.log` | start and stop, configuration, registration, connection to the server – **and every warning and error of all components**: look here first |
| `Inventory.log` | inventory collection (per section on debug) and push: size, HTTP status, duration, the server's answer when it rejects a push |
| `Jobs.log` | job polling and results, deployments, packages (download, detection, install exit codes) |
| `Updates.log` | Windows Update search and installation (also when started by a job): result codes, HRESULTs, reboot |
| `Remediation.log` | remediation jobs, service reconciliation |
| `Security.log` | security sensors (file audit, posture, processes, network, registry, logons, services) |
| `Events.log` | event log push |
| `LiveData.log` | live data |
| `RemoteTools.log` | terminal, remote shell, screen sharing |
| `SelfUpdate.log` | agent self-update (the update script itself writes `update.log`) |

A file is created when its component writes its first line. The lines are in the **CMTrace format**: open the folder with **CMTrace** or **OneTrace** to see warnings (yellow) and errors (red) highlighted, merge several logs by time, or follow a file live. They are still plain text (`<![LOG[message]LOG]!><time=… date=… component="Updates" … type="2" thread="12" file="PatchScanner">`; type 1 = information or debug, 2 = warning, 3 = error). Each file is rotated at 2 MB: the current file keeps its name, the full one is renamed to `Updates-20261124-153000.log`, and the 4 newest of those are kept (at most 10 MB per component).

The defaults can be changed in `service-config.json`, followed by a service restart:

```json
{
  "Logging": {
    "Format": "CMTrace",
    "Level": "Information",
    "Levels": { "Updates": "Debug", "Inventory": "Debug" },
    "MaxFileSizeMB": 2,
    "MaxOldFiles": 4
  }
}
```

| Field | Description | Default |
|---|---|---|
| `Format` | `CMTrace` or `Text` (`2026-11-24 15:30:00.123 +01:00 [WRN] [Updates] message`) | `CMTrace` |
| `Level` | level of all components: `Debug`, `Information`, `Warning`, `Error` (`Verbose`, `Info`, `Warn` work too) | `Information` |
| `Levels` | level per component, by the names above (`Agent`, `Inventory`, `Jobs`, `Updates`, `Remediation`, `Security`, `Events`, `LiveData`, `RemoteTools`, `SelfUpdate`) | – |
| `MaxFileSizeMB` | size at which a file is rotated | `2` |
| `MaxOldFiles` | rotated files kept per component | `4` |

Set a component to `Debug` while troubleshooting and back afterwards: debug lines name every query that failed or found nothing (e.g. a WMI class missing on this Windows version). An unknown component or level is reported as a warning in `Agent.log` at start. Agents up to 0.8.x wrote one `service-YYYYMMDD.log` per day; those files stay until they are 14 days old and are then deleted.

### Minimal Configuration

For a basic setup that pushes inventory and polls for jobs, you only need two fields:

```json
{
  "InventoryApiUrl": "http://192.168.1.100:8080",
  "InventoryApiKey": "your-api-key-here"
}
```

### Full Configuration (with Gateway)

For full functionality including remote terminal, screen sharing, and live view:

```json
{
  "InventoryApiUrl": "http://192.168.1.100:8080",
  "InventoryApiKey": "a9544b6300030bda29268e0f207b88ba446f6a31669a7c63",
  "GatewayUrl": "http://192.168.1.100:18789",
  "GatewayToken": "your-gateway-token",
  "DisplayName": "SQLSERVER1",
  "AutoStart": true,
  "AutoPushInventory": true,
  "ScheduledPushEnabled": true,
  "ScheduledPushIntervalMinutes": 60
}
```

### What Each Service Does

The agent runs multiple background services:

| Service | Requires | Description |
|---------|----------|-------------|
| **NodeWorker** | `InventoryApiUrl` | Pushes hardware, software, security, and network inventory |
| **JobPoller** | `InventoryApiUrl` | Polls for and executes pending jobs (scripts, patches, packages) |
| **RemediationPoller** | `InventoryApiUrl` | Polls for vulnerability remediation tasks |
| **PatchScanner** | `InventoryApiUrl` | Scans for available Windows Updates via WUA API |
| **PatchInstaller** | `InventoryApiUrl` | Installs Windows Updates when patch_install jobs are received |
| **TerminalPoller** | `InventoryApiUrl` | Runs commands from the browser terminal (**Nodes → Terminal**): asks every 0.5 s while a terminal page for the node is open and 60 s after, otherwise about every 5 s – opening a session waits up to 5 s |
| **ScreenStreamService**, **RemoteShellService** | `InventoryApiUrl` | Ask every 5 s for a screen sharing or remote shell session |
| **GatewayConnector** | `GatewayUrl` | WebSocket connection for remote terminal/screen/shell access |
| **AutoUpdater** | Internet | Checks GitHub Releases for agent updates and self-updates |

### What the Windows Agent Reports About Security

With every inventory push the security section has Microsoft Defender and other antivirus products, Windows Firewall per profile, TPM, BitLocker, UAC, Secure Boot and the local administrators, and the application control and hardening settings shown on the node's Security tab ([#227](https://github.com/BenediktSchackenberg/octofleet/issues/227)):

| Check | What | Source |
|-------|------|--------|
| **App Control for Business (WDAC)** | enforcement in kernel and user mode (off / audit / enforced), the active policies (name, version, Windows / base / supplemental, signed), the Microsoft vulnerable driver blocklist | `Win32_DeviceGuard` in `root\Microsoft\Windows\DeviceGuard` (`CodeIntegrityPolicyEnforcementStatus`, `UsermodeCodeIntegrityPolicyEnforcementStatus`); `CiTool --list-policies --json` (Windows 11 22H2, Server 2025; run with closed input and a 30 s limit), otherwise only the policy IDs from `C:\Windows\System32\CodeIntegrity\CiPolicies\Active\*.cip`; `HKLM\SYSTEM\CurrentControlSet\Control\CI\Config` `VulnerableDriverBlocklistEnable` |
| **AppLocker** | per rule collection (executables, Windows Installer, scripts, DLLs, packaged apps): enforced / audit / off and the rule count; whether the Application Identity service (`AppIDSvc`) runs | `Get-AppLockerPolicy -Effective -Xml`, service status |
| **Virtualization-based security** | VBS status, Credential Guard, memory integrity (HVCI), System Guard Secure Launch: running / configured but not running / off | `Win32_DeviceGuard` (`VirtualizationBasedSecurityStatus`, `SecurityServicesConfigured`, `SecurityServicesRunning`) |

An AppLocker collection without rules counts as off (AppLocker then allows every file of that type); one with rules and the mode *not configured* counts as enforced. AppLocker applies its rules only while `AppIDSvc` runs – the tab notes it when the service is stopped. A check that cannot be read (older Windows without the DeviceGuard class, no CiTool, no AppLocker module, no access) shows *unknown* and does not affect the rest of the inventory. The checks are shown only; they do not create security findings yet. Nodes show them after the agent update.

### Restart After Config Changes

After editing `service-config.json`, restart the service:

```powershell
Restart-Service OctofleetNodeAgent
```

### Verify

1. Check the service is running:
   ```powershell
   Get-Service OctofleetNodeAgent
   ```

2. Check the logs in `C:\Windows\Logs\Octofleet\` with CMTrace or OneTrace, starting with `Agent.log` (see [Logs](#logs); `update.log` for self-updates). Older agents wrote to `C:\ProgramData\Octofleet\logs\`; the update moves those files once. While the agent has a file open Explorer may show an older modified time and size.

   When the server is not reachable (restart, network, DNS) or a request times out, each part of the agent logs **one warning line** (in its component's log and in `Agent.log`), then at most one every 5 minutes with the number of failures, and one line when it works again, e.g. (in the `Text` format):
   ```
   [WRN] Screen session check failed: No connection could be made because the target machine actively refused it. (server:8080) (attempt 1, failing since 18:02:11)
   [INF] Screen session check works again (failed attempts: 3, failing since 18:02:11)
   ```
   Meanwhile the pollers ask less often (up to once a minute). Errors with a stack trace (type 3 in CMTrace, `[ERR]` in the text format) are real problems of the agent or answers the server rejected.

3. Confirm the node appears in the web UI under **Fleet → Nodes**

4. Check the backend logs for the agent polling:
   ```
   GET /api/v1/jobs/pending/win-myserver        200 OK
   GET /api/v1/remediation/jobs/pending/win-myserver  200 OK
   ```

### Windows Service Management

```powershell
# Start
Start-Service OctofleetNodeAgent

# Stop
Stop-Service OctofleetNodeAgent

# Restart
Restart-Service OctofleetNodeAgent

# Check status
Get-Service OctofleetNodeAgent

# Remove service
Stop-Service OctofleetNodeAgent
sc.exe delete OctofleetNodeAgent
```

---

## Linux Agent

### Install

```bash
# Clone the repo (or download just the agent script)
git clone https://github.com/BenediktSchackenberg/octofleet.git
cd octofleet

# Copy the agent files
sudo mkdir -p /opt/octofleet-agent
sudo cp backend/agent.sh /opt/octofleet-agent/
sudo chmod +x /opt/octofleet-agent/agent.sh
```

### Configuration

Create `/opt/octofleet-agent/config.env`:

```bash
# Required: Octofleet backend URL (no trailing slash)
API_URL="http://your-server:8080"

# Required: API authentication key
API_KEY="your-api-key"

# Optional: Override node identifier (defaults to hostname)
NODE_ID=""

# Optional: Inventory push interval in seconds (default: 60 min, spread over the interval)
PUSH_INTERVAL=3600

# Optional: Log file location
LOG_FILE="/var/log/octofleet-agent.log"
```

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `API_URL` | URL to the Octofleet backend API | — | **Yes** |
| `API_KEY` | API key for authentication | — | **Yes** |
| `NODE_ID` | Override node identifier | hostname | No |
| `PUSH_INTERVAL` | Full inventory push interval (seconds). The push after the start comes a random 0–60 s after it, the first scheduled one at a random 50–150 % of the interval, then every interval ±10 %, so nodes started together do not push together. Jobs and *Collect inventory* push immediately. Older installs have `1800` in `config.env`, which stays (also when `install.sh` runs again) | `3600` | No |
| `PUSH_RETRY_INTERVAL` | First retry of a failed inventory push (seconds), e.g. while the server is still starting after a reboot; doubles with every further failure up to `PUSH_INTERVAL`, plus 0–50 % random jitter so a large fleet does not retry in lockstep | `60` | No |
| `LOG_FILE` | Path to log file | `/var/log/octofleet-agent.log` | No |
| `LOG_LEVEL` | `debug` also logs the server's raw answer to a rejected inventory push | `info` | No |
| `DIAG_DIR` | Root-only folder for diagnosis files (see [Inventory push errors](#inventory-push-errors)) | `/opt/octofleet-agent/diagnostics` | No |
| `PUSH_FAIL_LOG_INTERVAL` | A push that keeps failing for the same reason is logged again at most this often (seconds) | `3600` | No |
| `LOG_ROTATE_COUNT` | Rotated log files kept (compressed) | `8` | No |
| `LOG_ROTATE_MAXSIZE` | Rotate earlier than weekly when the log is larger (logrotate size, e.g. `10M`) | `10M` | No |
| `LOGROTATE_FILE` | The agent's logrotate configuration; empty turns it off | `/etc/logrotate.d/octofleet-agent` | No |
| `LONG_POLL` | `false` turns the [long-poll](#long-poll) off: the agent then polls on its timers as before | `true` | No |
| `LONG_POLL_SECONDS` | How long the server may hold a long-poll (seconds; the server caps it at its `AGENT_WAIT_SECONDS`). Lower it behind a proxy that closes idle requests sooner | `55` | No |
| `LONG_POLL_FALLBACK_INTERVAL` | While the long-poll works: the job, terminal and screen polls run only this often (seconds), as a fallback | `600` | No |
| `LONG_POLL_RETRY_INTERVAL` | After a failed long-poll: the next one after a random 50–150 % of this (seconds), doubling per further failure up to 5 minutes | `15` | No |
| `LONG_POLL_RECHECK_INTERVAL` | A server without the long-poll (404) is asked again after this long (seconds) | `3600` | No |

### Long-Poll

The agent keeps one request open to the server, `GET /api/v1/agent/wait/{node_id}` ([#283](https://github.com/BenediktSchackenberg/octofleet/issues/283)). The server answers as soon as there is something for the node – a job, a terminal command or a newly opened terminal page, a screen session – and the agent runs that poll at once (within about a second); otherwise the server answers empty after about 55 s and the agent asks again. The job, terminal and screen polls then run only every `LONG_POLL_FALLBACK_INTERVAL` (10 minutes) as a fallback; while a terminal page is open the terminal poll still runs every second.

| Per idle node | Timers only (`LONG_POLL=false`, or an older server) | Long-poll |
|---|---|---|
| Requests per minute (jobs, terminal, screen) | about 13 (about 25 with a screen capture tool) | about 1.4 |
| Delay until a new job starts | up to 60 s | about 1 s |
| Delay until the agent notices a new terminal page | up to 5 s | about 1 s |
| 10,000 idle nodes | about 2,200 requests per second | about 230, most of them held |

The live data push (every 5 s) and the inventory push are not polls and stay as they are.

- **Older servers:** the agent asks once; on a 404 it keeps its timers and asks again after `LONG_POLL_RECHECK_INTERVAL`. Older agents keep their timers against a new server: the poll routes stay.
- **Errors and server restarts:** the agent falls back to its timers at once and reconnects after a random delay (7–22 s after the first failure, growing up to 5 minutes), so a large fleet does not come back in the same second. When the server stops it answers the held requests first, so a restart does not wait for them.
- **Server side:** one held request per node, handled asynchronously. The backend's open-file limit (`ulimit -n`; Docker's default is high enough) must allow one connection per node plus the usual load. The wake-up runs inside the backend process, which is how Octofleet runs (one `uvicorn` process; terminal, screen and shell sessions live there too). With several backend instances an agent would learn about new work only with its next request (up to 55 s later); that would need Postgres `LISTEN/NOTIFY`.
- **Proxies:** the hold time (55 s) is below the usual 60 s idle limit of proxies and load balancers. Behind a proxy with a shorter limit set `LONG_POLL_SECONDS` lower.
- Jobs created by paths that do not wake the agent (e.g. scheduled jobs that become due, baselines, provisioning) start with the agent's next long-poll, at most about 55 s later.

### What the Linux Agent Reports About Updates

With every inventory push the agent sends its available package updates (apt, dnf, yum, pacman): package name, new and installed version, architecture, repository, security flag (and severity on dnf/yum), plus the distribution release from `/etc/os-release` (`id`, `versionId`, `idLike`, `name`, `buildId`). Rolling releases without a version (Arch, CachyOS) show their `BUILD_ID` (`rolling`) as the OS version. On pacman systems the update search needs **pacman-contrib** (`checkupdates`); `arch-audit` adds security flags. The server keys the first time it saw each package version by that release; see [Patch Management](PATCH-MANAGEMENT.md#linux-nodes). Agents without the release (older versions) still report their updates, but they are stored per package version only after the agent update.

### Log Rotation

The agent writes `LOG_FILE` and rotates it with logrotate: `install.sh` adds `/etc/logrotate.d/octofleet-agent`, and the service checks it at every start, so also after a self-update. It rotates weekly, or earlier at `LOG_ROTATE_MAXSIZE`, keeps `LOG_ROTATE_COUNT` compressed files and uses `copytruncate`, because the agent keeps appending to the same file.

- **Your own settings:** the file's first line marks it as managed by the agent, which then keeps it current. Delete that line to keep your own version: the agent no longer touches the file.
- **logrotate not installed:** the agent logs a warning at every start and adds the file once logrotate is installed. The journal (`journalctl -u octofleet-agent`) is rotated by journald either way.
- **Uninstalling** (`uninstall.sh` or the console) removes the log, the rotated files and the managed configuration; a configuration you took over stays.
- **Manual setup:** run `sudo /opt/octofleet-agent/agent.sh logrotate` once.

### Inventory Push Errors

A failed inventory push is logged as one sentence, for example:

```
[2026-11-23 14:02:11] [ERROR] Inventory push failed: the server could not read it, invalid JSON at character 150206 (after ""usedBytes": "). The inventory is saved in /opt/octofleet-agent/diagnostics/last-failed-push.json.
```

The same failure is repeated at most every `PUSH_FAIL_LOG_INTERVAL` seconds as *Inventory push still failing (n times since …)*; a different reason is logged right away, and *Inventory pushed successfully again, after n failed attempt(s)* ends it. Other reasons: *server not reachable (…)*, *the server refused the agent key (HTTP 403)*, *server error (HTTP 500)*, *rejected by the server (HTTP 422): … (field …)*. Set `LOG_LEVEL=debug` in `config.env` to log the server's raw answer as well.

Before sending, the agent checks every section of the inventory (hardware, software, performance, …) with `jq`. A section whose collector produced invalid JSON is left out – the server keeps that section's last value – and the rest is sent; the log names the section. Files in `DIAG_DIR` (`/opt/octofleet-agent/diagnostics`, mode 700, files 600, so only root can read them):

| File | Content | Removed |
|------|---------|---------|
| `last-failed-push.json` | the inventory the server rejected (not written when the server was not reachable) | after the next successful push |
| `invalid-section-<name>.txt` | what the collector of a left-out section produced | when all sections are valid again |

The files can contain the node's inventory (installed software, users, network); share them only after checking them. The agent's numbers do not depend on the `awk` implementation (gawk, mawk, busybox): large values are printed with `printf "%.0f"`.

### Systemd Service

Create `/etc/systemd/system/octofleet-agent.service`:

```ini
[Unit]
Description=Octofleet Linux Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/octofleet-agent/agent.sh
Restart=always
RestartSec=30
EnvironmentFile=/opt/octofleet-agent/config.env

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable octofleet-agent
sudo systemctl start octofleet-agent
```

### Systems Without D-Bus

The service runs sandboxed (`ProtectSystem=strict`), so everything that changes the system – installing updates, refreshing package lists, writing `/etc/logrotate.d/octofleet-agent`, scheduling a reboot or the agent's own restart – runs as a short-lived systemd unit (`systemd-run`), outside the sandbox. Minimal systems (stripped-down vendor images, some cloud and container images) have no D-Bus system bus (`/run/dbus/system_bus_socket` missing). There `systemd-run --wait` fails with *Failed to connect to bus*. The agent then reaches systemd over its own socket (`/run/systemd/private`, root only), starts the unit without waiting and checks it every second until it has finished, with the same output and exit code; at the start it logs *No D-Bus system bus on this system: updates, reboots and logrotate run through systemd's private socket*. Nothing has to be installed for this.

If systemd cannot be reached at all, a job fails with one sentence that says so and how to fix it (install and start `dbus`, e.g. `apt-get install dbus; systemctl enable --now dbus`). Outside systemd, `shutdown -r` needs systemd-logind over D-Bus as well; the job then says so instead of only failing.

### Verify

```bash
# Check service status
sudo systemctl status octofleet-agent

# Follow logs
sudo journalctl -u octofleet-agent -f
```

---


## Rebooting a node from the console

**Reboot** on the node page and in *Patches → Fleet updates* sends a `reboot` job (permission `nodes:reboot`); see [Rebooting nodes](PATCH-MANAGEMENT.md#rebooting-nodes). The agent restarts the machine with the system's tool – Windows `shutdown /r /t <seconds>`, Linux `shutdown -r +<minutes>` (through a transient systemd unit, outside the service's sandbox; on systems without a D-Bus system bus a systemd timer that runs `systemctl reboot`, without a message to logged-on users) – so the reboot happens even if the agent stops, and logged-on users see the message. For the dialog's warning both agents add `loggedOnUsers` to their live data (Windows: Terminal Services sessions with a user; Linux: `loginctl list-sessions`, else `who`), read at most every 30 seconds. Agents older than this release show *logged-on users: unknown* and do not know the `reboot` job (it fails as an unknown command type on Linux and as a script without a command on Windows); update them first.

## Removing an Agent

Use **Remove node…** on the node's page in the console (requires the `nodes:delete` permission):

- **Uninstall agent** – the agent removes itself; the node stays in the console, marked as uninstalled, with its history.
- **Uninstall agent and delete node** – the node and all of its data are deleted once the agent has confirmed the uninstall.

If the agent never confirms (machine offline or gone), the node can be deleted anyway after a waiting period (`NODE_REMOVAL_FORCE_DELETE_HOURS`, default 24). A node whose agent reports again (machine reinstalled) becomes active again.

For machines the console cannot reach, run the uninstall script on the machine and then delete the node in the console:

```powershell
# Windows, as Administrator
.\scripts\Uninstall-OctofleetAgent.ps1
```

```bash
# Linux, as root
sudo ./linux-agent/uninstall.sh
```

Both remove the service, the program and data directories and the logs; on Windows also the screen helper task and the `DOTNET_BUNDLE_EXTRACT_BASE_DIR` machine variable. An agent installed by the MSI is uninstalled with `msiexec /x` first, so *Programs and Features* has no stale entry. `msiexec /x` alone (or your deployment tool) keeps the config and logs.

---

## Auto-Updates

The Windows agent includes an **AutoUpdater** that checks GitHub Releases periodically. When a new version is available:

1. Downloads the new release ZIP
2. Extracts to a staging directory
3. Schedules a deferred update (service restart required)
4. On next restart, the new version takes over

An agent installed by the MSI skips this: Windows Installer owns its files, and the service log says *"Self-update is off: the agent was installed by the Octofleet Agent MSI"*. Upgrade it by deploying the new MSI.

You can also trigger an update manually via a **restart-agent** job from the web UI. The Linux agent handles **restart-agent** too (through `systemd-run`, so the job reports its result before the service restarts) and updates itself at the next start.

On Linux nodes, **Search for updates** and **Install updates** on the node's Updates tab send `patch_scan` and `patch_install` jobs to the Linux agent. See [Patch Management](PATCH-MANAGEMENT.md#linux-nodes).

---

## Troubleshooting

### Agent not appearing in the dashboard

1. **Check the API URL** — must be reachable from the agent host:
   ```bash
   curl http://your-server:8080/health
   ```
2. **Check the API key** — must match the key configured on the server (`API_KEY` in `docker-compose.yml`)
3. **Check firewall** — port `8080` must be open between agent and server
4. **Check logs** — look for authentication errors (401/403)

### Agent polls but jobs stay "pending"

- Linux agent: the log says `Long-poll active` when the server wakes the agent; `The server has no long-poll` means an older server (the agent then polls every minute)

- Verify `InventoryApiUrl` and `InventoryApiKey` are set in `service-config.json`
- The agent polls as `win-{hostname}` (lowercase) — the backend resolves this to the node UUID
- Check backend logs for `GET /api/v1/jobs/pending/win-yourhost` requests

### "Invalid credentials" on first login

There is no default password. On the first start the backend uses `ADMIN_PASSWORD` from `.env` or, if it is not set, prints a one-time password: `docker compose logs backend | grep "One-time admin password"`. `ADMIN_PASSWORD` only applies on the very first start; later changes have no effect.

### Windows: Service won't start

- Check `C:\Windows\Logs\Octofleet\Agent.log`
- Check **Event Viewer → Windows Logs → Application** for .NET errors
- Verify `service-config.json` is valid JSON (no trailing commas!)
- Run manually to see console output:
  ```powershell
  & "C:\Program Files\Octofleet\OctofleetAgent.Service.exe"
  ```

### Config file location summary

| Platform | Config Path |
|----------|------------|
| Windows | `C:\ProgramData\Octofleet\service-config.json` |
| Windows (identity) | `C:\ProgramData\Octofleet\device-identity.json` |
| Linux | `/opt/octofleet-agent/config.env` |
