# Octofleet Linux Agent 🐙

Lightweight bash-based agent for Linux systems. Collects inventory and pushes to the Octofleet API.

## Features

- **Inventory Collection**: Hardware, software, network, security info
- **Job Polling**: Execute scheduled jobs from the backend
- **Live Data**: Real-time CPU, memory, disk, network metrics
- **Auto-Update**: Self-update from GitHub releases
- **Systemd Integration**: Runs as a systemd service

## Quick Install

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

# Start live data streaming (for UI)
/opt/octofleet-agent/agent.sh live
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
