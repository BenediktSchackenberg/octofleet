<#
.SYNOPSIS
    Repairs a broken Octofleet Agent service installation

.DESCRIPTION
    Diagnoses and fixes common issues:
    - Service registered with wrong binary path
    - Service not starting due to missing files
    - Service stuck in stopped state
    - Files installed in wrong location

.PARAMETER ServiceName
    Name of the Windows Service (default: OctofleetNodeAgent)

.EXAMPLE
    # Run with defaults
    .\Repair-Service.ps1

.NOTES
    Requires Administrator privileges
#>

param(
    [string]$ServiceName = "OctofleetNodeAgent"
)

$ErrorActionPreference = "Stop"

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Octofleet Service Repair Tool ===" -ForegroundColor Cyan
Write-Host ""

# Possible installation locations (check in order of priority)
$possiblePaths = @(
    "C:\Program Files\Octofleet",
    "C:\Program Files\Octofleet\Agent",
    "C:\Program Files (x86)\Octofleet",
    "$env:ProgramData\Octofleet\Agent"
)

$exeName = "OctofleetAgent.Service.exe"

# Step 1: Check service registration
Write-Host "1. Checking service registration..." -ForegroundColor Yellow
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($service) {
    Write-Host "   Service found: $ServiceName" -ForegroundColor Green
    Write-Host "   Current Status: $($service.Status)"
    
    # Get registered binary path
    $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
    $registeredPath = (Get-ItemProperty -Path $regPath -Name ImagePath -ErrorAction SilentlyContinue).ImagePath
    $registeredPath = $registeredPath -replace '"', ''
    Write-Host "   Registered Path: $registeredPath"
    
    # Check if registered path exists
    if (Test-Path $registeredPath) {
        Write-Host "   Binary exists: YES" -ForegroundColor Green
    } else {
        Write-Host "   Binary exists: NO" -ForegroundColor Red
    }
} else {
    Write-Host "   Service NOT registered" -ForegroundColor Red
    $registeredPath = $null
}

# Step 2: Find actual installation
Write-Host ""
Write-Host "2. Searching for installation..." -ForegroundColor Yellow
$foundPath = $null
$foundExe = $null

foreach ($path in $possiblePaths) {
    $testExe = Join-Path $path $exeName
    if (Test-Path $testExe) {
        $foundPath = $path
        $foundExe = $testExe
        $version = (Get-Item $testExe).VersionInfo.FileVersion
        Write-Host "   Found at: $path (v$version)" -ForegroundColor Green
        break
    }
}

if (-not $foundExe) {
    Write-Host "   No installation found in any expected location" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checked locations:" -ForegroundColor Yellow
    foreach ($path in $possiblePaths) {
        $exists = if (Test-Path $path) { "(exists, no exe)" } else { "(missing)" }
        Write-Host "   - $path $exists"
    }
    Write-Host ""
    Write-Host "Please reinstall the agent using Install-OctofleetAgent.ps1" -ForegroundColor Yellow
    exit 1
}

# Step 3: Diagnose issues
Write-Host ""
Write-Host "3. Diagnosing issues..." -ForegroundColor Yellow
$issues = @()

# Issue: Service not registered
if (-not $service) {
    $issues += @{
        Type = "NOT_REGISTERED"
        Message = "Service is not registered"
        Fix = "Will register service"
    }
}

# Issue: Wrong binary path
if ($service -and $registeredPath -ne $foundExe) {
    $issues += @{
        Type = "WRONG_PATH"
        Message = "Service path mismatch: registered='$registeredPath', actual='$foundExe'"
        Fix = "Will update service path"
    }
}

# Issue: Binary doesn't exist at registered path
if ($service -and $registeredPath -and -not (Test-Path $registeredPath)) {
    $issues += @{
        Type = "MISSING_BINARY"
        Message = "Binary not found at registered path"
        Fix = "Will update service path to found location"
    }
}

# Issue: Service stopped
if ($service -and $service.Status -ne "Running") {
    $issues += @{
        Type = "NOT_RUNNING"
        Message = "Service is not running (Status: $($service.Status))"
        Fix = "Will start service"
    }
}

# Issue: Service disabled
if ($service) {
    $startType = (Get-ItemProperty -Path $regPath -Name Start -ErrorAction SilentlyContinue).Start
    $startTypes = @{0="Boot";1="System";2="Automatic";3="Manual";4="Disabled"}
    if ($startType -eq 4) {
        $issues += @{
            Type = "DISABLED"
            Message = "Service is disabled"
            Fix = "Will set to automatic start"
        }
    }
}

if ($issues.Count -eq 0) {
    Write-Host "   No issues found!" -ForegroundColor Green
    
    # Double check service is actually working
    if ($service.Status -eq "Running") {
        Write-Host ""
        Write-Host "Service appears healthy." -ForegroundColor Green
        exit 0
    }
}

Write-Host ""
Write-Host "Found $($issues.Count) issue(s):" -ForegroundColor Yellow
foreach ($issue in $issues) {
    Write-Host "   - $($issue.Message)" -ForegroundColor Red
    Write-Host "     Fix: $($issue.Fix)" -ForegroundColor Gray
}

