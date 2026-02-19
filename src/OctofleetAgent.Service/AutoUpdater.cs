using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service;

/// <summary>
/// Auto-update service that checks GitHub Releases for new versions and self-updates.
/// </summary>
public class AutoUpdater : BackgroundService
{
    private readonly ILogger<AutoUpdater> _logger;
    private readonly HttpClient _httpClient;
    
    // GitHub repository for releases
    private const string GitHubRepo = "BenediktSchackenberg/octofleet";
    private const string GitHubApiUrl = $"https://api.github.com/repos/{GitHubRepo}/releases/latest";
    
    // Installation path (fixed location)
    private static readonly string InstallPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        "Octofleet"
    );
    
    // Check interval (default: 6 hours)
    private readonly TimeSpan _checkInterval = TimeSpan.FromHours(6);
    
    // Current version
    private readonly string _currentVersion;
    
    public AutoUpdater(ILogger<AutoUpdater> logger)
    {
        _logger = logger;
        _httpClient = new HttpClient();
        // GitHub API requires User-Agent header
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "OctofleetAgent");
        _httpClient.DefaultRequestHeaders.Add("Accept", "application/vnd.github+json");
        
        // Get current version from assembly
        var assembly = typeof(AutoUpdater).Assembly;
        var version = assembly.GetName().Version;
        _currentVersion = version != null 
            ? $"{version.Major}.{version.Minor}.{version.Build}"
            : "0.0.0";
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Wait a bit before first check (let agent fully start)
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
        
        _logger.LogInformation("AutoUpdater started. Current version: {Version}, checking GitHub every {Hours}h",
            _currentVersion, _checkInterval.TotalHours);
        
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckForUpdate(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Update check failed, will retry later");
            }
            
            await Task.Delay(_checkInterval, stoppingToken);
        }
    }
    
    private async Task CheckForUpdate(CancellationToken ct)
    {
        _logger.LogDebug("Checking for updates at GitHub: {Url}", GitHubApiUrl);
        
        var response = await _httpClient.GetAsync(GitHubApiUrl, ct);
        
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("GitHub API check failed: {Status}", response.StatusCode);
            return;
        }
        
        var json = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        
        // Get version from tag_name (e.g., "v0.4.48" -> "0.4.48")
        var tagName = root.GetProperty("tag_name").GetString()!;
        var latestVersion = tagName.TrimStart('v');
        
        // Find the ZIP asset
        string? downloadUrl = null;
        string? sha256Url = null;
        
        foreach (var asset in root.GetProperty("assets").EnumerateArray())
        {
            var name = asset.GetProperty("name").GetString()!;
            var url = asset.GetProperty("browser_download_url").GetString()!;
            
            if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            {
                downloadUrl = url;
            }
            else if (name.EndsWith(".sha256", StringComparison.OrdinalIgnoreCase))
            {
                sha256Url = url;
            }
        }
        
        if (downloadUrl == null)
        {
            _logger.LogWarning("No ZIP asset found in release {Tag}", tagName);
            return;
        }
        
        if (!IsNewerVersion(latestVersion, _currentVersion))
        {
            _logger.LogDebug("Already on latest version {Version}", _currentVersion);
            return;
        }
        
        _logger.LogInformation("New version available: {Latest} (current: {Current})",
            latestVersion, _currentVersion);
        
        ConsoleUI.Log("INF", $"🔄 Updating to v{latestVersion}...");
        
        // Optionally fetch SHA256
        string? sha256 = null;
        if (sha256Url != null)
        {
            try
            {
                sha256 = (await _httpClient.GetStringAsync(sha256Url, ct)).Trim();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not fetch SHA256, skipping verification");
            }
        }
        
        await DownloadAndInstall(latestVersion, downloadUrl, sha256, ct);
    }
    
    private bool IsNewerVersion(string latest, string current)
    {
        try
        {
            var latestParts = latest.Split('.').Select(int.Parse).ToArray();
            var currentParts = current.Split('.').Select(int.Parse).ToArray();
            
            for (int i = 0; i < Math.Min(latestParts.Length, currentParts.Length); i++)
            {
                if (latestParts[i] > currentParts[i]) return true;
                if (latestParts[i] < currentParts[i]) return false;
            }
            
            return latestParts.Length > currentParts.Length;
        }
        catch
        {
            return false;
        }
    }
    
    private async Task DownloadAndInstall(string version, string downloadUrl, string? expectedSha256, CancellationToken ct)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "OctofleetUpdate");
        var zipPath = Path.Combine(tempDir, $"OctofleetAgent-v{version}.zip");
        var extractPath = Path.Combine(tempDir, "extract");
        
        try
        {
            // Cleanup temp dir
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
            Directory.CreateDirectory(tempDir);
            
            // Download ZIP
            _logger.LogInformation("Downloading update from {Url}", downloadUrl);
            ConsoleUI.Log("INF", "Downloading update...");
            
            using (var downloadResponse = await _httpClient.GetAsync(downloadUrl, ct))
            {
                downloadResponse.EnsureSuccessStatusCode();
                await using var fs = File.Create(zipPath);
                await downloadResponse.Content.CopyToAsync(fs, ct);
            }
            
            _logger.LogInformation("Download complete: {Size} bytes", new FileInfo(zipPath).Length);
            
            // Verify SHA256
            if (!string.IsNullOrEmpty(expectedSha256))
            {
                var actualSha256 = ComputeSha256(zipPath);
                if (!actualSha256.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogError("SHA256 mismatch! Expected: {Expected}, Got: {Actual}",
                        expectedSha256, actualSha256);
                    ConsoleUI.Log("ERR", "Update failed: SHA256 mismatch");
                    return;
                }
                _logger.LogInformation("SHA256 verified");
            }
            
            // Extract ZIP
            _logger.LogInformation("Extracting update...");
            ZipFile.ExtractToDirectory(zipPath, extractPath, true);
            
            // Create update script
            var updateScript = CreateUpdateScript(extractPath, InstallPath, version);
            
            // Execute update script (this will stop the service, replace files, and restart)
            _logger.LogInformation("Launching update script...");
            ConsoleUI.Log("INF", "Installing update, service will restart...");
            
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-ExecutionPolicy Bypass -NoProfile -File \"{updateScript}\"",
                UseShellExecute = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            
            Process.Start(psi);
            
            // Give the script time to start before we exit
            await Task.Delay(2000, ct);
            
            // Exit the current process - the script will restart the service
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Update failed");
            ConsoleUI.Log("ERR", $"Update failed: {ex.Message}");
            
            // Cleanup on failure
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }
    
    private string ComputeSha256(string filePath)
    {
        using var sha256 = SHA256.Create();
        using var stream = File.OpenRead(filePath);
        var hash = sha256.ComputeHash(stream);
        return BitConverter.ToString(hash).Replace("-", "");
    }
    
    private string CreateUpdateScript(string sourcePath, string targetPath, string version)
    {
        var scriptPath = Path.Combine(Path.GetTempPath(), "OctofleetUpdate", "update.ps1");
        
        var script = $@"
# Octofleet Auto-Update Script
# Version: {version}

$ErrorActionPreference = 'Stop'
$serviceName = 'OctofleetNodeAgent'
$sourcePath = '{sourcePath.Replace("'", "''")}'
$targetPath = '{targetPath.Replace("'", "''")}'
$newVersion = '{version}'
$logFile = Join-Path $env:ProgramData 'Octofleet\logs\update.log'

# Ensure log directory exists
$logDir = Split-Path $logFile -Parent
if (-not (Test-Path $logDir)) {{ New-Item -ItemType Directory -Path $logDir -Force | Out-Null }}

# Log function
function Log {{ 
    param($msg) 
    $line = ""[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg""
    Write-Host $line
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}}

# Version comparison function
function Compare-Version {{
    param($installed, $new)
    try {{
        $instParts = $installed.Split('.') | ForEach-Object {{ [int]$_ }}
        $newParts = $new.Split('.') | ForEach-Object {{ [int]$_ }}
        for ($i = 0; $i -lt [Math]::Max($instParts.Count, $newParts.Count); $i++) {{
            $inst = if ($i -lt $instParts.Count) {{ $instParts[$i] }} else {{ 0 }}
            $newV = if ($i -lt $newParts.Count) {{ $newParts[$i] }} else {{ 0 }}
            if ($newV -gt $inst) {{ return 1 }}   # new is higher
            if ($newV -lt $inst) {{ return -1 }}  # new is lower (downgrade!)
        }}
        return 0  # equal
    }} catch {{
        return 0
    }}
}}

Log ""========================================""
Log ""Octofleet Update Script starting""
Log ""Source: $sourcePath""
Log ""Target: $targetPath""
Log ""Version: $newVersion""
Log ""========================================""

Start-Sleep -Seconds 3

try {{
    # Check installed version first - prevent downgrades!
    $existingExe = Join-Path $targetPath 'OctofleetAgent.Service.exe'
    if (Test-Path $existingExe) {{
        $installedVersion = (Get-Item $existingExe).VersionInfo.FileVersion
        # Clean up version string (remove .0 suffix if present)
        $installedVersion = ($installedVersion -split '\.')[0..2] -join '.'
        Log ""Installed version: $installedVersion, New version: $newVersion""
        
        $cmp = Compare-Version -installed $installedVersion -new $newVersion
        if ($cmp -le 0) {{
            Log ""ABORT: New version ($newVersion) is not higher than installed ($installedVersion) - skipping update""
            exit 0
        }}
        Log ""Proceeding with update: $installedVersion -> $newVersion""
    }} else {{
        Log ""No existing installation found, proceeding with fresh install""
    }}

    # Stop service
    Log 'Stopping service...'
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($svc) {{
        if ($svc.Status -eq 'Running') {{
            Stop-Service -Name $serviceName -Force -ErrorAction Stop
            Log ""Service stopped""
        }} else {{
            Log ""Service was not running (Status: $($svc.Status))""
        }}
    }} else {{
        Log ""Service not found - will register after install""
    }}
    Start-Sleep -Seconds 3
    
    # Kill any remaining processes (retry loop)
    for ($i = 0; $i -lt 3; $i++) {{
        $procs = Get-Process -Name 'OctofleetAgent*' -ErrorAction SilentlyContinue
        if ($procs) {{
            Log ""Killing $($procs.Count) remaining process(es)...""
            $procs | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }} else {{
            break
        }}
    }}
    
    # Check if files are locked
    $testExe = Join-Path $targetPath 'OctofleetAgent.Service.exe'
    if (Test-Path $testExe) {{
        try {{
            [IO.File]::OpenWrite($testExe).Close()
        }} catch {{
            Log ""WARNING: Executable is locked, waiting...""
            Start-Sleep -Seconds 5
        }}
    }}
    
    # Ensure target directory exists
    if (-not (Test-Path $targetPath)) {{
        Log ""Creating target directory: $targetPath""
        New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
    }}
    
    # Backup old version (keep last 2)
    $backupDir = Join-Path $targetPath 'backups'
    if (-not (Test-Path $backupDir)) {{ New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }}
    
    if (Test-Path $testExe) {{
        $backupName = ""backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')""
        $backupPath = Join-Path $backupDir $backupName
        Log ""Backing up to $backupPath""
        New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
        Copy-Item -Path (Join-Path $targetPath '*.exe') -Destination $backupPath -ErrorAction SilentlyContinue
        Copy-Item -Path (Join-Path $targetPath '*.dll') -Destination $backupPath -ErrorAction SilentlyContinue
        
        # Keep only last 2 backups
        Get-ChildItem $backupDir -Directory | Sort-Object CreationTime -Descending | Select-Object -Skip 2 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }}
    
    # Preserve config
    $configPath = Join-Path $targetPath 'config.json'
    $configBackup = $null
    if (Test-Path $configPath) {{
        $configBackup = Get-Content $configPath -Raw
        Log ""Config backed up""
    }}
    
    # Copy new files
    Log 'Installing new version...'
    Copy-Item -Path (Join-Path $sourcePath '*') -Destination $targetPath -Force -Recurse
    Log ""Files copied""
    
    # Restore config if it existed
    if ($configBackup) {{
        $configBackup | Set-Content -Path $configPath -Force
        Log 'Config restored'
    }}
    
    # Verify service registration and fix if needed
    $expectedBinPath = Join-Path $targetPath 'OctofleetAgent.Service.exe'
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    
    if (-not $svc) {{
        # Service doesn't exist - create it
        Log ""Registering service...""
        $result = sc.exe create $serviceName binPath=""$expectedBinPath"" start=auto DisplayName=""Octofleet Agent""
        if ($LASTEXITCODE -eq 0) {{
            Log ""Service registered successfully""
            sc.exe description $serviceName ""Octofleet endpoint management agent"" | Out-Null
            sc.exe failure $serviceName reset=86400 actions=restart/5000/restart/10000/restart/30000 | Out-Null
        }} else {{
            Log ""ERROR: Failed to register service: $result""
            throw ""Service registration failed""
        }}
    }} else {{
        # Service exists - check and fix binary path if needed
        $regPath = ""HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName""
        $currentBinPath = (Get-ItemProperty -Path $regPath -Name ImagePath -ErrorAction SilentlyContinue).ImagePath
        
        # Normalize paths for comparison (remove quotes, trim)
        $currentBinPathClean = $currentBinPath -replace '""', '' -replace ""'"", '' 
        $currentBinPathClean = $currentBinPathClean.Trim()
        
        if ($currentBinPathClean -ne $expectedBinPath) {{
            Log ""Fixing service path: '$currentBinPathClean' -> '$expectedBinPath'""
            sc.exe config $serviceName binPath=""$expectedBinPath"" | Out-Null
            if ($LASTEXITCODE -ne 0) {{
                Log ""WARNING: Could not update service path via sc.exe, trying registry...""
                Set-ItemProperty -Path $regPath -Name ImagePath -Value $expectedBinPath -ErrorAction Stop
            }}
            Log ""Service path updated""
        }} else {{
            Log ""Service path is correct""
        }}
    }}
    
    # Set DOTNET_BUNDLE_EXTRACT_BASE_DIR for Windows Server compatibility
    # (LocalSystem account may not have a valid TEMP directory)
    $extractDir = Join-Path $env:ProgramData 'Octofleet\extract'
    if (-not (Test-Path $extractDir)) {{
        Log ""Creating .NET extraction directory: $extractDir""
        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
    }}
    $currentEnv = (Get-ItemProperty ""HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"" -Name Environment -EA SilentlyContinue).Environment
    if (-not $currentEnv -or $currentEnv -notlike ""*DOTNET_BUNDLE_EXTRACT*"") {{
        Log ""Setting DOTNET_BUNDLE_EXTRACT_BASE_DIR for service...""
        reg add ""HKLM\SYSTEM\CurrentControlSet\Services\$serviceName"" /v Environment /t REG_MULTI_SZ /d ""DOTNET_BUNDLE_EXTRACT_BASE_DIR=$extractDir"" /f | Out-Null
    }}
    
    # Start service with retry
    Log 'Starting service...'
    $maxRetries = 3
    $started = $false
    
    for ($retry = 1; $retry -le $maxRetries; $retry++) {{
        try {{
            Start-Service -Name $serviceName -ErrorAction Stop
            Start-Sleep -Seconds 3
            
            $svc = Get-Service -Name $serviceName
            if ($svc.Status -eq 'Running') {{
                $started = $true
                Log ""Service started successfully on attempt $retry""
                break
            }} else {{
                Log ""WARNING: Service status is $($svc.Status) on attempt $retry""
            }}
        }} catch {{
            Log ""ERROR on attempt $retry : $_""
            if ($retry -lt $maxRetries) {{
                Log ""Retrying in 5 seconds...""
                Start-Sleep -Seconds 5
            }}
        }}
    }}
    
    if (-not $started) {{
        # Last resort - try to get more info
        Log ""FAILED to start service after $maxRetries attempts""
        Log ""Checking Windows Event Log...""
        $events = Get-WinEvent -FilterHashtable @{{LogName='System'; ProviderName='Service Control Manager'; Level=2; StartTime=(Get-Date).AddMinutes(-5)}} -MaxEvents 5 -ErrorAction SilentlyContinue
        foreach ($evt in $events) {{
            Log ""  Event: $($evt.Message)""
        }}
        
        # Check if exe exists and is valid
        if (Test-Path $expectedBinPath) {{
            $fileInfo = Get-Item $expectedBinPath
            Log ""Executable exists: $($fileInfo.Length) bytes, Version: $($fileInfo.VersionInfo.FileVersion)""
        }} else {{
            Log ""ERROR: Executable not found at $expectedBinPath!""
        }}
    }}
    
    Log ""========================================""
    if ($started) {{
        Log ""Update to v{version} COMPLETE!""
    }} else {{
        Log ""Update to v{version} FAILED - service did not start""
    }}
    Log ""========================================""
    
}} catch {{
    Log ""========================================""
    Log ""CRITICAL ERROR: $_""
    Log ""$($_.ScriptStackTrace)""
    Log ""========================================""
    
    # Try to start service anyway
    try {{
        Start-Service -Name $serviceName -ErrorAction SilentlyContinue
    }} catch {{}}
}}

# Cleanup (delayed to allow log review)
Start-Sleep -Seconds 10
try {{
    Remove-Item -Path (Split-Path $PSScriptRoot -Parent) -Recurse -Force -ErrorAction SilentlyContinue
}} catch {{}}
";
        
        File.WriteAllText(scriptPath, script);
        return scriptPath;
    }
}
