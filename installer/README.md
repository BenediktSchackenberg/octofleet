# OpenClaw Agent Installer

Zero-Touch / One-Click installation for the OpenClaw Node Agent.

## Quick Start (PowerShell)

**For existing service installation** (config only):
```powershell
# Run as Administrator!
.\Install-OpenClawAgent.ps1 -GatewayUrl "http://192.168.0.5:18789" -GatewayToken "your-token-here"
```

**One-liner from network share:**
```powershell
& "\\server\share\Install-OpenClawAgent.ps1" -GatewayUrl "http://192.168.0.5:18789" -GatewayToken "abc123"
```

## MSI Installation

**Silent install with parameters:**
```powershell
msiexec /i openclaw-agent.msi GATEWAY_URL="http://192.168.0.5:18789" GATEWAY_TOKEN="abc123" /qn
```

**All MSI parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `GATEWAY_URL` | Yes | OpenClaw Gateway URL |
| `GATEWAY_TOKEN` | Yes | Authentication token |
| `INVENTORY_URL` | No | Inventory API URL (default: Gateway host:8080) |
| `DISPLAY_NAME` | No | Node display name (default: hostname) |

## Building the MSI

### Prerequisites
- Visual Studio 2022+
- .NET 8.0 SDK
- [WiX Toolset v5](https://wixtoolset.org/docs/intro/)

### Build Steps
```powershell
# 1. Install WiX extension
dotnet tool install --global wix

# 2. Build the solution
dotnet build -c Release

# 3. Build the MSI
cd installer
dotnet build -c Release
```

The MSI will be at: `installer\bin\Release\OpenClawAgent.Installer.msi`

## Deployment Methods

### GPO (Group Policy)
1. Copy MSI to network share
2. Create GPO → Computer Configuration → Software Installation
3. Add package with transform file for GATEWAY_URL/TOKEN

### SCCM/Intune
```powershell
msiexec /i "\\server\share\openclaw-agent.msi" GATEWAY_URL="http://gw:18789" GATEWAY_TOKEN="xxx" /qn
```

### PDQ Deploy
Use the PowerShell script or MSI with parameters.

## Files Created

| Path | Description |
|------|-------------|
| `C:\Program Files\OpenClaw\Agent\` | Service binaries |
| `C:\ProgramData\OpenClaw\service-config.json` | Configuration |
| `C:\ProgramData\OpenClaw\logs\` | Log files |

## Troubleshooting

**Service not starting:**
```powershell
Get-Content "C:\ProgramData\OpenClaw\logs\*.log" -Tail 50
```

**Config not written:**
- Check MSI log: `msiexec /i agent.msi /l*v install.log`
- Verify parameters are passed correctly

**Connection issues:**
- Verify Gateway URL is reachable
- Check token is correct
- Ensure firewall allows outbound WebSocket (port 18789)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Installation Flow                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌───────────┐    ┌────────────────────┐    │
│  │   MSI    │───►│  Custom   │───►│  service-config    │    │
│  │ Package  │    │  Action   │    │     .json          │    │
│  └──────────┘    └───────────┘    └────────────────────┘    │
│       │                                     │               │
│       ▼                                     ▼               │
│  ┌──────────┐                    ┌──────────────────┐       │
│  │ Service  │◄───────────────────│  Service Start   │       │
│  │ Binaries │                    │  (auto)          │       │
│  └──────────┘                    └──────────────────┘       │
│                                          │                  │
│                                          ▼                  │
│                               ┌──────────────────┐          │
│                               │ Connect to       │          │
│                               │ Gateway          │          │
│                               └──────────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
