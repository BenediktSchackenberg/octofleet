# Configuration Reference

All configuration in Octofleet is done through environment variables. This document covers every option for the backend, frontend, database, and agents.

## Docker Compose Environment Variables

Set these in a `.env` file in the project root, or directly in `docker-compose.yml`.

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PASSWORD` | *(required)* | PostgreSQL password for the `octofleet` user. `docker compose` refuses to start without it. |

The database container uses these fixed values (change in `docker-compose.yml` if needed):

| Setting | Value |
|---------|-------|
| `POSTGRES_USER` | `octofleet` |
| `POSTGRES_DB` | `inventory` |
| Port | `5432` (bound to `127.0.0.1` only) |

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://octofleet:<DB_PASSWORD>@db:5432/inventory` | Full PostgreSQL connection string (set by `docker-compose.yml` from `DB_PASSWORD`) |
| `JWT_SECRET` | *(required)* | Secret key for signing login sessions. Use a random string of 32+ characters, e.g. `openssl rand -hex 32`. |
| `API_KEY` | *(required)* | API key for agent authentication. Must match the key configured on agents. Every managed machine stores it, so it has the agent's permissions only (inventory, job polls and results); administrative actions need a user login or an API key from **API Keys** (`/api-keys`). |
| `ADMIN_PASSWORD` | *(empty)* | Password of the `admin` user, used only on the very first start (12–72 characters, not `admin`; otherwise the backend does not start). Empty: the backend prints a one-time password to its log and asks for a new one after the first login. |
| `CORS_ORIGINS` | `*` | Allowed CORS origins. Use comma-separated URLs for production (e.g., `https://octofleet.example.com`). |
| `LOG_LEVEL` | `info` | Backend log level until the setting from **Admin → Logging** is loaded at startup (`error`, `warning`, `info`, `debug`); see [Logging](#logging). |
| `AGENT_WAIT_SECONDS` | `55` | Longest hold time of the agents' long-poll (`GET /api/v1/agent/wait/{node_id}`, see [AGENT-SETUP.md](AGENT-SETUP.md#long-poll)); keep it below the idle limit of a proxy in front of the backend. |
| `LOG_MAX_SIZE` / `LOG_MAX_FILE` | `20m` / `5` | Docker log rotation per container (db, backend, frontend): size of one log file and how many are kept. |
| `OCTOFLEET_GATEWAY_URL` | *(empty)* | Gateway URL for inter-service communication |
| `OCTOFLEET_GATEWAY_TOKEN` | *(empty)* | Token for gateway authentication |

The NVD API key for vulnerability scanning is set in the UI under **Settings → NVD API Key** (get one free at [nvd.nist.gov](https://nvd.nist.gov/developers/request-an-api-key); without it, scanning is rate-limited). `docker-compose.yml` does not pass an `NVD_API_KEY` variable to the backend.

The vulnerability scan checks Windows applications against NVD and Linux distribution packages against [OSV](https://osv.dev) (`api.osv.dev`); the backend needs outbound HTTPS to both. Short failures of either service (HTTP 429, 5xx, connection errors) are retried twice. A software version that still cannot be checked keeps its previous findings, and the scan ends as **Partial** with the number of such versions (automatic remediation is skipped for that scan) instead of failing as a whole.

Vulnerability numbers (dashboard, vulnerabilities page, sidebar badges) come from a cache per node that the backend recalculates when a node's findings can change (see [API reference](API-REFERENCE.md#vulnerabilities--remediation)). `VULNERABILITY_CACHE_WORKERS` (default `2`) sets how many nodes are recalculated at the same time; more workers make a full recalculation (first start, the ↻ button) faster but put more load on the database. Set it in the backend's `environment:` in `docker-compose.yml` if needed.

OSV advisories are cached in the database (table `osv_advisories`): a later scan downloads an advisory again only when OSV reports a different change date for it, or when the entry is older than 30 days, so repeated scans need a few requests instead of one per advisory. The first scan after an update fills the cache. **Vulnerabilities → Scan history → OSV advisory cache** shows the entries and offers (with `settings:write`):

- **Verify (50 random):** downloads 50 random cached advisories again and compares them; entries that differ are corrected, removed advisories are dropped.
- **Full scan without cache:** a scan that downloads and stores every advisory again.
- **Clear cache:** deletes all entries; the next scan downloads everything again.

The scan history shows per scan how many advisories were downloaded and how many came from the cache. A scan that downloaded everything (the first one, a full scan without cache, or the first after clearing) is marked **Cache rebuilt** or **Without cache** – it takes longer than the scans that use the cache. The cache card shows when it was last rebuilt.

> ℹ️ **Note:** The backend uses `API_KEY` internally (with fallback to `INVENTORY_API_KEY` for backward compatibility). Use `API_KEY` for all new deployments. Both agent types reference this as their authentication token.

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_API_URL` | *(empty)* | Backend URL as seen by the **browser**, without `/api` (e.g. `https://api.example.com`). Read when the page loads, so changing it needs only a container restart, not a rebuild. |
| `API_URL` | `http://backend:8080` | Backend API URL for server-side rendering (Docker internal) |

Where the browser sends API requests and WebSockets:

1. `BROWSER_API_URL`, if set (or `NEXT_PUBLIC_API_URL`, if it was set when the image was **built** – at runtime it has no effect).
2. UI opened on port **3000** (default `docker-compose.yml` without a reverse proxy): the same host on port **8080**, as before.
3. Otherwise – UI opened through a reverse proxy, e.g. `https://octofleet.example.com` – the page's own address: `/api/v1/...` and `wss://octofleet.example.com/api/v1/.../ws/...`. The proxy forwards `/api/` to the backend (see [Reverse Proxy](#reverse-proxy-nginx-example)); no second port is needed.

`BROWSER_API_URL` must be reachable from the user's browser. *Settings → System → API URL* shows the address in use.

---

## Agent Configuration

### Windows Agent

Configuration file: `C:\ProgramData\Octofleet\service-config.json`

```json
{
  "GatewayUrl": "http://your-server:8080",
  "GatewayToken": "your-api-key"
}
```

| Field | Description |
|-------|-------------|
| `GatewayUrl` | Backend API URL |
| `GatewayToken` | API key (must match backend's `API_KEY`) |

### Linux Agent

Configuration file: `/opt/octofleet-agent/config.env`

```bash
API_URL="http://your-server:8080"
API_KEY="your-api-key"
NODE_ID=""               # Defaults to hostname if empty
PUSH_INTERVAL=3600       # Inventory push interval in seconds (default: 60 min, spread)
JOB_POLL_INTERVAL=60     # Job polling interval in seconds
LIVE_DATA_INTERVAL=5     # Live metrics interval in seconds
POLL_IDLE_INTERVAL=5     # Terminal/screen requests when idle, in seconds
SESSION_ACTIVE_GRACE=60  # Poll every second this long after a session, in seconds
LONG_POLL=true           # One held request instead of the idle polls (false: off)
```

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | *(required)* | Backend API URL |
| `API_KEY` | *(required)* | API key for authentication |
| `NODE_ID` | hostname | Unique node identifier |
| `PUSH_INTERVAL` | `3600` | How often to push full inventory (seconds); spread over the interval (see AGENT-SETUP.md) |
| `JOB_POLL_INTERVAL` | `60` | How often to check for pending jobs (seconds) |
| `LIVE_DATA_INTERVAL` | `5` | How often to push live metrics (seconds) |
| `POLL_IDLE_INTERVAL` | `5` | How often to ask for terminal commands and screen sessions while none is open (seconds, ±1 s). While a terminal page for the node is open: every second. A new session waits up to this long |
| `SESSION_ACTIVE_GRACE` | `60` | How long the agent keeps polling every second after a session (seconds) |
| `LONG_POLL` | `true` | One request the server holds until there is work for the node; the job, terminal and screen polls then run only every `LONG_POLL_FALLBACK_INTERVAL` (`600`) seconds. Servers without it: the polls above. Details and further settings: [AGENT-SETUP.md](AGENT-SETUP.md#long-poll) |

---

## PXE Provisioning

Use **Settings → Provisioning** to configure PXE/API/NFS addresses, DNS defaults, ISO and boot storage, VM storage, SMB shares and PXE service options. Values are persisted centrally and used by new tasks and generated boot scripts.

The PXE server remains a separate Compose stack. Export its configuration from the menu and recreate the container to apply service and mount changes. See [Provisioning configuration](PROVISIONING-CONFIGURATION.md) for the exact workflow and supported environment variables.

---

## Production Recommendations

### Security Checklist

1. **Change all default passwords and secrets:**
   ```bash
   # Generate secure values
   openssl rand -hex 32  # For JWT_SECRET
   openssl rand -hex 24  # For DB_PASSWORD
   openssl rand -hex 24  # For API_KEY
   ```

2. **Restrict CORS origins:**
   ```bash
   CORS_ORIGINS=https://octofleet.yourdomain.com
   ```

3. **Use a reverse proxy with TLS** (nginx, Caddy, Traefik)

4. **Keep the database port local** (already `127.0.0.1:5432` by default)

5. **Set up an NVD API key** for reliable vulnerability scanning

### Example Production `.env`

```bash
# Database
DB_PASSWORD=s3cur3-r4nd0m-p4ssw0rd-h3r3

# Backend
JWT_SECRET=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
API_KEY=your-production-api-key-here
CORS_ORIGINS=https://octofleet.example.com
NVD_API_KEY=your-nvd-api-key

# Frontend: leave BROWSER_API_URL empty behind the reverse proxy below
# (the UI then calls the API on its own address)
```

### Reverse Proxy (nginx example)

```nginx
server {
    listen 443 ssl;
    server_name octofleet.example.com;

    ssl_certificate     /etc/ssl/certs/octofleet.pem;
    ssl_certificate_key /etc/ssl/private/octofleet.key;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API – no path after the port, so /api/v1/... reaches the backend unchanged
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # live data and progress streams (server-sent events)
        proxy_read_timeout 1h;
        client_max_body_size 5g;      # package uploads (OCTOFLEET_MAX_FILE_SIZE)
    }

    # WebSockets: remote shell, screen sharing, terminal (browser and agent side)
    location ~ ^/api/v1/(shell|screen|terminal)/ws/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
    }
}
```

Open the UI at `https://octofleet.example.com` (not on port 3000) and leave `BROWSER_API_URL` empty: the UI then calls `https://octofleet.example.com/api/v1/...` and opens its WebSockets with `wss://` on the same address. Set `CORS_ORIGINS=https://octofleet.example.com`. Agents can keep using `http://<server>:8080` as long as that port stays reachable, or use `https://octofleet.example.com` as their API URL (with a certificate the node trusts).

---

## Settings API

Runtime settings can be managed via the API without restarting services:

```bash
# List all settings
curl -H "X-API-Key: your-key" http://localhost:8080/api/v1/settings

# Get a specific setting
curl -H "X-API-Key: your-key" http://localhost:8080/api/v1/settings/nvd_api_key

# Update a setting
curl -X PUT -H "X-API-Key: your-key" -H "Content-Type: application/json" \
  -d '{"value": "new-value"}' \
  http://localhost:8080/api/v1/settings/nvd_api_key
```

---

## Docker Compose Customization

### Changing Ports

Edit `docker-compose.yml`:

```yaml
services:
  backend:
    ports:
      - "9090:8080"  # Change external port to 9090
  frontend:
    ports:
      - "3001:3000"  # Change external port to 3001
```

### Persistent Data

Database data is stored in the `postgres_data` Docker volume. To back up:

```bash
docker exec octofleet-inventory-db pg_dump -U octofleet inventory > backup.sql
```

To restore:

```bash
cat backup.sql | docker exec -i octofleet-inventory-db psql -U octofleet inventory
```

### Data Retention

Security events, file audit events, performance data and hardware changes are kept for a set time and older data is compressed: by default 30 / 90 / 30 / 365 days, compressed after 7 days (hardware changes not). Fresh installations apply these defaults immediately. Upgrades preserve existing database jobs until an admin explicitly activates each data type under **Admin → Retention**. Once activated, changes apply immediately as TimescaleDB jobs that drop whole chunks daily. See [Security Center – Retention & Legal Hold](SECURITY-CENTER.md#retention--legal-hold).

Plan disk space with this in mind: on a test installation one Windows node with the network sensor on produced about 400,000 security events (about 180 MB, 11 MB compressed) per day.

### Logging

The backend writes its log to stdout. With Docker Compose (`docker compose logs backend`) Docker keeps it per container in JSON files that are rotated at `LOG_MAX_SIZE` with `LOG_MAX_FILE` files kept (default 20 MB × 5 per container); before, the files had no limit and grew until the container was recreated. Without Docker ([systemd services](DEPLOYMENT.md), or `uvicorn` started by hand) the output goes where the service manager sends it – with systemd to the journal (`journalctl --user -u <unit>`), which rotates by its own limits (`SystemMaxUse` in `journald.conf`); `LOG_MAX_SIZE`/`LOG_MAX_FILE` do not apply there. The settings below and `LOG_LEVEL` work the same either way.

**Admin → Logging** (`/settings/logging`, `settings:read` to view, `settings:write` to change; changes are audited as `settings.logging`) sets, without a restart:
- **Log level**: `error`, `warning`, `info` (default) or `debug` for the backend's own messages. Debug writes much more – switch it back after troubleshooting.
- **One line per HTTP request**: every request (default, as before), only errors (status ≥ 400) and requests slower than a threshold (default 1,000 ms), or off. A line holds method, path without the query string (tokens in URLs no longer reach the log), status, duration and client address: `GET /api/v1/jobs/pending/<node> 200 2.4 ms 10.0.0.5`. It replaces uvicorn's access line, which had no duration.

Lines are formatted and written by a background thread, so a request does not wait for the log. API: `GET`/`PUT /api/v1/settings/logging` with `{"level", "access_log": "all" | "errors_slow" | "off", "slow_ms"}`.

**What a line per request costs** (measured on a test installation, 8 vCPU, simulated agents polling `GET /api/v1/terminal/pending/<node>`):

| Access log | CPU per request | Most requests per second (backend at one full core) | Log per request |
|---|---|---|---|
| Every request | about 0.87 ms | about 1,000 | about 116 bytes |
| Errors and slow only, or off | about 0.79 ms | about 1,040 | – |

A line per request costs about 5–10 % of the backend's CPU per request and about 4 % of its maximum rate; latencies at 200 and 600 requests per second were the same. The limit is the single backend process (about 1,000 agent polls per second), not the log. The log volume matters more: at 1,000 requests per second every request means about 7 MB per minute, so the default rotation (100 MB per container) holds about a quarter of an hour – with many nodes choose *errors and slow requests* or raise `LOG_MAX_SIZE`/`LOG_MAX_FILE`.

### Resource Limits

For constrained environments, add resource limits:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 512M
  db:
    deploy:
      resources:
        limits:
          memory: 1G
```
