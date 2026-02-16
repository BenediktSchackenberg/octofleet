# Quick Start Guide

Get Octofleet Inventory running in under 5 minutes!

## Option 1: Docker Compose (Recommended)

The fastest way to get started:

```bash
# Clone the repository
git clone https://github.com/BenediktSchackenberg/octofleet-windows-agent.git
cd octofleet-windows-agent

# Copy and edit environment variables
cp .env.example .env
nano .env  # Change passwords!

# Start all services
docker compose up -d

# Check status
docker compose ps
```

Open http://localhost:3000 - Default login: `admin` / `admin`

## Option 2: Manual Setup

### Prerequisites

- Ubuntu 22.04+ (or similar Linux)
- PostgreSQL 16 with TimescaleDB
- Python 3.12+
- Node.js 20+
- Octofleet Gateway

### Step 1: Database

```bash
# Install TimescaleDB (Ubuntu)
sudo apt install -y gnupg postgresql-common apt-transport-https lsb-release wget
echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -c -s) main" | \
  sudo tee /etc/apt/sources.list.d/timescaledb.list
wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey | sudo apt-key add -
sudo apt update
sudo apt install -y postgresql-16 timescaledb-2-postgresql-16

# Configure
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql

# Create database
sudo -u postgres psql << EOF
CREATE USER octofleet WITH PASSWORD 'your-password';
CREATE DATABASE inventory OWNER octofleet;
\c inventory
CREATE EXTENSION IF NOT EXISTS timescaledb;
EOF

# Apply schema
psql -U octofleet -d inventory -f backend/schema.sql
```

### Step 2: Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL="postgresql://octofleet:your-password@localhost:5432/inventory"
export JWT_SECRET="$(openssl rand -base64 32)"
export API_KEY="your-api-key"

uvicorn main:app --host 0.0.0.0 --port 8080
```

### Step 3: Frontend

```bash
cd frontend
npm install
npm run build
npm start
```

### Step 4: Octofleet Gateway

```bash
npm install -g octofleet
octofleet init
octofleet gateway start
```

## Installing Agents

### Windows

Run as Administrator:

```powershell
irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet-windows-agent/main/installer/Install-OctofleetAgent.ps1 -OutFile Install.ps1
.\Install.ps1 -GatewayUrl "http://YOUR-SERVER:18789" -GatewayToken "your-token"
```

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet-windows-agent/main/linux-agent/install.sh | \
  sudo bash -s -- --api-url http://YOUR-SERVER:8080 --api-key YOUR-API-KEY
```

## Next Steps

1. **Create your first group**: Go to Groups → New Group
2. **Add a package**: Go to Packages → New Package
3. **Deploy software**: Go to Deployments → New Deployment
4. **Set up alerts**: Go to Alerts → Channels → Add Discord/Slack webhook

## Troubleshooting

### Agent won't connect

- Check firewall: ports 8080, 3000, 18789 must be open
- Verify Gateway is running: `octofleet status`
- Check agent logs: `journalctl -u octofleet-agent` (Linux) or Event Viewer (Windows)

### Database errors

- Ensure TimescaleDB extension is enabled: `\dx` in psql should show `timescaledb`
- Check connection: `psql -U octofleet -d inventory -c "SELECT 1"`

### Frontend shows "Unauthorized"

- Clear browser cache and cookies
- Login again with admin/admin
- Check JWT_SECRET is set in backend

---

Need help? Join our [Discord](https://discord.com/invite/clawd)!
