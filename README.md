# OpenClaw Windows Agent 🪟

A native Windows agent/node for [OpenClaw](https://openclaw.ai) with GUI, gateway management, and remote deployment capabilities.

![.NET](https://img.shields.io/badge/.NET-8.0-512BD4?style=flat-square&logo=dotnet)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D6?style=flat-square&logo=windows)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

## Features

- 🔗 **Gateway Connection** — Connect to OpenClaw Gateway with secure token authentication
- 💾 **Credential Storage** — Secure storage using Windows DPAPI/Credential Manager
- 💬 **Command Terminal** — Execute OpenClaw commands with history and output
- 🖥️ **Remote Deployment** — Push agent to other Windows machines via WinRM
- 📊 **Status Dashboard** — Real-time monitoring of agent and gateway status
- 🔔 **System Tray** — Run minimized with status notifications

## Requirements

- Windows 10 (1903+) or Windows 11
- Windows Server 2019 or later
- .NET 8.0 Runtime

## Installation

### From Release (Recommended)

1. Download the latest release from [Releases](https://github.com/BenediktSchackenberg/openclaw-windows-agent/releases)
2. Run `OpenClawAgent-Setup.msi`
3. Launch "OpenClaw Agent" from Start Menu

### Build from Source

```powershell
# Clone repository
git clone https://github.com/BenediktSchackenberg/openclaw-windows-agent.git
cd openclaw-windows-agent

# Build
dotnet build -c Release

# Run
dotnet run --project src/OpenClawAgent
```

## Quick Start

### 1. Connect to Gateway

1. Open the app
2. Go to **Gateways** → **Add Gateway**
3. Enter your Gateway URL and Token
4. Click **Connect**

### 2. Run Commands

1. Go to **Commands**
2. Type any OpenClaw command (e.g., `status`, `config`)
3. Press Enter or click **Run**

### 3. Deploy to Remote Hosts

1. Go to **Remote Hosts**
2. Click **Add Host**
3. Enter hostname, credentials
4. Click **Deploy**

## Project Structure

```
src/OpenClawAgent/
├── Models/              # Data models
├── Services/            # Business logic
│   ├── GatewayService.cs       # Gateway communication
│   ├── CredentialService.cs    # Secure credential storage
│   └── RemoteDeploymentService.cs  # WinRM deployment
├── ViewModels/          # MVVM ViewModels
├── Views/               # WPF XAML views
├── Themes/              # OpenClaw styling
└── Assets/              # Icons, images
```

## Configuration

Config is stored in `%APPDATA%\OpenClaw\Agent\`:

```
%APPDATA%\OpenClaw\Agent\
├── gateways.json      # Encrypted gateway configs
├── settings.json      # App settings
└── logs/              # Application logs
```

Credentials are encrypted using Windows DPAPI (CurrentUser scope).

## Security

- **DPAPI Encryption** — All sensitive data encrypted with Windows Data Protection API
- **No Admin Required** — Runs with standard user privileges (admin only for remote deployment)
- **TLS Required** — All gateway communication over HTTPS
- **Least Privilege** — Minimal permissions requested

## Remote Deployment

The agent can deploy itself to other Windows machines using PowerShell Remoting (WinRM).

### Prerequisites on Target Machines

```powershell
# Enable WinRM (run as Admin on target)
Enable-PSRemoting -Force
```

### Deployment Process

1. Connects via WinRM/PowerShell Remoting
2. Checks for existing OpenClaw installation
3. Copies and installs agent MSI
4. Configures gateway connection
5. Starts agent service

## Development

### Tech Stack

- **Framework:** .NET 8.0 + WPF
- **Pattern:** MVVM (CommunityToolkit.Mvvm)
- **UI:** Custom OpenClaw theme
- **Tray:** Hardcodet.NotifyIcon.Wpf

### Building

```powershell
# Debug build
dotnet build

# Release build
dotnet build -c Release

# Publish self-contained
dotnet publish -c Release -r win-x64 --self-contained
```

### Code Signing

For production releases, sign with Authenticode:

```powershell
signtool sign /f certificate.pfx /p password /tr http://timestamp.digicert.com /td sha256 OpenClawAgent.exe
```

## Roadmap

- [ ] v0.1.0 — MVP: Gateway connection, basic UI
- [ ] v0.2.0 — Command terminal with history
- [ ] v0.3.0 — Remote deployment via WinRM
- [ ] v0.4.0 — MSI installer, code signing
- [ ] v1.0.0 — Production release

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT — see [LICENSE](LICENSE)

---

*Part of the [OpenClaw](https://openclaw.ai) ecosystem*
