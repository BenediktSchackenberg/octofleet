using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OctofleetAgent.Service;

/// <summary>
/// E18: Service Reconciliation Poller
/// Polls for assigned services and ensures desired state is achieved.
/// Handles package installation, health checks, and drift detection.
/// </summary>
public class ServiceReconciliationPoller : BackgroundService
{
    private readonly ILogger<ServiceReconciliationPoller> _logger;
    private readonly HttpClient _httpClient;
    
    private const int PollIntervalMs = 60000;  // 1 minute
    private const int ErrorBackoffMs = 300000; // 5 minutes
    private const int HealthCheckIntervalMs = 300000; // 5 minutes
    
    private DateTime _lastHealthCheck = DateTime.MinValue;
    
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public ServiceReconciliationPoller(ILogger<ServiceReconciliationPoller> logger)
    {
        _logger = logger;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ServiceReconciliationPoller starting...");
        
        // Wait for configuration
        while (!stoppingToken.IsCancellationRequested)
        {
            var config = ServiceConfig.Load();
            if (config.IsConfigured && !string.IsNullOrEmpty(config.InventoryApiUrl))
                break;
            
            await Task.Delay(5000, stoppingToken);
        }

        var nodeId = Environment.MachineName.ToUpperInvariant();
        _logger.LogInformation("ServiceReconciliationPoller ready for node: {NodeId}", nodeId);

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

                // Get assigned services for this node
                var services = await GetAssignedServicesAsync(baseUrl, apiKey, nodeId, stoppingToken);
                
                foreach (var service in services)
                {
                    if (stoppingToken.IsCancellationRequested) break;
                    
                    // Check if reconciliation needed
                    if (service.NeedsReconcile)
                    {
                        _logger.LogInformation("Reconciling service {ServiceName} (v{Current} -> v{Desired})",
                            service.ServiceName, service.CurrentVersion, service.DesiredVersion);
                        
                        await ReconcileServiceAsync(baseUrl, apiKey, nodeId, service, stoppingToken);
                    }
                    
                    // Periodic health checks
                    if (DateTime.UtcNow - _lastHealthCheck > TimeSpan.FromMilliseconds(HealthCheckIntervalMs))
                    {
                        await PerformHealthCheckAsync(baseUrl, apiKey, nodeId, service, stoppingToken);
                    }
                }
                
                if (services.Count > 0 && DateTime.UtcNow - _lastHealthCheck > TimeSpan.FromMilliseconds(HealthCheckIntervalMs))
                {
                    _lastHealthCheck = DateTime.UtcNow;
                }

                await Task.Delay(PollIntervalMs, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in ServiceReconciliationPoller");
                await Task.Delay(ErrorBackoffMs, stoppingToken);
            }
        }
        
