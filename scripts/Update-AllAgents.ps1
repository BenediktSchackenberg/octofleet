# Update-AllAgents.ps1
# Updates all agents in your fleet to latest version
# Run from management workstation with WinRM access

param(
    [string]$Version = "0.4.16",
    [string[]]$ComputerNames = @("BALTASA", "HYPERV02", "SQLSERVER1", "SCVMM", "CONTROLLER"),
    [switch]$WhatIf
)

$scriptBlock = {
    param($Version)
    
    $ServiceName = "OctofleetNodeAgent"
    $InstallDir = "C:\Program Files\Octofleet\Agent"
    $Url = "https://github.com/BenediktSchackenberg/octofleet-windows-agent/releases/download/v$Version/OctofleetAgent-v$Version-win-x64.zip"
    $tempZip = "$env:TEMP\OctofleetAgent.zip"
    
    # Check current version
    $exe = "$InstallDir\OctofleetAgent.Service.exe"
    if (Test-Path $exe) {
        $current = (Get-Item $exe).VersionInfo.FileVersion
        if ($current -like "$Version*") {
            return "Already on v$Version"
        }
    }
    
    # Download & Install
    Stop-Service $ServiceName -Force -EA SilentlyContinue
    Start-Sleep 2
    Invoke-WebRequest $Url -OutFile $tempZip -UseBasicParsing
    Expand-Archive $tempZip -DestinationPath $InstallDir -Force
    Start-Service $ServiceName
    Remove-Item $tempZip -Force -EA SilentlyContinue
    
    $newVer = (Get-Item $exe).VersionInfo.FileVersion
    return "Updated to v$newVer"
}

Write-Host "=== Octofleet Agent Fleet Update ===" -ForegroundColor Cyan
Write-Host "Target version: v$Version"
Write-Host "Targets: $($ComputerNames -join ', ')"
Write-Host ""

if ($WhatIf) {
    Write-Host "[WhatIf] Would update agents on: $($ComputerNames -join ', ')"
    exit 0
}

$results = @()
foreach ($computer in $ComputerNames) {
    Write-Host "[$computer] " -NoNewline
    try {
        $result = Invoke-Command -ComputerName $computer -ScriptBlock $scriptBlock -ArgumentList $Version -ErrorAction Stop
        Write-Host $result -ForegroundColor Green
        $results += [PSCustomObject]@{ Computer = $computer; Status = "Success"; Result = $result }
    }
    catch {
        Write-Host "FAILED: $_" -ForegroundColor Red
        $results += [PSCustomObject]@{ Computer = $computer; Status = "Failed"; Result = $_.Exception.Message }
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
