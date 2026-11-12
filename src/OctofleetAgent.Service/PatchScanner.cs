using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OctofleetAgent.Service;

/// <summary>
/// Scans for pending Windows Updates via COM (Microsoft.Update.Session)
/// and reports results to the Octofleet Patch Management API.
/// Runs every 6 hours by default.
/// </summary>
public class PatchScanner : BackgroundService
{
    private readonly ILogger _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;

    // Scan every 6 hours (Windows Update scans are expensive)
    private const int ScanIntervalMs = 6 * 60 * 60 * 1000;
    // Initial delay: wait 2 minutes after startup before first scan
    private const int InitialDelayMs = 120_000;
    private const int ErrorBackoffMs = 30 * 60 * 1000; // 30 min on error

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public PatchScanner(ILogger<PatchScanner> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
    }

    // Constructor for on-demand scan from JobPoller (accepts any ILogger)
    public PatchScanner(ILogger logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
    }

    /// <summary>
    /// Run a single scan + report cycle on demand (called from JobPoller for patch_scan jobs).
    /// </summary>
    public async Task RunOnDemandScanAsync(CancellationToken ct)
    {
        var config = ServiceConfig.Load();
        var baseUrl = config.InventoryApiUrl?.TrimEnd('/');
        var nodeId = Environment.MachineName.ToUpperInvariant();

        if (string.IsNullOrEmpty(baseUrl))
            throw new InvalidOperationException("InventoryApiUrl not configured");

        _logger.LogInformation("On-demand patch scan starting for {NodeId}...", nodeId);
        var outcome = await ScanWithTimeLimitAsync(ct);
        await ReportScanResultsAsync(baseUrl, nodeId, outcome, ct);

        // A failed search must fail the patch_scan job, not report "completed"
        if (outcome.Status == "failed")
            throw new InvalidOperationException($"Windows Update search failed: {outcome.Error}");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PatchScanner starting...");

        // Wait for inventory config
        while (!stoppingToken.IsCancellationRequested)
        {
            var config = ServiceConfig.Load();
            if (!string.IsNullOrEmpty(config.InventoryApiUrl))
                break;
            await Task.Delay(5000, stoppingToken);
        }

        // Initial delay to let other services start first
        await Task.Delay(InitialDelayMs, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var config = ServiceConfig.Load();
                var baseUrl = config.InventoryApiUrl?.TrimEnd('/');
                var nodeId = Environment.MachineName.ToUpperInvariant();

                if (string.IsNullOrEmpty(baseUrl))
                {
                    await Task.Delay(ScanIntervalMs, stoppingToken);
                    continue;
                }

                _logger.LogInformation("Starting Windows Update scan for node {NodeId}...", nodeId);

                var outcome = await ScanWithTimeLimitAsync(stoppingToken);
                // Reported in every case: the server keeps the last list when the search failed
                await ReportScanResultsAsync(baseUrl, nodeId, outcome, stoppingToken);

                await Task.Delay(ScanIntervalMs, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PatchScanner error, backing off for {Minutes} min", ErrorBackoffMs / 60000);
                await Task.Delay(ErrorBackoffMs, stoppingToken);
            }
        }

        _logger.LogInformation("PatchScanner stopped");
    }

    /// <summary>A Windows Update search can take minutes (first scan against WSUS) - but not forever.</summary>
    private static readonly TimeSpan SearchTimeout = TimeSpan.FromMinutes(20);

    /// <summary>
    /// Runs the search with <see cref="SearchTimeout"/>. A search that hangs is reported as failed;
    /// the COM call itself cannot be cancelled and ends in the background.
    /// </summary>
    private async Task<ScanOutcome> ScanWithTimeLimitAsync(CancellationToken ct)
    {
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var scan = ScanForUpdatesAsync(ct);
        ScanOutcome outcome;
        if (await Task.WhenAny(scan, Task.Delay(SearchTimeout, ct)) != scan)
        {
            _ = scan.ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
            outcome = new ScanOutcome
            {
                Status = "failed",
                Error = $"Windows Update search did not finish within {SearchTimeout.TotalMinutes:0} min",
            };
            (outcome.Source, outcome.Server) = ReadUpdateSource();
        }
        else
        {
            outcome = await scan;
        }
        outcome.DurationSeconds = Math.Round(stopwatch.Elapsed.TotalSeconds, 1);

        if (outcome.Status == "failed")
            _logger.LogWarning("Windows Update search failed after {Seconds} s: {Error}", outcome.DurationSeconds, outcome.Error);
        else
            _logger.LogInformation("Windows Update search {Status} via {Source}: {Count} pending updates in {Seconds} s",
                outcome.Status, outcome.Server ?? outcome.Source, outcome.Patches.Count, outcome.DurationSeconds);
        return outcome;
    }

