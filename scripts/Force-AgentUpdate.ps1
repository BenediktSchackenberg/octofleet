# Force-AgentUpdate.ps1
# Forces immediate update of Octofleet Agent to latest version
# Run on remote machines via: Invoke-Command -ComputerName SERVER -FilePath .\Force-AgentUpdate.ps1

param(
    [string]$Version = "0.4.16",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ServiceName = "OctofleetNodeAgent"
$InstallDir = "C:\Program Files\Octofleet\Agent"
$LogDir = "C:\ProgramData\Octofleet\logs"
$DownloadUrl = "https://github.com/BenediktSchackenberg/octofleet-windows-agent/releases/download/v$Version/OctofleetAgent-v$Version-win-x64.zip"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine = "$timestamp - $Message"
    Write-Host $logLine
    Add-Content -Path "$LogDir\force-update.log" -Value $logLine -ErrorAction SilentlyContinue
}

# Check current version
$currentExe = Join-Path $InstallDir "OctofleetAgent.Service.exe"
if (Test-Path $currentExe) {
    $currentVersion = (Get-Item $currentExe).VersionInfo.FileVersion
    Write-Log "Current version: $currentVersion"
    
    if (-not $Force -and $currentVersion -like "$Version*") {
        Write-Log "Already on version $Version. Use -Force to reinstall."
        exit 0
    }
} else {
    Write-Log "Agent not installed at $InstallDir"
}

Write-Log "Starting update to v$Version..."

# Download
$tempZip = Join-Path $env:TEMP "OctofleetAgent-v$Version.zip"
Write-Log "Downloading from $DownloadUrl..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $tempZip -UseBasicParsing
Write-Log "Downloaded: $((Get-Item $tempZip).Length / 1MB) MB"

# Stop service
Write-Log "Stopping service..."
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Backup
$backupDir = Join-Path $InstallDir "backup"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (Test-Path $currentExe) {
    Copy-Item $currentExe (Join-Path $backupDir "OctofleetAgent.Service.exe.bak") -Force
}

# Extract
Write-Log "Extracting to $InstallDir..."
Expand-Archive -Path $tempZip -DestinationPath $InstallDir -Force

# Verify
$newExe = Join-Path $InstallDir "OctofleetAgent.Service.exe"
if (Test-Path $newExe) {
    $newVersion = (Get-Item $newExe).VersionInfo.FileVersion
    Write-Log "New version installed: $newVersion"
} else {
    Write-Log "ERROR: Installation failed - exe not found!"
    exit 1
}

# Start service
Write-Log "Starting service..."
Start-Service -Name $ServiceName
Start-Sleep -Seconds 2

$svc = Get-Service -Name $ServiceName
Write-Log "Service status: $($svc.Status)"

# Cleanup
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
Write-Log "Update complete!"
