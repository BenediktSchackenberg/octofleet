using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OctofleetAgent.Service;

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
        bool usedFallback = false;

        try
        {
            // Execute the fix command (winget/choco)
            var result = await ExecuteFixCommandAsync(job.FixCommand, ct);
            exitCode = result.ExitCode;
            stdout.Append(result.Stdout);
            stderr.Append(result.Stderr);

            // Check if winget failed with "No installed package found" - try Chocolatey fallback
            if (exitCode != 0 && job.FixCommand.StartsWith("winget ", StringComparison.OrdinalIgnoreCase))
            {
                var output = result.Stdout + result.Stderr;
                if (output.Contains("No installed package found", StringComparison.OrdinalIgnoreCase) ||
                    output.Contains("No applicable update found", StringComparison.OrdinalIgnoreCase) ||
                    output.Contains("No package found", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogWarning("Winget failed to find package - attempting Chocolatey fallback");
                    stdout.AppendLine("\n=== Winget failed, trying Chocolatey fallback ===");
                    
                    // Ensure Chocolatey is installed
                    await EnsureChocolateyInstalledAsync();
                    
                    var chocoPath = @"C:\ProgramData\chocolatey\bin\choco.exe";
                    if (File.Exists(chocoPath))
                    {
                        var chocoCommand = ConvertWingetToChoco(job.FixCommand, chocoPath);
                        _logger.LogInformation("Fallback command: {Command}", chocoCommand);
                        stdout.AppendLine($"Fallback: {chocoCommand}");
                        
                        var fallbackResult = await ExecuteFixCommandAsync(chocoCommand, ct);
                        exitCode = fallbackResult.ExitCode;
                        stdout.Append(fallbackResult.Stdout);
                        stderr.Append(fallbackResult.Stderr);
                        usedFallback = true;
                        
                        _logger.LogInformation("Chocolatey fallback completed with exit code: {ExitCode}", exitCode);
                    }
                }
            }

            _logger.LogInformation(
                "Remediation {JobId} completed with exit code: {ExitCode}{Fallback}", 
                job.JobId, exitCode, usedFallback ? " (via Chocolatey fallback)" : "");
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
        // Resolve winget/choco paths for SYSTEM context
        command = ResolvePackageManagerPaths(command);
        
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

    /// <summary>
    /// Resolve winget/choco to full paths since SYSTEM service doesn't have them in PATH.
    /// </summary>
    private string ResolvePackageManagerPaths(string command)
    {
        // Common winget locations (for SYSTEM context)
        var wingetPaths = new[]
        {
            @"C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe",
            @"C:\Users\*\AppData\Local\Microsoft\WindowsApps\winget.exe",
            Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"),
            @"C:\Windows\System32\winget.exe"
        };

        // Find actual winget path
        string? wingetPath = null;
        foreach (var pattern in wingetPaths)
        {
            if (pattern.Contains('*'))
            {
                var dir = Path.GetDirectoryName(pattern);
                var file = Path.GetFileName(pattern);
                if (dir != null && Directory.Exists(Path.GetDirectoryName(dir)))
                {
                    try
                    {
                        var matches = Directory.GetDirectories(Path.GetDirectoryName(dir)!, Path.GetFileName(dir))
                            .OrderByDescending(d => d)
                            .FirstOrDefault();
                        if (matches != null)
                        {
                            var candidate = Path.Combine(matches, file.Replace("*", ""));
                            // For WindowsApps, just look in the dir
                            var exePath = Directory.GetFiles(matches, "winget.exe").FirstOrDefault();
                            if (exePath != null && File.Exists(exePath))
                            {
                                wingetPath = exePath;
                                break;
                            }
                        }
                    }
                    catch { }
                }
            }
            else if (File.Exists(pattern))
            {
                wingetPath = pattern;
                break;
            }
        }

        // Replace "winget" with full path if found
        // PowerShell needs & operator to execute paths with spaces
        if (wingetPath != null && command.StartsWith("winget ", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogDebug("Resolved winget to: {Path}", wingetPath);
            command = $"& \"{wingetPath}\" {command[7..]}";
        }
        else if (command.StartsWith("winget ", StringComparison.OrdinalIgnoreCase))
        {
            // Winget not found - try to use Chocolatey as fallback
            var chocoPath = @"C:\ProgramData\chocolatey\bin\choco.exe";
            
            // Auto-install Chocolatey if not present
            if (!File.Exists(chocoPath))
            {
                _logger.LogWarning("Neither winget nor choco found - auto-installing Chocolatey...");
                if (TryInstallChocolatey())
                {
                    _logger.LogInformation("Chocolatey installed successfully!");
                }
                else
                {
                    _logger.LogError("Failed to auto-install Chocolatey");
                }
            }
            
            if (File.Exists(chocoPath))
            {
                _logger.LogInformation("Winget not found, converting to Chocolatey command");
                command = ConvertWingetToChoco(command, chocoPath);
            }
            else
            {
                // Last resort: try Resolve-Path for winget
                _logger.LogWarning("Could not find winget.exe or choco.exe, using Resolve-Path fallback");
                command = $"& (Resolve-Path 'C:\\Program Files\\WindowsApps\\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\\winget.exe' -ErrorAction SilentlyContinue | Select-Object -Last 1).Path {command[7..]}";
            }
        }

        // Handle choco commands - ensure Chocolatey is installed and use full path
        if (command.StartsWith("choco ", StringComparison.OrdinalIgnoreCase))
        {
            var chocoPath = @"C:\ProgramData\chocolatey\bin\choco.exe";
            
            // If Chocolatey not installed, try to install it first
            if (!File.Exists(chocoPath))
            {
                _logger.LogWarning("Chocolatey not found at {Path} - attempting auto-install", chocoPath);
                TryInstallChocolatey();
            }
            
            if (File.Exists(chocoPath))
            {
                command = $"& \"{chocoPath}\" {command[6..]}";
            }
            else
            {
                // Chocolatey still not available - try with refreshed PATH
                _logger.LogWarning("Chocolatey install may have failed, trying with refreshed environment");
                command = $"$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine'); choco {command[6..]}";
            }
        }

        return command;
    }

    /// <summary>
    /// Convert a winget command to equivalent Chocolatey command.
    /// </summary>
    private string ConvertWingetToChoco(string wingetCommand, string chocoPath)
    {
        // Map common winget package IDs to choco package names
        var packageMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "Git.Git", "git" },
            { "7zip.7zip", "7zip" },
            { "Google.Chrome", "googlechrome" },
            { "Mozilla.Firefox", "firefox" },
            { "VideoLAN.VLC", "vlc" },
            { "Notepad++.Notepad++", "notepadplusplus" },
            { "Python.Python.3", "python" },
            { "Python.Python.3.12", "python312" },
            { "Oracle.JDK.17", "openjdk17" },
            { "Oracle.JDK.21", "openjdk21" },
            { "Microsoft.VisualStudioCode", "vscode" },
            { "Microsoft.Edge", "microsoft-edge" },
            { "OpenJS.NodeJS.LTS", "nodejs-lts" },
            { "ShiningLight.OpenSSL", "openssl" },
            { "Adobe.Acrobat.Reader.64-bit", "adobereader" },
        };

        // Parse winget command: winget upgrade --id <PackageId> --silent ...
        // or legacy: winget upgrade <PackageId> --silent ...
        var parts = wingetCommand.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        string? wingetPackageId = null;
        
        // Find --id flag and get the package ID after it
        for (int i = 0; i < parts.Length - 1; i++)
        {
            if (parts[i].Equals("--id", StringComparison.OrdinalIgnoreCase))
            {
                wingetPackageId = parts[i + 1];
                break;
            }
        }
        
        // Fallback: legacy format without --id
        if (wingetPackageId == null && parts.Length >= 3 && 
            parts[1].Equals("upgrade", StringComparison.OrdinalIgnoreCase) &&
            !parts[2].StartsWith("-"))
        {
            wingetPackageId = parts[2];
        }
        
        if (wingetPackageId != null)
        {
            
            // Try to find choco equivalent
            if (packageMap.TryGetValue(wingetPackageId, out var chocoPackage))
            {
                _logger.LogInformation("Mapped winget {WingetId} to choco {ChocoId}", wingetPackageId, chocoPackage);
                return $"& \"{chocoPath}\" upgrade {chocoPackage} -y";
            }
            else
            {
                // Try using the winget ID directly (sometimes works)
                var guessedName = wingetPackageId.Split('.').Last().ToLowerInvariant();
                _logger.LogWarning("No mapping for {WingetId}, guessing choco package: {Guess}", wingetPackageId, guessedName);
                return $"& \"{chocoPath}\" upgrade {guessedName} -y";
            }
        }

        // Can't parse - return original (will fail, but logs will show why)
        _logger.LogWarning("Could not parse winget command for choco conversion: {Command}", wingetCommand);
        return wingetCommand;
    }

    /// <summary>
    /// Ensure Chocolatey is installed (async wrapper).
    /// </summary>
    private async Task EnsureChocolateyInstalledAsync()
    {
        var chocoPath = @"C:\ProgramData\chocolatey\bin\choco.exe";
        if (File.Exists(chocoPath))
        {
            _logger.LogDebug("Chocolatey already installed at {Path}", chocoPath);
            return;
        }

        _logger.LogWarning("Chocolatey not found - auto-installing...");
        await Task.Run(() => TryInstallChocolatey());
        
        if (File.Exists(chocoPath))
        {
            _logger.LogInformation("Chocolatey installed successfully!");
        }
        else
        {
            _logger.LogError("Failed to install Chocolatey");
        }
    }

    /// <summary>
    /// Auto-install Chocolatey if not present.
    /// </summary>
    private bool TryInstallChocolatey()
    {
        try
        {
            var installScript = @"
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
";
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
            psi.ArgumentList.Add(installScript);

            _logger.LogInformation("Running Chocolatey install script...");
            
            using var process = Process.Start(psi);
            if (process == null)
            {
                _logger.LogError("Failed to start PowerShell for Chocolatey install");
                return false;
            }

            // 5 minute timeout for install
            var completed = process.WaitForExit(300000);
            if (!completed)
            {
                try { process.Kill(true); } catch { }
                _logger.LogError("Chocolatey install timed out (5 min)");
                return false;
            }

            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            
            if (process.ExitCode != 0)
            {
                _logger.LogError("Chocolatey install failed (exit {ExitCode}): {Stderr}", process.ExitCode, stderr);
                return false;
            }

            // Verify installation
            var chocoPath = @"C:\ProgramData\chocolatey\bin\choco.exe";
            if (File.Exists(chocoPath))
            {
                _logger.LogInformation("Chocolatey verified at: {Path}", chocoPath);
                return true;
            }
            
            _logger.LogError("Chocolatey install completed but choco.exe not found");
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during Chocolatey install");
            return false;
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
