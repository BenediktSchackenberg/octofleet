<#
.SYNOPSIS
    Octofleet Agent Code Signing Script
    Signs the latest release with your Certum smartcard certificate.

.DESCRIPTION
    Downloads the latest release ZIP, signs all EXE/DLL files with your
    Certum code-signing certificate (smartcard), and re-uploads to GitHub.
    
    Prerequisites:
    - Certum card reader plugged in with smartcard
    - proCertum CardManager running
    - Windows SDK installed (for signtool.exe)
    - GitHub PAT with 'repo' scope

.EXAMPLE
    .\Sign-Release.ps1
    .\Sign-Release.ps1 -Tag v0.5.5
#>

param(
    [string]$Tag,
    [string]$GitHubToken,
    [string]$TimestampServer = "http://time.certum.pl"
)

$ErrorActionPreference = "Stop"
$repo = "BenediktSchackenberg/octofleet"

# ── Colors ──────────────────────────────────────────
function Write-Step($msg) { Write-Host "  [>] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [✓] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  [✗] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor DarkCyan
Write-Host "  ║  🐙 Octofleet Release Signing Tool       ║" -ForegroundColor DarkCyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor DarkCyan
Write-Host ""

# ── GitHub Token ────────────────────────────────────
if (-not $GitHubToken) {
    $GitHubToken = $env:GITHUB_TOKEN
}
if (-not $GitHubToken) {
    $GitHubToken = Read-Host "GitHub PAT (repo scope)"
}
$headers = @{ Authorization = "token $GitHubToken"; Accept = "application/vnd.github.v3+json" }

# ── Find signtool.exe ──────────────────────────────
Write-Step "Looking for signtool.exe..."
$signtool = $null
$sdkPaths = @(
    "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe"
    "${env:ProgramFiles}\Windows Kits\10\bin\*\x64\signtool.exe"
)
foreach ($p in $sdkPaths) {
    $found = Get-Item $p -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { $signtool = $found.FullName; break }
}
if (-not $signtool) {
    Write-Err "signtool.exe not found! Install Windows SDK:"
    Write-Host "  winget install --id Microsoft.WindowsSDK.10.0.22621" -ForegroundColor Yellow
    exit 1
}
Write-OK "Found: $signtool"

# ── Check smartcard ─────────────────────────────────
Write-Step "Checking for code-signing certificate on smartcard..."
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { 
    $_.EnhancedKeyUsageList.ObjectId -contains "1.3.6.1.5.5.7.3.3" -and
    $_.Subject -like "*Schackenberg*"
} | Select-Object -First 1

if (-not $cert) {
    # Also check without private key filter — smartcard certs may show HasPrivateKey=False
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like "*Schackenberg*" } | Select-Object -First 1
}
if (-not $cert) {
    Write-Err "No code-signing certificate found! Make sure:"
    Write-Host "    - Card reader is plugged in" -ForegroundColor Yellow
    Write-Host "    - Smartcard is inserted" -ForegroundColor Yellow
    Write-Host "    - proCertum CardManager is running" -ForegroundColor Yellow
    Write-Host "    - Certificate is imported on the card" -ForegroundColor Yellow
    exit 1
}
Write-OK "Certificate: $($cert.Subject)"
Write-Host "    Thumbprint: $($cert.Thumbprint)" -ForegroundColor Gray
Write-Host "    Expires:    $($cert.NotAfter.ToString('yyyy-MM-dd'))" -ForegroundColor Gray

# ── Get release info ────────────────────────────────
Write-Step "Fetching release info..."
if ($Tag) {
    $releaseUrl = "https://api.github.com/repos/$repo/releases/tags/$Tag"
} else {
    $releaseUrl = "https://api.github.com/repos/$repo/releases/latest"
}
$release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers
$Tag = $release.tag_name
Write-OK "Release: $Tag ($($release.name))"

# ── Find the ZIP asset ──────────────────────────────
$zipAsset = $release.assets | Where-Object { $_.name -like "OctofleetAgent-*.zip" } | Select-Object -First 1
if (-not $zipAsset) {
    Write-Err "No OctofleetAgent ZIP found in release $Tag!"
    Write-Host "    Available assets:" -ForegroundColor Yellow
    $release.assets | ForEach-Object { Write-Host "      - $($_.name)" -ForegroundColor Gray }
    exit 1
}
Write-OK "Asset: $($zipAsset.name) ($([math]::Round($zipAsset.size / 1MB, 1)) MB)"

