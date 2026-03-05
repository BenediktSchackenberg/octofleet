# 🐙 Octofleet

<p align="center">
  <img src="docs/images/octofleet-logo-v3.png" alt="Octofleet Banner" width="800">
</p>

<p align="center">
  <b>Open-source endpoint management platform</b><br>
  Monitor your fleet, deploy software, track vulnerabilities, manage patches, and control devices from a single dashboard.
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
- **🌙 Dark Mode** — Full dark mode across all pages

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 📊 Inventory & Monitoring
- Real-time fleet dashboard with hotspot matrix
- Hardware inventory (CPU, RAM, Disks, Network)
- **Hardware Fleet Dashboard** — CPU/disk/storage aggregation, disk health monitoring, physical disk inventory
- Software inventory with version tracking
- Performance monitoring with heat intensity visualization
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

### 🔐 Security & Compliance
- **Security Center** with dedicated pages for monitoring, findings, and forensics
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

### 🩹 Patch & Update Orchestration — NEW in v0.6.0!
- **Patch catalog** — centralized KB/update registry
- **Patch rings** — Canary → Pilot → Broad rollout strategy
- **Deployment wizard** — create, schedule, pause, resume, cancel
- **Compliance tracking** — per-node and fleet-wide
- **Agent-side scanner** — `PatchScanner.cs` discovers missing Windows updates

</td>
</tr>
<tr>
<td width="50%">

### 📐 Configuration Baselines — NEW in v0.6.0!
- **CIS benchmark templates** (Win Server 2022/2025, Win 11)
- **Baseline rules** — registry, service, security policy checks
- **Drift detection** — automatic evaluation with drift events
- **Auto-remediation** — fix drifted settings automatically
- **Compliance dashboard** with trend charts

</td>
<td width="50%">

### 📦 Content Lifecycle — NEW in v0.6.0!
- **Repository management** — APT, YUM, Chocolatey, NuGet, WinGet, Generic
- **Content snapshots** — freeze repository state at a point in time
- **Environment pipeline** — Dev → Test → Prod promotion
- **Promotion & rollback** — advance or revert environments
- **Snapshot diff** — compare any two snapshots

</td>
</tr>
<tr>
<td width="50%">

### 🔍 Real-time Query Engine — NEW in v0.6.0!
- **DSL-to-SQL query builder** with visual WHERE clause builder
- **22 queryable tables** across fleet, software, security, metrics, events
- **18 pre-built templates** for common fleet questions
- **Live agent queries** — processes, services, open ports in real-time
- **CSV export** for external analysis

</td>
<td width="50%">

### 📊 Software Metering & Licenses — NEW in v0.6.0!
- **Software catalog** with auto-discovery from fleet inventory
- **License compliance** — per-device, per-user, site, enterprise
- **Normalization rules** — map name variations to catalog entries
- **Usage tracking** & reclamation candidates
- **True-up reports** for license reconciliation

</td>
</tr>
<tr>
<td width="50%">

### 🖥️ Remote Access & UX
- **Screen mirroring (live view)**
- Remote terminal in browser
- **Agent Activity Monitor** — real-time SSE feed
- **Command Palette (Ctrl+K)** — instant node search & navigation
- **Mega Dropdown Navigation** — 2-column Security & Compliance mega menu
- **Dark Mode** — full dark mode across all pages
- Discord alert notifications

</td>
<td width="50%">

### 🔌 Zero-Touch Provisioning
- **PXE boot** — No USB/ISO needed
- **WinPE deployment** — Full automation
- **VirtIO support** — KVM/QEMU ready
- **Multi-VLAN** — Tentacle relay architecture
- **Driver injection** — Auto hardware detection
- **Linux PXE** — Ubuntu 22.04/24.04 via NFS

</td>
</tr>
<tr>
<td width="50%">

### 🗄️ SQL Server Management
- Automated SQL Server installation
- Auto disk preparation (Data/Log/TempDB)
- Version support: SQL Server 2025/2022/2019
- Cumulative update deployment & compliance

</td>
<td width="50%">

### 🔄 Self-Updating Agents
- Windows agents auto-update from GitHub Releases
- SHA256 verification & downgrade protection
- Zero-touch deployment
- Enrollment tokens for mass rollout

