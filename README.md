# OpenClaw Inventory Platform 🖥️📊

> **Beta (v0.4.0)** — An open-source endpoint management and inventory system for Windows fleets. Collect hardware/software inventory, deploy packages, run remote commands, and monitor your infrastructure from a central dashboard.

[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![Windows](https://img.shields.io/badge/Windows-10%2F11%2FServer-0078D6?style=flat-square&logo=windows)](https://www.microsoft.com/windows)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## 🎯 What is this?

OpenClaw Inventory is an **endpoint management platform** that helps you:

- **See what's installed** on all your Windows machines (hardware, software, updates)
- **Deploy software** remotely (MSI/EXE packages with silent install)
- **Run commands** on any machine from a central dashboard
- **Group and organize** your devices
- **Track security posture** (firewall, BitLocker, UAC, local admins)

Think of it as a lightweight alternative to SCCM/Intune for smaller environments, labs, or homelabs.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (Next.js)                   │
│         http://your-server:3000                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend API (FastAPI)                      │
│         http://your-server:8080                              │
│         • Inventory storage (PostgreSQL + TimescaleDB)       │
│         • Job queue and execution tracking                   │
│         • Package catalog                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                           │
│         http://your-server:18789                             │
│         • Node communication hub                             │
│         • Command routing                                    │
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌──────────┐      ┌──────────┐      ┌──────────┐
      │ Windows  │      │ Windows  │      │ Windows  │
      │  Agent   │      │  Agent   │      │  Agent   │
      │  (PC 1)  │      │  (PC 2)  │      │  (PC N)  │
      └──────────┘      └──────────┘      └──────────┘
```

---

## ✨ Features

### 📊 Inventory Collection
The Windows Agent automatically collects and reports:

| Category | Data Collected |
|----------|----------------|
| **Hardware** | CPU, RAM, GPU, Disks, Mainboard, BIOS/UEFI, TPM |
| **Software** | All installed applications with versions & publishers |
| **Updates** | Windows Hotfixes + Update History |
| **Security** | Firewall, BitLocker, UAC, TPM, Secure Boot, Local Admins |
| **Network** | Adapters, IPs, Active connections, Listening ports |
| **Browser** | Extensions, Cookies metadata, History count (Chrome/Edge/Firefox) |

### 📦 Package Deployment
Deploy software to your fleet:
- Create packages with download URLs in the catalog
- Select target devices or groups
- Silent MSI/EXE installation
- Progress tracking and logs
- Retry failed installations

### 🎮 Remote Command Execution
Run any command on your Windows machines:
- PowerShell, CMD, or any executable
- Real-time output capture
- Timeout handling
- Job queue with priority

### 🌐 Web Dashboard
Modern Next.js dashboard with:
- **Node Tree** — Browse devices by group hierarchy
- **Global Search** — Find any device instantly
- **Inline Details** — View device info without page navigation
- **8 Detail Tabs** — Overview, Hardware, Software, Security, Network, Browser, Updates, Groups

### 🔗 Persistent Connection
- Windows Service runs 24/7 in background
- Auto-reconnects if connection drops
- Survives reboots
- Unique node ID per machine

---

## 🚀 Server Setup (Complete Guide)

This guide walks you through setting up the entire platform on a Linux server.

### Prerequisites

| Component | Version | Purpose |
|-----------|---------|---------|
| **Ubuntu Server** | 22.04+ | Host OS |
| **PostgreSQL** | 16+ | Database |
| **TimescaleDB** | 2.x | Time-series extension for metrics |
| **Python** | 3.12+ | Backend API |
| **Node.js** | 20+ | Frontend Dashboard |
| **OpenClaw Gateway** | Latest | Node communication |

### Step 1: Install PostgreSQL + TimescaleDB

```bash
# Add TimescaleDB repository
sudo apt install -y gnupg postgresql-common apt-transport-https lsb-release wget
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -c -s) main" | sudo tee /etc/apt/sources.list.d/timescaledb.list
wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey | sudo apt-key add -
sudo apt update

# Install PostgreSQL 16 with TimescaleDB
sudo apt install -y postgresql-16 timescaledb-2-postgresql-16

# Enable TimescaleDB
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql

# Create database
sudo -u postgres psql -c "CREATE USER openclaw WITH PASSWORD 'your-secure-password';"
sudo -u postgres psql -c "CREATE DATABASE inventory OWNER openclaw;"
sudo -u postgres psql -d inventory -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
```

### Step 2: Clone and Setup Backend

```bash
# Clone repository
git clone https://github.com/BenediktSchackenberg/openclaw-windows-agent.git
cd openclaw-windows-agent

# Setup Python virtual environment
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure database connection (edit main.py or use environment variables)
export DATABASE_URL="postgresql://openclaw:your-secure-password@localhost:5432/inventory"

# Initialize database schema (tables are auto-created on first run)
# Start the backend
uvicorn main:app --host 0.0.0.0 --port 8080
```

**For production**, create a systemd service:

```bash
sudo tee /etc/systemd/system/openclaw-inventory.service << 'EOF'
[Unit]
Description=OpenClaw Inventory API
After=network.target postgresql.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/openclaw-windows-agent/backend
Environment="DATABASE_URL=postgresql://openclaw:your-secure-password@localhost:5432/inventory"
ExecStart=/path/to/openclaw-windows-agent/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8080
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-inventory
```

### Step 3: Setup Frontend

```bash
cd ../frontend
npm install

# Development
npm run dev

# Production build
npm run build
npm start
```

**For production**, create a systemd service:

```bash
sudo tee /etc/systemd/system/openclaw-inventory-ui.service << 'EOF'
[Unit]
Description=OpenClaw Inventory UI
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/openclaw-windows-agent/frontend
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-inventory-ui
```

### Step 4: Install OpenClaw Gateway

The Gateway handles communication with Windows Agents.

```bash
# Install OpenClaw via npm
npm install -g openclaw

# Initialize configuration
openclaw init

# Edit config to enable nodes and set auth token
nano ~/.openclaw/openclaw.json
```

**Minimum gateway config** (`~/.openclaw/openclaw.json`):

```json
{
  "gateway": {
    "bind": "lan",
    "port": 18789
  },
  "auth": {
    "mode": "token",
    "tokens": ["your-secret-token-here"]
  },
  "nodes": {
    "enabled": true,
    "allowCommands": ["*"]
  }
}
```

```bash
# Start the gateway
openclaw gateway start
```

### Step 5: Configure Firewall

```bash
# Allow incoming connections
sudo ufw allow 3000/tcp    # Frontend
sudo ufw allow 8080/tcp    # Backend API
sudo ufw allow 18789/tcp   # Gateway (for Windows Agents)
```

### Step 6: Verify Installation

| Service | URL | Expected |
|---------|-----|----------|
| Frontend | `http://your-server:3000` | Dashboard loads |
| Backend API | `http://your-server:8080/docs` | Swagger UI |
| Gateway | `http://your-server:18789` | Connection accepted |

---

## 💻 Agent Installation (Windows)

Once the server is running, install agents on your Windows machines:

```powershell
# Run as Administrator
irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1
.\Install.ps1 -GatewayUrl "http://YOUR-SERVER-IP:18789" -GatewayToken "your-secret-token-here"
```

The installer:
1. ✅ Downloads agent from GitHub Releases
2. ✅ Verifies SHA256 hash
3. ✅ Installs to `C:\Program Files\OpenClaw\Agent`
4. ✅ Registers Windows Service (auto-start)
5. ✅ Connects to Gateway

**Update existing agents:**

```powershell
.\Install.ps1  # Keeps existing config, updates binary
```

---

## ⚠️ Agent Requirements

### Administrator Rights
The Windows Agent **should run as Administrator** for full functionality:

| Feature | Requires Admin |
|---------|----------------|
| MSI/EXE software installations | ✅ Yes |
| Windows Update operations | ✅ Yes |
| BitLocker status | ✅ Yes |
| Security Event Log | ✅ Yes |
| Basic inventory (CPU, RAM, Software) | ❌ No |
| Remote command execution | Depends on command |

**Recommendation:** Run the agent service as `Local System` or a dedicated admin service account.

### Firewall
The agent needs outbound access to:
- Gateway server (default port 18789)
- Package download URLs (for software deployment)

---

## 📁 Project Structure

```
openclaw-windows-agent/
├── agent/                    # Windows Agent (.NET 8)
│   ├── OpenClawAgent.sln
│   └── src/
├── backend/                  # FastAPI Backend
│   ├── main.py
│   └── requirements.txt
├── frontend/                 # Next.js Dashboard
│   ├── src/app/
│   └── package.json
├── installer/                # PowerShell installer scripts
│   ├── Install-OpenClawAgent.ps1
│   └── Build-Release.ps1
└── docs/                     # Documentation
```

---

## 🗺️ Roadmap

See [ROADMAP.md](ROADMAP.md) for the full feature roadmap.

### Coming Soon
- **E12:** Windows Eventlog Collection (Initial + Delta sync)
- **E13:** Software Versions Dashboard with CVE/BSI vulnerability tracking
- **E6:** Native package installation in agent (download progress, hash verification)

---

## 🤝 Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) guide first.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🔗 Links

- [OpenClaw Gateway](https://github.com/openclaw/openclaw) — The communication hub
- [Documentation](https://docs.openclaw.ai) — Full documentation
- [Discord Community](https://discord.com/invite/clawd) — Get help and chat