        _logger.LogInformation("ServiceReconciliationPoller stopped");
    }

    private async Task<List<ServiceAssignment>> GetAssignedServicesAsync(
        string baseUrl, string apiKey, string nodeId, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, 
            $"{baseUrl}/api/v1/nodes/{nodeId}/service-assignments");
        request.Headers.Add("X-API-Key", apiKey);
        
        var response = await _httpClient.SendAsync(request, ct);
        
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Failed to get service assignments: {Status}", response.StatusCode);
            return new List<ServiceAssignment>();
        }
        
        var result = await response.Content.ReadFromJsonAsync<ServiceAssignmentsResponse>(JsonOptions, ct);
        return result?.Services ?? new List<ServiceAssignment>();
    }

    private async Task ReconcileServiceAsync(
        string baseUrl, string apiKey, string nodeId,
        ServiceAssignment service, CancellationToken ct)
    {
        var status = "active";
        var healthStatus = "unknown";
        string? errorMessage = null;
        
        try
        {
            // Step 1: Ensure required packages are installed
            if (service.RequiredPackages?.Count > 0)
            {
                _logger.LogInformation("Installing {Count} required packages for {Service}",
                    service.RequiredPackages.Count, service.ServiceName);
                
                foreach (var package in service.RequiredPackages)
                {
                    var installed = await InstallPackageAsync(package, ct);
                    if (!installed)
                    {
                        status = "failed";
                        errorMessage = $"Failed to install package: {package}";
                        break;
                    }
                }
            }
            
            // Step 2: Apply configuration (if template exists)
            if (status == "active" && !string.IsNullOrEmpty(service.ConfigTemplate))
            {
                _logger.LogInformation("Applying configuration for {Service}", service.ServiceName);
                ApplyConfiguration(service);
            }
            
            // Step 3: Verify health
            if (status == "active")
            {
                healthStatus = await CheckServiceHealthAsync(service, ct);
                _logger.LogInformation("Health check for {Service}: {Status}", 
                    service.ServiceName, healthStatus);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reconciling service {Service}", service.ServiceName);
            status = "failed";
            healthStatus = "unhealthy";
            errorMessage = ex.Message;
        }
        
        // Report status back to server
        await ReportStatusAsync(baseUrl, apiKey, nodeId, service, status, healthStatus,
            status == "active" ? service.DesiredVersion : null, errorMessage, ct);
    }

    private async Task<bool> InstallPackageAsync(string packageName, CancellationToken ct)
    {
        try
        {
            // Try winget first
            var wingetResult = await RunCommandAsync("winget", $"install -e --id {packageName} --accept-source-agreements --accept-package-agreements", ct);
            if (wingetResult.ExitCode == 0 || wingetResult.Output.Contains("already installed", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("Package {Package} installed via winget", packageName);
                return true;
            }
            
            // Fallback to chocolatey
            var chocoResult = await RunCommandAsync("choco", $"install {packageName} -y --no-progress", ct);
            if (chocoResult.ExitCode == 0)
            {
                _logger.LogInformation("Package {Package} installed via chocolatey", packageName);
                return true;
            }
            
            _logger.LogWarning("Failed to install package {Package}", packageName);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error installing package {Package}", packageName);
            return false;
        }
    }

    private void ApplyConfiguration(ServiceAssignment service)
    {
        // Apply config template with values
        // This is a simple implementation - extend as needed
        if (string.IsNullOrEmpty(service.ConfigTemplate)) return;
        
        var configContent = service.ConfigTemplate;
        
        // Replace template variables (Jinja2-style: {{ variable }})
        if (service.ConfigValues != null)
        {
            foreach (var kvp in service.ConfigValues)
            {
                configContent = configContent.Replace($"{{{{ {kvp.Key} }}}}", kvp.Value?.ToString() ?? "");
                configContent = configContent.Replace($"{{{{{kvp.Key}}}}}", kvp.Value?.ToString() ?? "");
            }
        }
        
        // Determine config file path based on service
        var configDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Octofleet", "ServiceConfigs", service.ServiceName);
        Directory.CreateDirectory(configDir);
        
        var configPath = Path.Combine(configDir, "config.json");
        File.WriteAllText(configPath, configContent);
        
        _logger.LogInformation("Configuration written to {Path}", configPath);
    }

    private async Task<string> CheckServiceHealthAsync(ServiceAssignment service, CancellationToken ct)
    {
        if (service.HealthCheck == null || !service.HealthCheck.TryGetValue("type", out var typeObj))
            return "unknown";
        
        var type = typeObj?.ToString();
        
        try
        {
            switch (type?.ToLower())
            {
                case "http":
                    return await CheckHttpHealthAsync(service.HealthCheck, ct);
                
                case "tcp":
                    return await CheckTcpHealthAsync(service.HealthCheck, ct);
                
                case "process":
                    return CheckProcessHealth(service.HealthCheck);
                
                case "service":
                    return CheckWindowsServiceHealth(service.HealthCheck);
                
                default:
                    return "unknown";
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Health check failed for {Service}", service.ServiceName);
            return "unhealthy";
        }
    }

    private async Task<string> CheckHttpHealthAsync(Dictionary<string, object?> healthCheck, CancellationToken ct)
    {
        var port = healthCheck.GetValueOrDefault("port")?.ToString() ?? "80";
        var path = healthCheck.GetValueOrDefault("path")?.ToString() ?? "/";
        var host = healthCheck.GetValueOrDefault("host")?.ToString() ?? "localhost";
        
        var url = $"http://{host}:{port}{path}";
        
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            var response = await client.GetAsync(url, ct);
            return response.IsSuccessStatusCode ? "healthy" : "unhealthy";
        }
        catch
        {
            return "unhealthy";
        }
    }

    private async Task<string> CheckTcpHealthAsync(Dictionary<string, object?> healthCheck, CancellationToken ct)
    {
        var port = int.Parse(healthCheck.GetValueOrDefault("port")?.ToString() ?? "80");
        var host = healthCheck.GetValueOrDefault("host")?.ToString() ?? "localhost";
        
        try
        {
            using var client = new System.Net.Sockets.TcpClient();
            await client.ConnectAsync(host, port, ct);
            return "healthy";
        }
        catch
        {
            return "unhealthy";
        }
    }

    private string CheckProcessHealth(Dictionary<string, object?> healthCheck)
    {
        var processName = healthCheck.GetValueOrDefault("processName")?.ToString();
        if (string.IsNullOrEmpty(processName)) return "unknown";
        
        var processes = Process.GetProcessesByName(processName);
        return processes.Length > 0 ? "healthy" : "unhealthy";
    }

    private string CheckWindowsServiceHealth(Dictionary<string, object?> healthCheck)
    {
        var serviceName = healthCheck.GetValueOrDefault("serviceName")?.ToString();
        if (string.IsNullOrEmpty(serviceName)) return "unknown";
        
        try
        {
            using var sc = new System.ServiceProcess.ServiceController(serviceName);
            return sc.Status == System.ServiceProcess.ServiceControllerStatus.Running ? "healthy" : "unhealthy";
        }
        catch
        {
            return "unhealthy";
        }
    }

    private async Task PerformHealthCheckAsync(
        string baseUrl, string apiKey, string nodeId,
        ServiceAssignment service, CancellationToken ct)
    {
        var healthStatus = await CheckServiceHealthAsync(service, ct);
        
        // Drift detection for strict policy
        if (service.DriftPolicy == "strict")
        {
            // Check if packages are still installed
            if (service.RequiredPackages != null)
            {
                foreach (var package in service.RequiredPackages)
                {
                    var isInstalled = await CheckPackageInstalledAsync(package, ct);
                    if (!isInstalled)
                    {
                        _logger.LogWarning("Drift detected: Package {Package} missing for {Service}",
                            package, service.ServiceName);
                        healthStatus = "drifted";
                        break;
                    }
                }
            }
        }
        
        await ReportStatusAsync(baseUrl, apiKey, nodeId, service, 
            service.Status, healthStatus, null, null, ct);
    }

    private async Task<bool> CheckPackageInstalledAsync(string packageName, CancellationToken ct)
    {
        var result = await RunCommandAsync("winget", $"list -e --id {packageName}", ct);
        return result.ExitCode == 0 && result.Output.Contains(packageName, StringComparison.OrdinalIgnoreCase);
    }

    private async Task ReportStatusAsync(
        string baseUrl, string apiKey, string nodeId,
        ServiceAssignment service, string status, string healthStatus,
        int? stateVersion, string? errorMessage, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post,
            $"{baseUrl}/api/v1/services/{service.ServiceId}/nodes/{nodeId}/status");
        request.Headers.Add("X-API-Key", apiKey);
        
        var payload = new
        {
            status,
            healthStatus,
            stateVersion,
            errorMessage,
            timestamp = DateTime.UtcNow
        };
        
        request.Content = JsonContent.Create(payload, options: JsonOptions);
        
        var response = await _httpClient.SendAsync(request, ct);
        
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Failed to report status for {Service}: {Status}",
                service.ServiceName, response.StatusCode);
        }
    }

    private async Task<(int ExitCode, string Output)> RunCommandAsync(
        string fileName, string arguments, CancellationToken ct)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            }
        };
        
        process.Start();
        var output = await process.StandardOutput.ReadToEndAsync(ct);
        var error = await process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);
        
        return (process.ExitCode, output + error);
    }
}

// DTOs
public class ServiceAssignmentsResponse
{
    public string? NodeId { get; set; }
    public List<ServiceAssignment> Services { get; set; } = new();
}

public class ServiceAssignment
{
    public string AssignmentId { get; set; } = "";
    public string ServiceId { get; set; } = "";
    public string ServiceName { get; set; } = "";
    public string ClassName { get; set; } = "";
    public string Role { get; set; } = "";
    public string Status { get; set; } = "";
    public string ServiceType { get; set; } = "";
    public List<string>? RequiredPackages { get; set; }
    public string? ConfigTemplate { get; set; }
    public Dictionary<string, object?>? ConfigValues { get; set; }
    public Dictionary<string, object?>? HealthCheck { get; set; }
    public string? DriftPolicy { get; set; }
    public int CurrentVersion { get; set; }
    public int DesiredVersion { get; set; }
    public bool NeedsReconcile { get; set; }
}