# Step 4: Apply fixes
Write-Host ""
$confirm = Read-Host "Apply fixes? [Y/N]"
if ($confirm.ToUpper() -ne "Y") {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "4. Applying fixes..." -ForegroundColor Yellow

# Stop service if running
if ($service -and $service.Status -eq "Running") {
    Write-Host "   Stopping service..." -ForegroundColor Gray
    Stop-Service -Name $ServiceName -Force
    Start-Sleep -Seconds 2
}

# Kill any stuck processes
Get-Process -Name "OctofleetAgent*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

foreach ($issue in $issues) {
    switch ($issue.Type) {
        "NOT_REGISTERED" {
            Write-Host "   Registering service..." -ForegroundColor Gray
            sc.exe create $ServiceName binPath="$foundExe" start=auto DisplayName="Octofleet Agent" | Out-Null
            sc.exe description $ServiceName "Octofleet endpoint management agent" | Out-Null
            sc.exe failure $ServiceName reset=86400 actions=restart/5000/restart/10000/restart/30000 | Out-Null
            
            # Set extraction dir for Windows Server
            $extractDir = "C:\ProgramData\Octofleet\extract"
            if (-not (Test-Path $extractDir)) { New-Item -ItemType Directory -Path $extractDir -Force | Out-Null }
            reg add "HKLM\SYSTEM\CurrentControlSet\Services\$ServiceName" /v Environment /t REG_MULTI_SZ /d "DOTNET_BUNDLE_EXTRACT_BASE_DIR=$extractDir" /f | Out-Null
            
            Write-Host "   Service registered" -ForegroundColor Green
        }
        "WRONG_PATH" {
            Write-Host "   Updating service path..." -ForegroundColor Gray
            sc.exe config $ServiceName binPath="$foundExe" | Out-Null
            Write-Host "   Path updated" -ForegroundColor Green
        }
        "MISSING_BINARY" {
            Write-Host "   Updating service path to found location..." -ForegroundColor Gray
            sc.exe config $ServiceName binPath="$foundExe" | Out-Null
            Write-Host "   Path updated" -ForegroundColor Green
        }
        "DISABLED" {
            Write-Host "   Enabling service..." -ForegroundColor Gray
            sc.exe config $ServiceName start=auto | Out-Null
            Write-Host "   Service enabled" -ForegroundColor Green
        }
    }
}

# Ensure extraction dir is set (Windows Server fix)
$extractDir = "C:\ProgramData\Octofleet\extract"
if (-not (Test-Path $extractDir)) { 
    Write-Host "   Creating extraction directory..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null 
}
$currentEnv = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name Environment -EA SilentlyContinue).Environment
if (-not $currentEnv -or $currentEnv -notlike "*DOTNET_BUNDLE_EXTRACT*") {
    Write-Host "   Setting .NET extraction directory..." -ForegroundColor Gray
    reg add "HKLM\SYSTEM\CurrentControlSet\Services\$ServiceName" /v Environment /t REG_MULTI_SZ /d "DOTNET_BUNDLE_EXTRACT_BASE_DIR=$extractDir" /f | Out-Null
}

# Always try to start
Write-Host "   Starting service..." -ForegroundColor Gray
Start-Sleep -Seconds 1
try {
    Start-Service -Name $ServiceName -ErrorAction Stop
    Start-Sleep -Seconds 3
    
    $service = Get-Service -Name $ServiceName
    if ($service.Status -eq "Running") {
        Write-Host "   Service started!" -ForegroundColor Green
    } else {
        throw "Service status is $($service.Status)"
    }
} catch {
    Write-Host "   FAILED to start service: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checking Windows Event Log..." -ForegroundColor Yellow
    $events = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'; Level=2; StartTime=(Get-Date).AddMinutes(-5)} -MaxEvents 5 -ErrorAction SilentlyContinue
    foreach ($evt in $events) {
        Write-Host "   $($evt.TimeCreated): $($evt.Message)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Check logs at: C:\ProgramData\Octofleet\logs" -ForegroundColor Yellow
    exit 1
}

# Step 5: Verify
Write-Host ""
Write-Host "5. Verifying..." -ForegroundColor Yellow
$service = Get-Service -Name $ServiceName
$regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
$finalPath = (Get-ItemProperty -Path $regPath -Name ImagePath -ErrorAction SilentlyContinue).ImagePath -replace '"', ''

Write-Host ""
Write-Host "=== Service Status ===" -ForegroundColor Cyan
Write-Host "  Name:       $ServiceName"
Write-Host "  Status:     $($service.Status)" -ForegroundColor $(if ($service.Status -eq "Running") { "Green" } else { "Yellow" })
Write-Host "  Binary:     $finalPath"
Write-Host "  Version:    $((Get-Item $finalPath -ErrorAction SilentlyContinue).VersionInfo.FileVersion)"
Write-Host ""

if ($service.Status -eq "Running") {
    Write-Host "REPAIR SUCCESSFUL!" -ForegroundColor Green
} else {
    Write-Host "REPAIR INCOMPLETE - Service not running" -ForegroundColor Yellow
}
