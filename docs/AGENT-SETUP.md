# Octofleet Agent Setup Guide

This guide covers installing and configuring the Octofleet agent on Windows and Linux nodes.

## Prerequisites

- A running Octofleet server (backend API accessible on port 8080)
- An API key (generate one under **Admin → API Keys** in the web UI, or use the key from your `.env` / `docker-compose.yml`)

## Windows Agent

### 1. Install

Download the latest release from [GitHub Releases](https://github.com/BenediktSchackenberg/octofleet/releases) and extract to `C:\Program Files\Octofleet\`.

Or use the PowerShell installer:

```powershell
# Basic install
.\Install-OpenClawAgent.ps1 -ApiUrl "http://your-server:8080" -ApiKey "your-api-key"

# With enrollment token (zero-touch)
.\Install-OpenClawAgent.ps1 -ApiUrl "http://your-server:8080" -EnrollToken "your-token"
```

### 2. Configure

The agent configuration lives at:

```
C:\ProgramData\Octofleet\service-config.json
```

Edit this file with the correct server URL and API key:

```json
{
  "ApiUrl": "http://your-server:8080",
  "ApiKey": "your-api-key",
  "NodeId": "",
  "PushIntervalSeconds": 1800,
  "JobPollIntervalSeconds": 60,
  "LiveDataIntervalSeconds": 5
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `ApiUrl` | Full URL to the Octofleet backend API (no trailing slash) | *required* |
| `ApiKey` | API key for authentication | *required* |
| `NodeId` | Override the node identifier (defaults to hostname if empty) | hostname |
| `PushIntervalSeconds` | How often to push full inventory data | `1800` (30 min) |
| `JobPollIntervalSeconds` | How often to poll for pending jobs | `60` (1 min) |
| `LiveDataIntervalSeconds` | How often to push live performance data | `5` |

### 3. Restart the service

```powershell
Restart-Service OctofleetNodeAgent
```

### 4. Verify

Check the logs at `C:\ProgramData\Octofleet\logs\` and confirm the node appears in the web UI under **Fleet → Nodes**.

---

## Linux Agent

### 1. Install

```bash
# Set your server URL and API key, then run the installer
API_URL="http://your-server:8080" API_KEY="your-api-key" sudo -E bash install.sh
```

Or install manually:

```bash
sudo mkdir -p /opt/octofleet-agent
sudo cp agent.sh /opt/octofleet-agent/
sudo cp config.env.example /opt/octofleet-agent/config.env
sudo chmod +x /opt/octofleet-agent/agent.sh
```

### 2. Configure

The agent configuration lives at:

```
/opt/octofleet-agent/config.env
```

```bash
# Octofleet Linux Agent Configuration

# API endpoint (no trailing slash)
API_URL="http://your-server:8080"

# API authentication key
API_KEY="your-api-key"

# Node identifier (defaults to hostname if empty)
NODE_ID=""

# Inventory push interval in seconds (default: 30 min)
PUSH_INTERVAL=1800

# Job polling interval in seconds (default: 1 min)
JOB_POLL_INTERVAL=60

# Live data push interval in seconds (default: 5 sec)
LIVE_DATA_INTERVAL=5

# Log file location
LOG_FILE="/var/log/octofleet-agent.log"
```

| Variable | Description | Default |
|----------|-------------|---------|
| `API_URL` | Full URL to the Octofleet backend API (no trailing slash) | *required* |
| `API_KEY` | API key for authentication | *required* |
| `NODE_ID` | Override the node identifier | hostname |
| `PUSH_INTERVAL` | Full inventory push interval (seconds) | `1800` |
| `JOB_POLL_INTERVAL` | Job poll interval (seconds) | `60` |
| `LIVE_DATA_INTERVAL` | Live data push interval (seconds) | `5` |
| `LOG_FILE` | Path to log file | `/var/log/octofleet-agent.log` |

### 3. Start the service

```bash
sudo systemctl enable octofleet-agent
sudo systemctl start octofleet-agent
```

### 4. Verify

```bash
# Check service status
sudo systemctl status octofleet-agent

# Follow the logs
sudo journalctl -u octofleet-agent -f

# Or check the log file directly
tail -f /var/log/octofleet-agent.log
```

---

## Troubleshooting

### Agent not appearing in the dashboard

1. **Check the API URL** — make sure it's reachable from the agent host:
   ```bash
   curl -v http://your-server:8080/health
   ```
2. **Check the API key** — must match the key configured on the server
3. **Check firewall** — port 8080 must be open between agent and server
4. **Check logs** — look for authentication errors (401/403)

### "Invalid credentials" on first login

The default admin account is only created if the database was seeded. When using Docker Compose, the seed file (`ci-seed.sql`) is mounted automatically. Default login: `admin` / `admin`.

### Agent shows HTTP 000 or connection refused

- Backend might not be running — check `docker compose ps` or `systemctl status`
- DNS/network issue — try using the IP address directly
- If behind a reverse proxy, ensure WebSocket/SSE connections are allowed

### Windows: Service won't start

- Check Event Viewer → Windows Logs → Application for .NET errors
- Verify `service-config.json` is valid JSON (no trailing commas)
- Run the executable manually to see console output:
  ```powershell
  & "C:\Program Files\Octofleet\OctofleetAgent.Service.exe"
  ```
