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
/// Auto-update service that checks for new versions and self-updates.
/// </summary>
public class AutoUpdater : BackgroundService
{
    private readonly ILogger<AutoUpdater> _logger;
    private readonly HttpClient _httpClient;
    private readonly ServiceConfig _config;
    
    // Installation path (fixed location)
    private static readonly string InstallPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        "Octofleet"
    );
    
    // Check interval (default: 6 hours)
    private readonly TimeSpan _checkInterval = TimeSpan.FromHours(6);
    
    // Current version
    private readonly string _currentVersion;
    
    public AutoUpdater(ILogger<AutoUpdater> logger, ServiceConfig config)
    {
        _logger = logger;
        _httpClient = new HttpClient();
        _config = config;
        
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
        
        _logger.LogInformation("AutoUpdater started. Current version: {Version}, checking every {Hours}h",
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
        var versionUrl = $"{_config.InventoryApiUrl.TrimEnd('/')}/api/v1/agent/version";
        
        _logger.LogDebug("Checking for updates at {Url}", versionUrl);
        
        var request = new HttpRequestMessage(HttpMethod.Get, versionUrl);
        request.Headers.Add("X-API-Key", _config.InventoryApiKey);
        
        var response = await _httpClient.SendAsync(request, ct);
        
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Version check failed: {Status}", response.StatusCode);
            return;
        }
        
        var json = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        
        var latestVersion = root.GetProperty("latest").GetString()!;
        var downloadUrl = root.GetProperty("downloadUrl").GetString()!;
        var sha256 = root.TryGetProperty("sha256", out var shaElem) ? shaElem.GetString() : null;
        
        if (!IsNewerVersion(latestVersion, _currentVersion))
        {
            _logger.LogDebug("Already on latest version {Version}", _currentVersion);
            return;
        }
        
        _logger.LogInformation("New version available: {Latest} (current: {Current})",
            latestVersion, _currentVersion);
        
        ConsoleUI.Log("INF", $"🔄 Updating to v{latestVersion}...");
        
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

# Log function
function Log {{ param($msg) Write-Host ""[$(Get-Date -Format 'HH:mm:ss')] $msg"" }}

Start-Sleep -Seconds 3

try {{
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
