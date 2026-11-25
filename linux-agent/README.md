# Octofleet Linux Agent 🐙

Lightweight bash-based agent for Linux systems. Collects inventory and pushes to the Octofleet API.

## Features

- **Inventory Collection**: Hardware, software, network, security info
- **Job Polling**: Execute scheduled jobs from the backend – `run` (a command, e.g. from "Start job"), `script`/`shell`, `inventory` (push the inventory now), `restart-agent`, `service_reconcile`, `uninstall-agent`, `patch_scan` (refresh the package lists and report the updates) and `patch_install` (install updates). See [Patch Management](../docs/PATCH-MANAGEMENT.md#linux-nodes).
- **Live Data**: Real-time CPU, memory, disk, network metrics
- **Auto-Update**: Self-update from the Octofleet server (every 6 hours)
- **Systemd Integration**: Runs as a systemd service

## Quick Install

From your Octofleet server (the installer, the agent and its systemd unit come
from the server; agent and unit are checked against the server's SHA256 sums):

```bash
curl -fsSL http://YOUR_SERVER:8080/api/v1/agent/releases/linux/install.sh -o ~/octofleet-install.sh && sudo bash ~/octofleet-install.sh \
  --api-url http://YOUR_SERVER:8080 \
  --api-key YOUR_API_KEY \
  --node-id $(hostname)
```

If the server does not provide the Linux agent, the installer falls back to
GitHub; it can also be started from GitHub directly:

```bash
curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh -o ~/octofleet-install.sh && sudo bash ~/octofleet-install.sh \
  --api-url http://YOUR_SERVER:8080 \
  --api-key YOUR_API_KEY \
  --node-id $(hostname)
```

## Manual Install

1. Copy files to `/opt/octofleet-agent/`
2. Copy `octofleet-agent.service` to `/etc/systemd/system/`
3. Edit `/opt/octofleet-agent/config.env`
4. Enable and start: `systemctl enable --now octofleet-agent`

## Configuration

Edit `/opt/octofleet-agent/config.env`:

```bash
API_URL="http://192.168.0.5:8080"
API_KEY="your-api-key"
NODE_ID="linux-server-01"
PUSH_INTERVAL=3600  # 60 minutes (default), spread over the interval
PUSH_RETRY_INTERVAL=60  # first retry of a failed push (doubles per failure, with jitter)
PUSH_FAIL_LOG_INTERVAL=3600  # a push failing for the same reason is logged again at most hourly
LOG_LEVEL=info  # debug, info, warn, error; debug also logs the server's raw answer to a rejected push
#LOG_LEVEL_UPDATES=debug  # the level of one component (LOG_LEVEL_<COMPONENT>, see Logs)
JOB_POLL_INTERVAL=60  # 1 minute
LIVE_DATA_INTERVAL=5  # 5 seconds (for live view)
POLL_IDLE_INTERVAL=5  # terminal and screen requests when idle; every second while a session is open
SESSION_ACTIVE_GRACE=60  # keep polling every second this long after a session
LONG_POLL=true  # one request the server holds until there is work; the polls above become a 10-min fallback
AUTO_UPDATE=true  # update agent.sh from the Octofleet server
UPDATE_CHECK_INTERVAL=21600  # 6 hours
```

## Updates

The agent checks `API_URL/api/v1/agent/releases/linux/latest` two minutes after
start and then every `UPDATE_CHECK_INTERVAL` seconds. The server offers the
`linux-agent/agent.sh` of its own checkout; when its `VERSION` is newer, the
agent downloads it, verifies the SHA256 and `bash -n`, replaces itself and exits
so systemd starts the new version. If the new file cannot be put in place, the
old version keeps running and the check is repeated later. No internet access is
needed.

To roll out a new agent version, update the server checkout (bump `VERSION` in
`agent.sh`). To update one machine right away (restarts the running service with
the new version):

```bash
sudo /opt/octofleet-agent/agent.sh update
```

## Collected Data

| Category | Data |
|----------|------|
| Hardware | CPU (maximum clock only when the CPU reports one), RAM, disks and volumes (used share as `df` shows it), display adapters, mainboard, BIOS; no SSD/HDD type on virtual machines |
| Software | Installed packages (apt/dnf/pacman) |
| Network | Interfaces, IPs, routes |
| Security | Users with a login shell, administrators (sudo/admin/wheel groups and sudoers entries), effective SSH settings (`sshd -T`), firewall (ufw, firewalld, or rules on incoming traffic in iptables/nftables), SELinux/AppArmor |
| System | OS, kernel, boot time and uptime (`os.lastBootTime` in UTC from the kernel's `btime`, `uptimeHours`, `uptimeFormatted`, as the Windows agent reports them), services |

## Commands

```bash
# Check status
systemctl status octofleet-agent

# View logs (one file per component, see Logs)
sudo tail -f /var/log/octofleet-agent/*.log
journalctl -u octofleet-agent -f

# Manual inventory push
/opt/octofleet-agent/agent.sh push

# Manual job poll
/opt/octofleet-agent/agent.sh poll

# Check for and install an update from the server
/opt/octofleet-agent/agent.sh update
```

## Logs

One file per component in `/var/log/octofleet-agent/`, with the Windows agent's component names: `Agent.log` (start, configuration, long-poll – and every warning and error of all components), `Inventory.log`, `Jobs.log`, `Updates.log` (update searches, installations, reboots), `Remediation.log`, `Security.log` (file audit), `LiveData.log`, `RemoteTools.log` (terminal, screen) and `SelfUpdate.log`. Each line: ISO 8601 time with offset, level, component, message – e.g. `2026-11-15T16:26:04.561+01:00 WARN [Jobs] Job 8f2c… (run) failed: exit code 3 after 2 s: disk full`. Every line also goes to the journal.

The level is `info`; `LOG_LEVEL` in `config.env` sets all components, `LOG_LEVEL_<COMPONENT>` one (`LOG_LEVEL_UPDATES=debug`, `LOG_LEVEL_REMOTETOOLS=warn`, …); restart the service after a change. logrotate rotates each file weekly or at 2 MB and keeps 4 (`LOG_ROTATE_MAXSIZE`, `LOG_ROTATE_COUNT`); the agent also runs logrotate itself after writing 2 MB. An older agent's `/var/log/octofleet-agent.log` moves into the folder as `octofleet-agent.log.0` and becomes a link to `Agent.log`. Details: [docs/AGENT-SETUP.md](../docs/AGENT-SETUP.md#logs).

## Migration from OpenClaw Agent

If you have the old `openclaw-agent` installed:

```bash
# Stop and disable old service
sudo systemctl stop openclaw-agent
sudo systemctl disable openclaw-agent

# Remove old files
sudo rm -rf /opt/openclaw-agent
sudo rm /etc/systemd/system/openclaw-agent.service
sudo systemctl daemon-reload

# Install new agent
curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh -o ~/octofleet-install.sh && sudo bash ~/octofleet-install.sh \
  --api-url http://YOUR_SERVER:8080 \
  --api-key YOUR_API_KEY
```

## Uninstall

Use **Remove node…** in the Octofleet console, or run `sudo ./uninstall.sh` on the machine and then delete the node in the console. Both stop and disable the service and remove the unit, `/opt/octofleet-agent` and the logs (`/var/log/octofleet-agent`).

## Requirements

- bash 4.0+
- curl
- jq
- systemd (optional, for service)
