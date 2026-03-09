# Fix OctoFleet Agent Config — run on each Windows node as Administrator
# Usage: Run this in an elevated PowerShell prompt

$ApiUrl = "http://192.168.0.49:8080"
$ApiKey = "a9544b6300030bda29268e0f207b88ba446f6a31669a7c63"

$configPaths = @(
    "C:\Program Files\OctofleetAgent\service-config.json",
    "C:\Program Files\Octofleet\service-config.json"
)

$found = $false
foreach ($p in $configPaths) {
    if (Test-Path $p) {
        $config = Get-Content $p -Raw | ConvertFrom-Json
        $config.InventoryApiUrl = $ApiUrl
        $config.InventoryApiKey = $ApiKey
        $config | ConvertTo-Json -Depth 10 | Set-Content $p -Force
        Write-Host "Updated $p" -ForegroundColor Green
        $found = $true
        break
    }
}

if (-not $found) {
    Write-Host "Config file not found! Checked:" -ForegroundColor Red
    $configPaths | ForEach-Object { Write-Host "  $_" }
    exit 1
}

# Restart agent service
Restart-Service OctofleetNodeAgent -Force
Write-Host "Service restarted" -ForegroundColor Green

# Verify
Start-Sleep -Seconds 5
$svc = Get-Service OctofleetNodeAgent
Write-Host "Agent status: $($svc.Status)" -ForegroundColor Cyan
