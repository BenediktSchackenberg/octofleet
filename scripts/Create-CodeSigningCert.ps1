<#
.SYNOPSIS
    Creates a self-signed code signing certificate for Octofleet

.DESCRIPTION
    Creates a certificate that can be used to sign executables.
    For production, purchase a real certificate from DigiCert/Sectigo.

.EXAMPLE
    .\Create-CodeSigningCert.ps1
    .\Create-CodeSigningCert.ps1 -ExportPath "C:\certs" -Password "secret123"
#>

param(
    [string]$CertName = "Octofleet Code Signing",
    [string]$ExportPath = "$env:USERPROFILE\Documents\Octofleet-Certs",
    [string]$Password,
    [int]$ValidYears = 3
)

$ErrorActionPreference = "Stop"

Write-Host "🐙 Creating Octofleet Code Signing Certificate" -ForegroundColor Cyan
Write-Host ""

# Create export directory
if (-not (Test-Path $ExportPath)) {
    New-Item -ItemType Directory -Path $ExportPath -Force | Out-Null
}

# Generate password if not provided
if (-not $Password) {
    $Password = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object {[char]$_})
    Write-Host "Generated password: $Password" -ForegroundColor Yellow
    Write-Host "⚠️  Save this password securely!" -ForegroundColor Red
}

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText

# Create self-signed certificate
Write-Host "Creating certificate..." -ForegroundColor Gray
$cert = New-SelfSignedCertificate `
    -Subject "CN=$CertName, O=Octofleet, C=DE" `
    -Type CodeSigningCert `
    -KeySpec Signature `
    -KeyUsage DigitalSignature `
    -KeyLength 4096 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($ValidYears) `
    -CertStoreLocation "Cert:\CurrentUser\My"

Write-Host "✅ Certificate created: $($cert.Thumbprint)" -ForegroundColor Green

# Export PFX (for signing)
$pfxPath = Join-Path $ExportPath "OctofleetCodeSigning.pfx"
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
Write-Host "✅ Exported PFX: $pfxPath" -ForegroundColor Green

# Export CER (for distribution/trust)
$cerPath = Join-Path $ExportPath "OctofleetCodeSigning.cer"
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
Write-Host "✅ Exported CER: $cerPath" -ForegroundColor Green

Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "1. To sign executables:"
Write-Host '   signtool sign /fd SHA256 /f "' -NoNewline
Write-Host $pfxPath -ForegroundColor Yellow -NoNewline
Write-Host '" /p "' -NoNewline
Write-Host $Password -ForegroundColor Yellow -NoNewline
Write-Host '" /tr http://timestamp.digicert.com /td SHA256 MyApp.exe'
Write-Host ""
Write-Host "2. To trust on other machines (run as Admin):"
Write-Host '   Import-Certificate -FilePath "' -NoNewline
Write-Host $cerPath -ForegroundColor Yellow -NoNewline
Write-Host '" -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher"'
Write-Host ""
Write-Host "3. For MSI signing, also import to Root:"
Write-Host '   Import-Certificate -FilePath "' -NoNewline
Write-Host $cerPath -ForegroundColor Yellow -NoNewline
Write-Host '" -CertStoreLocation "Cert:\LocalMachine\Root"'
Write-Host ""

# Save info file
$infoPath = Join-Path $ExportPath "README.txt"
@"
Octofleet Code Signing Certificate
==================================

Thumbprint: $($cert.Thumbprint)
Valid Until: $($cert.NotAfter)
Password: [stored separately - DO NOT commit to git!]

Files:
- OctofleetCodeSigning.pfx - Private key (for signing)
- OctofleetCodeSigning.cer - Public cert (for trust distribution)

Sign executables:
  signtool sign /fd SHA256 /f OctofleetCodeSigning.pfx /p <password> /tr http://timestamp.digicert.com /td SHA256 <file.exe>

Trust on client machines (Admin required):
  Import-Certificate -FilePath OctofleetCodeSigning.cer -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher"
"@ | Set-Content $infoPath

Write-Host "✅ Info saved: $infoPath" -ForegroundColor Green
Write-Host ""
Write-Host "🔐 Keep PFX and password SECURE!" -ForegroundColor Red
