# Octofleet Deployment Templates

## Smart Software Install (with Chocolatey Bootstrap)

Use this template for reliable software deployment on any Windows node - automatically installs Chocolatey if missing.

### Template Command

```powershell
$chocoPath = 'C:\ProgramData\chocolatey\bin\choco.exe'
if (!(Test-Path $chocoPath)) {
    Write-Host 'Installing Chocolatey...'
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
}
& $chocoPath install PACKAGE_NAME -y --no-progress
```

### One-liner Version (for API)

Replace `PACKAGE_NAME` with actual package:

```
$c='C:\ProgramData\chocolatey\bin\choco.exe';if(!(Test-Path $c)){Set-ExecutionPolicy Bypass -Scope Process -Force;[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor 3072;iex((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))};& $c install PACKAGE_NAME -y --no-progress
```

### Example: Install Notepad++

```json
{
  "name": "Install Notepad++",
  "targetType": "device",
  "targetId": "NODE_ID",
  "commandType": "run",
  "commandData": {
    "command": "$c='C:\\ProgramData\\chocolatey\\bin\\choco.exe';if(!(Test-Path $c)){Set-ExecutionPolicy Bypass -Scope Process -Force;[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor 3072;iex((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))};& $c install notepadplusplus -y --no-progress"
  },
  "timeoutSeconds": 600
}
```

### Popular Packages

| Package | Choco Name |
|---------|------------|
| Notepad++ | `notepadplusplus` |
| 7-Zip | `7zip` |
| VLC | `vlc` |
| Git | `git` |
| VS Code | `vscode` |
| Python | `python` |
| Node.js | `nodejs-lts` |
| Chrome | `googlechrome` |
| Firefox | `firefox` |

## Why Chocolatey?

- ✅ Works with SYSTEM account (unlike winget)
- ✅ No user interaction required
- ✅ Huge package repository
- ✅ Silent installs by default
- ✅ Easy updates: `choco upgrade all -y`
