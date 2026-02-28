# 🐙 Octofleet

<p align="center">
  <img src="docs/images/octofleet-logo-v3.png" alt="Octofleet Banner" width="800">
</p>

<p align="center">
  <b>Open-source endpoint management platform</b><br>
  Monitor your fleet, deploy software, track vulnerabilities, and manage devices from a single dashboard.
</p>

<p align="center">
  <a href="https://github.com/BenediktSchackenberg/octofleet/releases"><img src="https://img.shields.io/github/v/release/BenediktSchackenberg/octofleet?style=flat-square&color=blue" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License"></a>
  <a href="https://github.com/BenediktSchackenberg/octofleet/stargazers"><img src="https://img.shields.io/github/stars/BenediktSchackenberg/octofleet?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/BenediktSchackenberg/octofleet/issues"><img src="https://img.shields.io/github/issues/BenediktSchackenberg/octofleet?style=flat-square" alt="Issues"></a>
  <a href="https://github.com/BenediktSchackenberg/octofleet/actions"><img src="https://img.shields.io/github/actions/workflow/status/BenediktSchackenberg/octofleet/tests.yml?style=flat-square&label=tests" alt="Tests"></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="../../wiki">Documentation</a> •
  <a href="#-contributing">Contributing</a> •
  <a href="../../wiki/Roadmap">Roadmap</a>
</p>

---

## 🎯 Why Octofleet?

- **🚀 5-Minute Setup** — Docker Compose up and you're running
- **💯 100% Self-Hosted** — Your data stays on your infrastructure
- **🔓 Fully Open Source** — No license fees, no vendor lock-in
- **🪶 Lightweight Agents** — < 20MB footprint, minimal resource usage
- **🔌 API-First** — Everything accessible via REST API
- **🌐 Cross-Platform** — Windows and Linux support

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 📊 Inventory & Monitoring
- Real-time fleet dashboard with hotspot matrix
- Hardware inventory (CPU, RAM, Disks, Network)
- Software inventory with version tracking
- **Performance monitoring with heat intensity visualization**
- Process and network monitoring
- Fleet-wide trend sparklines

</td>
<td width="50%">

### 🚀 Deployment & Jobs
- Remote job execution (PowerShell, Bash)
- Package management with tracking
- Rollout strategies (Canary, Staged)
- Maintenance windows
- Service orchestration

</td>
</tr>
<tr>
<td width="50%">

### 🔐 Security & Compliance — NEW in v0.5.6!
- **Security Center** with 12 dedicated pages
- Vulnerability scanning (NVD/CVE) + fleet-wide aggregation
- Auto-remediation (winget/Chocolatey)
- **File audit** — real-time monitoring (Windows + Linux)
- **Behavior rules** — threshold, pattern & time-based detection
- **Findings & risk scoring** — auto-generated, severity-weighted
- **Config posture snapshots** — baseline drift detection
- **Activity dashboards** — file & user activity, after-hours alerts
- **Evidence export** & retention / legal hold
- Role-based access control (RBAC) + UI audit logging

</td>
<td width="50%">

### 🖥️ Remote Access & UX — NEW in v0.5.6!
- **Screen mirroring (live view)**
- Remote terminal in browser
- **Agent Activity Monitor** — real-time SSE feed of all agent actions
- **Command Palette (Ctrl+K)** — instant node search & navigation
- Discord alert notifications
- Node health & capability monitoring

</td>
</tr>
<tr>
<td width="50%">

### 🗄️ SQL Server Management (NEW!)
- Automated SQL Server installation
- Auto disk preparation (Data/Log/TempDB)
- Single instance deployment
- Version support: SQL Server 2025/2022/2019
- Coming soon: AlwaysOn, Clustering

</td>
<td width="50%">

### 🔌 Zero-Touch Provisioning (NEW!)
- **PXE boot** — No USB/ISO needed
- **WinPE deployment** — Full automation
- **VirtIO support** — KVM/QEMU ready
- **Multi-VLAN** — Tentacle relay architecture
- **Driver injection** — Auto hardware detection
- **Autounattend.xml** — Unattended Windows install

</td>
</tr>
<tr>
<td width="50%">

### 🔄 Auto-Update
- Agents self-update from GitHub Releases
- SHA256 verification
- Downgrade protection
- Zero-touch deployment
- Enrollment tokens for mass rollout

</td>
<td width="50%">

