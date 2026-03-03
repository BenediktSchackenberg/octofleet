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
    private readonly ILogger<PatchScanner> _logger;
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

                var patches = await ScanForUpdatesAsync(stoppingToken);

                if (patches.Count > 0)
                {
                    _logger.LogInformation("Found {Count} pending updates, reporting to API", patches.Count);
                    await ReportScanResultsAsync(baseUrl, nodeId, patches, stoppingToken);
                }
                else
                {
                    _logger.LogInformation("No pending updates found");
                    // Report empty scan so server knows we scanned
                    await ReportScanResultsAsync(baseUrl, nodeId, patches, stoppingToken);
                }

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

    /// <summary>
    /// Uses Windows Update Agent COM API to search for pending updates.
    /// Must run on a thread with COM initialized (STA or MTA).
    /// </summary>
    private async Task<List<PendingPatch>> ScanForUpdatesAsync(CancellationToken ct)
    {
        // COM calls must run on a separate thread
        return await Task.Run(() =>
        {
            var patches = new List<PendingPatch>();

            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                _logger.LogWarning("PatchScanner only works on Windows");
                return patches;
            }

            dynamic? session = null;
            try
            {
                var sessionType = Type.GetTypeFromProgID("Microsoft.Update.Session");
                if (sessionType == null)
                {
                    _logger.LogWarning("Windows Update Session COM not available");
                    return patches;
                }

                session = Activator.CreateInstance(sessionType);
                if (session == null) return patches;

                dynamic searcher = session.CreateUpdateSearcher();

                // Search for updates that are not installed and not hidden
                _logger.LogDebug("Searching for pending updates...");
                dynamic searchResult = searcher.Search("IsInstalled=0 AND IsHidden=0");

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
                _logger.LogError(ex, "Windows Update search failed");
            }
            finally
            {
                if (session != null)
                {
                    try { Marshal.ReleaseComObject(session); } catch { }
                }
            }

            return patches;
        }, ct);
    }

    private async Task ReportScanResultsAsync(string baseUrl, string nodeId,
        List<PendingPatch> patches, CancellationToken ct)
    {
        try
        {
            // Look up our node UUID first
            string? nodeUuid = await GetNodeUuidAsync(baseUrl, nodeId, ct);

            var payload = new
            {
                node_id = nodeUuid ?? nodeId,
                scanned_at = DateTime.UtcNow.ToString("o"),
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

            var response = await _httpClient.PostAsJsonAsync(
                $"{baseUrl}/api/v1/patches/scan-results",
                payload, JsonOptions, ct);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Reported {Count} patches for {Node}", patches.Count, nodeId);
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

    /// <summary>
    /// Look up our node UUID from the API by hostname.
    /// </summary>
    private async Task<string?> GetNodeUuidAsync(string baseUrl, string hostname, CancellationToken ct)
    {
        try
        {
            var config = ServiceConfig.Load();
            using var request = new HttpRequestMessage(HttpMethod.Get,
                $"{baseUrl}/api/v1/nodes?hostname={hostname}");

            if (!string.IsNullOrEmpty(config.InventoryApiKey))
                request.Headers.Add("X-API-Key", config.InventoryApiKey);

            var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode) return null;

            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);

            // Try different response formats
            JsonElement nodes;
            if (doc.RootElement.TryGetProperty("nodes", out nodes) && nodes.ValueKind == JsonValueKind.Array)
            {
                foreach (var node in nodes.EnumerateArray())
                {
                    if (node.TryGetProperty("hostname", out var h) &&
                        h.GetString()?.Equals(hostname, StringComparison.OrdinalIgnoreCase) == true)
                    {
                        if (node.TryGetProperty("id", out var id))
                            return id.GetString();
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not resolve node UUID for {Hostname}", hostname);
        }

        return null;
    }

    private static string? ExtractKbId(string title)
    {
        var match = System.Text.RegularExpressions.Regex.Match(title, @"KB(\d+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return match.Success ? $"KB{match.Groups[1].Value}" : null;
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
