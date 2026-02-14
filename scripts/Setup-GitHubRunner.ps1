<#
.SYNOPSIS
    Setup GitHub Actions self-hosted runner on Windows.
.DESCRIPTION
    Downloads, configures, and installs a GitHub Actions self-hosted runner
    as a Windows service for running integration tests.
.PARAMETER RepoUrl
    GitHub repository URL (e.g., https://github.com/BenediktSchackenberg/openclaw-windows-agent)
.PARAMETER Token
    Runner registration token from GitHub (Settings > Actions > Runners > New self-hosted runner)
.PARAMETER RunnerName
    Name for this runner (default: hostname)
.PARAMETER Labels
    Comma-separated labels for the runner (default: Windows,X64,self-hosted)
.EXAMPLE
    .\Setup-GitHubRunner.ps1 -RepoUrl "https://github.com/BenediktSchackenberg/openclaw-windows-agent" -Token "AXXXX..."
.NOTES
    Requires: Administrator privileges, PowerShell 5.1+
    Get your token from: https://github.com/BenediktSchackenberg/openclaw-windows-agent/settings/actions/runners/new
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoUrl,
    
    [Parameter(Mandatory = $true)]
    [string]$Token,
    
    [string]$RunnerName = $env:COMPUTERNAME,
    
    [string]$Labels = "Windows,X64,self-hosted",
    
    [string]$InstallPath = "C:\actions-runner"
)

$ErrorActionPreference = "Stop"

# Require elevation
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script requires Administrator privileges. Please run as Administrator."
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "GitHub Actions Self-Hosted Runner Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Repository: $RepoUrl"
Write-Host "Runner Name: $RunnerName"
Write-Host "Labels: $Labels"
Write-Host "Install Path: $InstallPath"
Write-Host ""

# Step 1: Create install directory
if (-not (Test-Path $InstallPath)) {
    Write-Host "[1/6] Creating installation directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
} else {
    Write-Host "[1/6] Installation directory exists" -ForegroundColor Green
}

Set-Location $InstallPath

# Step 2: Download runner
Write-Host "[2/6] Downloading GitHub Actions runner..." -ForegroundColor Yellow

$runnerVersion = "2.321.0"  # Update as needed
$runnerUrl = "https://github.com/actions/runner/releases/download/v$runnerVersion/actions-runner-win-x64-$runnerVersion.zip"
$runnerZip = "actions-runner-win-x64-$runnerVersion.zip"

if (-not (Test-Path $runnerZip)) {
    Invoke-WebRequest -Uri $runnerUrl -OutFile $runnerZip
    Write-Host "   Downloaded $runnerZip" -ForegroundColor Green
} else {
    Write-Host "   Runner package already exists" -ForegroundColor Green
}

# Step 3: Extract runner
Write-Host "[3/6] Extracting runner..." -ForegroundColor Yellow

if (-not (Test-Path ".\config.cmd")) {
    Expand-Archive -Path $runnerZip -DestinationPath . -Force
    Write-Host "   Extracted successfully" -ForegroundColor Green
} else {
    Write-Host "   Runner already extracted" -ForegroundColor Green
}

# Step 4: Configure runner
Write-Host "[4/6] Configuring runner..." -ForegroundColor Yellow

# Check if already configured
if (Test-Path ".\.runner") {
    Write-Host "   Runner already configured. Removing old config..." -ForegroundColor Yellow
    .\config.cmd remove --token $Token
}

# Configure with labels
$labelArray = $Labels -split ','
$configArgs = @(
    "--url", $RepoUrl,
    "--token", $Token,
    "--name", $RunnerName,
    "--labels", $Labels,
    "--unattended",
    "--replace"
)

Write-Host "   Running: config.cmd $($configArgs -join ' ')" -ForegroundColor Gray
& .\config.cmd @configArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Configuration failed with exit code $LASTEXITCODE"
    exit 1
}

Write-Host "   Configuration complete" -ForegroundColor Green

# Step 5: Install as Windows service
Write-Host "[5/6] Installing as Windows service..." -ForegroundColor Yellow

# Stop existing service if running
$serviceName = "actions.runner.*"
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "   Stopping existing service..." -ForegroundColor Yellow
    Stop-Service -Name $existingService.Name -Force -ErrorAction SilentlyContinue
}

# Install service
& .\svc.cmd install

if ($LASTEXITCODE -ne 0) {
    Write-Error "Service installation failed"
    exit 1
}

Write-Host "   Service installed" -ForegroundColor Green

# Step 6: Start service
Write-Host "[6/6] Starting runner service..." -ForegroundColor Yellow

& .\svc.cmd start

if ($LASTEXITCODE -ne 0) {
    Write-Error "Service start failed"
    exit 1
}

Write-Host "   Service started" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "✅ Self-hosted runner setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Runner Details:"
Write-Host "  Name: $RunnerName"
Write-Host "  Labels: $Labels"
Write-Host "  Path: $InstallPath"
Write-Host ""
Write-Host "The runner should now appear at:"
Write-Host "  $RepoUrl/settings/actions/runners"
Write-Host ""
Write-Host "To test, run a workflow with:"
Write-Host '  runs-on: [self-hosted, Windows, X64]'
Write-Host ""
