# Octofleet Deployment Guide

## Systemd Services (Linux)

### Backend API Service

**File:** `~/.config/systemd/user/openclaw-inventory.service`

```ini
[Unit]
Description=OpenClaw Inventory API
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/backend
ExecStart=/path/to/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8080
Restart=always
RestartSec=5

# NOTE: Do NOT use WatchdogSec - uvicorn doesn't support systemd watchdog notifications
# This caused random service kills after 30s
StartLimitIntervalSec=300
StartLimitBurst=10

Environment=INVENTORY_API_KEY=your-api-key
Environment=NVD_API_KEY=your-nvd-key

[Install]
WantedBy=default.target
```

### Frontend UI Service

**File:** `~/.config/systemd/user/openclaw-inventory-ui.service`

```ini
[Unit]
Description=OpenClaw Inventory Frontend
After=network.target openclaw-inventory.service

[Service]
Type=simple
WorkingDirectory=/path/to/frontend
# Use standalone server.js, NOT "next start" - it doesn't work with output: standalone
ExecStart=/usr/bin/node /path/to/frontend/.next/standalone/server.js
Restart=always
RestartSec=5

StartLimitIntervalSec=300
StartLimitBurst=10

Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_URL=http://localhost:8080

[Install]
WantedBy=default.target
```

### Important Notes

1. **No Watchdog for Simple Services**: `WatchdogSec` requires the service to send sd_notify() heartbeats. Neither uvicorn nor Node.js do this by default, so the watchdog will kill your service after the timeout.

2. **Next.js Standalone Mode**: When using `output: "standalone"` in next.config.js:
   - Use `node .next/standalone/server.js` instead of `next start`
   - Copy static files: `cp -r .next/static .next/standalone/.next/`
   - Copy public files: `cp -r public .next/standalone/`

3. **Service Management**:
   ```bash
   # Reload after config changes
   systemctl --user daemon-reload
   
   # Start/stop/restart
   systemctl --user start openclaw-inventory.service
   systemctl --user stop openclaw-inventory.service
   systemctl --user restart openclaw-inventory.service
   
   # Check status
   systemctl --user status openclaw-inventory.service
   
   # View logs
   journalctl --user -u openclaw-inventory.service -f
   ```

## Linux Agent

**Location:** `/opt/octofleet-agent/`

**Service:** `/etc/systemd/system/octofleet-agent.service`

**Config:** `/opt/octofleet-agent/config.env`

```bash
API_URL=http://your-server:8080
API_KEY=your-api-key
NODE_ID=hostname
PUSH_INTERVAL=1800
JOB_POLL_INTERVAL=60
LIVE_DATA_INTERVAL=5
LOG_FILE=/var/log/octofleet-agent.log
```

## Troubleshooting

### Service keeps restarting every 30 seconds
- Remove `WatchdogSec` from the service file
- Run `systemctl --user daemon-reload`

### Frontend shows "output: standalone" warning
- Change ExecStart to use `node .next/standalone/server.js`
- Ensure static and public files are copied to standalone directory

### Linux Agent shows HTTP 000 on job poll
- Check if backend is running and accessible from agent host
- Verify firewall allows port 8080
- Test with: `curl -v http://server:8080/api/v1/jobs/pending/node-id`
