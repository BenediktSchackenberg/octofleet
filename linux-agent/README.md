# Octofleet Linux Agent 🐙

Lightweight bash-based agent for Linux systems. Collects inventory and pushes to the Octofleet API.

## Features

- **Inventory Collection**: Hardware, software, network, security info
- **Job Polling**: Execute scheduled jobs from the backend
- **Live Data**: Real-time CPU, memory, disk, network metrics
- **Auto-Update**: Self-update from the Octofleet server (every 6 hours)
- **Systemd Integration**: Runs as a systemd service

## Quick Install

From your Octofleet server (the installer, the agent and its systemd unit come
from the server; agent and unit are checked against the server's SHA256 sums):

```bash
curl -fsSL http://YOUR_SERVER:8080/api/v1/agent/releases/linux/install.sh | sudo bash -s -- \
  --api-url http://YOUR_SERVER:8080 \
  --api-key YOUR_API_KEY \
  --node-id $(hostname)
```

If the server does not provide the Linux agent, the installer falls back to
GitHub; it can also be started from GitHub directly:

```bash
curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh | sudo bash -s -- \
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
PUSH_INTERVAL=1800  # 30 minutes
JOB_POLL_INTERVAL=60  # 1 minute
LIVE_DATA_INTERVAL=5  # 5 seconds (for live view)
AUTO_UPDATE=true  # update agent.sh from the Octofleet server
UPDATE_CHECK_INTERVAL=21600  # 6 hours
```

## Updates

The agent checks `API_URL/api/v1/agent/releases/linux/latest` two minutes after
start and then every `UPDATE_CHECK_INTERVAL` seconds. The server offers the
`linux-agent/agent.sh` of its own checkout; when its `VERSION` is newer, the
agent downloads it, verifies the SHA256 and `bash -n`, replaces itself and exits
so systemd starts the new version. No internet access is needed.

`install.sh` also installs from the Octofleet server when it offers a Linux
agent: it verifies the SHA256 of both `agent.sh` and `octofleet-agent.service`
and stops if a download or a checksum fails. Only when the server has no Linux
agent does it fall back to GitHub.

To roll out a new agent version, update the server checkout (bump `VERSION` in
`agent.sh`). To update one machine right away:

```bash
sudo /opt/octofleet-agent/agent.sh update && sudo systemctl restart octofleet-agent
```

## Collected Data

| Category | Data |
|----------|------|
| Hardware | CPU, RAM, disks, motherboard |
| Software | Installed packages (apt/dnf/pacman) |
| Network | Interfaces, IPs, routes |
| Security | Users, sudo, SSH config, firewall |
| System | OS, kernel, uptime, services |

## Commands

```bash
# Check status
systemctl status octofleet-agent

# View logs
journalctl -u octofleet-agent -f

# Manual inventory push
/opt/octofleet-agent/agent.sh push

# Manual job poll
/opt/octofleet-agent/agent.sh poll

# Check for and install an update from the server
/opt/octofleet-agent/agent.sh update
```

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
curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh | sudo bash -s -- \
  --api-url http://YOUR_SERVER:8080 \
  --api-key YOUR_API_KEY
```

## Requirements

- bash 4.0+
- curl
- jq
- systemd (optional, for service)
