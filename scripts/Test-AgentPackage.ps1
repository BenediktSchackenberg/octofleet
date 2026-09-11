<#
.SYNOPSIS
    Rejects incomplete agent packages and legacy or unexpected executables.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [switch]$RequireScreenHelper
)

$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path -LiteralPath $Path).Path
$requiredFiles = @('OctofleetAgent.Service.exe', 'Install-OctofleetAgent.ps1')
if ($RequireScreenHelper) {
    $requiredFiles += 'OctofleetScreenHelper.exe'
}
foreach ($name in $requiredFiles) {
    $file = Join-Path $packageRoot $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) {
        throw "Missing or empty required package file: $name"
    }
}

$allowedExecutables = @('OctofleetAgent.Service.exe', 'OctofleetScreenHelper.exe')
foreach ($file in Get-ChildItem -LiteralPath $packageRoot -Recurse -Force) {
    if ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "Package must not contain links: $($file.Name)"
    }
    if ($file.Name -like '*openclaw*') {
        throw "Legacy OpenClaw artifact in package: $($file.Name)"
    }
    if (-not $file.PSIsContainer -and $file.Extension -ieq '.exe' -and
        ($file.Name -notin $allowedExecutables -or $file.DirectoryName -ne $packageRoot)) {
        throw "Unexpected executable in package: $($file.Name)"
    }
}
Write-Host 'Agent package validation passed'
