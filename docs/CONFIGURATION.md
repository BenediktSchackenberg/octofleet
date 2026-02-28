# Configuration Reference

All configuration in Octofleet is done through environment variables. This document covers every option for the backend, frontend, database, and agents.

## Docker Compose Environment Variables

Set these in a `.env` file in the project root, or directly in `docker-compose.yml`.

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PASSWORD` | `octofleet-secret-change-me` | PostgreSQL password for the `octofleet` user |

The database container uses these fixed values (change in `docker-compose.yml` if needed):

| Setting | Value |
|---------|-------|
| `POSTGRES_USER` | `octofleet` |
| `POSTGRES_DB` | `inventory` |
| Port | `5432` (bound to `127.0.0.1` only) |

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://octofleet:<DB_PASSWORD>@db:5432/inventory` | Full PostgreSQL connection string |
| `JWT_SECRET` | `change-this-in-production-please` | Secret key for signing JWT tokens. **Must be changed in production.** Use a random string of 32+ characters. |
| `API_KEY` | `your-api-key-here` | API key for agent authentication. Must match the key configured on agents. |
| `CORS_ORIGINS` | `*` | Allowed CORS origins. Use comma-separated URLs for production (e.g., `https://octofleet.example.com`). |
| `NVD_API_KEY` | *(none)* | NVD API key for vulnerability scanning. Get one free at [nvd.nist.gov](https://nvd.nist.gov/developers/request-an-api-key). Without it, scanning is rate-limited. |
| `OCTOFLEET_GATEWAY_URL` | `http://192.168.0.5:18789` | Gateway URL for inter-service communication |
| `OCTOFLEET_GATEWAY_TOKEN` | *(empty)* | Token for gateway authentication |

> ⚠️ **Important:** The backend uses `API_KEY` internally, but agents reference it as `INVENTORY_API_KEY` or `API_KEY` depending on the agent version. Make sure the values match.

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://192.168.0.49:8080` | Backend API URL as seen by the **browser** (public/external URL) |
| `API_URL` | `http://backend:8080` | Backend API URL for server-side rendering (Docker internal) |

> **Note:** `NEXT_PUBLIC_API_URL` must be reachable from the user's browser. If you access Octofleet at `https://octofleet.example.com`, set this to `https://octofleet.example.com:8080` (or route through your reverse proxy).

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
PUSH_INTERVAL=1800       # Inventory push interval in seconds (default: 30 min)
JOB_POLL_INTERVAL=60     # Job polling interval in seconds
LIVE_DATA_INTERVAL=5     # Live metrics interval in seconds
```

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | *(required)* | Backend API URL |
| `API_KEY` | *(required)* | API key for authentication |
| `NODE_ID` | hostname | Unique node identifier |
| `PUSH_INTERVAL` | `1800` | How often to push full inventory (seconds) |
| `JOB_POLL_INTERVAL` | `60` | How often to check for pending jobs (seconds) |
| `LIVE_DATA_INTERVAL` | `5` | How often to push live metrics (seconds) |

---

## PXE Provisioning

The PXE provisioning system runs as a separate Docker Compose stack in the `provisioning/` directory.

| Variable | Description |
|----------|-------------|
| DHCP range | Configured in dnsmasq — see `provisioning/` configs |
| TFTP root | iPXE binary location |
| HTTP server | Serves boot images (WIM, kernel, initrd) |

For full PXE setup, see [PXE-PROVISIONING.md](PXE-PROVISIONING.md).

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

# Frontend
NEXT_PUBLIC_API_URL=https://octofleet.example.com/api
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

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket (terminal, screen sharing)
    location /api/v1/terminal/ws/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

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
