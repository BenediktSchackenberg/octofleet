using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using OpenClawAgent.Service.Packages;

namespace OpenClawAgent.Service;

/// <summary>
/// E5-08/E5-09: Polls for pending deployments and executes package installations.
/// Runs in parallel with JobPoller.
/// </summary>
public class DeploymentPoller : BackgroundService
{
    private readonly ILogger<DeploymentPoller> _logger;
    private readonly ServiceConfig _config;
    private readonly PackageManager _packageManager;
    private readonly HttpClient _httpClient;
    
    private const int PollIntervalMs = 60000;  // 1 minute
    private const int ErrorBackoffMs = 300000; // 5 minutes
    
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public DeploymentPoller(ILogger<DeploymentPoller> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _packageManager = new PackageManager(LoggerFactory.Create(b => b.AddConsole()).CreateLogger<PackageManager>());
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
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
                var apiKey = config.InventoryApiKey ?? "openclaw-inventory-dev-key";
                
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
                
                var uninstallResult = await _packageManager.UninstallPackageAsync(
                    deployment.InstallerType ?? "exe",
                    deployment.UninstallArgs ?? "",
                    ct);

                await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId,
                    uninstallResult.ExitCode == 0 ? "success" : "failed",
                    uninstallResult.ExitCode,
                    uninstallResult.ExitCode != 0 ? uninstallResult.Error : null,
                    ct);
            }
            else
            {
                // Install (required or available)
                // Download package
                string localPath;
                if (!string.IsNullOrEmpty(deployment.InstallerUrl))
                {
                    localPath = await _packageManager.DownloadPackageAsync(
                        deployment.InstallerUrl, 
                        deployment.ExpectedHash,
                        ct);
                }
                else if (!string.IsNullOrEmpty(deployment.InstallerPath))
                {
                    localPath = deployment.InstallerPath; // SMB path
                }
                else
                {
                    throw new Exception("No installer URL or path specified");
                }

                // Verify hash if provided
                if (!string.IsNullOrEmpty(deployment.ExpectedHash))
                {
                    var valid = await _packageManager.VerifyHashAsync(localPath, deployment.ExpectedHash, ct);
                    if (!valid)
                    {
                        throw new Exception("Hash verification failed");
                    }
                }

                // Install
                await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId, "installing", null, null, ct);
                
                var installResult = await _packageManager.InstallPackageAsync(
                    localPath,
                    deployment.InstallerType ?? "exe",
                    deployment.InstallArgs ?? "",
                    ct);

                await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId,
                    installResult.ExitCode == 0 ? "success" : "failed",
                    installResult.ExitCode,
                    installResult.ExitCode != 0 ? installResult.Error : null,
                    ct);

                _logger.LogInformation("Deployment {Name} completed with exit code {ExitCode}",
                    deployment.Name, installResult.ExitCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Deployment {Name} failed", deployment.Name);
            await ReportStatusAsync(baseUrl, apiKey, nodeId, deployment.DeploymentId, 
                "failed", -1, ex.Message, ct);
        }
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
