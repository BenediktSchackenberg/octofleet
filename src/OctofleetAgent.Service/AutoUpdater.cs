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

# Log function
function Log {{ param($msg) Write-Host ""[$(Get-Date -Format 'HH:mm:ss')] $msg"" }}

# Version comparison function
function Compare-Version {{
    param($installed, $new)
    $instParts = $installed.Split('.') | ForEach-Object {{ [int]$_ }}
    $newParts = $new.Split('.') | ForEach-Object {{ [int]$_ }}
    for ($i = 0; $i -lt [Math]::Max($instParts.Count, $newParts.Count); $i++) {{
        $inst = if ($i -lt $instParts.Count) {{ $instParts[$i] }} else {{ 0 }}
        $newV = if ($i -lt $newParts.Count) {{ $newParts[$i] }} else {{ 0 }}
        if ($newV -gt $inst) {{ return 1 }}   # new is higher
        if ($newV -lt $inst) {{ return -1 }}  # new is lower (downgrade!)
    }}
    return 0  # equal
}}

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
    }}

    # Stop service
    Log 'Stopping service...'
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    
    # Kill any remaining processes
    Get-Process -Name 'OctofleetAgent*' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    
    # Backup old version (keep last 2)
    $backupDir = Join-Path $targetPath 'backups'
    if (-not (Test-Path $backupDir)) {{ New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }}
    
    $existingExe = Join-Path $targetPath 'OctofleetAgent.Service.exe'
    if (Test-Path $existingExe) {{
        $backupName = ""backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')""
        $backupPath = Join-Path $backupDir $backupName
        Log ""Backing up to $backupPath""
        New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
        Copy-Item -Path (Join-Path $targetPath '*.exe') -Destination $backupPath -ErrorAction SilentlyContinue
        Copy-Item -Path (Join-Path $targetPath '*.dll') -Destination $backupPath -ErrorAction SilentlyContinue
        
        # Keep only last 2 backups
        Get-ChildItem $backupDir -Directory | Sort-Object CreationTime -Descending | Select-Object -Skip 2 | Remove-Item -Recurse -Force
    }}
    
    # Copy new files (preserve config!)
    Log 'Installing new version...'
    $configPath = Join-Path $targetPath 'config.json'
    $configBackup = $null
    if (Test-Path $configPath) {{
        $configBackup = Get-Content $configPath -Raw
    }}
    
    # Copy all files from source
    Copy-Item -Path (Join-Path $sourcePath '*') -Destination $targetPath -Force -Recurse
    
    # Restore config if it existed
    if ($configBackup) {{
        $configBackup | Set-Content -Path $configPath -Force
        Log 'Config preserved'
    }}
    
    # Start service
    Log 'Starting service...'
    Start-Service -Name $serviceName
    Start-Sleep -Seconds 2
    
    $svc = Get-Service -Name $serviceName
    if ($svc.Status -eq 'Running') {{
        Log ""Update to v{version} complete!""
    }} else {{
        Log ""WARNING: Service status is $($svc.Status)""
    }}
    
}} catch {{
    Log ""ERROR: $_""
    
    # Try to start service anyway
    Start-Service -Name $serviceName -ErrorAction SilentlyContinue
}}

# Cleanup
Start-Sleep -Seconds 5
Remove-Item -Path (Split-Path $PSScriptRoot -Parent) -Recurse -Force -ErrorAction SilentlyContinue
";
        
        File.WriteAllText(scriptPath, script);
        return scriptPath;
    }
}
