<#
.SYNOPSIS
    Registers the Octofleet Agent as a Windows Service

.DESCRIPTION
    Use this script if the agent files are already installed but the
    Windows Service is not registered. Common after manual installation
    or failed automatic setup.

.PARAMETER InstallDir
    Path where the agent is installed (default: C:\Program Files\Octofleet\Agent)

.PARAMETER ServiceName
    Name for the Windows Service (default: OctofleetNodeAgent)

.EXAMPLE
    # Register with defaults
    .\Register-Service.ps1

    # Custom install location
    .\Register-Service.ps1 -InstallDir "D:\Octofleet\Agent"

.NOTES
    Requires Administrator privileges
#>

param(
    [string]$InstallDir = "C:\Program Files\Octofleet",
    [string]$ServiceName = "OctofleetNodeAgent"
)

$ErrorActionPreference = "Stop"

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Octofleet Service Registration ===" -ForegroundColor Cyan
Write-Host ""

# Find the executable
$exePath = Join-Path $InstallDir "OctofleetAgent.Service.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: Agent executable not found at: $exePath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please ensure the agent is installed. Available files:" -ForegroundColor Yellow
    if (Test-Path $InstallDir) {
        Get-ChildItem $InstallDir | ForEach-Object { Write-Host "  - $($_.Name)" }
    } else {
        Write-Host "  Install directory does not exist: $InstallDir" -ForegroundColor Red
    }
    exit 1
}

Write-Host "Found agent: $exePath" -ForegroundColor Green

# Check if service already exists
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Service '$ServiceName' already exists (Status: $($existingService.Status))" -ForegroundColor Yellow
    
    $choice = Read-Host "Do you want to (R)e-register, (S)tart, or (Q)uit? [R/S/Q]"
    
    switch ($choice.ToUpper()) {
        "R" {
            Write-Host "Stopping and removing existing service..." -ForegroundColor Yellow
            if ($existingService.Status -eq "Running") {
                Stop-Service -Name $ServiceName -Force
                Start-Sleep -Seconds 2
            }
            sc.exe delete $ServiceName | Out-Null
            Start-Sleep -Seconds 2
        }
        "S" {
            if ($existingService.Status -ne "Running") {
                Start-Service -Name $ServiceName
                Start-Sleep -Seconds 2
                $existingService = Get-Service -Name $ServiceName
            }
            Write-Host "Service status: $($existingService.Status)" -ForegroundColor $(if ($existingService.Status -eq "Running") { "Green" } else { "Yellow" })
            exit 0
        }
        default {
            Write-Host "Cancelled." -ForegroundColor Yellow
            exit 0
        }
    }
}

# Create service
Write-Host "Registering Windows Service..." -ForegroundColor Cyan
$result = sc.exe create $ServiceName binPath="$exePath" start=auto DisplayName="Octofleet Agent"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Service registered successfully!" -ForegroundColor Green
} else {
    Write-Host "ERROR: Failed to register service" -ForegroundColor Red
    Write-Host $result
    exit 1
}

# Set description
sc.exe description $ServiceName "Octofleet endpoint management agent - connects to Gateway for remote management" | Out-Null

# Configure recovery options (restart on failure)
Write-Host "Configuring recovery options..." -ForegroundColor Cyan
sc.exe failure $ServiceName reset=86400 actions=restart/5000/restart/10000/restart/30000 | Out-Null

# Set DOTNET_BUNDLE_EXTRACT_BASE_DIR for Windows Server compatibility
# (LocalSystem account may not have a valid TEMP directory)
Write-Host "Configuring .NET extraction directory..." -ForegroundColor Cyan
$extractDir = "C:\ProgramData\Octofleet\extract"
if (-not (Test-Path $extractDir)) {
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
}
reg add "HKLM\SYSTEM\CurrentControlSet\Services\$ServiceName" /v Environment /t REG_MULTI_SZ /d "DOTNET_BUNDLE_EXTRACT_BASE_DIR=$extractDir" /f | Out-Null
Write-Host "Extraction directory set: $extractDir" -ForegroundColor Green

# Start the service
Write-Host "Starting service..." -ForegroundColor Cyan
Start-Service -Name $ServiceName
Start-Sleep -Seconds 3

$service = Get-Service -Name $ServiceName
if ($service.Status -eq "Running") {
    Write-Host ""
    Write-Host "SUCCESS! Service is running." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "WARNING: Service status is $($service.Status)" -ForegroundColor Yellow
    Write-Host "Check logs at: C:\ProgramData\Octofleet\logs" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Service Info ===" -ForegroundColor Cyan
Write-Host "  Name:        $ServiceName"
Write-Host "  Executable:  $exePath"
Write-Host "  Status:      $($service.Status)"
Write-Host "  Start Type:  Automatic"
Write-Host ""
Write-Host "Commands:" -ForegroundColor Yellow
Write-Host "  Start:   Start-Service $ServiceName"
Write-Host "  Stop:    Stop-Service $ServiceName"
Write-Host "  Status:  Get-Service $ServiceName"
Write-Host "  Logs:    Get-Content 'C:\ProgramData\Octofleet\logs\*.log' -Tail 50"
Write-Host ""
