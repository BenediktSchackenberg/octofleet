<#
.SYNOPSIS
    Signs all Octofleet executables with a code signing certificate

.EXAMPLE
    .\Sign-Release.ps1 -CertPath "C:\certs\OctofleetCodeSigning.pfx" -Password "secret"
    .\Sign-Release.ps1 -Thumbprint "ABC123..." 
#>

param(
    [string]$CertPath,
    [string]$Password,
    [string]$Thumbprint,
    [string]$BuildDir = "..\publish",
    [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

Write-Host "🐙 Signing Octofleet Release" -ForegroundColor Cyan
Write-Host ""

# Find signtool
$signtool = Get-Command signtool -ErrorAction SilentlyContinue
if (-not $signtool) {
    # Try Windows SDK paths
    $sdkPaths = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe"
    )
    foreach ($pattern in $sdkPaths) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object -Descending | Select-Object -First 1
        if ($found) {
            $signtool = $found.FullName
            break
        }
    }
}

if (-not $signtool) {
    Write-Error "signtool.exe not found. Install Windows SDK or Visual Studio."
}

Write-Host "Using signtool: $signtool" -ForegroundColor Gray

# Build sign arguments
$signArgs = @("sign", "/fd", "SHA256", "/tr", $TimestampServer, "/td", "SHA256")

if ($CertPath) {
    if (-not (Test-Path $CertPath)) {
        Write-Error "Certificate not found: $CertPath"
    }
    $signArgs += "/f", $CertPath
    if ($Password) {
        $signArgs += "/p", $Password
    }
} elseif ($Thumbprint) {
    $signArgs += "/sha1", $Thumbprint
} else {
    Write-Error "Provide -CertPath or -Thumbprint"
}

# Find executables to sign
$buildPath = Resolve-Path $BuildDir -ErrorAction SilentlyContinue
if (-not $buildPath) {
    Write-Error "Build directory not found: $BuildDir"
}

$filesToSign = @(
    "OctofleetAgent.Service.exe",
    "OctofleetScreenHelper.exe",
    "OctofleetAgent.exe"
)

$signedCount = 0
foreach ($file in $filesToSign) {
    $filePath = Get-ChildItem -Path $buildPath -Recurse -Filter $file -ErrorAction SilentlyContinue | Select-Object -First 1
    
    if ($filePath) {
        Write-Host "Signing: $($filePath.Name)..." -NoNewline
        
        $result = & $signtool @signArgs $filePath.FullName 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host " ✅" -ForegroundColor Green
            $signedCount++
        } else {
            Write-Host " ❌" -ForegroundColor Red
            Write-Host $result -ForegroundColor Red
        }
    } else {
        Write-Host "⚠️  Not found: $file" -ForegroundColor Yellow
    }
}

# Sign MSI if exists
$msiFiles = Get-ChildItem -Path $buildPath -Filter "*.msi" -ErrorAction SilentlyContinue
foreach ($msi in $msiFiles) {
    Write-Host "Signing: $($msi.Name)..." -NoNewline
    $result = & $signtool @signArgs $msi.FullName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " ✅" -ForegroundColor Green
        $signedCount++
    } else {
        Write-Host " ❌" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✅ Signed $signedCount files" -ForegroundColor Green
