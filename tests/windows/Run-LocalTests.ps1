<#
.SYNOPSIS
    Local test runner for Octofleet Windows Agent.
.DESCRIPTION
    Runs all Pester tests locally on a Windows machine with the agent installed.
    Useful for testing before CI or when self-hosted runner isn't available.
.PARAMETER ApiUrl
    Backend API URL (default: http://homeinvader.lan:8080)
.PARAMETER IncludeIntegration
    Run integration tests that require a running agent
.PARAMETER OutputPath
    Path for test reports (default: .\test-results)
.EXAMPLE
    .\Run-LocalTests.ps1 -IncludeIntegration
.EXAMPLE
    .\Run-LocalTests.ps1 -ApiUrl "http://192.168.0.5:8080" -IncludeIntegration
#>

[CmdletBinding()]
param(
    [string]$ApiUrl = "http://homeinvader.lan:8080",
    [switch]$IncludeIntegration,
    [string]$OutputPath = ".\test-results"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Octofleet Agent Local Test Suite" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Pester
Write-Host "[1/4] Checking Pester module..." -ForegroundColor Yellow
$pester = Get-Module -ListAvailable -Name Pester | Sort-Object Version -Descending | Select-Object -First 1

if (-not $pester -or $pester.Version -lt [version]"5.0.0") {
    Write-Host "   Installing Pester 5.x..." -ForegroundColor Yellow
    Install-Module -Name Pester -Force -SkipPublisherCheck -Scope CurrentUser
}

Import-Module Pester -MinimumVersion 5.0.0
Write-Host "   Pester $((Get-Module Pester).Version) loaded" -ForegroundColor Green

# Create output directory
Write-Host "[2/4] Creating output directory..." -ForegroundColor Yellow
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}
Write-Host "   Results will be saved to: $OutputPath" -ForegroundColor Green

# Find test files
Write-Host "[3/4] Discovering test files..." -ForegroundColor Yellow
$testPath = $PSScriptRoot
if (-not (Test-Path (Join-Path $testPath "*.Tests.ps1"))) {
    $testPath = Join-Path $PSScriptRoot "..\tests\windows"
}

$testFiles = Get-ChildItem -Path $testPath -Filter "*.Tests.ps1" -Recurse
Write-Host "   Found $($testFiles.Count) test file(s):" -ForegroundColor Green
$testFiles | ForEach-Object { Write-Host "     - $($_.Name)" -ForegroundColor Gray }

# Run tests
Write-Host "[4/4] Running tests..." -ForegroundColor Yellow
Write-Host ""

$results = @()
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

foreach ($testFile in $testFiles) {
    $testName = $testFile.BaseName -replace '\.Tests$', ''
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "Running: $($testFile.Name)" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    
    $config = New-PesterConfiguration
    $config.Run.Path = $testFile.FullName
    $config.Run.PassThru = $true
    $config.Output.Verbosity = "Detailed"
    $config.TestResult.Enabled = $true
    $config.TestResult.OutputPath = Join-Path $OutputPath "$testName-$timestamp.xml"
    $config.TestResult.OutputFormat = "NUnitXml"
    
    # Skip integration tests unless requested
    if (-not $IncludeIntegration -and $testFile.Name -match 'Integration|SelfUpdate') {
        $config.Filter.ExcludeTag = @("Integration")
    }
    
    # Pass API URL to tests
    $container = New-PesterContainer -Path $testFile.FullName -Data @{
        ApiUrl = $ApiUrl
    }
    $config.Run.Container = $container
    
    try {
        $result = Invoke-Pester -Configuration $config
        $results += $result
    }
    catch {
        Write-Warning "Test file $($testFile.Name) failed: $_"
    }
    
    Write-Host ""
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$totalPassed = ($results | Measure-Object -Property PassedCount -Sum).Sum
$totalFailed = ($results | Measure-Object -Property FailedCount -Sum).Sum
$totalSkipped = ($results | Measure-Object -Property SkippedCount -Sum).Sum
$total = $totalPassed + $totalFailed + $totalSkipped

Write-Host ""
Write-Host "  Total:   $total" -ForegroundColor White
Write-Host "  Passed:  $totalPassed" -ForegroundColor Green
Write-Host "  Failed:  $totalFailed" -ForegroundColor $(if ($totalFailed -gt 0) { "Red" } else { "Green" })
Write-Host "  Skipped: $totalSkipped" -ForegroundColor Yellow
Write-Host ""
Write-Host "Reports saved to: $OutputPath" -ForegroundColor Gray
Write-Host ""

if ($totalFailed -gt 0) {
    Write-Host "❌ Some tests failed!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✅ All tests passed!" -ForegroundColor Green
    exit 0
}
