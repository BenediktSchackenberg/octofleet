# Build-Release.ps1
# Builds and packages the Octofleet Windows Agent for release
param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [switch]$CreateRelease,
    
    [string]$OutputPath = ".\release"
)

$ErrorActionPreference = "Stop"

# Find solution/project
$projectPath = "$PSScriptRoot\..\src\OctofleetAgent.Service\OctofleetAgent.Service.csproj"
if (-not (Test-Path $projectPath)) {
    Write-Error "Project not found: $projectPath"
    exit 1
}

Write-Host "Building Octofleet Windows Agent v$Version..." -ForegroundColor Cyan

# Clean output
if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

# Build paths
$publishPath = "$OutputPath\publish"
$zipPath = "$OutputPath\OctofleetAgent-v$Version.zip"

# Publish Service (self-contained, single file)
Write-Host "Publishing Service..." -ForegroundColor Yellow
dotnet publish $projectPath `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:Version=$Version `
    -p:AssemblyVersion=$Version.0 `
    -p:FileVersion=$Version.0 `
    -o $publishPath

if ($LASTEXITCODE -ne 0) {
    Write-Error "Service build failed!"
    exit 1
}

# Publish Screen Helper (self-contained, single file)
$helperProjectPath = "$PSScriptRoot\..\src\OctofleetScreenHelper\OctofleetScreenHelper.csproj"
if (Test-Path $helperProjectPath) {
    Write-Host "Publishing Screen Helper..." -ForegroundColor Yellow
    dotnet publish $helperProjectPath `
        -c Release `
        -r win-x64 `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:Version=$Version `
        -p:AssemblyVersion=$Version.0 `
        -p:FileVersion=$Version.0 `
        -o $publishPath

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Screen Helper build failed - continuing without it"
    } else {
        Write-Host "Screen Helper included in release" -ForegroundColor Green
    }
} else {
    Write-Host "Screen Helper project not found - skipping" -ForegroundColor Yellow
}

# Copy installer script
$installerSrc = "$PSScriptRoot\Install-OctofleetAgent.ps1"
if (Test-Path $installerSrc) {
    Copy-Item $installerSrc -Destination $publishPath
}

# Create ZIP
Write-Host "Creating ZIP archive..." -ForegroundColor Yellow
Compress-Archive -Path "$publishPath\*" -DestinationPath $zipPath -Force

# Calculate hash
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
Write-Host "SHA256: $hash" -ForegroundColor Green

# Save hash to file
$hash | Out-File "$OutputPath\OctofleetAgent-v$Version.sha256" -NoNewline

Write-Host "`nBuild complete!" -ForegroundColor Green
Write-Host "  ZIP: $zipPath"
Write-Host "  Hash: $hash"

# Create GitHub release if requested
if ($CreateRelease) {
    Write-Host "`nCreating GitHub release..." -ForegroundColor Yellow
    
    # Check for gh CLI
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Warning "GitHub CLI (gh) not found. Please create release manually."
        Write-Host "  gh release create v$Version '$zipPath' --title 'v$Version' --notes 'See CHANGELOG.md'"
        exit 0
    }
    
    # Create release
    $releaseNotes = @"
## Octofleet Windows Agent v$Version

See [CHANGELOG.md](https://github.com/BenediktSchackenberg/octofleet-windows-agent/blob/main/CHANGELOG.md) for details.

### Installation
``````powershell
irm https://github.com/BenediktSchackenberg/octofleet-windows-agent/releases/download/v$Version/Install-OctofleetAgent.ps1 | iex
``````

### SHA256
``$hash``
"@
    
    gh release create "v$Version" $zipPath `
        --title "v$Version" `
        --notes $releaseNotes
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Release created successfully!" -ForegroundColor Green
    }
}
