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
  "ScheduledPushIntervalMinutes": 30
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
| `ScheduledPushIntervalMinutes` | Inventory push interval in minutes | `30` | No |
| `RepoUrl` | Custom URL for the software repository | Auto-detected | No |
| `PreferRepo` | Check local repo before external download URLs | `true` | No |
| `FallbackToSource` | Fall back to source URL if package not in repo | `true` | No |

> **Important:** `InventoryApiUrl` and `InventoryApiKey` are required for the agent to function. Without them, the agent will not push inventory data or poll for jobs.

#### `device-identity.json`

This file is **auto-generated** on first run and contains the device's unique identity (cryptographic key pair). Do not edit or delete this file — it is used for secure device authentication.

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
  "ScheduledPushIntervalMinutes": 30
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
| **GatewayConnector** | `GatewayUrl` | WebSocket connection for remote terminal/screen/shell access |
| **AutoUpdater** | Internet | Checks GitHub Releases for agent updates and self-updates |

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

2. Check logs at `C:\ProgramData\Octofleet\logs\`

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

# Optional: Inventory push interval in seconds (default: 30 min)
PUSH_INTERVAL=1800

# Optional: Log file location
LOG_FILE="/var/log/octofleet-agent.log"
```

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `API_URL` | URL to the Octofleet backend API | — | **Yes** |
| `API_KEY` | API key for authentication | — | **Yes** |
| `NODE_ID` | Override node identifier | hostname | No |
| `PUSH_INTERVAL` | Full inventory push interval (seconds) | `1800` | No |
| `LOG_FILE` | Path to log file | `/var/log/octofleet-agent.log` | No |

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

### Verify

```bash
# Check service status
sudo systemctl status octofleet-agent

# Follow logs
sudo journalctl -u octofleet-agent -f
```

---

## Auto-Updates

The Windows agent includes an **AutoUpdater** that checks GitHub Releases periodically. When a new version is available:

1. Downloads the new release ZIP
2. Extracts to a staging directory
3. Schedules a deferred update (service restart required)
4. On next restart, the new version takes over

You can also trigger an update manually via a **restart-agent** job from the web UI.

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

- Verify `InventoryApiUrl` and `InventoryApiKey` are set in `service-config.json`
- The agent polls as `win-{hostname}` (lowercase) — the backend resolves this to the node UUID
- Check backend logs for `GET /api/v1/jobs/pending/win-yourhost` requests

### "Invalid credentials" on first login

Default admin credentials: `admin` / `admin` (created by the database seed file).

### Windows: Service won't start

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
