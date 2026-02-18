# Force-AgentUpdate.ps1
# Forces immediate update of Octofleet Agent to latest version
# Usage: irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/scripts/Force-AgentUpdate.ps1 | iex

param(
    [string]$Version = "0.4.47"
)

$ErrorActionPreference = "Stop"
$ServiceName = "OctofleetNodeAgent"
$InstallDir = "C:\Program Files\Octofleet"
$DownloadUrl = "https://github.com/BenediktSchackenberg/octofleet/releases/download/v$Version/OctofleetAgent-v$Version.zip"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "$timestamp - $Message"
}

# Check current version
$currentExe = Join-Path $InstallDir "OctofleetAgent.Service.exe"
if (Test-Path $currentExe) {
    $currentVersion = (Get-Item $currentExe).VersionInfo.ProductVersion
    Write-Log "Current version: $currentVersion"
    
    if ($currentVersion -eq $Version) {
        Write-Log "Already on version $Version"
        exit 0
    }
}

Write-Log "Starting update to v$Version..."

# Download
$tempZip = Join-Path $env:TEMP "OctofleetAgent-v$Version.zip"
Write-Log "Downloading from $DownloadUrl..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $DownloadUrl -OutFile $tempZip -UseBasicParsing
Write-Log "Downloaded: $([math]::Round((Get-Item $tempZip).Length / 1MB, 2)) MB"

# Stop service
Write-Log "Stopping service..."
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Kill any remaining processes
Get-Process -Name "OctofleetAgent*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Backup config
$configPath = Join-Path $InstallDir "config.json"
$configBackup = $null
if (Test-Path $configPath) {
    $configBackup = Get-Content $configPath -Raw
    Write-Log "Config backed up"
}

# Extract (overwrite)
Write-Log "Extracting to $InstallDir..."
Expand-Archive -Path $tempZip -DestinationPath $InstallDir -Force

# Restore config
if ($configBackup) {
    $configBackup | Set-Content -Path $configPath -Force
    Write-Log "Config restored"
}

# Verify
$newExe = Join-Path $InstallDir "OctofleetAgent.Service.exe"
if (Test-Path $newExe) {
    $newVersion = (Get-Item $newExe).VersionInfo.ProductVersion
    Write-Log "New version installed: $newVersion"
} else {
    Write-Log "ERROR: Installation failed - exe not found!"
    exit 1
}

# Start service
Write-Log "Starting service..."
Start-Service -Name $ServiceName
Start-Sleep -Seconds 2

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Log "Service status: $($svc.Status)"
} else {
    Write-Log "WARNING: Service not found - may need manual registration"
}

# Cleanup
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
Write-Log "Update complete!"
