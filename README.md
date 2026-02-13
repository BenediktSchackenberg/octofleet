# OpenClaw Inventory Platform 🖥️📊

> **⚠️ BETA** — This project is under active development. Expect breaking changes.

> **v0.4.5** — An open-source endpoint management and inventory system for Windows and Linux fleets. Collect hardware/software inventory, deploy packages, run remote commands, receive alerts, and monitor your infrastructure from a central dashboard.

[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![Windows](https://img.shields.io/badge/Windows-10%2F11%2FServer-0078D6?style=flat-square&logo=windows)](https://www.microsoft.com/windows)
[![Linux](https://img.shields.io/badge/Linux-Ubuntu%2FDebian%2FRHEL-FCC624?style=flat-square&logo=linux&logoColor=black)](https://www.linux.org/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## 📸 Screenshots

### Dashboard with Fleet Performance
![Dashboard](docs/screenshots/dashboard.png)
*Real-time fleet overview with CPU, RAM, and Disk usage across all nodes*

### Node Details
![Node Details](docs/screenshots/node-details.png)
*Detailed hardware, software, security, and performance information per node*

### Jobs (Remote Commands)
![Jobs](docs/screenshots/jobs.png)
*Execute remote commands across your fleet with real-time progress tracking*

### Package Catalog
![Packages](docs/screenshots/packages.png)
*Software catalog with categorized packages for deployment*

### Software Compare
![Software Compare](docs/screenshots/software-compare.png)
*Compare software versions across all nodes - quickly identify outdated installations*

### Deployment Dialog
![Deployment Dialog](docs/screenshots/deployment-dialog.png)
*Create deployments with rollout strategies, maintenance windows, and scheduling*

---

## 🎯 What is this?

OpenClaw Inventory is an **endpoint management platform** that helps you:

- **See what's installed** on all your Windows machines (hardware, software, updates)
- **Deploy software** remotely (MSI/EXE packages with silent install)
- **Run commands** on any machine from a central dashboard
- **Group and organize** your devices with dynamic rules
- **Track security posture** (firewall, BitLocker, UAC, local admins)
- **Monitor performance** in real-time (CPU, RAM, Disk, Network)

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
│         • Package catalog + Deployment engine                │
│         • Alerting & Notifications                           │
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
      │ Windows  │      │  Linux   │      │ Windows  │
      │  Agent   │      │  Agent   │      │  Agent   │
      │  (PC 1)  │      │ (Server) │      │  (PC N)  │
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
| **Performance** | CPU, RAM, Disk usage (TimescaleDB time-series) |

### 🔔 Alerting & Notifications (v0.4.5)
Get notified when something goes wrong:

- **Alert Types**: Node offline, deployment failed, disk critical, agent outdated
- **Notification Channels**: Discord, Slack, Microsoft Teams, generic webhooks
- **Alert Management**: Acknowledge, resolve, cooldowns to prevent spam
- **Dashboard**: View active alerts, history, and stats

### 🚀 Rollout Strategies (NEW in v0.4.5)
Control how software deploys to your fleet:

- **Immediate**: Deploy to all nodes at once (default)
- **Staged**: Deploy in waves with configurable batch size and delay
- **Canary**: Test on a few nodes first, then full rollout
- **Percentage**: Gradually increase from 10% → 30% → 50% → 100%
- **Maintenance Windows**: Define time windows when deployments can run (e.g., 22:00-06:00 weekdays)

### 🐧 Linux Agent (v0.4.5)
Manage Linux servers alongside your Windows fleet:

- **Supported distros**: Ubuntu, Debian, RHEL, Fedora, CentOS, Arch, Alpine
- **One-line install**: `curl ... | sudo bash`
- **Same features**: Inventory, jobs, performance monitoring
- **Lightweight**: Pure Bash, minimal dependencies (curl, jq)

### 📦 Package Deployment
Deploy software to your fleet with the new **Deployment Engine**:

- **Create packages** in the catalog with download URLs
- **Target options**: All nodes, specific groups, or individual nodes
- **Deployment modes**: Required (auto-install), Available (self-service), Uninstall
- **Scheduling**: Set start/end times for maintenance windows
- **Progress tracking**: Real-time status per node (pending/downloading/installing/success/failed)
- **Automatic retry**: Failed installations retry up to 3 times

### 📈 Fleet Performance Dashboard (NEW in v0.4.0)
Monitor your entire fleet's performance:

- **Real-time metrics**: CPU, RAM, Disk usage across all nodes
- **Fleet averages**: See overall health at a glance
- **Historical charts**: 7, 14, or 30-day views per node
- **Auto-refresh**: Updates every 30 seconds
- **Performance alerts**: Identify overloaded machines quickly

### 🏷️ Dynamic Device Groups (NEW in v0.4.0)
Organize devices automatically with rule-based groups:

- **Rule builder**: Visual AND/OR condition builder
- **Operators**: equals, contains, starts_with, ends_with, gt, lt, has_tag
- **Auto-membership**: Nodes automatically join/leave groups based on inventory
- **Tags**: Assign custom tags and filter by them

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
- **8 Detail Tabs** — Overview, Hardware, Software, Security, Network, Browser, Updates, Performance

### 🔗 Persistent Connection
- Windows Service runs 24/7 in background
- Auto-reconnects if connection drops
- Survives reboots
- Unique node ID per machine
- **Auto-updater**: Agent updates itself from GitHub releases

---

## 🚀 Quick Start

### Server (Linux)

```bash
# Clone repository
git clone https://github.com/BenediktSchackenberg/openclaw-windows-agent.git
cd openclaw-windows-agent

# Start backend (requires PostgreSQL + TimescaleDB)
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080

# Start frontend (in another terminal)
cd frontend
npm install && npm run build && npm start
```

### Windows Agent

> ⚠️ **Important: Administrator Rights Required**
> 
> The Windows Agent must run as **Administrator** (elevated) for full functionality:
> - **Software deployment** (MSI/EXE installation) requires admin rights
> - **Security data collection** (BitLocker, TPM, Local Admins) requires admin rights
> - **Eventlog access** (Security log) requires admin rights
> - **Service installation** requires admin rights
> 
> If the agent runs without admin rights, software deployments will fail with exit code 1603.
> 
> The installer automatically installs the agent as a Windows Service running under LocalSystem, which has the required privileges.

```powershell
# Run as Administrator
irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1
.\Install.ps1 -GatewayUrl "http://YOUR-SERVER:18789" -GatewayToken "your-token"
```

See the full [Server Setup Guide](#-server-setup-complete-guide) below for production deployment.

---

## 🗺️ Roadmap

| Epic | Status | Description |
|------|--------|-------------|
| **E1** Inventory | ✅ Complete | 7 collectors, TimescaleDB storage |
| **E2** Device Grouping | ✅ Complete | Static + dynamic groups, tags, rules |
| **E3** Job System | ✅ Complete | Remote commands, pre/post scripts, reboot handling |
| **E4** Package Management | ✅ Complete | Package catalog, SMB/HTTP downloads, verification |
| **E5** Deployment Engine | ✅ Complete | Package rollouts to groups, scheduling, monitoring |
| **E6** Linux Agent | ✅ Complete | Bash agent for Linux nodes |
| **E7** Alerting | ✅ Complete | Discord/Slack/Teams webhooks, alert rules |
| **E8** RBAC | ✅ Complete | Role-based access control, JWT auth |
| **E9** Rollout Strategies | ✅ Complete | Canary, staged, percentage rollouts + maintenance windows |
| **E10** Zero-Touch Install | ✅ Complete | Enrollment tokens, PowerShell installer |

See [ROADMAP.md](ROADMAP.md) for the full feature list with task breakdowns.

---

## 📁 Project Structure

```
openclaw-windows-agent/
├── src/                      # Windows Agent (.NET 8)
│   ├── OpenClawAgent/        # WPF Management UI
│   └── OpenClawAgent.Service/ # Windows Service
├── linux-agent/              # Linux Agent (Bash)
│   ├── agent.sh             # Main agent script
│   ├── install.sh           # One-line installer
│   └── openclaw-agent.service # Systemd unit
├── backend/                  # FastAPI Backend
│   ├── main.py              # All API endpoints
│   ├── alerting.py          # Alerting & Notifications
│   └── requirements.txt
├── frontend/                 # Next.js Dashboard
│   ├── src/app/             # Pages (dashboard, nodes, groups, jobs, packages, deployments, alerts)
│   └── src/components/      # Reusable UI components
├── installer/                # Deployment scripts
│   ├── Install-OpenClawAgent.ps1
│   └── Build-Release.ps1
├── docs/                     # Documentation
│   └── screenshots/         # UI screenshots
└── .github/workflows/        # CI/CD (auto-build on tag)
```

---

## 🏗️ Server Setup (Complete Guide)

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
git clone https://github.com/BenediktSchackenberg/openclaw-windows-agent.git
cd openclaw-windows-agent/backend

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL="postgresql://openclaw:your-secure-password@localhost:5432/inventory"
uvicorn main:app --host 0.0.0.0 --port 8080
```

### Step 3: Setup Frontend

```bash
cd ../frontend
npm install
npm run build
npm start
```

### Step 4: Install OpenClaw Gateway

```bash
npm install -g openclaw
openclaw init
# Edit ~/.openclaw/openclaw.json to enable nodes
openclaw gateway start
```

### Step 5: Configure Firewall

```bash
sudo ufw allow 3000/tcp    # Frontend
sudo ufw allow 8080/tcp    # Backend API
sudo ufw allow 18789/tcp   # Gateway
```

---

## 💻 Agent Installation (Windows)

```powershell
# Run as Administrator
irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1
.\Install.ps1 -GatewayUrl "http://YOUR-SERVER-IP:18789" -GatewayToken "your-token"
```

The installer automatically:
- ✅ Downloads agent from GitHub Releases
- ✅ Verifies SHA256 hash
- ✅ Installs to `C:\Program Files\OpenClaw\Agent`
- ✅ Registers Windows Service (auto-start)
- ✅ Connects to Gateway

---

## 🐧 Agent Installation (Linux)

```bash
# Run as root
curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/linux-agent/install.sh | sudo bash -s -- \
  --api-url http://YOUR-SERVER:8080 \
  --api-key YOUR-API-KEY \
  --node-id $(hostname)
```

The installer automatically:
- ✅ Installs dependencies (curl, jq)
- ✅ Downloads agent to `/opt/openclaw-agent/`
- ✅ Creates systemd service (auto-start)
- ✅ Starts collecting inventory immediately

**Supported distros**: Ubuntu, Debian, RHEL, Fedora, CentOS, Arch, Alpine

---

## 🔔 Setting Up Alerts

1. Navigate to `http://your-server:3000/alerts`
2. Go to the **Channels** tab
3. Click **+ Add Channel**
4. Select Discord/Slack/Teams and paste your webhook URL
5. Click **Test** to verify
6. Go to **Rules** tab and link your rules to the channel

Default alert rules:
- **Node Offline** — Triggers when a node hasn't reported in 5 minutes
- **Deployment Failed** — Triggers when a package deployment fails
- **Disk Critical** — Triggers when disk usage exceeds 90%
- **Agent Outdated** — Triggers when agents are running old versions

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
