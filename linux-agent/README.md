# Octofleet Linux Agent

Lightweight bash-based agent for Linux systems. Collects inventory and pushes to the Octofleet API.

## Features

- **Inventory Collection**: Hardware, software, network, security info
- **Job Polling**: Execute scheduled jobs from the backend
- **Auto-Update**: Self-update from GitHub releases
- **Systemd Integration**: Runs as a systemd service

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/linux-agent/install.sh | sudo bash -s -- \
  --api-url http://YOUR_SERVER:8080 \
  --api-key YOUR_API_KEY \
  --node-id $(hostname)
```

## Manual Install

1. Copy files to `/opt/openclaw-agent/`
2. Copy `openclaw-agent.service` to `/etc/systemd/system/`
3. Edit `/opt/openclaw-agent/config.env`
4. Enable and start: `systemctl enable --now openclaw-agent`

## Configuration

Edit `/opt/openclaw-agent/config.env`:

```bash
API_URL="http://192.168.0.5:8080"
API_KEY="openclaw-inventory-dev-key"
NODE_ID="linux-server-01"
PUSH_INTERVAL=1800  # 30 minutes
JOB_POLL_INTERVAL=60  # 1 minute
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
systemctl status openclaw-agent

# View logs
journalctl -u openclaw-agent -f

# Manual inventory push
/opt/openclaw-agent/agent.sh push

# Manual job poll
/opt/openclaw-agent/agent.sh poll
```

## Requirements

- bash 4.0+
- curl
- jq
- systemd (optional, for service)
