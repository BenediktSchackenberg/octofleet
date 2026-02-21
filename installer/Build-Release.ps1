<#
.SYNOPSIS
    Build and package the Octofleet Agent Service for release

.DESCRIPTION
    Builds the service in Release mode and creates a ZIP for distribution.

.EXAMPLE
    .\Build-Release.ps1
    Creates: OctofleetAgent.Service.zip

.EXAMPLE
    .\Build-Release.ps1 -Version "0.3.0" -CreateGitHubRelease
    Builds and creates a GitHub release (requires gh CLI)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Version = "0.3.0",

    [Parameter(Mandatory = $false)]
    [switch]$CreateGitHubRelease
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serviceProject = Join-Path $repoRoot "src\OctofleetAgent.Service\OctofleetAgent.Service.csproj"
$publishDir = Join-Path $repoRoot "publish"
$outputZip = Join-Path $repoRoot "OctofleetAgent.Service.zip"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Octofleet Agent - Release Builder" -ForegroundColor Cyan
Write-Host "  Version: $Version" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean
Write-Host "[1/4] Cleaning previous build..." -ForegroundColor Green
if (Test-Path $publishDir) { Remove-Item -Path $publishDir -Recurse -Force }
if (Test-Path $outputZip) { Remove-Item -Path $outputZip -Force }

# Step 2: Build
Write-Host "[2/4] Building Release..." -ForegroundColor Green
dotnet publish $serviceProject -c Release -o $publishDir --self-contained false
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

# Step 3: Create ZIP
Write-Host "[3/4] Creating ZIP package..." -ForegroundColor Green
Compress-Archive -Path "$publishDir\*" -DestinationPath $outputZip -Force
$zipSize = (Get-Item $outputZip).Length / 1MB
Write-Host "  Created: $outputZip ($([math]::Round($zipSize, 2)) MB)" -ForegroundColor Gray

# Step 4: GitHub Release (optional)
if ($CreateGitHubRelease) {
    Write-Host "[4/4] Creating GitHub Release..." -ForegroundColor Green
    
    # Check if gh is installed
    $ghInstalled = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghInstalled) {
        Write-Host "  GitHub CLI (gh) not installed. Install from: https://cli.github.com" -ForegroundColor Yellow
        Write-Host "  Skipping GitHub release creation." -ForegroundColor Yellow
    } else {
        $tagName = "v$Version"
        $releaseName = "Octofleet Agent v$Version"
        
        # Create release and upload asset
        gh release create $tagName $outputZip --title $releaseName --notes "Octofleet Node Agent v$Version`n`nDownload and run the installer script for automatic installation."
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  GitHub Release created: $tagName" -ForegroundColor Green
        } else {
            Write-Host "  Failed to create GitHub release" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "[4/4] Skipping GitHub release (use -CreateGitHubRelease to enable)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output: $outputZip" -ForegroundColor Yellow
Write-Host ""
Write-Host "To create a GitHub release manually:" -ForegroundColor Gray
Write-Host "  1. Go to: https://github.com/BenediktSchackenberg/octofleet/releases/new" -ForegroundColor Gray
Write-Host "  2. Tag: v$Version" -ForegroundColor Gray
Write-Host "  3. Upload: $outputZip" -ForegroundColor Gray
Write-Host ""
