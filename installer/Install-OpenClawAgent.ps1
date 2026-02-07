<#
.SYNOPSIS
    OpenClaw Node Agent Full Installer - Downloads, installs, configures, starts

.DESCRIPTION
    Complete zero-touch installation:
    1. Downloads agent package from GitHub/Repository
    2. Extracts to Program Files
    3. Registers Windows Service
    4. Writes configuration
    5. Starts service
    
.PARAMETER GatewayUrl
    The OpenClaw Gateway URL (e.g., http://192.168.0.5:18789)

.PARAMETER GatewayToken
    The authentication token for the Gateway

.PARAMETER InventoryUrl
    The Inventory API URL (optional, defaults to Gateway host:8080)

.PARAMETER DisplayName
    Display name for this node (optional, defaults to hostname)

.PARAMETER PackageUrl
    URL to the agent ZIP package (optional, uses GitHub releases by default)

.PARAMETER Version
    Version to install (optional, defaults to "latest")

.EXAMPLE
    # One-liner installation:
    irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/installer/Install-OpenClawAgent.ps1 | iex
    Install-OpenClawAgent -GatewayUrl "http://192.168.0.5:18789" -GatewayToken "abc123"

    # Or direct:
    .\Install-OpenClawAgent.ps1 -GatewayUrl "http://192.168.0.5:18789" -GatewayToken "abc123"

.NOTES
    Author: OpenClaw
    Version: 2.0.0
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
    [string]$PackageUrl = "",

    [Parameter(Mandatory = $false)]
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Speed up downloads

# Constants
$GitHubRepo = "BenediktSchackenberg/openclaw-windows-agent"
$ServiceName = "OpenClawNodeAgent"
$InstallDir = "C:\Program Files\OpenClaw\Agent"
$ConfigDir = "C:\ProgramData\OpenClaw"
$ServiceExe = "OpenClawAgent.Service.exe"

function Write-Step {
    param([string]$Step, [string]$Message)
    Write-Host "[$Step] $Message" -ForegroundColor Green
}

function Write-Detail {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor Gray
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  WARNING: $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "  ERROR: $Message" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  OpenClaw Node Agent - Full Installer" -ForegroundColor Cyan
Write-Host "  Version 2.0.0" -ForegroundColor Cyan
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
Write-Host "  Install Dir:   $InstallDir"
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "This script must be run as Administrator!"
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# ============================================
# Step 1: Stop existing service if running
# ============================================
Write-Step "1/6" "Checking existing installation..."
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Detail "Found existing service (Status: $($existingService.Status))"
    if ($existingService.Status -eq "Running") {
        Write-Detail "Stopping service..."
        Stop-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 2
    }
}

# ============================================
# Step 2: Download package
# ============================================
Write-Step "2/6" "Downloading agent package..."

$tempDir = Join-Path $env:TEMP "OpenClawInstall_$(Get-Random)"
New-Item -Path $tempDir -ItemType Directory -Force | Out-Null
$zipPath = Join-Path $tempDir "agent.zip"

if ($PackageUrl) {
    # Use provided URL
    $downloadUrl = $PackageUrl
} else {
    # Get from GitHub releases
    Write-Detail "Fetching latest release from GitHub..."
    try {
        $releasesUrl = "https://api.github.com/repos/$GitHubRepo/releases"
        $headers = @{ "User-Agent" = "OpenClaw-Installer" }
        
        if ($Version -eq "latest") {
            $releaseInfo = Invoke-RestMethod -Uri "$releasesUrl/latest" -Headers $headers -ErrorAction SilentlyContinue
        } else {
            $releaseInfo = Invoke-RestMethod -Uri "$releasesUrl/tags/v$Version" -Headers $headers -ErrorAction SilentlyContinue
        }
        
        if ($releaseInfo -and $releaseInfo.assets) {
            $asset = $releaseInfo.assets | Where-Object { $_.name -like "*Service*.zip" -or $_.name -like "*agent*.zip" } | Select-Object -First 1
            if ($asset) {
                $downloadUrl = $asset.browser_download_url
                Write-Detail "Found release: $($releaseInfo.tag_name)"
            }
        }
    } catch {
        Write-Detail "Could not fetch from GitHub API: $_"
    }
    
    # Fallback: Try direct release URL
    if (-not $downloadUrl) {
        if ($Version -eq "latest") {
            $downloadUrl = "https://github.com/$GitHubRepo/releases/latest/download/OpenClawAgent.Service.zip"
        } else {
            $downloadUrl = "https://github.com/$GitHubRepo/releases/download/v$Version/OpenClawAgent.Service.zip"
        }
        Write-Detail "Using direct URL: $downloadUrl"
    }
}

Write-Detail "Downloading from: $downloadUrl"
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
    $zipSize = (Get-Item $zipPath).Length / 1MB
    Write-Detail "Downloaded: $([math]::Round($zipSize, 2)) MB"
} catch {
    Write-Err "Failed to download package: $_"
    Write-Host ""
    Write-Host "Please create a release on GitHub with the Service ZIP:" -ForegroundColor Yellow
    Write-Host "  1. Build: dotnet publish src/OpenClawAgent.Service -c Release -o publish" -ForegroundColor Gray
    Write-Host "  2. ZIP the 'publish' folder as 'OpenClawAgent.Service.zip'" -ForegroundColor Gray
    Write-Host "  3. Create GitHub Release and upload the ZIP" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Or provide -PackageUrl parameter with direct link to ZIP" -ForegroundColor Yellow
    
    # Cleanup
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# ============================================
# Step 3: Extract package
# ============================================
Write-Step "3/6" "Extracting package..."

# Create install directory
New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null

# Extract
$extractPath = Join-Path $tempDir "extracted"
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

# Find the exe (might be in subfolder)
$exeFile = Get-ChildItem -Path $extractPath -Recurse -Filter $ServiceExe | Select-Object -First 1
if (-not $exeFile) {
    Write-Err "Could not find $ServiceExe in package!"
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# Copy files to install dir
$sourceDir = $exeFile.DirectoryName
Write-Detail "Copying files from: $sourceDir"
Copy-Item -Path "$sourceDir\*" -Destination $InstallDir -Recurse -Force
Write-Detail "Installed to: $InstallDir"

# Cleanup temp
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

# ============================================
# Step 4: Register service
# ============================================
Write-Step "4/6" "Registering Windows service..."

$servicePath = Join-Path $InstallDir $ServiceExe

if (-not $existingService) {
    # Create new service
    $result = sc.exe create $ServiceName binPath="$servicePath" start=auto DisplayName="OpenClaw Node Agent"
    if ($LASTEXITCODE -eq 0) {
        Write-Detail "Service registered successfully"
    } else {
        Write-Err "Failed to register service: $result"
        exit 1
    }
    
    # Set description
    sc.exe description $ServiceName "OpenClaw endpoint management agent - connects to Gateway for remote management" | Out-Null
} else {
    Write-Detail "Service already registered, updating path..."
    sc.exe config $ServiceName binPath="$servicePath" | Out-Null
}

# ============================================
# Step 5: Write configuration
# ============================================
Write-Step "5/6" "Writing configuration..."

$configPath = Join-Path $ConfigDir "service-config.json"
$logsDir = Join-Path $ConfigDir "logs"

# Create directories
New-Item -Path $ConfigDir -ItemType Directory -Force | Out-Null
New-Item -Path $logsDir -ItemType Directory -Force | Out-Null

# Create config object
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

# Write as UTF-8 without BOM
$configJson = $config | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($configPath, $configJson, [System.Text.UTF8Encoding]::new($false))
Write-Detail "Config: $configPath"

# ============================================
# Step 6: Start service
# ============================================
Write-Step "6/6" "Starting service..."

Start-Service -Name $ServiceName
Start-Sleep -Seconds 3

$service = Get-Service -Name $ServiceName
if ($service.Status -eq "Running") {
    Write-Detail "Service is running!"
} else {
    Write-Warn "Service status: $($service.Status)"
    Write-Detail "Check logs at: $logsDir"
}

# Wait for connection
Write-Detail "Waiting for Gateway connection..."
Start-Sleep -Seconds 5

# Check logs for success
$latestLog = Get-ChildItem -Path $logsDir -Filter "*.log" -ErrorAction SilentlyContinue | 
             Sort-Object LastWriteTime -Descending | 
             Select-Object -First 1

if ($latestLog) {
    $logContent = Get-Content $latestLog.FullName -Tail 15 -ErrorAction SilentlyContinue
    $logText = $logContent -join "`n"
    
    if ($logText -match "WebSocket opened|Connected to gateway|connected successfully") {
        Write-Host ""
        Write-Host "  SUCCESS: Agent connected to Gateway!" -ForegroundColor Green
    } elseif ($logText -match "error|failed|exception") {
        Write-Warn "Connection may have issues, check logs"
    }
}

# ============================================
# Done!
# ============================================
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "  Service:     $ServiceName"
Write-Host "  Install Dir: $InstallDir"
Write-Host "  Config:      $configPath"
Write-Host "  Logs:        $logsDir"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Check Gateway dashboard for '$DisplayName'"
Write-Host "  2. View logs: Get-Content '$logsDir\*.log' -Tail 50"
Write-Host ""
