# Offline regression tests. dotnet is mocked: no agent or installer is executed.
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRoot = Join-Path $repoRoot ('tests/reports/package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$checks = 0
$failureState = @{ Project = '' }

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:checks++
    Write-Host "PASS: $Message"
}

function Assert-Throws([scriptblock]$Action, [string]$Message) {
    $threw = $false
    try { & $Action } catch { $threw = $true }
    Assert-True $threw $Message
}

function dotnet {
    $project = [string]$args[1]
    $destination = [string]$args[[Array]::IndexOf($args, '-o') + 1]
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $name = if ($project -like '*OctofleetScreenHelper*') { 'OctofleetScreenHelper' } else { 'OctofleetAgent.Service' }
    $global:LASTEXITCODE = 0
    if ($failureState.Project -eq $name) {
        $global:LASTEXITCODE = 1
        return
    }
    Set-Content -LiteralPath (Join-Path $destination "$name.exe") -Value 'Synthetic executable fixture; never run'
    Set-Content -LiteralPath (Join-Path $destination "$name.pdb") -Value 'Synthetic symbols'
}

try {
    # Exercise the real builder in a small synthetic checkout.
    $fixtureRepo = Join-Path $testRoot 'repo'
    foreach ($directory in @('scripts', 'src/OctofleetAgent.Service', 'src/OctofleetScreenHelper', 'publish')) {
        New-Item -ItemType Directory -Path (Join-Path $fixtureRepo $directory) -Force | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts/Build-Release.ps1'), (Join-Path $repoRoot 'scripts/Test-AgentPackage.ps1') -Destination (Join-Path $fixtureRepo 'scripts')
    Set-Content -LiteralPath (Join-Path $fixtureRepo 'src/OctofleetAgent.Service/OctofleetAgent.Service.csproj') -Value '<Project />'
    Set-Content -LiteralPath (Join-Path $fixtureRepo 'src/OctofleetScreenHelper/OctofleetScreenHelper.csproj') -Value '<Project />'
    Set-Content -LiteralPath (Join-Path $fixtureRepo 'Install-OctofleetAgent.ps1') -Value '# Synthetic installer; never run'
    Set-Content -LiteralPath (Join-Path $fixtureRepo 'publish/OpenClawAgent.Service.exe') -Value 'Legacy tracked fixture'
    $output = Join-Path $testRoot 'output'
    New-Item -ItemType Directory -Path (Join-Path $output 'publish') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $output 'publish/OpenClawAgent.Service.exe') -Value 'Stale build fixture'
    Set-Content -LiteralPath (Join-Path $output 'keep.txt') -Value 'Existing user file'
    $builder = Join-Path $fixtureRepo 'scripts/Build-Release.ps1'
    & $builder -Version '1.2.3' -OutputPath $output

    $zipPath = Join-Path $output 'OctofleetAgent-v1.2.3.zip'
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $names = @($archive.Entries.FullName)
        Assert-True ($names.Count -eq 5) 'ZIP contains only the fresh service, helper, symbols and installer'
        Assert-True ('OctofleetAgent.Service.exe' -in $names -and 'OctofleetScreenHelper.exe' -in $names -and 'Install-OctofleetAgent.ps1' -in $names) 'Required files are at archive root'
        Assert-True (@($names | Where-Object { $_ -like '*OpenClaw*' }).Count -eq 0) 'Stale OpenClaw binaries do not enter the ZIP'
    } finally { $archive.Dispose() }
    Assert-True (Test-Path -LiteralPath (Join-Path $output 'keep.txt')) 'Build preserves unrelated output files'
    $checksum = (Get-Content -LiteralPath (Join-Path $output 'OctofleetAgent-v1.2.3.sha256') -Raw).Trim()
    Assert-True ($checksum -eq (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash) 'Checksum matches the generated ZIP'

    # Reject contamination before an archive can be published.
    $staging = (Get-ChildItem -LiteralPath $output -Directory -Filter 'publish-*' | Select-Object -First 1).FullName
    $validator = Join-Path $fixtureRepo 'scripts/Test-AgentPackage.ps1'
    $legacy = Join-Path $staging 'OPENCLAWagent.Service.pdb'
    Set-Content -LiteralPath $legacy -Value 'Legacy symbols'
    Assert-Throws { & $validator -Path $staging -RequireScreenHelper } 'Validator rejects legacy artifacts case-insensitively'
    Remove-Item -LiteralPath $legacy
    $unexpected = Join-Path $staging 'Unexpected.exe'
    Set-Content -LiteralPath $unexpected -Value 'Unexpected fixture'
    Assert-Throws { & $validator -Path $staging -RequireScreenHelper } 'Validator rejects unexpected executables'
    Remove-Item -LiteralPath $unexpected
    $nestedDir = Join-Path $staging 'nested'
    New-Item -ItemType Directory -Path $nestedDir | Out-Null
    $nestedExe = Join-Path $nestedDir 'OctofleetAgent.Service.exe'
    Set-Content -LiteralPath $nestedExe -Value 'Misplaced executable'
    Assert-Throws { & $validator -Path $staging -RequireScreenHelper } 'Validator rejects nested executables'
    Remove-Item -LiteralPath $nestedExe
    Remove-Item -LiteralPath (Join-Path $staging 'OctofleetScreenHelper.exe')
    Assert-Throws { & $validator -Path $staging -RequireScreenHelper } 'Validator rejects missing required helper'

    foreach ($failed in @('OctofleetAgent.Service', 'OctofleetScreenHelper')) {
        $failureState.Project = $failed
        $failureOutput = Join-Path $testRoot $failed
        Assert-Throws { & $builder -Version '1.2.4' -OutputPath $failureOutput } "Failed $failed build aborts packaging"
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $failureOutput 'OctofleetAgent-v1.2.4.zip'))) "Failed $failed build creates no ZIP"
    }
    Write-Host "All $checks release packaging checks passed."
}
finally {
    # Delete only the unique fixture directory created under this checkout.
    $reportsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'tests/reports'))
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if (-not $resolvedTestRoot.StartsWith($reportsRoot + [System.IO.Path]::DirectorySeparatorChar)) {
        throw 'Unsafe test cleanup path'
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    Remove-Item Function:dotnet
    $global:LASTEXITCODE = 0
}
