# Fix-ApiKey.ps1
# Updates the Octofleet Agent API Key to the correct value
# Run as Administrator on affected nodes (WIN-5AB0HPGJPAN, OBELIX)

$ConfigPath = "C:\ProgramData\Octofleet\service-config.json"
$CorrectApiKey = "octofleet-inventory-dev-key"

Write-Host "Octofleet API Key Fix Script" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

if (-not (Test-Path $ConfigPath)) {
    Write-Host "ERROR: Config file not found at $ConfigPath" -ForegroundColor Red
    exit 1
}

# Read current config
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$currentKey = $config.InventoryApiKey

Write-Host "Current API Key: $currentKey"
Write-Host "Correct API Key: $CorrectApiKey"

if ($currentKey -eq $CorrectApiKey) {
    Write-Host "API Key is already correct. No changes needed." -ForegroundColor Green
    exit 0
}

# Update the key
$config.InventoryApiKey = $CorrectApiKey

# Save config
$config | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath -Encoding UTF8

Write-Host "API Key updated successfully!" -ForegroundColor Green

# Restart the service
Write-Host "Restarting Octofleet Agent service..." -ForegroundColor Yellow

$serviceName = Get-Service -Name "Octofleet*" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Name

if ($serviceName) {
    Restart-Service -Name $serviceName -Force
    Write-Host "Service '$serviceName' restarted." -ForegroundColor Green
} else {
    Write-Host "WARNING: Could not find Octofleet service. Please restart manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! The agent should now authenticate correctly." -ForegroundColor Cyan
