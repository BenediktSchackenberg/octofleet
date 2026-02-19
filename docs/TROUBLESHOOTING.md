# Troubleshooting Guide

## Service Fails to Start on Windows Server (Error 1053)

### Symptoms
- Service is registered but won't start
- Error 1053: "The service did not respond to the start or control request in a timely fashion"
- Running the EXE manually works fine
- Event Log shows: `DOTNET_BUNDLE_EXTRACT_BASE_DIR is not set`

### Cause
On Windows Server editions, the LocalSystem account does not have a proper TEMP directory. .NET single-file apps need a writable location to extract embedded files.

### Solution
Set the extraction directory for the service:

```powershell
# Create extraction directory
New-Item -ItemType Directory -Path "C:\ProgramData\Octofleet\extract" -Force

# Set environment variable for the service
reg add "HKLM\SYSTEM\CurrentControlSet\Services\OctofleetNodeAgent" /v Environment /t REG_MULTI_SZ /d "DOTNET_BUNDLE_EXTRACT_BASE_DIR=C:\ProgramData\Octofleet\extract" /f

# Start the service
sc.exe start OctofleetNodeAgent
```

### Affected Systems
- ✅ Windows Server 2022
- ✅ Windows Server 2019 (likely)
- ✅ Windows Server Core editions
- ❌ Windows 10/11 Desktop (usually not affected)

---

## Service Won't Start After Update

### Symptoms
- Update completed but service stays stopped
- Error 1053 or "Service cannot be started"

### Cause
Old service handle still held by Windows, or service binary path mismatch.

### Solution

**Option 1: Reboot**
```powershell
Restart-Computer -Force
```

**Option 2: Re-register service**
```powershell
# Stop and delete
Stop-Service OctofleetNodeAgent -Force -EA SilentlyContinue
sc.exe delete OctofleetNodeAgent

# Wait for handle release
Start-Sleep -Seconds 5

# Re-create
sc.exe create OctofleetNodeAgent binPath="C:\Program Files\Octofleet\OctofleetAgent.Service.exe" start=auto DisplayName="Octofleet Agent"
Start-Service OctofleetNodeAgent
```

---

## Service Path Mismatch

### Symptoms
- Service registered but points to wrong/old path
- Error: "The system cannot find the file specified"

### Solution
Use the Repair Script:
```powershell
irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/scripts/Repair-Service.ps1 | iex
```

Or manually fix:
```powershell
# Check current path
reg query "HKLM\SYSTEM\CurrentControlSet\Services\OctofleetNodeAgent" /v ImagePath

# Fix path
sc.exe config OctofleetNodeAgent binPath="C:\Program Files\Octofleet\OctofleetAgent.Service.exe"
```

---

## Clean Installation

If all else fails, perform a clean install:

```powershell
# 1. Remove old installation
Stop-Service OctofleetNodeAgent -Force -EA SilentlyContinue
sc.exe delete OctofleetNodeAgent
Remove-Item "C:\Program Files\Octofleet" -Recurse -Force -EA SilentlyContinue

# 2. Download latest release
$version = "0.4.57"  # Update to latest
$url = "https://github.com/BenediktSchackenberg/octofleet/releases/download/v$version/OctofleetAgent-v$version.zip"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\agent.zip"

# 3. Extract
New-Item -ItemType Directory -Path "C:\Program Files\Octofleet" -Force
Expand-Archive "$env:TEMP\agent.zip" -DestinationPath "C:\Program Files\Octofleet" -Force

# 4. Create extraction dir (for Windows Server)
New-Item -ItemType Directory -Path "C:\ProgramData\Octofleet\extract" -Force

# 5. Register service with env var
sc.exe create OctofleetNodeAgent binPath="C:\Program Files\Octofleet\OctofleetAgent.Service.exe" start=auto DisplayName="Octofleet Agent"
reg add "HKLM\SYSTEM\CurrentControlSet\Services\OctofleetNodeAgent" /v Environment /t REG_MULTI_SZ /d "DOTNET_BUNDLE_EXTRACT_BASE_DIR=C:\ProgramData\Octofleet\extract" /f

# 6. Start
Start-Service OctofleetNodeAgent
Get-Service OctofleetNodeAgent
```

---

## Checking Logs

```powershell
# Application logs
Get-Content "C:\ProgramData\Octofleet\logs\*.log" -Tail 100

# Windows Event Log - Application errors
Get-WinEvent -FilterHashtable @{LogName='Application'; Level=2; StartTime=(Get-Date).AddHours(-1)} -MaxEvents 20 | 
    Where-Object { $_.Message -like "*Octofleet*" -or $_.Message -like "*.NET*" } | 
    Format-List TimeCreated, Message

# Service Control Manager events
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'; StartTime=(Get-Date).AddHours(-1)} -MaxEvents 10 |
    Format-List TimeCreated, Message
```
