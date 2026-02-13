using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpenClawAgent.Service;

/// <summary>
/// Polls for and executes auto-remediation jobs (winget/choco updates).
/// Runs independently of regular jobs for vulnerability fixes.
/// </summary>
public class RemediationPoller : BackgroundService
{
    private readonly ILogger<RemediationPoller> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    
    // Poll every 60 seconds for remediation jobs
    private const int PollIntervalMs = 60000;
    private const int ErrorBackoffMs = 120000;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public RemediationPoller(ILogger<RemediationPoller> logger, ServiceConfig config)
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
        _logger.LogInformation("RemediationPoller starting...");

        // Wait for config
        while (!stoppingToken.IsCancellationRequested)
        {
            var config = ServiceConfig.Load();
            if (config.IsConfigured && !string.IsNullOrEmpty(config.InventoryApiUrl))
                break;
            
            await Task.Delay(5000, stoppingToken);
        }

        var nodeId = $"win-{Environment.MachineName.ToLowerInvariant()}";
        _logger.LogInformation("RemediationPoller configured for node: {NodeId}", nodeId);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var config = ServiceConfig.Load();
                var baseUrl = config.InventoryApiUrl?.TrimEnd('/');
                
                if (string.IsNullOrEmpty(baseUrl))
                {
                    await Task.Delay(PollIntervalMs, stoppingToken);
                    continue;
                }

                // Poll for remediation jobs
                var jobs = await GetPendingRemediationJobsAsync(baseUrl, nodeId, stoppingToken);
                
                if (jobs.Count > 0)
                {
                    _logger.LogInformation("Found {Count} remediation jobs to execute", jobs.Count);
                    
                    foreach (var job in jobs)
                    {
                        if (stoppingToken.IsCancellationRequested) break;
                        await ExecuteRemediationAsync(baseUrl, job, stoppingToken);
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
                _logger.LogError(ex, "Remediation polling error, backing off...");
                await Task.Delay(ErrorBackoffMs, stoppingToken);
            }
        }

        _logger.LogInformation("RemediationPoller stopped.");
    }

    private async Task<List<RemediationJob>> GetPendingRemediationJobsAsync(
        string baseUrl, string nodeId, CancellationToken ct)
    {
        var url = $"{baseUrl}/api/v1/remediation/jobs/pending/{nodeId}";
        
        try
        {
            var response = await _httpClient.GetAsync(url, ct);
            
            if (!response.IsSuccessStatusCode)
            {
                if (response.StatusCode != System.Net.HttpStatusCode.NotFound)
                {
                    _logger.LogWarning("Failed to get remediation jobs: {StatusCode}", response.StatusCode);
                }
                return new List<RemediationJob>();
            }

            var content = await response.Content.ReadAsStringAsync(ct);
            var result = JsonSerializer.Deserialize<RemediationJobsResponse>(content, JsonOptions);
            
            return result?.Jobs ?? new List<RemediationJob>();
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("HTTP error getting remediation jobs: {Message}", ex.Message);
            return new List<RemediationJob>();
        }
    }

    private async Task ExecuteRemediationAsync(string baseUrl, RemediationJob job, CancellationToken ct)
    {
        _logger.LogInformation(
            "Executing remediation: {Software} ({CveId}) via {Method}", 
            job.SoftwareName, job.CveId, job.FixMethod);
        _logger.LogInformation("Command: {Command}", job.FixCommand);

        var stdout = new System.Text.StringBuilder();
        var stderr = new System.Text.StringBuilder();
        int exitCode = -1;

        try
        {
            // Execute the fix command (winget/choco)
            var result = await ExecuteFixCommandAsync(job.FixCommand, ct);
            exitCode = result.ExitCode;
            stdout.Append(result.Stdout);
            stderr.Append(result.Stderr);

            _logger.LogInformation(
                "Remediation {JobId} completed with exit code: {ExitCode}", 
                job.JobId, exitCode);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Remediation {JobId} failed", job.JobId);
            stderr.AppendLine($"Exception: {ex.Message}");
            exitCode = -1;
        }

        // Report result back to API
        await ReportRemediationResultAsync(baseUrl, job.JobId, exitCode, 
            stdout.ToString(), stderr.ToString(), ct);
    }

    private async Task<CommandResult> ExecuteFixCommandAsync(string command, CancellationToken ct)
    {
        // Wrap command in PowerShell for proper execution
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-ExecutionPolicy");
        psi.ArgumentList.Add("Bypass");
        psi.ArgumentList.Add("-Command");
        psi.ArgumentList.Add(command);

        _logger.LogDebug("Starting: powershell -Command {Command}", command);

        using var process = Process.Start(psi);
        if (process == null)
        {
            return new CommandResult { ExitCode = -1, Stderr = "Failed to start PowerShell" };
        }

        // 10 minute timeout for package updates
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
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
        catch (OperationCanceledException)
        {
            try { process.Kill(true); } catch { }
            return new CommandResult { ExitCode = -1, Stderr = "Command timed out (10 min)" };
        }
    }

    private async Task ReportRemediationResultAsync(
        string baseUrl, int jobId, int exitCode, 
        string stdout, string stderr, CancellationToken ct)
    {
        var url = $"{baseUrl}/api/v1/remediation/jobs/{jobId}/result";
        
        try
        {
            var payload = new
            {
                exitCode = exitCode,
                output = stdout,
                error = stderr
            };

            var response = await _httpClient.PostAsJsonAsync(url, payload, JsonOptions, ct);
            
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to report remediation result: {StatusCode}", response.StatusCode);
            }
            else
            {
                _logger.LogInformation(
                    "Remediation result reported: Job {JobId} (exitCode: {ExitCode})", 
                    jobId, exitCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reporting remediation result for job {JobId}", jobId);
        }
    }
}

#region DTOs

public class RemediationJobsResponse
{
    public List<RemediationJob> Jobs { get; set; } = new();
    public int Count { get; set; }
}

public class RemediationJob
{
    public int JobId { get; set; }
    public string CveId { get; set; } = "";
    public string SoftwareName { get; set; } = "";
    public string SoftwareVersion { get; set; } = "";
    public string FixMethod { get; set; } = "";
    public string FixCommand { get; set; } = "";
    public string PackageName { get; set; } = "";
}

#endregion