    /// <summary>
    /// Where Windows Update gets its updates: WSUS when the policy says so (UseWUServer = 1 and
    /// WUServer set), otherwise Windows Update / Microsoft Update.
    /// </summary>
    private static (string Source, string? Server) ReadUpdateSource()
    {
        try
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return ("windows_update", null);
            using var wu = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate");
            using var au = wu?.OpenSubKey("AU");
            var server = wu?.GetValue("WUServer") as string;
            var useServer = au?.GetValue("UseWUServer") is int value && value == 1;
            return useServer && !string.IsNullOrWhiteSpace(server) ? ("wsus", server) : ("windows_update", null);
        }
        catch
        {
            return ("windows_update", null);
        }
    }

    /// <summary>
    /// Uses Windows Update Agent COM API to search for pending updates.
    /// Must run on a thread with COM initialized (STA or MTA).
    /// A search that fails is reported as failed - before, it came back as an empty list, which the
    /// server took for "no pending updates" and cleared the node's update list.
    /// </summary>
    private async Task<ScanOutcome> ScanForUpdatesAsync(CancellationToken ct)
    {
        // COM calls must run on a separate thread
        return await Task.Run(() =>
        {
            var outcome = new ScanOutcome();
            (outcome.Source, outcome.Server) = ReadUpdateSource();
            var patches = outcome.Patches;

            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                outcome.Error = "PatchScanner only works on Windows";
                return outcome;
            }

            dynamic? session = null;
            try
            {
                var sessionType = Type.GetTypeFromProgID("Microsoft.Update.Session");
                if (sessionType == null)
                {
                    outcome.Error = "Windows Update Session COM not available";
                    return outcome;
                }

                session = Activator.CreateInstance(sessionType);
                if (session == null)
                {
                    outcome.Error = "Windows Update Session could not be created";
                    return outcome;
                }

                dynamic searcher = session.CreateUpdateSearcher();

                // Search for updates that are not installed and not hidden
                _logger.LogDebug("Searching for pending updates...");
                dynamic searchResult = searcher.Search("IsInstalled=0 AND IsHidden=0");

                // OperationResultCode: 2 = succeeded, 3 = succeeded with errors, 4 = failed, 5 = aborted
                outcome.ResultCode = (int)searchResult.ResultCode;
                outcome.Status = outcome.ResultCode switch
                {
                    2 => "succeeded",
                    3 => "partial",
                    _ => "failed",
                };
                if (outcome.Status == "failed")
                {
                    outcome.Error = $"Windows Update search ended with result code {outcome.ResultCode}";
                    return outcome;
                }

                _logger.LogDebug("Found {Count} updates in search result", (int)searchResult.Updates.Count);

                foreach (dynamic update in searchResult.Updates)
                {
                    try
                    {
                        string title = update.Title?.ToString() ?? "Unknown Update";
                        string? kbId = ExtractKbId(title);
                        string? description = null;
                        try { description = update.Description?.ToString(); } catch { }

                        // Determine severity from MsrcSeverity
                        string severity = "moderate";
                        try
                        {
                            string? msrcSeverity = update.MsrcSeverity?.ToString();
                            if (!string.IsNullOrEmpty(msrcSeverity))
                            {
                                severity = msrcSeverity.ToLowerInvariant() switch
                                {
                                    "critical" => "critical",
                                    "important" => "important",
                                    "moderate" => "moderate",
                                    "low" => "low",
                                    _ => "moderate"
                                };
                            }
                        }
                        catch { }

                        // Get categories
                        string category = "security";
                        try
                        {
                            foreach (dynamic cat in update.Categories)
                            {
                                string catName = cat.Name?.ToString()?.ToLowerInvariant() ?? "";
                                if (catName.Contains("driver"))
                                {
                                    category = "driver";
                                    break;
                                }
                                else if (catName.Contains("feature") || catName.Contains("upgrade"))
                                {
                                    category = "feature";
                                    break;
                                }
                                else if (catName.Contains("security"))
                                {
                                    category = "security";
                                    break;
                                }
                            }
                        }
                        catch { }

                        // Get download size
                        long downloadSize = 0;
                        try { downloadSize = (long)update.MaxDownloadSize; } catch { }

                        // Check if it's mandatory/auto-select
                        bool isMandatory = false;
                        try { isMandatory = (bool)update.IsMandatory; } catch { }

                        bool autoSelectOnWebSites = false;
                        try { autoSelectOnWebSites = (bool)update.AutoSelectOnWebSites; } catch { }

                        patches.Add(new PendingPatch
                        {
                            KbId = kbId ?? $"UPDATE-{update.Identity.UpdateID?.ToString()?[..8]}",
                            Title = title,
                            Description = description,
                            Severity = severity,
                            Category = category,
                            DownloadSizeBytes = downloadSize,
                            IsMandatory = isMandatory || autoSelectOnWebSites,
                            UpdateId = update.Identity?.UpdateID?.ToString()
                        });
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to parse update entry");
                    }
                }
            }
            catch (Exception ex)
            {
                // e.g. 0x8024401C (WSUS not reachable), 0x80244022, certificate errors
                _logger.LogError(ex, "Windows Update search failed");
                outcome.Status = "failed";
                outcome.Error = $"0x{ex.HResult:X8}: {ex.Message}";
                outcome.Patches.Clear();
            }
            finally
            {
                if (session != null)
                {
                    try { Marshal.ReleaseComObject(session); } catch { }
                }
            }

            return outcome;
        }, ct);
    }

    private async Task ReportScanResultsAsync(string baseUrl, string nodeId,
        ScanOutcome outcome, CancellationToken ct)
    {
        var patches = outcome.Patches;
        try
        {
            // The server resolves the hostname to the node (before, the agent looked its UUID up
            // through GET /api/v1/nodes, a user route that answers the agent key with 403)
            var payload = new
            {
                node_id = nodeId,
                scanned_at = DateTime.UtcNow.ToString("o"),
                scan = new
                {
                    status = outcome.Status,
                    result_code = outcome.ResultCode,
                    error = outcome.Error,
                    source = outcome.Source,
                    server = outcome.Server,
                    duration_seconds = outcome.DurationSeconds,
                },
                patches = patches.Select(p => new
                {
                    kb_id = p.KbId,
                    title = p.Title,
                    description = p.Description,
                    severity = p.Severity,
                    category = p.Category,
                    download_size_bytes = p.DownloadSizeBytes,
                    is_mandatory = p.IsMandatory,
                    update_id = p.UpdateId
                }).ToArray()
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/api/v1/patches/scan-results")
            {
                Content = JsonContent.Create(payload, options: JsonOptions)
            };
            var config = ServiceConfig.Load();
            if (!string.IsNullOrEmpty(config.InventoryApiKey))
                request.Headers.Add("X-API-Key", config.InventoryApiKey);
            var response = await _httpClient.SendAsync(request, ct);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Reported {Count} patches for {Node} (scan {Status})", patches.Count, nodeId, outcome.Status);
            }
            else
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("Failed to report patches: {Status} - {Body}",
                    response.StatusCode, body);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to report scan results");
        }
    }

    private static string? ExtractKbId(string title)
    {
        var match = System.Text.RegularExpressions.Regex.Match(title, @"KB(\d+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return match.Success ? $"KB{match.Groups[1].Value}" : null;
    }

    /// <summary>Result of one Windows Update search, reported to the server with the updates.</summary>
    private sealed class ScanOutcome
    {
        /// <summary>succeeded, partial (result code 3: succeeded with errors) or failed</summary>
        public string Status { get; set; } = "failed";
        public int? ResultCode { get; set; }
        public string? Error { get; set; }
        /// <summary>wsus or windows_update</summary>
        public string Source { get; set; } = "windows_update";
        /// <summary>WSUS server URL (WUServer policy)</summary>
        public string? Server { get; set; }
        public double DurationSeconds { get; set; }
        public List<PendingPatch> Patches { get; } = new();
    }

    private class PendingPatch
    {
        public string KbId { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string Severity { get; set; } = "moderate";
        public string Category { get; set; } = "security";
        public long DownloadSizeBytes { get; set; }
        public bool IsMandatory { get; set; }
        public string? UpdateId { get; set; }
    }
}