</td>
</tr>
<tr>
<td width="50%">

### 📊 Reports & Exports
- **PDF Reports** — Fleet Summary, Security, Inventory
- **Excel/CSV/JSON exports** — For all data types
- **Date range filtering** — 7d/30d/90d presets
- Report Generator page (`/reports`)

</td>
<td width="50%">

### 🏗️ Hardware Fleet Dashboard
- CPU, disk, and storage fleet aggregation
- Disk health monitoring (SMART)
- Physical disk inventory across all nodes
- Hardware export

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

## 📚 Documentation

| Topic | Link |
|-------|------|
| Quick Start | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Configuration | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| **API Reference** | [docs/API-REFERENCE.md](docs/API-REFERENCE.md) • [Swagger UI](http://localhost:8080/docs) |
| Security Center | [docs/SECURITY-CENTER.md](docs/SECURITY-CENTER.md) |
| Patch Management | [docs/PATCH-MANAGEMENT.md](docs/PATCH-MANAGEMENT.md) |
| Content Lifecycle | [docs/CONTENT-LIFECYCLE.md](docs/CONTENT-LIFECYCLE.md) |
| Query Engine | [docs/QUERY-ENGINE.md](docs/QUERY-ENGINE.md) |
| Software Metering | [docs/SOFTWARE-METERING.md](docs/SOFTWARE-METERING.md) |
| Agent Setup | [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md) |
| Roadmap | [docs/ROADMAP-ENTERPRISE.md](docs/ROADMAP-ENTERPRISE.md) |

### 🔌 API Endpoints (~450 total)

The backend exposes a full REST API with automatic OpenAPI documentation:

```bash
# Interactive API docs (Swagger UI)
open http://localhost:8080/docs

# Alternative: ReDoc
open http://localhost:8080/redoc

# OpenAPI JSON spec
curl http://localhost:8080/openapi.json
```

**Key Endpoint Groups:**
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
| `/api/v1/patches` | 20 | Patch catalog, rings, deployments, compliance |
| `/api/v1/baselines` | ~25 | Config baselines, rules, evaluations, drift, templates, remediation |
| `/api/v1/content` | 22 | Content repos, items, snapshots, environments, promotion |
| `/api/v1/query` | 4 | Query engine (execute, schema, templates, live) |
| `/api/v1/metering` | ~20 | Software catalog, licenses, compliance, reclamation |
| `/api/v1/hardware` | 2 | Hardware fleet aggregation & export |
| `/api/v1/security/*` | 34 | Security monitoring, events, findings, evidence, audit |

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
| `API_KEY` | `octofleet-inventory-dev-key` | API key for agent authentication |
| `DATABASE_URL` | `postgresql://octofleet:...@127.0.0.1:5432/inventory` | PostgreSQL connection string |
| `JWT_SECRET` | Auto-generated | Secret for JWT tokens (persistent) |
| `NVD_API_KEY` | None | NVD API key for vulnerability scanning |
| `OCTOFLEET_GATEWAY_URL` | `http://192.168.0.5:18789` | Octofleet gateway URL |
| `OCTOFLEET_GATEWAY_TOKEN` | Empty | Token for gateway authentication |

> ℹ️ The backend reads `API_KEY` from the environment (with fallback to `INVENTORY_API_KEY` for backward compatibility). Use `API_KEY` for new deployments.

📖 **[Full Configuration Reference →](docs/CONFIGURATION.md)**

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

See the [Enterprise Roadmap](docs/ROADMAP-ENTERPRISE.md) and [public roadmap](../../wiki/Roadmap) for planned features.

### ✅ Completed in v0.6.0
- E30 Patch & Update Orchestration
- E31 Configuration Baselines & Drift Management
- E33 Content Repository & Lifecycle Management
- E34 Real-time Query Engine
- E38 Software Metering & License Tracking

### 🔜 Upcoming
- macOS Agent
- LDAP/Active Directory & SSO/OIDC integration
- Ansible/DSC integration
- Cloud provider integration (Azure, AWS, Proxmox)
- Multi-tenancy
- High Availability

[View Full Roadmap →](docs/ROADMAP-ENTERPRISE.md)

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
