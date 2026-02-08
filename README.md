# OpenClaw Windows Agent 🪟🐉

> **Production Ready (v0.3.7)** — Zero-touch installation, hardware/software inventory, browser security analysis, remote command execution. Manage your Windows fleet from anywhere.

A native Windows Service + GUI for [OpenClaw](https://openclaw.ai) that turns your Windows PCs into remotely manageable nodes. Talk to your machines via Discord, Telegram, or any AI interface.

[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![Windows](https://img.shields.io/badge/Windows-10%2F11%2FServer-0078D6?style=flat-square&logo=windows)](https://www.microsoft.com/windows)
[![Release](https://img.shields.io/github/v/release/BenediktSchackenberg/openclaw-windows-agent?style=flat-square)](https://github.com/BenediktSchackenberg/openclaw-windows-agent/releases)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## 🚀 Zero-Touch Installation

**One PowerShell command. 30 seconds. Done.**

```powershell
# Fresh Install (run as Administrator)
irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1
.\Install.ps1 -GatewayUrl "http://YOUR-GATEWAY-IP:18789" -GatewayToken "YOUR-TOKEN"
```

```powershell
# Update Existing Installation (keeps your config!)
irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 -OutFile Install.ps1
.\Install.ps1
```

The script automatically:
1. ✅ Downloads agent from GitHub Releases
2. ✅ Verifies SHA256 hash
3. ✅ Installs to `C:\Program Files\OpenClaw\Agent`
4. ✅ Preserves existing config on updates
5. ✅ Registers Windows Service (auto-start)
6. ✅ Connects to Gateway

**No manual steps. No reboots. No touching keyboards.**

---

## ✨ Features

### 📊 Hardware & Software Inventory
Automatically collects and reports:
- **Hardware** — CPU, RAM, GPU, Disks, Mainboard, BIOS/UEFI, TPM, Virtualization detection
- **Software** — All installed applications with versions & MSI product codes
- **Windows Updates** — Hotfixes + full Windows Update history (200+ entries)
- **Security** — Firewall, BitLocker, UAC, TPM, Secure Boot, **Local Administrators list**
- **Network** — Active connections, adapters, IP addresses, listening ports
- **Browser** — Extensions, history count, bookmarks, **cookie metadata** (Chrome, Edge, Firefox)
- **System** — Uptime, boot time, domain/workgroup status, computer name

### 🍪 Browser Security Analysis (NEW in v0.3.7)
- **Multi-user scanning** — Collects browser data from ALL Windows user profiles
- **Cookie metadata** — Domain, name, path, expiry, security flags (NOT values!)
- **Critical cookies detection** — Flags cookies from banking, auth, cloud providers
- **Security warnings** — Alerts for insecure cookies (missing Secure/HttpOnly flags)
- **VSS Shadow Copy** — Reads locked browser databases while browser is running

### 🖥️ Remote Command Execution
Run any command on your Windows machines:
```
You: "What's the hostname of CONTROLLER?"
AI: *runs command* → "CONTROLLER"

You: "Open Notepad on my desktop"
AI: *starts Notepad* → "Started with PID 1234"

You: "Get the top 5 processes by memory"
AI: *runs Get-Process | Sort WS -Desc | Select -First 5*
```

### ⏱️ System Monitoring (NEW in v0.3.7)
- **Uptime tracking** — Shows "3d 12h 45m" since last boot
- **Boot time** — Exact timestamp of last system start
- **Local Admins** — Lists all members of local Administrators group

### 🔗 Persistent Connection
- Windows Service runs 24/7 in background
- Auto-reconnects if connection drops
- Survives reboots
- Unique node ID per machine (`win-{hostname}`)

### 🌐 Web Dashboard
Beautiful Next.js dashboard showing:
- All connected nodes with status (Online/Away/Offline)
- Hardware/Software details per node (8 tabs)
- Groups and tags for organization
- Windows Update history with KB links
- Browser security warnings
- Critical cookies by category

---

## 📋 Prerequisites

Before installing the agent, you need:

1. **OpenClaw Gateway** running on Linux (Raspberry Pi, Server, WSL, etc.)
   ```bash
   npm install -g openclaw
   openclaw gateway start
   ```

2. **.NET 8.0 Runtime** on Windows machines
   - Download: [dotnet.microsoft.com/download](https://dotnet.microsoft.com/download/dotnet/8.0)

3. **Gateway accessible from network**
   - Set `bind: "lan"` in `~/.openclaw/openclaw.json`
   - Default port: `18789`

4. **Gateway Token**
   ```bash
   grep token ~/.openclaw/openclaw.json
   ```

📚 Full docs: [docs.openclaw.ai](https://docs.openclaw.ai)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           YOUR NETWORK                                   │
│                                                                          │
│  ┌──────────────────┐                        ┌───────────────────────┐  │
│  │   Linux Server   │      WebSocket         │   Windows Machines    │  │
│  │                  │ ◄────────────────────► │                       │  │
│  │  ┌────────────┐  │                        │  ┌─────────────────┐  │  │
│  │  │  OpenClaw  │  │   Commands/Events      │  │  Agent Service  │  │  │
│  │  │  Gateway   │  │ ─────────────────────► │  │  (runs 24/7)    │  │  │
│  │  └────────────┘  │                        │  └─────────────────┘  │  │
│  │        │         │                        │           │           │  │
│  │  ┌────────────┐  │                        │  ┌─────────────────┐  │  │
│  │  │ Inventory  │  │   Inventory Push       │  │   WMI/CIM       │  │  │
│  │  │ Backend    │ ◄───────────────────────  │  │   Collectors    │  │  │
│  │  │ (FastAPI)  │  │                        │  └─────────────────┘  │  │
│  │  └────────────┘  │                        │                       │  │
│  │        │         │                        │  DESKTOP-PC           │  │
│  │  ┌────────────┐  │                        │  LAPTOP-01            │  │
│  │  │ Dashboard  │  │                        │  SERVER-2022          │  │
│  │  │ (Next.js)  │  │                        │  ...                  │  │
│  │  └────────────┘  │                        └───────────────────────┘  │
│  └──────────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Supported Commands

| Command | Description | Example |
|---------|-------------|---------|
| `system.run` | Execute command | `{"command": ["hostname"]}` |
| `system.run` (background) | Start GUI app | `{"command": ["notepad.exe"], "background": true}` |
| `system.which` | Find executable | `{"name": "python"}` |
| `inventory.hardware` | Get hardware info | CPU, RAM, GPU, Disks, BIOS |
| `inventory.software` | Get installed apps | With MSI product codes |
| `inventory.hotfixes` | Get Windows updates | Hotfixes + Update History |
| `inventory.security` | Get security status | Firewall, BitLocker, TPM, UAC, Local Admins |
| `inventory.network` | Get network info | Adapters, Connections, Ports |
| `inventory.browser` | Get browser data | Extensions, History, Cookies (metadata) |
| `inventory.system` | Get system info | OS, Uptime, Domain, Users |
| `inventory.full` | Get everything | All collectors combined |
| `inventory.push` | Push to backend | Sends data to Inventory API |

---

## 📦 Project Structure

```
├── src/
│   ├── OpenClawAgent/              # WPF GUI Application
│   │   ├── ViewModels/             # MVVM ViewModels
│   │   ├── Views/                  # WPF XAML views
│   │   └── Services/               # Gateway, Node, Credentials
│   │
│   └── OpenClawAgent.Service/      # Windows Service
│       ├── NodeWorker.cs           # WebSocket client
│       └── Inventory/              # WMI Collectors
│           ├── HardwareCollector.cs
│           ├── SoftwareCollector.cs
│           ├── SecurityCollector.cs
│           ├── BrowserCollector.cs  # Multi-user browser scanning
│           ├── VssHelper.cs         # VSS shadow copy for locked DBs
│           └── ...
│
├── backend/                        # FastAPI Inventory Backend
│   └── main.py                     # REST API + Critical Cookies detection
│
├── frontend/                       # Next.js Dashboard
│   └── src/app/                    # React components (8 tabs per node)
│
├── installer/
│   ├── Install-OpenClawAgent.ps1   # Zero-touch installer v2.2.0
│   ├── Build-Release.ps1           # Release packaging
│   └── Package.wxs                 # MSI installer (WiX)
│
└── docs/
    ├── E10-ZERO-TOUCH-INSTALL.md   # Deployment documentation
    ├── ROADMAP.md                  # 10 Epics, 150+ tasks
    └── VISION.md                   # Endpoint Management Platform vision
```

---

## 🔐 Security

- **Tokens stored with DPAPI** — Windows-native encryption
- **SHA256 hash verification** — Installer validates downloads
- **Service runs as SYSTEM** — Full local access for complete inventory
- **Cookie VALUES not collected** — Only metadata (domain, name, flags, expiry)
- **Config preserved on update** — Installer v2.2.0 keeps existing credentials
- **Enrollment Tokens** — Available for large deployments

⚠️ **Important:** Only connect to Gateways you control. The token grants full access.

---

## 📈 Roadmap

| Version | Status | Features |
|---------|--------|----------|
| v0.1 | ✅ Done | Basic GUI + Gateway connection |
| v0.2 | ✅ Done | Windows Service + Remote commands |
| v0.3 | ✅ Done | Inventory + Zero-touch install + Browser security |
| v0.4 | 🚧 Next | Job system + Package management |
| v0.5 | 📋 Planned | Software deployment + Detection rules |
| v1.0 | 🎯 Goal | Production-ready with RBAC |

**GitHub Project Board:** [147 tasks across 10 Epics](https://github.com/users/BenediktSchackenberg/projects/1)

See full roadmap: [ROADMAP.md](ROADMAP.md)

---

## 🤝 Contributing

Contributions welcome!

```bash
# Clone
git clone https://github.com/BenediktSchackenberg/openclaw-windows-agent.git

# Build Service
dotnet build src/OpenClawAgent.Service

# Build GUI
dotnet build src/OpenClawAgent

# Run (development)
dotnet run --project src/OpenClawAgent
```

Or open `OpenClawAgent.sln` in Visual Studio 2022.

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

## 🔗 Links

- **OpenClaw**: [openclaw.ai](https://openclaw.ai) | [GitHub](https://github.com/openclaw/openclaw)
- **Docs**: [docs.openclaw.ai](https://docs.openclaw.ai)
- **Blog Post**: [schackenberg.com/posts/openclaw-windows-agent](https://schackenberg.com/posts/openclaw-windows-agent/)
- **Discord**: [OpenClaw Community](https://discord.com/invite/clawd)
- **Releases**: [GitHub Releases](https://github.com/BenediktSchackenberg/openclaw-windows-agent/releases)

---

*Built with 🐉 energy by [Benedikt Schackenberg](https://schackenberg.com)*