### 📊 Reports & Exports
- **PDF Reports** — Fleet Summary, Security, Inventory
- **Excel/CSV/JSON exports** — For all data types
- **Date range filtering** — 7d/30d/90d presets
- Report Generator page (`/reports`)

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/BenediktSchackenberg/octofleet.git
cd octofleet
docker compose up -d
```

Open http://localhost:3000 — Login: `admin` / `admin`

### Option 2: Install Agent

**Windows (PowerShell as Admin):**
```powershell
iwr "https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1" -OutFile "$env:TEMP\install.ps1"
& "$env:TEMP\install.ps1" -GatewayUrl "http://your-server:8080" -GatewayToken "your-gateway-token"
```

Then configure `C:\ProgramData\Octofleet\service-config.json`:
```json
{
  "GatewayUrl": "http://your-server:8080",
  "GatewayToken": "your-gateway-token"
}
```

**Linux:**
```bash
API_URL="http://your-server:8080" API_KEY="your-api-key" \
  curl -sSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh | sudo -E bash
```

Then configure `/opt/octofleet-agent/config.env`:
```bash
API_URL="http://your-server:8080"
API_KEY="your-api-key"
```

📖 **[Full Agent Setup Guide →](docs/AGENT-SETUP.md)** · **[Installation Wiki →](../../wiki/Installation)**

---

## 🖥️ Screen Sharing (NEW in v0.5.0)

Remote screen viewing with low latency JPEG streaming:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Browser   │◄──WSS──►│   Backend   │◄──HTTP──│   Agent     │
│ (Viewer UI) │         │  (FastAPI)  │         │  (Service)  │
└─────────────┘         └─────────────┘         └──────┬──────┘
                                                       │ Named Pipe
                                                ┌──────▼──────┐
                                                │ ScreenHelper│
                                                │ (User Sess) │
                                                └─────────────┘
```

### How it works:
1. **OctofleetScreenHelper.exe** runs in the user session (with tray icon)
2. **OctofleetAgent.Service** connects via Named Pipe IPC
3. **Backend** streams JPEG frames to browser via WebSocket

### Auto-Start:
The helper starts automatically at user login via Windows Run key:
```
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run\OctofleetScreenHelper
```

### Manual Test:
```powershell
# Start helper manually (for development)
.\src\OctofleetScreenHelper\bin\Debug\net8.0-windows\OctofleetScreenHelper.exe
```

---

## 🔌 Zero-Touch Provisioning

Deploy Windows servers via PXE boot — no USB drives, no ISOs, no clicking through installers.

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   VM/Host   │◄──PXE──►│  Tentacle   │◄──API──►│  Octofleet  │
│  (Booting)  │         │  (Docker)   │         │   Backend   │
└─────────────┘         └─────────────┘         └─────────────┘
       │                       │
       │ TFTP                  │ HTTP
       └──► ipxe.efi          └──► boot.wim + install.wim
```

### Quick Start (PXE Server):

```bash
cd provisioning
docker-compose up -d
```

### Boot Sequence:
1. **PXE ROM** → dnsmasq (ProxyDHCP) → `ipxe.efi`
2. **iPXE** → HTTP → `boot.ipxe` script
3. **WinPE** → loads `boot.wim` into RAM
4. **startnet.cmd** → VirtIO drivers, SMB mount, DISM, bcdboot
5. **Windows** → boots with injected drivers
6. **Agent** → auto-installs and connects

### Supported Platforms:
- ✅ **KVM/QEMU** (Unraid, Proxmox, libvirt)
- ✅ **Hyper-V** (with PXE boot)
- ✅ **Bare Metal** (UEFI PXE)
- 🔜 VMware vSphere

📖 **[Provisioning Guide →](docs/E22-UNIVERSAL-PROVISIONING.md)**

---

## 🐧 Linux PXE Boot (NEW!)

Deploy Ubuntu servers via PXE boot with fully automated installation.

### Architecture:
```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   VM/Host   │◄──PXE──►│  PXE Server │◄──API──►│  Octofleet  │
│  (Booting)  │         │  (Docker)   │         │   Backend   │
└─────────────┘         └──────┬──────┘         └─────────────┘
       │                       │
       │ NFS                   │ HTTP
       └──► /mnt/ubuntu-XX.XX └──► kernel + initrd + autoinstall
