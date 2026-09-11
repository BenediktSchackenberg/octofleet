# Build-Release.ps1
# Builds and packages the Octofleet Windows Agent for release
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    
    [switch]$CreateRelease,
    
    [string]$OutputPath = ".\release",

    [string]$SigningThumbprint,

    [string]$TimestampServer = "http://time.certum.pl"
)

$ErrorActionPreference = "Stop"

# Find solution/project
$projectPath = "$PSScriptRoot\..\src\OctofleetAgent.Service\OctofleetAgent.Service.csproj"
if (-not (Test-Path $projectPath)) {
    throw "Project not found: $projectPath"
}

Write-Host "Building Octofleet Windows Agent v$Version..." -ForegroundColor Cyan

# Use a new staging directory for every build. dotnet publish does not remove
# unrelated files, so never package the repository's old publish directory.
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

# Build paths
$publishPath = Join-Path $OutputPath ("publish-" + [guid]::NewGuid().ToString('N'))
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
    throw "Service build failed; refusing to package an incomplete release"
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
        throw "Screen Helper build failed; refusing to package an incomplete release"
    } else {
        Write-Host "Screen Helper included in release" -ForegroundColor Green
    }
} else {
    Write-Host "Screen Helper project not found - skipping" -ForegroundColor Yellow
}

# Copy installer script
$installerSrc = "$PSScriptRoot\..\Install-OctofleetAgent.ps1"
Copy-Item -LiteralPath $installerSrc -Destination $publishPath

# Fail before creating an archive if a legacy or unexpected agent is present.
& "$PSScriptRoot\Test-AgentPackage.ps1" -Path $publishPath `
    -RequireScreenHelper:(Test-Path $helperProjectPath)

# Sign before packaging so the checksum covers the signed executables.
if ($SigningThumbprint) {
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $signtool) {
        $signtool = Get-Item "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $signtool) { throw 'signtool.exe not found; install the Windows SDK before signing' }

    $executables = @(Get-ChildItem -LiteralPath $publishPath -Filter '*.exe' -File)
    & $signtool sign /sha1 $SigningThumbprint /fd SHA256 /tr $TimestampServer /td SHA256 @($executables.FullName)
    if ($LASTEXITCODE -ne 0) { throw 'Code signing failed; refusing to package an unsigned release' }
    foreach ($executable in $executables) {
        & $signtool verify /pa $executable.FullName
        if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $($executable.Name)" }
        $signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
        if ($signature.SignerCertificate.Thumbprint -ne $SigningThumbprint -or -not $signature.TimeStamperCertificate) {
            throw "Unexpected signer or missing timestamp: $($executable.Name)"
        }
    }
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

See [CHANGELOG.md](https://github.com/BenediktSchackenberg/octofleet/blob/main/CHANGELOG.md) for details.

### Installation
``````powershell
irm https://github.com/BenediktSchackenberg/octofleet/releases/download/v$Version/Install-OctofleetAgent.ps1 | iex
``````

### SHA256
``$hash``
"@
    
    gh release create "v$Version" $zipPath "$OutputPath\OctofleetAgent-v$Version.sha256" $installerSrc `
        --title "v$Version" `
        --notes $releaseNotes
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Release created successfully!" -ForegroundColor Green
    }
}
