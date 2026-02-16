<#
.SYNOPSIS
    Removes the legacy OpenClaw Agent and prepares for Octofleet installation.

.DESCRIPTION
    Stops and removes the old "OpenClaw Node Agent" service, removes old files,
    and optionally installs the new Octofleet Agent.

.EXAMPLE
    # Just uninstall old agent
    .\Uninstall-LegacyAgent.ps1

.EXAMPLE
    # Uninstall and install new agent
    .\Uninstall-LegacyAgent.ps1 -InstallNew
#>

[CmdletBinding()]
param(
    [switch]$InstallNew,
    [string]$NewAgentUrl = "https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1"
)

$ErrorActionPreference = "Stop"

# Legacy service names to check
$LegacyServiceNames = @(
    "OpenClaw Node Agent",
    "OpenClaw Agent",
    "OpenClawAgent"
)

# Legacy install paths to clean
$LegacyPaths = @(
    "C:\Program Files\OpenClaw",
    "C:\Program Files\OpenClawAgent",
    "C:\ProgramData\OpenClaw"
)

function Write-Status {
    param([string]$Message, [string]$Type = "Info")
    $color = switch ($Type) {
        "Success" { "Green" }
        "Warning" { "Yellow" }
        "Error"   { "Red" }
        default   { "Cyan" }
    }
    Write-Host "[$Type] $Message" -ForegroundColor $color
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Check admin
if (-not (Test-Administrator)) {
    Write-Status "This script requires Administrator privileges!" -Type Error
    Write-Host "Run PowerShell as Administrator and try again." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║     Legacy OpenClaw Agent Removal & Migration Tool        ║" -ForegroundColor Magenta
Write-Host "║                    → Octofleet 🐙                         ║" -ForegroundColor Magenta
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# Step 1: Stop and remove legacy services
Write-Status "Checking for legacy services..."

$servicesRemoved = 0
foreach ($serviceName in $LegacyServiceNames) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service) {
        Write-Status "Found legacy service: $serviceName" -Type Warning
        
        # Stop if running
        if ($service.Status -eq "Running") {
            Write-Status "Stopping $serviceName..."
            Stop-Service -Name $serviceName -Force
            Start-Sleep -Seconds 2
        }
        
        # Remove service
        Write-Status "Removing service $serviceName..."
        sc.exe delete $serviceName | Out-Null
        $servicesRemoved++
        Write-Status "Service '$serviceName' removed!" -Type Success
    }
}

if ($servicesRemoved -eq 0) {
    Write-Status "No legacy services found." -Type Success
}

# Step 2: Remove legacy files
Write-Status "Checking for legacy installation directories..."

$pathsRemoved = 0
foreach ($path in $LegacyPaths) {
    if (Test-Path $path) {
        Write-Status "Found legacy path: $path" -Type Warning
        
        # Backup config if exists
        $configFile = Join-Path $path "config.json"
        if (Test-Path $configFile) {
            $backupPath = "$env:TEMP\openclaw-config-backup.json"
            Copy-Item $configFile $backupPath -Force
            Write-Status "Config backed up to: $backupPath" -Type Success
        }
        
        # Remove directory
        Write-Status "Removing $path..."
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
        $pathsRemoved++
        Write-Status "Removed: $path" -Type Success
    }
}

if ($pathsRemoved -eq 0) {
    Write-Status "No legacy directories found." -Type Success
}

# Summary
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Status "Legacy cleanup complete!" -Type Success
Write-Host "  Services removed: $servicesRemoved"
Write-Host "  Directories removed: $pathsRemoved"
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# Step 3: Install new agent (optional)
if ($InstallNew) {
    Write-Status "Installing new Octofleet Agent..."
    Write-Host ""
    
    try {
        Invoke-Expression (Invoke-RestMethod -Uri $NewAgentUrl)
    }
    catch {
        Write-Status "Failed to download installer: $_" -Type Error
        Write-Host ""
        Write-Host "You can install manually:" -ForegroundColor Yellow
        Write-Host "  irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1 | iex" -ForegroundColor Cyan
    }
}
else {
    Write-Host "To install the new Octofleet Agent, run:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1 | iex" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or run this script with -InstallNew:" -ForegroundColor Yellow
    Write-Host "  .\Uninstall-LegacyAgent.ps1 -InstallNew" -ForegroundColor Cyan
}

Write-Host ""
