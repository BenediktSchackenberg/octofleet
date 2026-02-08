using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpenClawAgent.Service;

/// <summary>
/// Polls the Inventory API for pending jobs and executes them.
/// Runs as a background service parallel to the Gateway connection.
/// </summary>
public class JobPoller : BackgroundService
{
    private readonly ILogger<JobPoller> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    
    // Polling settings
    private const int DefaultPollIntervalMs = 30000;  // 30 seconds
    private const int ErrorBackoffMs = 60000;         // 1 minute on error
    private const int MaxRetries = 3;                 // Retry failed jobs 3 times

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = true
    };

    public JobPoller(ILogger<JobPoller> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("JobPoller starting...");

        // Wait for config to be ready
        while (!stoppingToken.IsCancellationRequested)
        {
            var config = ServiceConfig.Load();
            
            if (config.IsConfigured && !string.IsNullOrEmpty(config.InventoryApiUrl))
            {
                break;
            }
            
            _logger.LogDebug("Waiting for configuration...");
            await Task.Delay(5000, stoppingToken);
        }

        // Get nodeId (same format as NodeWorker)
        var nodeId = $"win-{Environment.MachineName.ToLowerInvariant()}";
        _logger.LogInformation("JobPoller configured for node: {NodeId}", nodeId);

        // Main polling loop
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var config = ServiceConfig.Load();
                var baseUrl = config.InventoryApiUrl?.TrimEnd('/');
                
                if (string.IsNullOrEmpty(baseUrl))
                {
                    await Task.Delay(DefaultPollIntervalMs, stoppingToken);
                    continue;
                }

                // Poll for pending jobs
                var pendingJobs = await GetPendingJobsAsync(baseUrl, nodeId, stoppingToken);
                
                if (pendingJobs.Count > 0)
                {
                    _logger.LogInformation("Found {Count} pending jobs", pendingJobs.Count);
                    
                    foreach (var job in pendingJobs)
                    {
                        if (stoppingToken.IsCancellationRequested) break;
                        await ExecuteJobAsync(baseUrl, job, stoppingToken);
                    }
                }

                await Task.Delay(DefaultPollIntervalMs, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Job polling error, backing off...");
                await Task.Delay(ErrorBackoffMs, stoppingToken);
            }
        }

        _logger.LogInformation("JobPoller stopped.");
    }

    private async Task<List<PendingJob>> GetPendingJobsAsync(string baseUrl, string nodeId, CancellationToken ct)
    {
        var url = $"{baseUrl}/api/v1/jobs/pending/{nodeId}";
        
        try
        {
            var response = await _httpClient.GetAsync(url, ct);
            
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to get pending jobs: {StatusCode}", response.StatusCode);
                return new List<PendingJob>();
            }

            var content = await response.Content.ReadAsStringAsync(ct);
            var result = JsonSerializer.Deserialize<PendingJobsResponse>(content, JsonOptions);
            
            return result?.Jobs ?? new List<PendingJob>();
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("HTTP error getting pending jobs: {Message}", ex.Message);
            return new List<PendingJob>();
        }
    }

    private async Task ExecuteJobAsync(string baseUrl, PendingJob job, CancellationToken ct)
    {
        _logger.LogInformation("Executing job: {JobName} (instance: {InstanceId})", job.JobName, job.InstanceId);

        // Mark job as started
        await UpdateJobStatusAsync(baseUrl, job.InstanceId, "start", ct);

        var result = new JobResult
        {
            InstanceId = job.InstanceId,
            StartedAt = DateTime.UtcNow
        };

        try
        {
            // Parse and execute the command
            var commandResult = await ExecuteCommandAsync(job.CommandType, job.CommandPayload, job.TimeoutSeconds, ct);
            
            result.ExitCode = commandResult.ExitCode;
            result.Stdout = commandResult.Stdout;
            result.Stderr = commandResult.Stderr;
            result.Success = commandResult.ExitCode == 0;
            result.CompletedAt = DateTime.UtcNow;

            _logger.LogInformation("Job {InstanceId} completed with exit code: {ExitCode}", 
                job.InstanceId, result.ExitCode);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Job {InstanceId} failed", job.InstanceId);
            
            result.Success = false;
            result.Stderr = ex.Message;
            result.ExitCode = -1;
            result.CompletedAt = DateTime.UtcNow;
        }

        // Report result back to API
        await ReportJobResultAsync(baseUrl, result, ct);
    }

    private async Task<CommandResult> ExecuteCommandAsync(string commandType, string commandPayload, int timeoutSeconds, CancellationToken ct)
    {
        var result = new CommandResult();
        
        // Parse command payload
        JsonElement payload;
        try
        {
            payload = JsonDocument.Parse(commandPayload).RootElement;
        }
        catch
        {
            // Simple string command
            payload = JsonDocument.Parse($"{{\"command\": [\"{commandPayload}\"]}}").RootElement;
        }

        switch (commandType?.ToLowerInvariant())
        {
            case "script":
            case "command":
            case "powershell":
                return await ExecuteScriptAsync(payload, commandType, timeoutSeconds, ct);
                
            case "msi":
                return await ExecuteMsiAsync(payload, timeoutSeconds, ct);
                
            default:
                // Default to script/command execution
                return await ExecuteScriptAsync(payload, "command", timeoutSeconds, ct);
        }
    }

    private async Task<CommandResult> ExecuteScriptAsync(JsonElement payload, string type, int timeoutSeconds, CancellationToken ct)
    {
        var command = new List<string>();
        
        // Parse command array
        if (payload.TryGetProperty("command", out var cmdProp))
        {
            if (cmdProp.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in cmdProp.EnumerateArray())
                {
                    if (item.GetString() is string s)
                        command.Add(s);
                }
            }
            else if (cmdProp.ValueKind == JsonValueKind.String)
            {
                // Single command string - wrap in PowerShell
                var cmdString = cmdProp.GetString();
                command.Add("powershell.exe");
                command.Add("-NoProfile");
                command.Add("-NonInteractive");
                command.Add("-Command");
                command.Add(cmdString ?? "");
            }
        }

        // Check for script property (inline script content)
        if (command.Count == 0 && payload.TryGetProperty("script", out var scriptProp))
        {
            var script = scriptProp.GetString();
            command.Add("powershell.exe");
            command.Add("-NoProfile");
            command.Add("-NonInteractive");
            command.Add("-Command");
            command.Add(script ?? "");
        }

        if (command.Count == 0)
        {
            return new CommandResult
            {
                ExitCode = -1,
                Stderr = "No command specified"
            };
        }

        // Force PowerShell wrapper for "powershell" type
        if (type == "powershell" && !command[0].Contains("powershell", StringComparison.OrdinalIgnoreCase))
        {
            var originalCmd = string.Join(" ", command);
            command.Clear();
            command.Add("powershell.exe");
            command.Add("-NoProfile");
            command.Add("-NonInteractive");
            command.Add("-Command");
            command.Add(originalCmd);
        }

        var psi = new ProcessStartInfo
        {
            FileName = command[0],
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        for (int i = 1; i < command.Count; i++)
            psi.ArgumentList.Add(command[i]);

        using var process = Process.Start(psi);
        if (process == null)
        {
            return new CommandResult
            {
                ExitCode = -1,
                Stderr = "Failed to start process"
            };
        }

        var timeout = TimeSpan.FromSeconds(timeoutSeconds > 0 ? timeoutSeconds : 300);
        using var timeoutCts = new CancellationTokenSource(timeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        try
        {
            var stdout = await process.StandardOutput.ReadToEndAsync(linkedCts.Token);
            var stderr = await process.StandardError.ReadToEndAsync(linkedCts.Token);
            await process.WaitForExitAsync(linkedCts.Token);

            return new CommandResult
            {
                ExitCode = process.ExitCode,
                Stdout = stdout,
                Stderr = stderr
            };
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            try { process.Kill(); } catch { }
            
            return new CommandResult
            {
                ExitCode = -1,
                Stderr = $"Process timed out after {timeout.TotalSeconds}s"
            };
        }
    }

    private async Task<CommandResult> ExecuteMsiAsync(JsonElement payload, int timeoutSeconds, CancellationToken ct)
    {
        // Extract MSI parameters
        string? msiPath = null;
        string? productCode = null;
        bool uninstall = false;
        var additionalArgs = new List<string>();

        if (payload.TryGetProperty("path", out var pathProp))
            msiPath = pathProp.GetString();
            
        if (payload.TryGetProperty("productCode", out var pcProp))
            productCode = pcProp.GetString();
            
        if (payload.TryGetProperty("uninstall", out var uninstallProp))
            uninstall = uninstallProp.GetBoolean();
            
        if (payload.TryGetProperty("args", out var argsProp) && argsProp.ValueKind == JsonValueKind.Array)
        {
            foreach (var arg in argsProp.EnumerateArray())
            {
                if (arg.GetString() is string s)
                    additionalArgs.Add(s);
            }
        }

        // Build msiexec command
        var args = new List<string>();
        
        if (uninstall)
        {
            args.Add("/x");
            args.Add(productCode ?? msiPath ?? "");
        }
        else
        {
            args.Add("/i");
            args.Add(msiPath ?? "");
        }
        
        // Always quiet + no restart
        args.Add("/qn");
        args.Add("/norestart");
        args.AddRange(additionalArgs);

        var psi = new ProcessStartInfo
        {
            FileName = "msiexec.exe",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        foreach (var arg in args)
            psi.ArgumentList.Add(arg);

        _logger.LogInformation("Executing MSI: msiexec {Args}", string.Join(" ", args));

        using var process = Process.Start(psi);
        if (process == null)
        {
            return new CommandResult
            {
                ExitCode = -1,
                Stderr = "Failed to start msiexec"
            };
        }

        var timeout = TimeSpan.FromSeconds(timeoutSeconds > 0 ? timeoutSeconds : 600); // 10 min default for MSI
        using var timeoutCts = new CancellationTokenSource(timeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        try
        {
            var stdout = await process.StandardOutput.ReadToEndAsync(linkedCts.Token);
            var stderr = await process.StandardError.ReadToEndAsync(linkedCts.Token);
            await process.WaitForExitAsync(linkedCts.Token);

            return new CommandResult
            {
                ExitCode = process.ExitCode,
                Stdout = stdout,
                Stderr = stderr
            };
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            return new CommandResult
            {
                ExitCode = -1,
                Stderr = $"MSI installation timed out after {timeout.TotalSeconds}s"
            };
        }
    }

    private async Task UpdateJobStatusAsync(string baseUrl, string instanceId, string action, CancellationToken ct)
    {
        var url = $"{baseUrl}/api/v1/jobs/instances/{instanceId}/{action}";
        
        try
        {
            var response = await _httpClient.PostAsync(url, null, ct);
            
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to update job status ({Action}): {StatusCode}", action, response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Error updating job status ({Action}): {Message}", action, ex.Message);
        }
    }

    private async Task ReportJobResultAsync(string baseUrl, JobResult result, CancellationToken ct)
    {
        var url = $"{baseUrl}/api/v1/jobs/instances/{result.InstanceId}/result";
        
        try
        {
            var payload = new
            {
                success = result.Success,
                exitCode = result.ExitCode,
                stdout = result.Stdout ?? "",
                stderr = result.Stderr ?? "",
                startedAt = result.StartedAt?.ToString("o"),
                completedAt = result.CompletedAt?.ToString("o")
            };

            var response = await _httpClient.PostAsJsonAsync(url, payload, JsonOptions, ct);
            
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to report job result: {StatusCode}", response.StatusCode);
            }
            else
            {
                _logger.LogInformation("Job result reported: {InstanceId} (success: {Success})", 
                    result.InstanceId, result.Success);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reporting job result for {InstanceId}", result.InstanceId);
        }
    }
}

#region DTOs

public class PendingJobsResponse
{
    public List<PendingJob> Jobs { get; set; } = new();
    public int Count { get; set; }
}

public class PendingJob
{
    public string InstanceId { get; set; } = "";
    public string JobId { get; set; } = "";
    public string JobName { get; set; } = "";
    public string CommandType { get; set; } = "command";
    public string CommandPayload { get; set; } = "{}";
    public int TimeoutSeconds { get; set; } = 300;
    public int RetryCount { get; set; } = 0;
    public DateTime CreatedAt { get; set; }
}

public class JobResult
{
    public string InstanceId { get; set; } = "";
    public bool Success { get; set; }
    public int ExitCode { get; set; }
    public string? Stdout { get; set; }
    public string? Stderr { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class CommandResult
{
    public int ExitCode { get; set; }
    public string Stdout { get; set; } = "";
    public string Stderr { get; set; } = "";
}

#endregion
