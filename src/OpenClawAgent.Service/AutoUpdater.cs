using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Json;
using System.Reflection;

namespace OpenClawAgent.Service;

/// <summary>
/// Background service that checks for agent updates and performs self-update.
/// </summary>
public class AutoUpdater : BackgroundService
{
    private readonly ILogger<AutoUpdater> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    
    // Current agent version
    public static readonly string CurrentVersion = "0.3.12";
    
    // Check interval: every 5 minutes
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(5);
    
    public AutoUpdater(ILogger<AutoUpdater> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("AutoUpdater started. Current version: {Version}", CurrentVersion);
        
        // Wait a bit before first check
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckAndUpdateAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Update check failed");
            }
            
            await Task.Delay(CheckInterval, stoppingToken);
        }
    }
    
    private async Task CheckAndUpdateAsync(CancellationToken ct)
    {
        if (string.IsNullOrEmpty(_config.InventoryApiUrl))
        {
            return;
        }
        
        var baseUrl = _config.InventoryApiUrl.TrimEnd('/');
        
        try
        {
            // Check for updates
            var response = await _httpClient.GetAsync($"{baseUrl}/api/v1/agent/version", ct);
            if (!response.IsSuccessStatusCode)
            {
                return; // Endpoint not available yet
            }
            
            var versionInfo = await response.Content.ReadFromJsonAsync<VersionInfo>(ct);
            if (versionInfo == null || string.IsNullOrEmpty(versionInfo.LatestVersion))
            {
                return;
            }
            
            // Compare versions
            if (!IsNewerVersion(versionInfo.LatestVersion, CurrentVersion))
            {
                _logger.LogDebug("Already on latest version {Version}", CurrentVersion);
                return;
            }
            
            _logger.LogInformation("New version available: {NewVersion} (current: {Current})", 
                versionInfo.LatestVersion, CurrentVersion);
            
            if (string.IsNullOrEmpty(versionInfo.DownloadUrl))
            {
                _logger.LogWarning("No download URL provided for update");
                return;
            }
            
            // Download and apply update
            await DownloadAndApplyUpdateAsync(versionInfo.DownloadUrl, versionInfo.LatestVersion, ct);
        }
        catch (HttpRequestException)
        {
            // Endpoint not available, ignore
        }
    }
    
    private async Task DownloadAndApplyUpdateAsync(string downloadUrl, string newVersion, CancellationToken ct)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"OpenClawUpdate-{newVersion}");
        var zipPath = Path.Combine(Path.GetTempPath(), $"OpenClawAgent-{newVersion}.zip");
        
        try
        {
            // Clean up any previous attempt
            if (Directory.Exists(tempDir))
                Directory.Delete(tempDir, true);
            if (File.Exists(zipPath))
                File.Delete(zipPath);
            
            _logger.LogInformation("Downloading update from {Url}", downloadUrl);
            
            // Download ZIP
            using (var response = await _httpClient.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead, ct))
            {
                response.EnsureSuccessStatusCode();
                using var fileStream = File.Create(zipPath);
                await response.Content.CopyToAsync(fileStream, ct);
            }
            
            _logger.LogInformation("Download complete. Extracting...");
            
            // Extract ZIP
            Directory.CreateDirectory(tempDir);
            ZipFile.ExtractToDirectory(zipPath, tempDir, true);
            
            // Find the extracted folder (might be nested)
            var extractedDir = tempDir;
            var subdirs = Directory.GetDirectories(tempDir);
            if (subdirs.Length == 1)
            {
                extractedDir = subdirs[0];
            }
            
            // Get install directory (where we're running from)
            var installDir = AppContext.BaseDirectory;
            
            // Create update script
            var scriptPath = Path.Combine(Path.GetTempPath(), "openclaw-update.cmd");
            var script = $@"@echo off
echo Waiting for service to stop...
timeout /t 3 /nobreak >nul
echo Copying new files...
xcopy /Y /E ""{extractedDir}\*"" ""{installDir}""
echo Starting service...
net start ""OpenClaw Node Agent""
echo Update complete!
del ""%~f0""
";
            File.WriteAllText(scriptPath, script);
            
            _logger.LogInformation("Stopping service for update...");
            
            // Start the update script and exit
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{scriptPath}\"",
                UseShellExecute = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(psi);
            
            // Request service stop
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply update");
            
            // Cleanup
            try { if (File.Exists(zipPath)) File.Delete(zipPath); } catch { }
            try { if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true); } catch { }
        }
    }
    
    private static bool IsNewerVersion(string newVersion, string currentVersion)
    {
        // Parse semantic versions (e.g., "0.3.10")
        var newParts = newVersion.TrimStart('v').Split('.').Select(int.Parse).ToArray();
        var currentParts = currentVersion.TrimStart('v').Split('.').Select(int.Parse).ToArray();
        
        for (int i = 0; i < Math.Max(newParts.Length, currentParts.Length); i++)
        {
            var newPart = i < newParts.Length ? newParts[i] : 0;
            var currentPart = i < currentParts.Length ? currentParts[i] : 0;
            
            if (newPart > currentPart) return true;
            if (newPart < currentPart) return false;
        }
        
        return false;
    }
    
    private class VersionInfo
    {
        public string? LatestVersion { get; set; }
        public string? DownloadUrl { get; set; }
        public string? ReleaseNotes { get; set; }
    }
}
