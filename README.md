# OpenClaw Inventory Platform 🖥️📊

> **⚠️ BETA** — This project is under active development. Expect breaking changes.

> **v0.4.26** — An open-source endpoint management and inventory system for Windows and Linux fleets. Collect hardware/software inventory, deploy packages, run remote commands, scan vulnerabilities, auto-remediate security issues, live monitoring, screen sharing, and manage your infrastructure from a central dashboard.

[![CI Tests](https://img.shields.io/github/actions/workflow/status/BenediktSchackenberg/openclaw-windows-agent/tests.yml?branch=main&style=flat-square&label=CI%20Tests)](https://github.com/BenediktSchackenberg/openclaw-windows-agent/actions/workflows/tests.yml)
[![Windows Tests](https://img.shields.io/github/actions/workflow/status/BenediktSchackenberg/openclaw-windows-agent/windows-tests.yml?branch=main&style=flat-square&label=Windows%20Tests)](https://github.com/BenediktSchackenberg/openclaw-windows-agent/actions/workflows/windows-tests.yml)
[![Release](https://img.shields.io/github/v/release/BenediktSchackenberg/openclaw-windows-agent?style=flat-square&label=Latest)](https://github.com/BenediktSchackenberg/openclaw-windows-agent/releases/latest)
[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![Windows](https://img.shields.io/badge/Windows-10%2F11%2FServer-0078D6?style=flat-square&logo=windows)](https://www.microsoft.com/windows)
[![Linux](https://img.shields.io/badge/Linux-Ubuntu%2FDebian%2FRHEL-FCC624?style=flat-square&logo=linux&logoColor=black)](https://www.linux.org/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## 🆕 What's New in v0.4.26

- 🖥️ **Screen Mirroring** — View remote desktops in real-time via WebSocket streaming
- 📊 **Live Performance Tab** — Real-time CPU, RAM, Disk, Network with SSE streaming
- 📜 **Live Logs & Processes** — Windows Event Logs and running processes in real-time
- 🌐 **Live Network Monitoring** — Interface stats, traffic counters, link status
- 🐧 **Linux Agent** — Python-based agent for Ubuntu/Debian with full inventory support
- 💾 **Hardware Fleet Dashboard** — SMART disk monitoring, health badges, fleet overview
- 🔧 **Auto-Remediation** — Automatic vulnerability fixes via winget/chocolatey

---

## 📸 Screenshots

### Dashboard with Fleet Performance
![Dashboard](docs/screenshots/dashboard.png)
*Real-time fleet overview with CPU, RAM, and Disk usage across all nodes*

### Node Details with Live Performance
![Node Details](docs/screenshots/node-details.png)
*Detailed hardware, software, security, and real-time performance monitoring per node*

### Live Performance Tab
*Real-time SSE streaming with CPU/RAM/Disk charts, process list, Windows Event Logs, Network interfaces, and Agent logs — all in one tab*

### Screen Sharing
*Remote desktop viewing via WebSocket streaming — watch what's happening on any node*

### Jobs (Remote Commands)
![Jobs](docs/screenshots/jobs.png)
*Execute remote commands across your fleet with real-time progress tracking*

### Hardware Fleet Dashboard
*Fleet-wide hardware overview with SMART disk health, RAM distribution, CPU types, and health badges*

---

## 🎯 What is this?

OpenClaw Inventory is an **endpoint management platform** that helps you:

- **See what's installed** on all your Windows and Linux machines
- **Monitor in real-time** with live CPU, RAM, Disk, Network, Processes, and Logs
- **View remote screens** with WebSocket-based screen sharing
- **Deploy software** remotely (MSI/EXE packages with silent install)
- **Auto-fix vulnerabilities** with winget/chocolatey remediation
- **Run commands** on any machine from a central dashboard
- **Group and organize** your devices with dynamic rules
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
│         • Package catalog + Deployment engine                │
│         • Live SSE streaming + WebSocket screen sharing      │
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
      │ (.NET 8) │      │ (Python) │      │ (.NET 8) │
      └──────────┘      └──────────┘      └──────────┘
```

---

## ✨ Features

### 🖥️ Screen Mirroring (NEW in v0.4.26)
View remote desktops in real-time:

- **WebSocket streaming** — Low-latency JPEG frames
- **On-demand capture** — Agent only captures when you're watching
- **Multiple monitors** — Support for multi-monitor setups
- **Session management** — Start/stop screen sessions via API

### 📊 Live Performance Monitoring (NEW in v0.4.26)
Real-time system monitoring via Server-Sent Events (SSE):

- **Live metrics** — CPU, RAM, Disk, Network updated every 5 seconds
- **Live charts** — Rolling 5-minute graphs with auto-update
- **Live processes** — Top 20 processes by CPU usage
- **Live logs** — Windows Event Logs streaming in real-time
- **Live network** — Interface stats, traffic counters, link status
- **Agent logs** — View OpenClaw Agent service logs remotely
- **Pause/Resume** — Control the data stream
- **Auto-reconnect** — Exponential backoff on connection loss

### 💾 Hardware Fleet Dashboard (NEW in v0.4.25)
Fleet-wide hardware overview:

- **SMART monitoring** — Disk health status from S.M.A.R.T. data
- **Health badges** — Visual indicators (Healthy/Warning/Critical)
- **CPU distribution** — See what processors are in your fleet
- **RAM overview** — Total and per-node memory stats
- **Storage summary** — Total capacity, free space, disk types
- **Export** — Download fleet hardware report as CSV/JSON

### 🛡️ Auto-Remediation (NEW in v0.4.14)
Automatically fix security vulnerabilities:

- **Winget integration** — Uses Windows Package Manager on Win10/11
- **Chocolatey fallback** — Auto-installs Chocolatey on Windows Server
- **Package mapping** — Maps CVE fixes to correct package names
- **Smart retries** — Automatic retry with alternative package managers
- **Audit trail** — Full logging of all remediation actions

```
[INF] Found 5 remediation jobs to execute
[INF] Executing remediation: Git (CVE-2016-7794) via winget
[INF] Winget not found, converting to Chocolatey command
[INF] Mapped winget Git.Git to choco git
[INF] Remediation completed with exit code: 0
```

### 🐧 Linux Agent (NEW in v0.4.26)
Python-based agent for Linux servers:

- **Supported distros**: Ubuntu, Debian, RHEL, Fedora, CentOS
- **One-line install**: `curl ... | sudo bash`
- **Full inventory**: CPU, RAM, Disks, Network, 800+ packages
- **Metrics reporting**: CPU, RAM, Disk usage every 30 seconds
- **Systemd service**: Auto-start, auto-restart on failure

```bash
# Install on Ubuntu
curl -sSL http://your-server:8888/openclaw-linux-install.sh | sudo bash
```

### 📦 Inventory Collection
The agents automatically collect and report:

| Category | Data Collected |
|----------|----------------|
| **Hardware** | CPU, RAM, GPU, Disks (incl. SMART), Mainboard, BIOS/UEFI, TPM |
| **Software** | All installed applications with versions & publishers |
| **Updates** | Windows Hotfixes + Update History |
| **Security** | Firewall, BitLocker, UAC, TPM, Secure Boot, Local Admins |
| **Network** | Adapters, IPs, Active connections, Listening ports |
| **Browser** | Extensions, Cookies metadata, History count (Chrome/Edge/Firefox) |
| **Performance** | CPU, RAM, Disk usage (TimescaleDB time-series) |

### 🔔 Alerting & Notifications
Get notified when something goes wrong:

- **Alert Types**: Node offline, deployment failed, disk critical, agent outdated
- **Notification Channels**: Discord, Slack, Microsoft Teams, generic webhooks
- **Alert Management**: Acknowledge, resolve, cooldowns to prevent spam

### 🚀 Rollout Strategies
Control how software deploys to your fleet:

- **Immediate**: Deploy to all nodes at once
- **Staged**: Deploy in waves with configurable batch size
- **Canary**: Test on a few nodes first, then full rollout
- **Percentage**: Gradually increase from 10% → 50% → 100%
- **Maintenance Windows**: Define time windows for deployments

### 🔒 Vulnerability Scanning
Automatically identify security vulnerabilities:

- **NVD Integration**: Scans against NIST National Vulnerability Database
- **CVE Detection**: Matches installed software against known CVEs
- **CVSS Scoring**: Severity ratings (Critical/High/Medium/Low)
- **Fixable Detection**: Identifies which vulnerabilities have fixes

### 📦 Package Deployment
Deploy software to your fleet:

- **Package catalog** with download URLs and silent install commands
- **Target options**: All nodes, specific groups, or individual nodes
- **Progress tracking**: Real-time status per node
- **Automatic retry**: Failed installations retry up to 3 times

### 🏷️ Dynamic Device Groups
Organize devices automatically:

- **Rule builder**: Visual AND/OR condition builder
- **Auto-membership**: Nodes join/leave groups based on inventory
- **Tags**: Assign custom tags and filter by them

### 🎮 Remote Command Execution
Run any command on your machines:

- PowerShell, CMD, Bash, or any executable
- Real-time output capture
- Timeout handling
- Job queue with priority
- **restart-agent** command type for remote agent restarts

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

```powershell
# Run as Administrator
irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1
.\Install.ps1 -GatewayUrl "http://YOUR-SERVER:18789" -GatewayToken "your-token"
```

### Linux Agent

```bash
# Run as root - replace YOUR-SERVER with your backend IP
curl -sSL http://YOUR-SERVER:8888/openclaw-linux-install.sh | sudo bash
```

---

## 🗺️ Roadmap

| Epic | Status | Description |
|------|--------|-------------|
| **E1** Inventory | ✅ Complete | 7 collectors, TimescaleDB storage |
| **E2** Device Grouping | ✅ Complete | Static + dynamic groups, tags, rules |
| **E3** Job System | ✅ Complete | Remote commands, pre/post scripts, reboot handling |
| **E4** Package Management | ✅ Complete | Package catalog, SMB/HTTP downloads, verification |
| **E5** Deployment Engine | ✅ Complete | Package rollouts to groups, scheduling, monitoring |
| **E6** Linux Agent | ✅ Complete | Python agent for Linux nodes |
| **E7** Alerting | ✅ Complete | Discord/Slack/Teams webhooks, alert rules |
| **E8** RBAC | ✅ Complete | Role-based access control, JWT auth |
| **E9** Rollout Strategies | ✅ Complete | Canary, staged, percentage rollouts + maintenance windows |
| **E10** Zero-Touch Install | ✅ Complete | Enrollment tokens, PowerShell installer |
| **E12** Eventlog | ✅ Complete | Windows Event Log collection and viewing |
| **E13** Vulnerability Tracking | ✅ Complete | NVD integration, CVE scanning, CVSS scoring |
| **E14** Auto-Remediation | ✅ Complete | Automatic vulnerability fixes via winget/choco |
| **E15** Hardware Fleet | ✅ Complete | SMART monitoring, fleet dashboard, health badges |
| **E16** Live View | ✅ Complete | SSE streaming for metrics, logs, processes, network |
| **E17** Screen Mirroring | ✅ Complete | WebSocket screen sharing |

See [ROADMAP.md](ROADMAP.md) for the full feature list.

---

## 📁 Project Structure

```
openclaw-windows-agent/
├── src/                      # Windows Agent (.NET 8)
│   ├── OpenClawAgent/        # WPF Management UI
│   └── OpenClawAgent.Service/ # Windows Service
│       ├── Inventory/        # Hardware, Software, Security collectors
│       ├── LiveDataPoller.cs # SSE metrics streaming
│       ├── ScreenCapturer.cs # Screen sharing
│       └── AutoUpdater.cs    # Self-update from GitHub
├── linux-agent/              # Linux Agent (Python)
│   └── install.sh           # Installer with embedded agent
├── backend/                  # FastAPI Backend
│   ├── main.py              # All API endpoints (~7500 lines)
│   └── requirements.txt
├── frontend/                 # Next.js Dashboard
│   ├── src/app/             # Pages
│   └── src/components/      # UI components
│       └── performance-tab.tsx # Live monitoring component
├── installer/                # Deployment scripts
│   ├── Install-OpenClawAgent.ps1
│   └── Build-Release.ps1
├── tests/                    # Test suites
│   ├── api/                 # pytest API tests
│   ├── e2e/                 # Playwright E2E tests (36 tests)
│   └── windows/             # Pester Windows tests (17 tests)
└── .github/workflows/        # CI/CD
    ├── tests.yml            # API + E2E tests
    ├── windows-tests.yml    # Windows Pester tests
    └── release.yml          # Auto-build on tag
```

---

## 🧪 Testing

```bash
# API Tests (pytest)
cd tests/api && pytest -v

# E2E Tests (Playwright)
cd tests/e2e && npx playwright test

# Windows Tests (Pester) — run on Windows
cd tests/windows && .\Run-LocalTests.ps1

# CI runs all tests automatically on push
```

---

## 📚 Documentation

- [GitHub Wiki](https://github.com/BenediktSchackenberg/openclaw-windows-agent/wiki) — User guides
- [ROADMAP.md](ROADMAP.md) — Feature roadmap
- [CHANGELOG.md](CHANGELOG.md) — Version history
- [OpenClaw Docs](https://docs.openclaw.ai) — Gateway documentation

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
- [Blog Post: v0.4.26](https://www.schackenberg.com/2026-02-14-openclaw-inventory-v0426/) — Feature overview