```

### Prerequisites:

1. **Mount Ubuntu Live ISOs:**
```bash
sudo mount -o loop /path/to/ubuntu-24.04.iso /mnt/ubuntu-24.04
sudo mount -o loop /path/to/ubuntu-22.04.iso /mnt/ubuntu-22.04
```

2. **Install and configure NFS server:**
```bash
sudo apt install nfs-kernel-server
echo '/mnt/ubuntu-24.04 *(ro,sync,no_subtree_check,no_root_squash)' | sudo tee -a /etc/exports
echo '/mnt/ubuntu-22.04 *(ro,sync,no_subtree_check,no_root_squash)' | sudo tee -a /etc/exports
sudo exportfs -ra
sudo systemctl restart nfs-server
```

3. **Verify exports:**
```bash
showmount -e localhost
```

### Boot Sequence:
1. **PXE ROM** → dnsmasq (ProxyDHCP) → `ipxe.efi`
2. **iPXE** → API fetches task-specific boot script
3. **Kernel + initrd** → loaded via HTTP from `/ubuntu-live/XX.XX/casper/`
4. **casper** → mounts root filesystem via NFS
5. **Subiquity** → runs autoinstall with cloud-config from API
6. **Ubuntu** → installed with hostname, user, SSH configured

### Autoinstall Features:
- 🔐 Pre-configured user (`octofleet`) with SSH access
- 💾 LVM storage layout using all available space
- 🌐 DHCP networking with German keyboard layout
- 📦 Essential packages (curl, wget, htop, vim)

### Supported Ubuntu Versions:
- ✅ Ubuntu 24.04 LTS (Noble)
- ✅ Ubuntu 22.04 LTS (Jammy)

> **Note:** Ubuntu Live installer requires NFS. The HTTP `url=` parameter is not reliably supported by casper.

---

## 🐧 Linux Agent

Full-featured agent for Linux servers and workstations.

### Features:
- **Hardware inventory** — CPU, RAM, disks, network interfaces
- **Software inventory** — Installed packages (dpkg/rpm/pacman)
- **Performance monitoring** — Load average, CPU per core, memory details
- **Service monitoring** — systemd services with status
- **Package updates** — Available updates with security flag
- **Disk health** — SMART monitoring via smartctl

### Install:
```bash
# Quick install (API_URL and API_KEY are required)
API_URL="http://your-server:8080" API_KEY="your-api-key" \
  curl -sSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh | sudo -E bash

# Or manual:
git clone https://github.com/BenediktSchackenberg/octofleet.git
cd octofleet/linux-agent
API_URL="http://your-server:8080" API_KEY="your-api-key" sudo -E ./install.sh
```

### Configure:
```bash
# Edit /opt/openclaw-agent/config.env
API_URL="http://your-octofleet-server:8080"
API_KEY="your-api-key"
NODE_ID=""          # defaults to hostname
PUSH_INTERVAL=1800  # inventory push (seconds)
JOB_POLL_INTERVAL=60
LIVE_DATA_INTERVAL=5
```

### Commands:
```bash
# Service management
sudo systemctl status openclaw-agent
sudo systemctl restart openclaw-agent

# Manual run
/opt/openclaw-agent/agent.sh collect  # Show collected data
/opt/openclaw-agent/agent.sh push     # Push to server
```

### Collected Data:
| Category | Data |
|----------|------|
| Hardware | CPU, RAM (modules), Disks, NICs, GPU, Mainboard |
| Software | Installed packages with versions |
| System | OS info, hostname, uptime, kernel |
| Network | Interfaces, connections, open ports |
| Security | Firewall status, SELinux/AppArmor |
| Performance | Load average, CPU per core, memory (buffers/cached), swap, disk I/O |
| Services | All systemd services with status |
| Updates | Available package updates, security count |
| Disk Health | SMART status (requires smartctl + root) |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│                    (Next.js + React)                        │
│                     localhost:3000                          │
└─────────────────────┬───────────────────────────────────────┘
                      │ REST API
┌─────────────────────▼───────────────────────────────────────┐
│                        Backend                               │
│                 (FastAPI + Python 3.12)                     │
│                     localhost:8080                          │
└─────────────────────┬───────────────────────────────────────┘
                      │ SQL
┌─────────────────────▼───────────────────────────────────────┐
│                       Database                               │
│               (PostgreSQL 16 + TimescaleDB)                 │
│                     localhost:5432                          │
└─────────────────────────────────────────────────────────────┘

         ┌──────────┐  ┌──────────┐  ┌──────────┐
         │ Windows  │  │ Windows  │  │  Linux   │
         │  Agent   │  │  Agent   │  │  Agent   │
         │ (.NET 8) │  │ (.NET 8) │  │  (Bash)  │
         └────┬─────┘  └────┬─────┘  └────┬─────┘
              │             │             │
              └─────────────┴─────────────┘
                    HTTPS to Backend
```

---

## 📸 Screenshots

<details>
<summary>📈 Dashboard</summary>
<img src="docs/screenshot-dashboard.png" alt="Dashboard">
</details>

<details>
<summary>🔥 Performance Hotspot Matrix</summary>
<img src="docs/screenshot-performance.png" alt="Performance Monitoring">
</details>

<details>
<summary>🖥️ Node Details</summary>
<img src="docs/screenshot-node.png" alt="Node Details">
</details>

<details>
<summary>🔒 Vulnerability Scanner</summary>
<img src="docs/screenshot-vulns.png" alt="Vulnerabilities">
</details>

