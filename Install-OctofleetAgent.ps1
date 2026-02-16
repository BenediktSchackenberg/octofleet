<#
.SYNOPSIS
    Installs or updates the Octofleet Windows Agent.

.DESCRIPTION
    Downloads the latest release from GitHub and installs the Octofleet Windows Agent
    as a Windows Service. Supports enrollment tokens for automatic registration.

.PARAMETER GatewayUrl
    WebSocket URL to the Octofleet Gateway (e.g., ws://192.168.0.5:18789)

.PARAMETER GatewayToken
    Authentication token for the Gateway connection.

.PARAMETER EnrollToken
    Enrollment token for automatic registration with the inventory backend.

.PARAMETER InstallPath
    Installation directory. Default: C:\Program Files\Octofleet

.PARAMETER Force
    Force reinstallation even if already installed.

.EXAMPLE
    # Interactive install
    .\Install-OctofleetAgent.ps1

.EXAMPLE
    # Silent install with parameters
    .\Install-OctofleetAgent.ps1 -GatewayUrl "ws://192.168.0.5:18789" -GatewayToken "mytoken"

.EXAMPLE
    # Install with enrollment token (auto-registers)
    $env:OPENCLAW_ENROLL_TOKEN = "enrollment-token"
    irm https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/Install-OctofleetAgent.ps1 | iex
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$GatewayUrl = $env:OPENCLAW_GATEWAY_URL,
    
    [Parameter()]
    [string]$GatewayToken = $env:OPENCLAW_GATEWAY_TOKEN,
    
    [Parameter()]
    [string]$EnrollToken = $env:OPENCLAW_ENROLL_TOKEN,
    
    [Parameter()]
    [string]$InstallPath = "C:\Program Files\Octofleet",
    
    [Parameter()]
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Faster downloads

# Constants
$RepoOwner = "BenediktSchackenberg"
$RepoName = "openclaw-windows-agent"
$ServiceName = "Octofleet Agent"
$ServiceExe = "DIOOctofleetAgent.Service.exe"

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

function Get-LatestRelease {
    Write-Status "Fetching latest release from GitHub..."
    $apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
    
    try {
        $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "Octofleet-Installer" }
        return $release
    }
    catch {
        throw "Failed to fetch release info: $_"
    }
}

function Get-InstalledVersion {
    $exePath = Join-Path $InstallPath $ServiceExe
    if (Test-Path $exePath) {
        return (Get-Item $exePath).VersionInfo.ProductVersion
    }
    return $null
}

function Install-OctofleetAgent {
    # Check admin rights
    if (-not (Test-Administrator)) {
        throw "This script requires Administrator privileges. Please run as Administrator."
    }
    
    Write-Status "Octofleet Windows Agent Installer" "Info"
    Write-Host ""
    
    # Get release info
    $release = Get-LatestRelease
    $tagName = $release.tag_name
    $version = $tagName -replace '^v', ''
    
    Write-Status "Latest version: $version"
    
    # Check if already installed
    $installedVersion = Get-InstalledVersion
    if ($installedVersion -and -not $Force) {
        if ([Version]$installedVersion -ge [Version]$version) {
            Write-Status "Already up to date (v$installedVersion)" "Success"
            return
        }
        Write-Status "Upgrading from v$installedVersion to v$version" "Info"
    }
    
    # Find ZIP asset
    $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
    if (-not $zipAsset) {
        throw "No ZIP asset found in release $tagName"
    }
    
    # Download
    $tempZip = Join-Path $env:TEMP "OctofleetAgent-$version.zip"
    Write-Status "Downloading $($zipAsset.name)..."
    Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $tempZip
    
    # Verify hash if available
    $hashAsset = $release.assets | Where-Object { $_.name -like "*.sha256" } | Select-Object -First 1
    if ($hashAsset) {
        Write-Status "Verifying checksum..."
        $expectedHash = (Invoke-RestMethod -Uri $hashAsset.browser_download_url).Split(" ")[0]
        $actualHash = (Get-FileHash -Path $tempZip -Algorithm SHA256).Hash
        if ($expectedHash -ne $actualHash) {
            Remove-Item $tempZip -Force
            throw "Checksum verification failed!"
        }
        Write-Status "Checksum verified" "Success"
    }
    
    # Stop existing service
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        Write-Status "Stopping existing service..."
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    
    # Extract
    Write-Status "Extracting to $InstallPath..."
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }
    Expand-Archive -Path $tempZip -DestinationPath $InstallPath -Force
    
    # Cleanup temp file
    Remove-Item $tempZip -Force
    
    # Create config if needed
    $configPath = Join-Path $InstallPath "service-config.json"
    if (-not (Test-Path $configPath) -or $GatewayUrl -or $GatewayToken) {
        Write-Status "Creating configuration..."
        
        $config = @{
            GatewayUrl = if ($GatewayUrl) { $GatewayUrl } else { "ws://localhost:18789" }
            GatewayToken = if ($GatewayToken) { $GatewayToken } else { "" }
            NodeName = $env:COMPUTERNAME
            HeartbeatIntervalSeconds = 30
            InventoryPushIntervalMinutes = 60
            EventlogEnabled = $true
            AutoUpdate = $true
        }
        
        if ($EnrollToken) {
            $config.EnrollToken = $EnrollToken
        }
        
        $config | ConvertTo-Json -Depth 10 | Out-File -FilePath $configPath -Encoding UTF8
    }
    
    # Install service
    $exePath = Join-Path $InstallPath $ServiceExe
    if (-not $service) {
        Write-Status "Installing Windows Service..."
        & $exePath install
    }
    
    # Start service
    Write-Status "Starting service..."
    & $exePath start
    Start-Sleep -Seconds 2
    
    # Verify
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq "Running") {
        Write-Status "Octofleet Agent v$version installed successfully!" "Success"
        Write-Host ""
        Write-Host "Service Status: Running"
        Write-Host "Install Path:   $InstallPath"
        Write-Host "Config File:    $configPath"
    }
    else {
        Write-Status "Service may not have started correctly. Check logs at: $InstallPath\logs\" "Warning"
    }
}

# Run installer
Install-OctofleetAgent
