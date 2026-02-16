using System.Diagnostics;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OctofleetAgent.Service;

/// <summary>
/// E5-08/E5-09: Polls for pending deployments and executes package installations.
/// Runs in parallel with JobPoller.
/// </summary>
public class DeploymentPoller : BackgroundService
{
    private readonly ILogger<DeploymentPoller> _logger;
    private readonly HttpClient _httpClient;
    private readonly string _cacheDir;
    
    private const int PollIntervalMs = 60000;  // 1 minute
    private const int ErrorBackoffMs = 300000; // 5 minutes
    
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    public DeploymentPoller(ILogger<DeploymentPoller> logger)
    {
        _logger = logger;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        _cacheDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Octofleet", "PackageCache");
        Directory.CreateDirectory(_cacheDir);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("DeploymentPoller starting...");
        
        // Wait for configuration
        while (!stoppingToken.IsCancellationRequested)
        {
            var config = ServiceConfig.Load();
            if (config.IsConfigured && !string.IsNullOrEmpty(config.InventoryApiUrl))
                break;
            
            await Task.Delay(5000, stoppingToken);
        }

        var nodeId = Environment.MachineName.ToUpperInvariant();
        _logger.LogInformation("DeploymentPoller ready for node: {NodeId}", nodeId);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var config = ServiceConfig.Load();
                var baseUrl = config.InventoryApiUrl?.TrimEnd('/');
                var apiKey = config.InventoryApiKey ?? "octofleet-inventory-dev-key";
                
                if (string.IsNullOrEmpty(baseUrl))
                {
                    await Task.Delay(PollIntervalMs, stoppingToken);
                    continue;
                }

                // E5-08: Get pending deployments for this node
                var deployments = await GetPendingDeploymentsAsync(baseUrl, apiKey, nodeId, stoppingToken);
                
                if (deployments.Count > 0)
                {
                    _logger.LogInformation("Found {Count} pending deployments", deployments.Count);
                    
                    foreach (var deployment in deployments)
                    {
                        if (stoppingToken.IsCancellationRequested) break;
                        await ProcessDeploymentAsync(baseUrl, apiKey, nodeId, deployment, stoppingToken);
                    }
                }

                await Task.Delay(PollIntervalMs, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Deployment polling error, backing off...");
                await Task.Delay(ErrorBackoffMs, stoppingToken);
            }
        }
    }

    private async Task<List<PendingDeployment>> GetPendingDeploymentsAsync(
        string baseUrl, string apiKey, string nodeId, CancellationToken ct)
    {
        var url = $"{baseUrl}/api/v1/nodes/{nodeId}/deployments";
        
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-API-Key", apiKey);
        
        var response = await _httpClient.SendAsync(request, ct);
        
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogDebug("No deployments or error: {StatusCode}", response.StatusCode);
            return new List<PendingDeployment>();
        }

        var content = await response.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<List<PendingDeployment>>(content, JsonOptions) 
            ?? new List<PendingDeployment>();
    }

    private async Task ProcessDeploymentAsync(
        string baseUrl, string apiKey, string nodeId, 
        PendingDeployment deployment, CancellationToken ct)
    {
        _logger.LogInformation("Processing deployment: {Name} ({Mode}) - Package: {Package} v{Version}",
            deployment.Name, deployment.Mode, deployment.PackageName, deployment.PackageVersion);

        // E5-09: Report status = downloading
        await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId, "downloading", null, null, ct);

        try
        {
            if (deployment.Mode == "uninstall")
            {
                // Uninstall
                await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId, "installing", null, null, ct);
                
                var (exitCode, error) = await RunUninstallAsync(
                    deployment.InstallerType ?? "exe",
                    deployment.UninstallArgs ?? "",
                    ct);

                await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId,
                    exitCode == 0 || exitCode == 3010 ? "success" : "failed",
                    exitCode,
                    exitCode != 0 && exitCode != 3010 ? error : null,
                    ct);
            }
            else
            {
                // Install (required or available)
                string localPath;
                if (!string.IsNullOrEmpty(deployment.InstallerUrl))
                {
                    localPath = await DownloadFileAsync(deployment.InstallerUrl, deployment.ExpectedHash, ct);
                }
                else if (!string.IsNullOrEmpty(deployment.InstallerPath))
                {
                    localPath = deployment.InstallerPath; // SMB/UNC path
                }
                else
                {
                    throw new Exception("No installer URL or path specified");
                }

                // Verify hash if provided
                if (!string.IsNullOrEmpty(deployment.ExpectedHash))
                {
                    var actualHash = await ComputeFileHashAsync(localPath, ct);
                    if (!actualHash.Equals(deployment.ExpectedHash, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new Exception($"Hash mismatch: expected {deployment.ExpectedHash}, got {actualHash}");
                    }
                }

                // Install
                await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId, "installing", null, null, ct);
                
                var (exitCode, error) = await RunInstallAsync(
                    localPath,
                    deployment.InstallerType ?? "exe",
                    deployment.InstallArgs ?? "",
                    ct);

                var success = exitCode == 0 || exitCode == 3010; // 3010 = reboot required
                await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId,
                    success ? "success" : "failed",
                    exitCode,
                    !success ? error : null,
                    ct);

                _logger.LogInformation("Deployment {Name} completed with exit code {ExitCode}",
                    deployment.Name, exitCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Deployment {Name} failed", deployment.Name);
            await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId, 
                "failed", -1, ex.Message, ct);
        }
    }

    private async Task<string> DownloadFileAsync(string url, string? expectedHash, CancellationToken ct)
    {
        var fileName = Path.GetFileName(new Uri(url).LocalPath);
        if (string.IsNullOrEmpty(fileName)) fileName = "package.exe";
        
        // Check cache first
        if (!string.IsNullOrEmpty(expectedHash))
        {
            var cachedPath = Path.Combine(_cacheDir, expectedHash, fileName);
            if (File.Exists(cachedPath))
            {
                _logger.LogInformation("Using cached file: {Path}", cachedPath);
                return cachedPath;
            }
        }

        var tempPath = Path.Combine(Path.GetTempPath(), $"octofleet_{Guid.NewGuid()}_{fileName}");
        
        _logger.LogInformation("Downloading {Url} to {Path}", url, tempPath);
        
        using var response = await _httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        
        await using var contentStream = await response.Content.ReadAsStreamAsync(ct);
        await using var fileStream = File.Create(tempPath);
        await contentStream.CopyToAsync(fileStream, ct);
        
        // Move to cache if we have a hash
        if (!string.IsNullOrEmpty(expectedHash))
        {
            var cacheSubDir = Path.Combine(_cacheDir, expectedHash);
            Directory.CreateDirectory(cacheSubDir);
            var finalPath = Path.Combine(cacheSubDir, fileName);
            if (File.Exists(finalPath)) File.Delete(finalPath);
            File.Move(tempPath, finalPath);
            return finalPath;
        }

        return tempPath;
    }

    private async Task<string> ComputeFileHashAsync(string filePath, CancellationToken ct)
    {
        using var sha256 = System.Security.Cryptography.SHA256.Create();
        await using var stream = File.OpenRead(filePath);
        var hash = await sha256.ComputeHashAsync(stream, ct);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }

    private async Task<(int ExitCode, string? Error)> RunInstallAsync(
        string filePath, string installerType, string args, CancellationToken ct)
    {
        var isMsi = installerType.Equals("msi", StringComparison.OrdinalIgnoreCase) 
                    || filePath.EndsWith(".msi", StringComparison.OrdinalIgnoreCase);
        
        ProcessStartInfo psi;
        if (isMsi)
        {
            psi = new ProcessStartInfo
            {
                FileName = "msiexec",
                Arguments = $"/i \"{filePath}\" /qn /norestart {args}".Trim(),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
        }
        else
        {
            psi = new ProcessStartInfo
            {
                FileName = filePath,
                Arguments = args,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
        }

        _logger.LogInformation("Running: {FileName} {Args}", psi.FileName, psi.Arguments);

        using var process = Process.Start(psi);
        if (process == null)
            return (-1, "Failed to start process");

        var stderr = await process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);

        return (process.ExitCode, string.IsNullOrEmpty(stderr) ? null : stderr);
    }

    private async Task<(int ExitCode, string? Error)> RunUninstallAsync(
        string installerType, string args, CancellationToken ct)
    {
        // For uninstall, args should contain the full command (e.g., product code for msiexec)
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c {args}",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        _logger.LogInformation("Running uninstall: {Args}", args);

        using var process = Process.Start(psi);
        if (process == null)
            return (-1, "Failed to start process");

        var stderr = await process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);

        return (process.ExitCode, string.IsNullOrEmpty(stderr) ? null : stderr);
    }

    private async Task ReportStatusAsync(
        string baseUrl, string apiKey, string nodeId, string deploymentId,
        string status, int? exitCode, string? errorMessage, CancellationToken ct)
    {
        var url = $"{baseUrl}/api/v1/nodes/{nodeId}/deployments/{deploymentId}/status";
        
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Add("X-API-Key", apiKey);
        request.Content = JsonContent.Create(new
        {
            status,
            exitCode,
            errorMessage
        }, options: JsonOptions);

        try
        {
            var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to report deployment status: {StatusCode}", response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error reporting deployment status");
        }
    }
}

public class PendingDeployment
{
    [JsonPropertyName("deployment_id")]
    public string DeploymentId { get; set; } = "";
    
    public string Name { get; set; } = "";
    public string Mode { get; set; } = "required";
    
    [JsonPropertyName("maintenance_window_only")]
    public bool MaintenanceWindowOnly { get; set; }
    
    [JsonPropertyName("package_name")]
    public string PackageName { get; set; } = "";
    
    [JsonPropertyName("package_version")]
    public string PackageVersion { get; set; } = "";
    
    [JsonPropertyName("installer_type")]
    public string? InstallerType { get; set; }
    
    [JsonPropertyName("installer_url")]
    public string? InstallerUrl { get; set; }
    
    [JsonPropertyName("installer_path")]
    public string? InstallerPath { get; set; }
    
    [JsonPropertyName("install_args")]
    public string? InstallArgs { get; set; }
    
    [JsonPropertyName("uninstall_args")]
    public string? UninstallArgs { get; set; }
    
    [JsonPropertyName("expected_hash")]
    public string? ExpectedHash { get; set; }
    
    [JsonPropertyName("node_status")]
    public string NodeStatus { get; set; } = "pending";
    
    public int Attempts { get; set; }
}
