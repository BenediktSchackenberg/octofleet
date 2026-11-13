# Getting Started with Octofleet

Welcome to Octofleet! This guide will have you up and running in under 10 minutes.

## Prerequisites

- **Docker** and **Docker Compose** installed ([Get Docker](https://docs.docker.com/get-docker/))
- A machine with at least 2 GB RAM and 10 GB free disk space
- A modern web browser (Chrome, Firefox, Edge)

## Step 1: Clone and Start

```bash
git clone https://github.com/BenediktSchackenberg/octofleet.git
cd octofleet

# Required settings – docker compose refuses to start without them
cat > .env <<ENV
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
API_KEY=$(openssl rand -hex 24)
# Optional: your own initial admin password (12–72 characters, not "admin")
# ADMIN_PASSWORD=
ENV

docker compose up -d
```

Keep `.env` private: `API_KEY` is the key your agents use, `JWT_SECRET` signs login sessions.

This starts three containers:

| Container | Purpose | Port |
|-----------|---------|------|
| `octofleet-inventory-db` | PostgreSQL + TimescaleDB | 5432 (localhost only) |
| `octofleet-inventory-api` | FastAPI backend | 8080 |
| `octofleet-inventory-ui` | Next.js frontend | 3000 |

Wait about 30 seconds for everything to initialize, then open **http://localhost:3000** in your browser.

## Step 2: First Login

Log in as `admin`. The password is set on the first start:

- If `ADMIN_PASSWORD` is set in `.env` (12–72 characters, not "admin"), use that password. It is only used on the very first start – changing it later has no effect; change the password in the UI instead. If it is too short, the backend does not start and says so in its log.
- Otherwise the backend generates a one-time password and prints it to its log:

  ```bash
  docker compose logs backend | grep "One-time admin password"
  ```

  You are asked to choose a new password right after logging in.

## Step 3: Add Your First Node

Nodes are the endpoints (servers, workstations) that Octofleet manages. You have two options:

### Option A: Windows Agent

Open PowerShell as Administrator and run:

```powershell
iwr "https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1" -OutFile "$env:TEMP\install.ps1"
& "$env:TEMP\install.ps1" -GatewayUrl "http://your-server:8080" -GatewayToken "your-api-key"
```

The agent installs as a Windows service and starts sending inventory data automatically.

### Option B: Linux Agent

```bash
f=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh -o "$f" && \
  sudo bash "$f" --api-url http://your-server:8080 --api-key your-api-key
```

Replace `your-server` with your Octofleet server's IP/hostname and `your-api-key` with the `API_KEY` from your `.env`.

> 📖 For detailed agent setup, see [AGENT-SETUP.md](AGENT-SETUP.md).

### Verify the Node

After a minute or two, your new node should appear in the **Dashboard** at http://localhost:3000. Click on it to see hardware, software, and system information.

## Step 4: Run Your First Job

Jobs let you execute commands remotely on your managed nodes.

1. Navigate to **Jobs** in the sidebar
2. Click **Create Job**
3. Fill in:
   - **Name:** `Hello World`
   - **Target nodes:** Select your node
   - **Script type:** PowerShell (Windows) or Bash (Linux)
   - **Script:** `echo "Hello from Octofleet!"`
4. Click **Run**

The job will be picked up by the agent on its next poll cycle (default: 60 seconds). Check the job details page for output and status.

## Step 5: Explore

Now that you have a node reporting in, explore these features:

- **📊 Dashboard** — Fleet overview with health status and hotspot matrix
- **🖥️ Node Details** — Click any node for deep hardware/software inventory
  - **Collect inventory** asks the agent for a fresh inventory, instead of waiting for the next scheduled push.
  - The **Jobs** and **Patches** counts link to the node's own jobs and open patches.
  - The **Services** tab lists the services of Windows and Linux nodes. Linux nodes also have a **Linux** tab for their Linux-specific details.
  - The **Updates** tab of Windows nodes shows the last update search (WSUS or Windows Update), the installed updates with their status, and the update history.
  - A tab whose data the agent did not report stays visible with a notice, so a collection problem is not mistaken for an empty node.
- **🔒 Vulnerabilities** — Scan for CVEs across your fleet
- **📦 Packages** — Track and deploy software
- **🔐 Security Center** — File audit, behavior rules, and compliance monitoring
- **📈 Performance** — Real-time metrics and trend visualization
- **🩹 Patch Management** — Manage Windows updates with rings and compliance tracking *(new in v0.6.0)*
- **📐 Config Baselines** — CIS benchmarks with drift detection *(new in v0.6.0)*
- **📦 Content Lifecycle** — Repository management with Dev → Test → Prod pipelines *(new in v0.6.0)*
- **🔍 Query Engine** — Ask questions about your fleet with a visual query builder *(new in v0.6.0)*
- **📊 Software Metering** — License tracking and compliance *(new in v0.6.0)*

## Environment Variables

`.env` in the project root (see Step 1) holds the settings. For production, also restrict CORS (default `*`):

```bash
DB_PASSWORD=a-strong-database-password
JWT_SECRET=a-random-secret-for-jwt-tokens
API_KEY=your-chosen-api-key
CORS_ORIGINS=https://your-domain.com
```

See [CONFIGURATION.md](CONFIGURATION.md) for all available options.

## Stopping and Restarting

```bash
# Stop all services
docker compose down

# Stop and remove data (⚠️ destructive)
docker compose down -v

# Restart
docker compose up -d

# View logs
docker compose logs -f backend
```

## Next Steps

- 📖 [Architecture Overview](ARCHITECTURE.md) — How the system works
- 🔐 [Security Center Guide](SECURITY-CENTER.md) — File audit, behavior rules, findings
- 🩹 [Patch Management](PATCH-MANAGEMENT.md) — Windows update orchestration *(new in v0.6.0)*
- 📐 [Configuration Baselines](SECURITY-CENTER.md#configuration-baselines) — CIS benchmarks & drift detection *(new in v0.6.0)*
- 📦 [Content Lifecycle](CONTENT-LIFECYCLE.md) — Repository & environment management *(new in v0.6.0)*
- 🔍 [Query Engine](QUERY-ENGINE.md) — Fleet-wide query builder *(new in v0.6.0)*
- 📊 [Software Metering](SOFTWARE-METERING.md) — License tracking *(new in v0.6.0)*
- 🔧 [Configuration Reference](CONFIGURATION.md) — All environment variables
- 📡 [API Reference](API-REFERENCE.md) — REST API documentation
- 🌐 [PXE Provisioning](PXE-PROVISIONING.md) — Zero-touch OS deployment
- 🤖 [Agent Setup](AGENT-SETUP.md) — Detailed agent installation guide

## Troubleshooting

**Backend won't start?**
```bash
docker compose logs backend
```
Usually a database connection issue — make sure the `db` container is healthy first.

**Agent not showing up?**
- Verify the API URL is reachable from the agent machine
- Check that the API key matches between agent config and backend
- Check agent logs: Windows Event Viewer or `journalctl -u octofleet-agent` on Linux

**Port conflicts?**
Edit `docker-compose.yml` to change the exposed ports (e.g., `"3001:3000"` for the frontend).
