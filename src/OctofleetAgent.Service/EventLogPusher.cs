using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OctofleetAgent.Service;

/// <summary>
/// Background service that periodically pushes Windows Event Log entries to the backend.
/// Collects Error, Warning, and Critical events from System, Application, and Security logs.
/// </summary>
public class EventLogPusher : BackgroundService
{
    private readonly ILogger<EventLogPusher> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    private readonly string _nodeId;
    
    // Track last pushed event to avoid duplicates
    private DateTime _lastPushTime = DateTime.MinValue;
    private readonly HashSet<string> _pushedEventHashes = new();
    private const int MaxHashCacheSize = 10000;
    
    // Push every 5 minutes by default
    private const int DefaultPushIntervalMinutes = 5;
    // Look back 10 minutes for events (overlap to catch any missed)
    private const int LookbackMinutes = 10;
    // Max events per push to avoid overloading
    private const int MaxEventsPerPush = 100;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public EventLogPusher(ILogger<EventLogPusher> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _nodeId = Environment.MachineName.ToUpperInvariant();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("EventLogPusher started for node {NodeId}", _nodeId);

        // Wait for inventory config to be ready
        while (!stoppingToken.IsCancellationRequested)
        {
            var config = ServiceConfig.Load();
            if (!string.IsNullOrEmpty(config.InventoryApiUrl) && !string.IsNullOrEmpty(config.InventoryApiKey))
                break;
            await Task.Delay(5000, stoppingToken);
        }

        // Initial delay to let other services start first
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);

        // Initial push
        await PushEventLogs(stoppingToken);
        _lastPushTime = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(DefaultPushIntervalMinutes), stoppingToken);
                await PushEventLogs(stoppingToken);
                _lastPushTime = DateTime.UtcNow;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error pushing event logs, will retry next interval");
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            }
        }
    }

    private async Task PushEventLogs(CancellationToken ct)
    {
        var config = ServiceConfig.Load();
        if (string.IsNullOrEmpty(config.InventoryApiUrl) || string.IsNullOrEmpty(config.InventoryApiKey))
        {
            _logger.LogDebug("EventLogPusher: No inventory API configured, skipping");
            return;
        }

        var events = CollectEventLogs();
        
        if (events.Count == 0)
        {
            _logger.LogDebug("No new event log entries to push");
            return;
        }

        _logger.LogInformation("Pushing {Count} event log entries to backend", events.Count);

        try
        {
            var url = $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/nodes/{_nodeId}/eventlog";
            
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Add("X-API-Key", config.InventoryApiKey);
            request.Content = JsonContent.Create(new { events }, options: JsonOptions);

            using var response = await _httpClient.SendAsync(request, ct);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Successfully pushed {Count} event log entries", events.Count);
                
                // Mark events as pushed
                foreach (var evt in events)
                {
                    _pushedEventHashes.Add(evt.Hash);
                }
                
                // Trim hash cache if too large
                if (_pushedEventHashes.Count > MaxHashCacheSize)
                {
                    _pushedEventHashes.Clear();
                    _logger.LogDebug("Cleared event hash cache (exceeded {Max} entries)", MaxHashCacheSize);
                }
            }
            else
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                _logger.LogWarning("Failed to push event logs: {Status} - {Body}", response.StatusCode, body);
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "HTTP error pushing event logs");
        }
    }

    private List<EventLogEntry> CollectEventLogs()
    {
        var events = new List<EventLogEntry>();
        var cutoffTime = DateTime.Now.AddMinutes(-LookbackMinutes);
        var logNames = new[] { "System", "Application", "Security" };

        foreach (var logName in logNames)
        {
            try
            {
                using var eventLog = new System.Diagnostics.EventLog(logName);

                var entries = eventLog.Entries.Cast<System.Diagnostics.EventLogEntry>()
                    .Where(e => e.TimeWritten >= cutoffTime)
                    .Where(e => e.EntryType == EventLogEntryType.Error ||
                               e.EntryType == EventLogEntryType.Warning ||
                               e.EntryType == EventLogEntryType.FailureAudit)
                    .OrderByDescending(e => e.TimeWritten)
                    .Take(MaxEventsPerPush / logNames.Length);

                foreach (var entry in entries)
                {
                    var evt = new EventLogEntry
                    {
                        LogName = logName,
                        Timestamp = entry.TimeWritten.ToUniversalTime(),
                        Level = MapEntryType(entry.EntryType),
                        LevelName = entry.EntryType.ToString(),
                        Source = entry.Source ?? "Unknown",
                        EventId = (int)(entry.InstanceId & 0xFFFF), // Lower 16 bits
                        Message = TruncateMessage(entry.Message),
                        Category = entry.Category,
                        MachineName = entry.MachineName
                    };
                    
                    // Skip if already pushed (dedup by hash)
                    if (_pushedEventHashes.Contains(evt.Hash))
                        continue;
                    
                    events.Add(evt);
                }
            }
            catch (System.Security.SecurityException)
            {
                // Security log often requires admin privileges
                _logger.LogDebug("No permission to read {LogName} event log", logName);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Could not read {LogName} event log", logName);
            }
        }

        // Sort by timestamp and limit
        return events
            .OrderByDescending(e => e.Timestamp)
            .Take(MaxEventsPerPush)
            .ToList();
    }

    private static int MapEntryType(EventLogEntryType type) => type switch
    {
        EventLogEntryType.Error => 1,
        EventLogEntryType.Warning => 2,
        EventLogEntryType.Information => 3,
        EventLogEntryType.SuccessAudit => 4,
        EventLogEntryType.FailureAudit => 5,
        _ => 0
    };

    private static string? TruncateMessage(string? message)
    {
        if (string.IsNullOrEmpty(message))
            return null;
        return message.Length > 2000 ? message[..2000] + "..." : message;
    }

    private class EventLogEntry
    {
        public string LogName { get; set; } = "";
        public DateTime Timestamp { get; set; }
        public int Level { get; set; }
        public string? LevelName { get; set; }
        public string Source { get; set; } = "";
        public int EventId { get; set; }
        public string? Message { get; set; }
        public string? Category { get; set; }
        public string? MachineName { get; set; }
        
        // Hash for deduplication (not serialized)
        [JsonIgnore]
        public string Hash => $"{LogName}:{Timestamp:o}:{EventId}:{Source}";
    }
}