<details>
<summary>⚡ Live View</summary>
<img src="docs/screenshot-live.png" alt="Live View">
</details>

<details>
<summary>🖥️ Screen Sharing (NEW!)</summary>
<img src="docs/screenshot-screen.png" alt="Screen Sharing">
</details>

<details>
<summary>🐙 Windows Agent TUI</summary>
<img src="docs/screenshot-agent.png" alt="Agent TUI">
</details>

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| Quick Start | [Wiki: Quick-Start](../../wiki/Quick-Start) |
| Installation | [Wiki: Installation](../../wiki/Installation) |
| Configuration | [Wiki: Configuration](../../wiki/Configuration) |
| **API Reference** | [Swagger UI](http://localhost:8080/docs) • [ReDoc](http://localhost:8080/redoc) |
| Agent Setup | [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) |
| Troubleshooting | [Wiki: Troubleshooting](../../wiki/Troubleshooting) |
| **Roadmap** | [Wiki: Roadmap](../../wiki/Roadmap) |

### 🔌 API Endpoints (158 total)

The backend exposes a full REST API with automatic OpenAPI documentation:

```bash
# Interactive API docs (Swagger UI)
open http://localhost:8080/docs

# Alternative: ReDoc
open http://localhost:8080/redoc

# OpenAPI JSON spec
curl http://localhost:8080/openapi.json
```

**Key Endpoints:**
| Category | Endpoints | Description |
|----------|-----------|-------------|
| `/api/v1/nodes` | 15 | Node inventory, search, tree view |
| `/api/v1/inventory/*` | 17 | Hardware, software, hotfixes, security |
| `/api/v1/jobs` | 10 | Job creation, scheduling, results |
| `/api/v1/packages` | 12 | Package management, winget/choco |
| `/api/v1/vulnerabilities` | 6 | CVE tracking, suppression |
| `/api/v1/remediation` | 23 | Auto-remediation, health checks |
| `/api/v1/services` | 10 | Service orchestration |
| `/api/v1/deployments` | 8 | Software deployment |

---

## 🛠️ Development

```bash
# Backend (FastAPI)
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# Frontend (Next.js)
cd frontend && npm install && npm run dev

# Windows Agent (.NET 8)
cd src/OctofleetAgent.Service && dotnet run

# Run Tests
cd tests/api && pytest
cd tests/e2e && npx playwright test
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INVENTORY_API_KEY` | `octofleet-inventory-dev-key` | API key for agent authentication |
| `DATABASE_URL` | `postgresql://octofleet:...@127.0.0.1:5432/inventory` | PostgreSQL connection string |
| `JWT_SECRET` | Auto-generated | Secret for JWT tokens (persistent) |
| `NVD_API_KEY` | None | NVD API key for vulnerability scanning |
| `OCTOFLEET_GATEWAY_URL` | `http://192.168.0.5:18789` | Octofleet gateway URL |
| `OCTOFLEET_GATEWAY_TOKEN` | Empty | Token for gateway authentication |

> ⚠️ **Important:** Use `INVENTORY_API_KEY` (not `API_KEY`) for all API authentication. The API key must match between backend and agents.

---

## 🤝 Contributing

We love contributions! Octofleet is built by the community, for the community.

**🌟 First time?** Check out issues labeled [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

**📖 Read the [Contributing Guide](CONTRIBUTING.md)** for setup instructions and guidelines.

### Ways to Contribute
- 🐛 Report bugs and request features
- 📝 Improve documentation
- 💻 Submit pull requests
- 🌍 Translate to other languages
- ⭐ Star the repo to show support!

---

## 🗺️ Roadmap

See our [public roadmap](../../wiki/Roadmap) for planned features:

- **Q1 2026:** Multi-tenancy, Reporting & Analytics
- **Q2 2026:** macOS Agent, Mobile App
- **Q3 2026:** Compliance Frameworks, Enterprise SSO
- **Q4 2026:** AI-Powered Insights, Predictive Maintenance

[View Full Roadmap →](../../wiki/Roadmap)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

Built with [FastAPI](https://fastapi.tiangolo.com/), [Next.js](https://nextjs.org/), [.NET 8](https://dotnet.microsoft.com/), [TimescaleDB](https://www.timescale.com/)

Vulnerability data from [NVD](https://nvd.nist.gov/) • Icons by [Lucide](https://lucide.dev/)

---

<p align="center">
  <b>🐙 Reach every endpoint in your fleet</b><br><br>
  <a href="https://github.com/BenediktSchackenberg/octofleet/stargazers">⭐ Star us on GitHub</a> · 
  <a href="../../issues/new">🐛 Report Bug</a> · 
  <a href="../../issues/new">💡 Request Feature</a>
</p>