# ── Download ────────────────────────────────────────
$workDir = Join-Path $env:TEMP "octofleet-sign-$Tag"
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir | Out-Null

$zipPath = Join-Path $workDir $zipAsset.name
Write-Step "Downloading $($zipAsset.name)..."
$downloadHeaders = @{ Authorization = "token $GitHubToken"; Accept = "application/octet-stream" }
Invoke-WebRequest -Uri $zipAsset.url -Headers $downloadHeaders -OutFile $zipPath
Write-OK "Downloaded to $zipPath"

# ── Extract ─────────────────────────────────────────
$extractDir = Join-Path $workDir "extracted"
Write-Step "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $extractDir
Write-OK "Extracted"

# ── Sign all EXEs and DLLs ──────────────────────────
$filesToSign = Get-ChildItem $extractDir -Recurse -Include *.exe, *.dll
Write-Step "Signing $($filesToSign.Count) files..."
Write-Host ""
Write-Host "    ⚠ You may be prompted for your smartcard PIN!" -ForegroundColor Yellow
Write-Host ""

$signed = 0
$failed = 0
foreach ($file in $filesToSign) {
    $relativeName = $file.FullName.Replace("$extractDir\", "")
    Write-Host "    Signing: $relativeName" -ForegroundColor Gray -NoNewline
    
    $result = & $signtool sign /a /tr $TimestampServer /td sha256 /fd sha256 $file.FullName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " ✓" -ForegroundColor Green
        $signed++
    } else {
        Write-Host " ✗" -ForegroundColor Red
        Write-Host "      $result" -ForegroundColor Red
        $failed++
    }
}

if ($failed -gt 0) {
    Write-Err "$failed files failed to sign!"
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y") { exit 1 }
}
Write-OK "Signed $signed files"

# ── Repackage ZIP ───────────────────────────────────
$signedZip = Join-Path $workDir "OctofleetAgent-$Tag-signed.zip"
Write-Step "Creating signed ZIP..."
Compress-Archive -Path "$extractDir\*" -DestinationPath $signedZip
Write-OK "Created: $signedZip"

# ── Delete old asset & upload new one ───────────────
Write-Step "Replacing asset on GitHub..."

# Delete old unsigned ZIP
$deleteUrl = "https://api.github.com/repos/$repo/releases/assets/$($zipAsset.id)"
Invoke-RestMethod -Uri $deleteUrl -Method Delete -Headers $headers
Write-Host "    Deleted old: $($zipAsset.name)" -ForegroundColor Gray

# Upload signed ZIP (keep same name so AutoUpdater works!)
$uploadUrl = $release.upload_url -replace '\{.*\}', ''
$uploadUrl = "$uploadUrl`?name=$($zipAsset.name)"
$uploadHeaders = @{
    Authorization  = "token $GitHubToken"
    "Content-Type" = "application/zip"
}
$uploadResult = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -InFile $signedZip
Write-OK "Uploaded: $($uploadResult.name) ($([math]::Round($uploadResult.size / 1MB, 1)) MB)"

# ── Verify ──────────────────────────────────────────
Write-Step "Verifying signature on main EXE..."
$mainExe = Get-ChildItem $extractDir -Recurse -Filter "OctofleetAgent.Service.exe" | Select-Object -First 1
if ($mainExe) {
    $verifyResult = & $signtool verify /pa $mainExe.FullName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Signature verified!"
    } else {
        Write-Err "Verification failed: $verifyResult"
    }
}

# ── Cleanup ─────────────────────────────────────────
Remove-Item $workDir -Recurse -Force

# ── Done ────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  ✅ Release $Tag signed and uploaded!     " -ForegroundColor Green
Write-Host "  ║                                          ║" -ForegroundColor Green
Write-Host "  ║  Signed:  $signed files                       ║" -ForegroundColor Green
Write-Host "  ║  Cert:    Certum Open Source             ║" -ForegroundColor Green
Write-Host "  ║  TSA:     $TimestampServer    ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Agents will auto-update to the signed version on next check." -ForegroundColor Gray
Write-Host ""
