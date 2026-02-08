using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json.Serialization;

namespace OpenClawAgent.Service;

/// <summary>
/// Background service that checks for agent updates and performs self-update.
/// Checks both the inventory API and GitHub releases for updates.
/// </summary>
public class AutoUpdater : BackgroundService
{
    private readonly ILogger<AutoUpdater> _logger;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    
    // Check interval: every hour (more reasonable than 5 minutes)
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan InitialDelay = TimeSpan.FromMinutes(2);
    
    private const string GitHubReleasesUrl = "https://api.github.com/repos/BenediktSchackenberg/openclaw-windows-agent/releases/latest";
    private const string ServiceName = "OpenClawNodeAgent";
    
    public AutoUpdater(ILogger<AutoUpdater> logger, IHostApplicationLifetime lifetime, ServiceConfig config)
    {
        _logger = logger;
        _lifetime = lifetime;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "OpenClawAgent-AutoUpdater");
    }
    
    /// <summary>
    /// Get current version from assembly metadata
    /// </summary>
    public static string GetCurrentVersion()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var version = assembly.GetName().Version;
        if (version != null && (version.Major > 0 || version.Minor > 0 || version.Build > 0))
        {
            return $"{version.Major}.{version.Minor}.{version.Build}";
        }
        // Fallback to informational version attribute
        var infoVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (!string.IsNullOrEmpty(infoVersion))
        {
            // Strip any suffix like "+commitsha"
            var plusIndex = infoVersion.IndexOf('+');
            return plusIndex > 0 ? infoVersion[..plusIndex] : infoVersion;
        }
        return "0.0.0";
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var currentVersion = GetCurrentVersion();
        _logger.LogInformation("AutoUpdater started. Current version: {Version}", currentVersion);
        
        // Wait before first check to let the agent start up properly
        await Task.Delay(InitialDelay, stoppingToken);
        
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
        var currentVersion = GetCurrentVersion();
        _logger.LogInformation("Checking for updates... (current: {Version})", currentVersion);
        
        // Try inventory API first if configured
        if (!string.IsNullOrEmpty(_config.InventoryApiUrl))
        {
            var apiUpdate = await CheckInventoryApiAsync(currentVersion, ct);
            if (apiUpdate != null)
            {
                await DownloadAndApplyUpdateAsync(apiUpdate.Value.url, apiUpdate.Value.version, ct);
                return;
            }
        }
        
        // Fallback to GitHub releases
        var githubUpdate = await CheckGitHubReleasesAsync(currentVersion, ct);
        if (githubUpdate != null)
        {
            await DownloadAndApplyUpdateAsync(githubUpdate.Value.url, githubUpdate.Value.version, ct);
            return;
        }
        
        _logger.LogInformation("Already running latest version");
    }
    
    private async Task<(string version, string url)?> CheckInventoryApiAsync(string currentVersion, CancellationToken ct)
    {
        var baseUrl = _config.InventoryApiUrl!.TrimEnd('/');
        
        try
        {
            var response = await _httpClient.GetAsync($"{baseUrl}/api/v1/agent/version", ct);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }
            
            var versionInfo = await response.Content.ReadFromJsonAsync<InventoryVersionInfo>(ct);
            if (versionInfo == null || string.IsNullOrEmpty(versionInfo.LatestVersion))
            {
                return null;
            }
            
            if (!IsNewerVersion(currentVersion, versionInfo.LatestVersion))
            {
                return null;
            }
            
            if (string.IsNullOrEmpty(versionInfo.DownloadUrl))
            {
                return null;
            }
            
            _logger.LogInformation("Update available from inventory API: {Version}", versionInfo.LatestVersion);
            return (versionInfo.LatestVersion, versionInfo.DownloadUrl);
        }
        catch (HttpRequestException)
        {
            // Endpoint not available
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Inventory API check failed");
            return null;
        }
    }
    
    private async Task<(string version, string url)?> CheckGitHubReleasesAsync(string currentVersion, CancellationToken ct)
    {
        try
        {
            var release = await _httpClient.GetFromJsonAsync<GitHubRelease>(GitHubReleasesUrl, ct);
            if (release == null || string.IsNullOrEmpty(release.TagName))
            {
                return null;
            }
            
            var latestVersion = release.TagName.TrimStart('v');
            
            if (!IsNewerVersion(currentVersion, latestVersion))
            {
                return null;
            }
            
            // Find Windows x64 ZIP asset
            var zipAsset = release.Assets?.FirstOrDefault(a => 
                a.Name?.Contains("win-x64") == true && a.Name.EndsWith(".zip"));
            
            if (zipAsset?.BrowserDownloadUrl == null)
            {
                _logger.LogWarning("No Windows x64 ZIP found in GitHub release");
                return null;
            }
            
            _logger.LogInformation("Update available from GitHub: {Version}", latestVersion);
            return (latestVersion, zipAsset.BrowserDownloadUrl);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "GitHub releases check failed");
            return null;
        }
    }
    
    private async Task DownloadAndApplyUpdateAsync(string downloadUrl, string newVersion, CancellationToken ct)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"OpenClawUpdate-{newVersion}-{Guid.NewGuid():N}");
        var zipPath = Path.Combine(tempDir, $"update.zip");
        
        try
        {
            Directory.CreateDirectory(tempDir);
            
            _logger.LogInformation("Downloading update v{Version} from {Url}", newVersion, downloadUrl);
            
            // Download ZIP
            using (var response = await _httpClient.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead, ct))
            {
                response.EnsureSuccessStatusCode();
                await using var fileStream = File.Create(zipPath);
                await response.Content.CopyToAsync(fileStream, ct);
            }
            
            _logger.LogInformation("Download complete ({Size:N0} bytes). Extracting...", new FileInfo(zipPath).Length);
            
            // Extract ZIP
            var extractPath = Path.Combine(tempDir, "extracted");
            ZipFile.ExtractToDirectory(zipPath, extractPath, overwriteFiles: true);
            
            // Find the release folder (might be nested like openclaw-release-X.X.X)
            var sourceDir = extractPath;
            var subdirs = Directory.GetDirectories(extractPath);
            if (subdirs.Length == 1)
            {
                sourceDir = subdirs[0];
            }
            
            // Get install directory
            var installDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            
            _logger.LogInformation("Preparing update from {Source} to {Install}", sourceDir, installDir);
            
            // Create PowerShell update script
            var scriptPath = Path.Combine(tempDir, "update.ps1");
            var script = CreateUpdateScript(sourceDir, installDir, newVersion, tempDir);
            await File.WriteAllTextAsync(scriptPath, script, ct);
            
            _logger.LogInformation("Starting update script and shutting down for update to v{Version}...", newVersion);
            
            // Start the update script
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-ExecutionPolicy Bypass -WindowStyle Hidden -File \"{scriptPath}\"",
                UseShellExecute = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(psi);
            
            // Stop the application to allow update
            _lifetime.StopApplication();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply update");
            
            // Cleanup on failure
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }
    
    private static string CreateUpdateScript(string sourceDir, string installDir, string version, string tempDir)
    {
        // Escape paths for PowerShell
        var src = sourceDir.Replace("'", "''");
        var dst = installDir.Replace("'", "''");
        var tmp = tempDir.Replace("'", "''");
        
        return $@"
# OpenClaw Agent Update Script - v{version}
$ErrorActionPreference = 'Continue'

$serviceName = '{ServiceName}'
$sourceDir = '{src}'
$installDir = '{dst}'
$tempDir = '{tmp}'
$logFile = 'C:\ProgramData\OpenClaw\logs\update.log'

function Log($msg) {{
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logFile -Value ""$ts - $msg"" -ErrorAction SilentlyContinue
    Write-Host $msg
}}

Log ""Starting update to v{version}...""

# Wait for service to stop (max 60 seconds)
$timeout = 60
$elapsed = 0
while ($elapsed -lt $timeout) {{
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $svc -or $svc.Status -eq 'Stopped') {{
        Log ""Service stopped""
        break
    }}
    Start-Sleep -Seconds 1
    $elapsed++
}}

