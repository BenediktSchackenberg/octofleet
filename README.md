# 🐙 Octofleet

<p align="center">
  <img src="docs/octofleet-banner.svg" alt="Octofleet Banner" width="800">
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

### 🔐 Security
- Vulnerability scanning (NVD/CVE)
- Auto-remediation (winget/Chocolatey)
- CVSS severity scoring
- Windows Update tracking
- Role-based access control (RBAC)

</td>
<td width="50%">

### 🖥️ Remote Access
- Screen mirroring (live view)
- Remote terminal in browser
- Event log viewer
- Discord alert notifications
- Node health monitoring

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

### 🔄 Auto-Update
- Agents self-update from GitHub Releases
- SHA256 verification
- Downgrade protection
- Zero-touch deployment
- Enrollment tokens for mass rollout

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
iwr "https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1" -OutFile "$env:TEMP\install.ps1"; & "$env:TEMP\install.ps1"
```

**Linux:**
```bash
curl -sSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh | sudo bash
```

📖 **[Full Installation Guide →](../../wiki/Installation)**

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

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| Quick Start | [Wiki: Quick-Start](../../wiki/Quick-Start) |
| Installation | [Wiki: Installation](../../wiki/Installation) |
| Configuration | [Wiki: Configuration](../../wiki/Configuration) |
| **API Reference** | [Swagger UI](http://localhost:8080/docs) • [ReDoc](http://localhost:8080/redoc) |
| Agent Setup | [Wiki: Agent-Configuration](../../wiki/Agent-Configuration) |
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
| `OCTOFLEET_GATEWAY_URL` | `http://192.168.0.5:18789` | OpenClaw gateway URL |
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
