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

## 🚀 Quick Start

### Prerequisites
- Linux server (Ubuntu 22.04+ recommended) for Backend/Gateway
- Windows 10/11/Server for Agents
- PostgreSQL 16 with TimescaleDB extension
- Node.js 20+ and Python 3.12+

### 1. Backend Setup

```bash
# Clone the repo
git clone https://github.com/BenediktSchackenberg/openclaw-windows-agent.git
cd openclaw-windows-agent/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start the API
uvicorn main:app --host 0.0.0.0 --port 8080
```

### 2. Frontend Setup

```bash
cd ../frontend
npm install
npm run dev  # Development
# or
npm run build && npm start  # Production
```

### 3. Agent Installation (on Windows)

```powershell
# Run as Administrator
irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1
.\Install.ps1 -GatewayUrl "http://YOUR-SERVER-IP:18789" -GatewayToken "YOUR-TOKEN"
```

The installer:
1. ✅ Downloads agent from GitHub Releases
2. ✅ Verifies SHA256 hash
3. ✅ Installs to `C:\Program Files\OpenClaw\Agent`
4. ✅ Registers Windows Service (auto-start)
5. ✅ Connects to Gateway

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
