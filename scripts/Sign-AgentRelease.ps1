#Requires -Version 5.1
<#
.SYNOPSIS
    Downloads, signs, and re-uploads an OctoFleet Agent release.

.DESCRIPTION
    1. Downloads the agent ZIP from a GitHub Release
    2. Extracts and signs all EXEs + DLLs with your Certum code signing cert
    3. Re-packages into a signed ZIP
    4. Uploads the signed ZIP back to the GitHub Release (replaces unsigned)

.PARAMETER Version
    Release tag, e.g. "v0.7.0". Defaults to latest.

.PARAMETER CertName
    Certificate CN for signtool /n. Default: "Open Source Developer Jan-Benedikt Schackenberg"

.PARAMETER GitHubToken
    GitHub PAT with repo scope. Can also be set via GITHUB_TOKEN env var.

.EXAMPLE
    .\Sign-AgentRelease.ps1 -Version v0.7.0 -GitHubToken ghp_xxxx
#>

param(
    [string]$Version = "latest",
    [string]$CertHash = "7a9afaf3e49638746f2e5d9288e79c5f669f7d71",
    [string]$CertCSP = "Microsoft Base Smart Card Crypto Provider",
    [string]$KeyContainer = "AT_KEYEXCHANGE",
    [string]$GitHubToken = $env:GITHUB_TOKEN,
    [string]$TimestampServer = "http://time.certum.pl",
    [string]$Repo = "BenediktSchackenberg/octofleet"
)

$ErrorActionPreference = "Stop"

# --- Find signtool ---
$signtoolPaths = @(
    "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe",
    "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe",
    "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe"
)
$signtool = $signtoolPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $signtool) {
    # Try PATH
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}
if (-not $signtool) {
    Write-Error "signtool.exe not found. Install Windows SDK: winget install Microsoft.WindowsSDK.10.0.22621"
    exit 1
}
Write-Host "Using signtool: $signtool" -ForegroundColor Cyan

# --- Validate token ---
if (-not $GitHubToken) {
    Write-Error "GitHub token required. Pass -GitHubToken or set GITHUB_TOKEN env var."
    exit 1
}

$headers = @{
    Authorization = "Bearer $GitHubToken"
    Accept        = "application/vnd.github+json"
}

# --- Get release info ---
Write-Host "`nFetching release info..." -ForegroundColor Cyan
if ($Version -eq "latest") {
    $releaseUrl = "https://api.github.com/repos/$Repo/releases/latest"
} else {
    $releaseUrl = "https://api.github.com/repos/$Repo/releases/tags/$Version"
}

$release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers
$releaseName = $release.tag_name
$releaseId = $release.id
Write-Host "Release: $releaseName (ID: $releaseId)" -ForegroundColor Green

# --- Find agent ZIP asset ---
$zipAsset = $release.assets | Where-Object { $_.name -match "OctofleetAgent.*\.zip$" -and $_.name -notmatch "signed" } | Select-Object -First 1
if (-not $zipAsset) {
    Write-Error "No OctofleetAgent ZIP found in release $releaseName"
    exit 1
}
Write-Host "Found asset: $($zipAsset.name) ($([math]::Round($zipAsset.size / 1MB, 2)) MB)" -ForegroundColor Green

# --- Setup temp directory ---
$tempDir = Join-Path $env:TEMP "octofleet-signing-$releaseName"
$extractDir = Join-Path $tempDir "agent"
$zipPath = Join-Path $tempDir $zipAsset.name
$signedZipName = $zipAsset.name -replace "\.zip$", "-signed.zip"
$signedZipPath = Join-Path $tempDir $signedZipName

if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

# --- Download ---
Write-Host "`nDownloading $($zipAsset.name)..." -ForegroundColor Cyan
$downloadHeaders = @{
    Authorization = "Bearer $GitHubToken"
    Accept        = "application/octet-stream"
}
Invoke-WebRequest -Uri $zipAsset.url -Headers $downloadHeaders -OutFile $zipPath
Write-Host "Downloaded to $zipPath" -ForegroundColor Green

# --- Extract ---
Write-Host "`nExtracting..." -ForegroundColor Cyan
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
$files = Get-ChildItem $extractDir -Recurse -Include "*.exe", "*.dll"
Write-Host "Found $($files.Count) files to sign" -ForegroundColor Green

# --- Sign ---
Write-Host "`nSigning files (smartcard PIN will be requested)..." -ForegroundColor Yellow
$signed = 0
$failed = 0
foreach ($file in $files) {
    Write-Host "  Signing $($file.Name)..." -NoNewline
    $result = & $signtool sign /sha1 $CertHash /csp $CertCSP /kc $KeyContainer /t $TimestampServer /fd sha256 /v $file.FullName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " OK" -ForegroundColor Green
        $signed++
    } else {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Host "    $result" -ForegroundColor DarkRed
        $failed++
    }
}

Write-Host "`nSigned: $signed, Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
if ($failed -gt 0) {
    Write-Error "$failed files failed to sign. Aborting upload."
    exit 1
}

# --- Verify one file ---
Write-Host "`nVerifying signature..." -ForegroundColor Cyan
$mainExe = $files | Where-Object { $_.Name -eq "OctofleetAgent.Service.exe" } | Select-Object -First 1
if ($mainExe) {
    & $signtool verify /pa /v $mainExe.FullName 2>&1 | Select-Object -Last 5
}

# --- Repackage ---
Write-Host "`nCreating signed ZIP..." -ForegroundColor Cyan
Compress-Archive -Path "$extractDir\*" -DestinationPath $signedZipPath -Force
$signedSize = (Get-Item $signedZipPath).Length
Write-Host "Created $signedZipName ($([math]::Round($signedSize / 1MB, 2)) MB)" -ForegroundColor Green

# --- Generate SHA256 ---
$sha256 = (Get-FileHash $signedZipPath -Algorithm SHA256).Hash.ToLower()
$sha256File = Join-Path $tempDir ($signedZipName -replace "\.zip$", ".sha256")
"$sha256  $signedZipName" | Set-Content $sha256File -Encoding UTF8
Write-Host "SHA256: $sha256" -ForegroundColor Cyan

# --- Upload to GitHub Release ---
Write-Host "`nUploading to GitHub Release..." -ForegroundColor Cyan
$uploadUrl = "https://uploads.github.com/repos/$Repo/releases/$releaseId/assets"

# Upload signed ZIP
$uploadHeaders = @{
    Authorization  = "Bearer $GitHubToken"
    "Content-Type" = "application/zip"
}
$response = Invoke-RestMethod -Uri "$uploadUrl`?name=$signedZipName" -Method Post -Headers $uploadHeaders -InFile $signedZipPath
Write-Host "Uploaded: $($response.name) ($($response.download_count) downloads)" -ForegroundColor Green

# Upload SHA256
$uploadHeaders["Content-Type"] = "text/plain"
$sha256AssetName = Split-Path $sha256File -Leaf
$response = Invoke-RestMethod -Uri "$uploadUrl`?name=$sha256AssetName" -Method Post -Headers $uploadHeaders -InFile $sha256File
Write-Host "Uploaded: $($response.name)" -ForegroundColor Green

# --- Cleanup ---
Write-Host "`nCleaning up..." -ForegroundColor Cyan
Remove-Item $tempDir -Recurse -Force

# --- Done ---
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  SIGNING COMPLETE" -ForegroundColor Green
Write-Host "  Release: $releaseName" -ForegroundColor Green
Write-Host "  Files signed: $signed" -ForegroundColor Green
Write-Host "  Asset: $signedZipName" -ForegroundColor Green
Write-Host "  SHA256: $sha256" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green
