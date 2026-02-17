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
    $env:OCTOFLEET_ENROLL_TOKEN = "enrollment-token"
    irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1 | iex
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$GatewayUrl = $env:OCTOFLEET_GATEWAY_URL,
    
    [Parameter()]
    [string]$GatewayToken = $env:OCTOFLEET_GATEWAY_TOKEN,
    
    [Parameter()]
    [string]$EnrollToken = $env:OCTOFLEET_ENROLL_TOKEN,
    
    [Parameter()]
    [string]$InstallPath = "C:\Program Files\Octofleet",
    
    [Parameter()]
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Faster downloads

# Force TLS 1.2 for GitHub
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Constants
$RepoOwner = "BenediktSchackenberg"
$RepoName = "octofleet"
$ServiceName = "Octofleet Agent"
$ServiceExe = "OctofleetAgent.Service.exe"

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
    $apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases"
    
    try {
        $releases = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "Octofleet-Installer" }
        
        # Find the first release that has a ZIP asset
        foreach ($release in $releases) {
            $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" }
            if ($zipAsset) {
                Write-Status "Found release $($release.tag_name) with ZIP asset"
                return $release
            }
        }
        
        throw "No release found with ZIP asset"
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
    # Clean version - remove git hash suffix (e.g., "0.4.29+abc123" -> "0.4.29")
    $versionClean = ($version -split '\+')[0]
    
    Write-Status "Latest version: $versionClean"
    
    # Check if already installed
    $installedVersion = Get-InstalledVersion
    # Clean installed version too
    $installedVersionClean = if ($installedVersion) { ($installedVersion -split '\+')[0] } else { $null }
    
    if ($installedVersionClean -and -not $Force) {
        if ([Version]$installedVersionClean -ge [Version]$versionClean) {
            Write-Status "Already up to date (v$installedVersionClean)" "Success"
            return
        }
        Write-Status "Upgrading from v$installedVersionClean to v$versionClean" "Info"
    }
    
    # Find ZIP asset
    $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
    if (-not $zipAsset) {
        throw "No ZIP asset found in release $tagName"
    }
    
    # Ensure temp directory exists
    $tempDir = $env:TEMP
    if (-not $tempDir) { $tempDir = "C:\Windows\Temp" }
    if (-not (Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    }
    
    # Download
    $tempZip = Join-Path $tempDir "OctofleetAgent-$version.zip"
    Write-Status "Downloading $($zipAsset.name) ($([math]::Round($zipAsset.size / 1MB, 1)) MB)..."
    
    # Use WebClient for better large file handling
    $webClient = New-Object System.Net.WebClient
    $webClient.Headers.Add("User-Agent", "Octofleet-Installer")
    try {
        $webClient.DownloadFile($zipAsset.browser_download_url, $tempZip)
    }
    finally {
        $webClient.Dispose()
    }
    
    if (-not (Test-Path $tempZip)) {
        throw "Download failed - file not found at $tempZip"
    }
    Write-Status "Downloaded successfully" "Success"
    
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
    
    # Create config in ProgramData (where the service reads from)
    $configDir = Join-Path $env:ProgramData "Octofleet"
    $configPath = Join-Path $configDir "service-config.json"
    
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Force -Path $configDir | Out-Null
    }
    
    # Only create minimal config - agent will auto-register and get full config
    if (-not (Test-Path $configPath) -or $GatewayUrl -or $GatewayToken) {
        Write-Status "Creating configuration at $configPath..."
        
        $config = @{
            # Discovery URL - agent will register here and wait for approval
            DiscoveryUrl = if ($GatewayUrl) { $GatewayUrl } else { "http://192.168.0.5:8080" }
            DisplayName = $env:COMPUTERNAME
        }
        
        # If full config provided, use it (backwards compatibility)
        if ($GatewayUrl -and $GatewayUrl -notlike "http://192.168.0.5*") {
            $config.InventoryApiUrl = $GatewayUrl
            $config.InventoryApiKey = "octofleet-inventory-dev-key"
            $config.AutoPushInventory = $true
            $config.ScheduledPushEnabled = $true
            $config.ScheduledPushIntervalMinutes = 30
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
        Write-Status "Octofleet Agent v$versionClean installed successfully!" "Success"
        Write-Host ""
        Write-Host "Service Status: Running"
        Write-Host "Install Path:   $InstallPath"
        Write-Host "Config File:    $configPath"
        Write-Host ""
        Write-Host "NEXT STEP: Approve this node in the Octofleet Web UI:" -ForegroundColor Yellow
        Write-Host "           http://192.168.0.5:3000/nodes" -ForegroundColor Cyan
    }
    else {
        Write-Status "Service may not have started correctly. Check logs at: $InstallPath\logs\" "Warning"
    }
}

# Run installer
Install-OctofleetAgent
