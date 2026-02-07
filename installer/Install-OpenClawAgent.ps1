<#
.SYNOPSIS
    OpenClaw Node Agent Bootstrapper - One-line installation script

.DESCRIPTION
    Downloads and installs the OpenClaw Node Agent with pre-configured settings.
    
.PARAMETER GatewayUrl
    The OpenClaw Gateway URL (e.g., http://192.168.0.5:18789)

.PARAMETER GatewayToken
    The authentication token for the Gateway

.PARAMETER InventoryUrl
    The Inventory API URL (optional, defaults to Gateway host:8080)

.PARAMETER DisplayName
    Display name for this node (optional, defaults to hostname)

.PARAMETER RepoUrl
    Base URL for the package repository (optional)

.EXAMPLE
    # Direct invocation:
    .\Install-OpenClawAgent.ps1 -GatewayUrl "http://192.168.0.5:18789" -GatewayToken "abc123"

    # One-liner from web:
    irm https://repo.example.com/install.ps1 | iex; Install-OpenClawAgent -GatewayUrl "http://192.168.0.5:18789" -GatewayToken "abc123"

.NOTES
    Author: OpenClaw
    Version: 1.0.0
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GatewayUrl,

    [Parameter(Mandatory = $true)]
    [string]$GatewayToken,

    [Parameter(Mandatory = $false)]
    [string]$InventoryUrl,

    [Parameter(Mandatory = $false)]
    [string]$DisplayName = $env:COMPUTERNAME,

    [Parameter(Mandatory = $false)]
    [string]$RepoUrl = ""
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OpenClaw Node Agent Installer" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Derive InventoryUrl from GatewayUrl if not provided
if (-not $InventoryUrl) {
    try {
        $uri = [System.Uri]$GatewayUrl
        $InventoryUrl = "$($uri.Scheme)://$($uri.Host):8080"
    } catch {
        $InventoryUrl = "http://localhost:8080"
    }
}

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Gateway URL:   $GatewayUrl"
Write-Host "  Inventory URL: $InventoryUrl"
Write-Host "  Display Name:  $DisplayName"
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Config paths
$configDir = "C:\ProgramData\OpenClaw"
$configPath = Join-Path $configDir "service-config.json"
$logsDir = Join-Path $configDir "logs"

# Step 1: Create directories
Write-Host "[1/4] Creating directories..." -ForegroundColor Green
New-Item -Path $configDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null
New-Item -Path $logsDir -ItemType Directory -Force -ErrorAction SilentlyContinue | Out-Null

# Step 2: Write config file
Write-Host "[2/4] Writing configuration..." -ForegroundColor Green
$config = @{
    GatewayUrl = $GatewayUrl
    GatewayToken = $GatewayToken
    DisplayName = $DisplayName
    InventoryApiUrl = $InventoryUrl
    AutoStart = $true
    AutoPushInventory = $true
    ScheduledPushEnabled = $true
    ScheduledPushIntervalMinutes = 30
}

$configJson = $config | ConvertTo-Json -Depth 10
# Write with UTF-8 encoding (no BOM)
[System.IO.File]::WriteAllText($configPath, $configJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "  Config written to: $configPath" -ForegroundColor Gray

# Step 3: Check if service is installed
Write-Host "[3/4] Checking service status..." -ForegroundColor Green
$service = Get-Service -Name "OpenClawNodeAgent" -ErrorAction SilentlyContinue

if ($service) {
    Write-Host "  Service found, restarting..." -ForegroundColor Gray
    Restart-Service -Name "OpenClawNodeAgent" -Force
    Start-Sleep -Seconds 2
    
    $service = Get-Service -Name "OpenClawNodeAgent"
    if ($service.Status -eq "Running") {
        Write-Host "  Service is running!" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: Service status is $($service.Status)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Service not installed." -ForegroundColor Yellow
    Write-Host "  Please install the OpenClaw Agent Service first, then re-run this script." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  For MSI installation:" -ForegroundColor Cyan
    Write-Host '    msiexec /i openclaw-agent.msi GATEWAY_URL="$GatewayUrl" GATEWAY_TOKEN="$GatewayToken" /qn' -ForegroundColor Gray
}

# Step 4: Verify connection
Write-Host "[4/4] Verifying setup..." -ForegroundColor Green
if ($service -and $service.Status -eq "Running") {
    Write-Host "  Waiting for agent to connect..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
    
    # Check logs for success
    $latestLog = Get-ChildItem -Path $logsDir -Filter "*.log" -ErrorAction SilentlyContinue | 
                 Sort-Object LastWriteTime -Descending | 
                 Select-Object -First 1
    
    if ($latestLog) {
        $logContent = Get-Content $latestLog.FullName -Tail 10 -ErrorAction SilentlyContinue
        if ($logContent -match "Connected to gateway" -or $logContent -match "WebSocket opened") {
            Write-Host "  SUCCESS: Agent connected to Gateway!" -ForegroundColor Green
        } elseif ($logContent -match "error|failed" ) {
            Write-Host "  WARNING: Check logs for errors: $($latestLog.FullName)" -ForegroundColor Yellow
        } else {
            Write-Host "  Agent is starting, check logs: $logsDir" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Check the Gateway dashboard for this node"
Write-Host "  2. View logs at: $logsDir"
Write-Host ""