# Force stop if still running
Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Backup current version (just the exe)
$backupDir = ""$installDir\backup""
New-Item -ItemType Directory -Path $backupDir -Force -ErrorAction SilentlyContinue | Out-Null
Copy-Item ""$installDir\OpenClawAgent.Service.exe"" ""$backupDir\OpenClawAgent.Service.exe.bak"" -Force -ErrorAction SilentlyContinue

# Copy new files
Log ""Copying new files from $sourceDir to $installDir...""
Copy-Item -Path ""$sourceDir\*"" -Destination $installDir -Recurse -Force -ErrorAction Continue

# Verify the new exe exists
if (Test-Path ""$installDir\OpenClawAgent.Service.exe"") {{
    Log ""Files copied successfully""
}} else {{
    Log ""ERROR: New executable not found, restoring backup...""
    Copy-Item ""$backupDir\OpenClawAgent.Service.exe.bak"" ""$installDir\OpenClawAgent.Service.exe"" -Force -ErrorAction SilentlyContinue
}}

# Start service
Log ""Starting service...""
Start-Service -Name $serviceName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {{
    Log ""Update to v{version} completed successfully!""
}} else {{
    Log ""WARNING: Service may not have started properly""
}}

# Cleanup temp files
Start-Sleep -Seconds 5
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
Log ""Cleanup complete""
";
    }
    
    private static bool IsNewerVersion(string current, string latest)
    {
        if (string.IsNullOrEmpty(latest)) return false;
        if (string.IsNullOrEmpty(current) || current == "0.0.0") return true;
        
        try
        {
            var currentParts = current.TrimStart('v').Split('.').Select(int.Parse).ToArray();
            var latestParts = latest.TrimStart('v').Split('.').Select(int.Parse).ToArray();
            
            for (int i = 0; i < Math.Max(currentParts.Length, latestParts.Length); i++)
            {
                var c = i < currentParts.Length ? currentParts[i] : 0;
                var l = i < latestParts.Length ? latestParts[i] : 0;
                
                if (l > c) return true;
                if (l < c) return false;
            }
            
            return false;
        }
        catch
        {
            return false;
        }
    }
    
    public override void Dispose()
    {
        _httpClient.Dispose();
        base.Dispose();
    }
}

// API response models
public class InventoryVersionInfo
{
    public string? LatestVersion { get; set; }
    public string? DownloadUrl { get; set; }
    public string? ReleaseNotes { get; set; }
}

public class GitHubRelease
{
    [JsonPropertyName("tag_name")]
    public string? TagName { get; set; }
    
    [JsonPropertyName("name")]
    public string? Name { get; set; }
    
    [JsonPropertyName("assets")]
    public List<GitHubAsset>? Assets { get; set; }
}

public class GitHubAsset
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }
    
    [JsonPropertyName("browser_download_url")]
    public string? BrowserDownloadUrl { get; set; }
    
    [JsonPropertyName("size")]
    public long Size { get; set; }
}
