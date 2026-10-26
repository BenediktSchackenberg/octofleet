<#
.SYNOPSIS
    Removes the Octofleet agent from this machine.

.DESCRIPTION
    Stops and deletes the agent service (found by its executable, whatever its name, so
    both "OctofleetNodeAgent" and older "Octofleet Agent" installs are covered), ends
    remaining agent processes, removes the screen helper task, the program and data
    folders and the DOTNET_BUNDLE_EXTRACT_BASE_DIR machine variable.

    The Octofleet console runs this script through the "uninstall-agent" job (Remove node).
    Run it by hand, as Administrator, on machines the console can no longer reach; then
    delete the node in the console.

.EXAMPLE
    .\Uninstall-OctofleetAgent.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallPath = "C:\Program Files\Octofleet",
    [string]$DataPath = (Join-Path $env:ProgramData "Octofleet"),
    [int]$DelaySeconds = 0,
    [string]$LogFile
)

$ErrorActionPreference = "Continue"

function Write-Log([string]$Message) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
    Write-Host $line
    if ($LogFile) { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue }
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script requires Administrator privileges."
}

if ($DelaySeconds -gt 0) {
    Write-Log "Uninstalling the Octofleet agent in $DelaySeconds seconds..."
    Start-Sleep -Seconds $DelaySeconds
}

# Services that run the agent executable
$exePath = Join-Path $InstallPath "OctofleetAgent.Service.exe"
foreach ($svc in Get-CimInstance Win32_Service -ErrorAction SilentlyContinue) {
    $path = "$($svc.PathName)".Trim()
    if ($path.StartsWith('"')) {
        $end = $path.IndexOf('"', 1)
        if ($end -gt 0) { $path = $path.Substring(1, $end - 1) }
    }
    if ($path -ieq $exePath) {
        Write-Log "Stopping and deleting service '$($svc.Name)'"
        Stop-Service -Name $svc.Name -Force -ErrorAction SilentlyContinue
        sc.exe delete "$($svc.Name)" | Out-Null
    }
}

Get-Process -Name "OctofleetAgent.Service", "OctofleetScreenHelper" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Log "Ending process $($_.Name) ($($_.Id))"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

schtasks.exe /Query /TN "OctofleetScreenHelper" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Log "Removing scheduled task 'OctofleetScreenHelper'"
    schtasks.exe /Delete /TN "OctofleetScreenHelper" /F | Out-Null
}

Start-Sleep -Seconds 2
foreach ($dir in @($InstallPath, $DataPath)) {
    for ($attempt = 1; $attempt -le 3 -and (Test-Path $dir); $attempt++) {
        Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $dir) { Start-Sleep -Seconds 2 }
    }
    if (Test-Path $dir) { Write-Log "WARNING: could not remove $dir" } else { Write-Log "Removed $dir" }
}

if ([Environment]::GetEnvironmentVariable("DOTNET_BUNDLE_EXTRACT_BASE_DIR", "Machine")) {
    [Environment]::SetEnvironmentVariable("DOTNET_BUNDLE_EXTRACT_BASE_DIR", $null, "Machine")
    Write-Log "Removed machine variable DOTNET_BUNDLE_EXTRACT_BASE_DIR"
}

Write-Log "Octofleet agent removed"
