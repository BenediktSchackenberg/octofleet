using System.Collections.Concurrent;
using System.Diagnostics.Eventing.Reader;
using System.Text.Json;

namespace OctofleetAgent.Service.Security;

/// <summary>
/// Monitors Windows Security Event Log for logon/logoff events.
/// Detects brute force attempts by aggregating rapid failed logons.
/// </summary>
public class LogonEventCollector : BackgroundService
{
    private readonly ILogger<LogonEventCollector> _logger;
    private readonly ConcurrentQueue<Dictionary<string, object?>> _eventQueue = new();
    private readonly ConcurrentDictionary<string, List<DateTime>> _failedLogonTracker = new();

    private const int FlushIntervalMs = 5000;
    private const int MaxQueueSize = 10000;
    private const int MaxBatchSize = 200;
    private const int BruteForceThreshold = 5;
    private const int BruteForceWindowSeconds = 60;

    private EventLogWatcher? _eventLogWatcher;
    private int _droppedCount;

    private static readonly Dictionary<int, string> EventIdToType = new()
    {
        [4624] = "logon.success",
        [4625] = "logon.failed",
        [4634] = "logon.logoff",
        [4648] = "logon.explicit_creds",
        [4672] = "logon.special_privs"
    };

    private static readonly Dictionary<int, string> LogonTypes = new()
    {
        [2] = "interactive", [3] = "network", [4] = "batch", [5] = "service",
        [7] = "unlock", [8] = "network_cleartext", [9] = "new_credentials",
        [10] = "remote_interactive", [11] = "cached_interactive"
    };

    public LogonEventCollector(ILogger<LogonEventCollector> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Logon Event Collector starting...");
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        var config = ServiceConfig.Load();
        if (!config.IsInventoryConfigured)
        {
            _logger.LogWarning("Inventory API not configured, Logon Event Collector disabled.");
            return;
        }

        var sensorEnabled = await FetchSensorEnabledAsync(config, "logon_events");
        if (sensorEnabled == false)
        {
            _logger.LogInformation("Logon Events sensor disabled by profile.");
            return;
        }

        try
        {
            var eventIds = string.Join(" or ", EventIdToType.Keys.Select(id => $"EventID={id}"));
            var query = new EventLogQuery("Security", PathType.LogName, $"*[System[({eventIds})]]")
            {
                ReverseDirection = false
            };

            _eventLogWatcher = new EventLogWatcher(query, null, true);
            _eventLogWatcher.EventRecordWritten += OnSecurityEvent;
            _eventLogWatcher.Enabled = true;

            _logger.LogInformation("Logon Event Collector active.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to start Security Event Log watcher. Logon Event Collector disabled (admin required).");
            return;
        }

        var lastHealth = DateTime.UtcNow;
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(FlushIntervalMs, stoppingToken);

            // Cleanup old brute force tracking
            CleanupFailedLogonTracker();

            if (!_eventQueue.IsEmpty)
                await FlushEventsAsync(config);

            if ((DateTime.UtcNow - lastHealth).TotalMinutes >= 5)
            {
                await ReportHealthAsync(config);
                lastHealth = DateTime.UtcNow;
            }
        }

        if (_eventLogWatcher != null)
        {
            _eventLogWatcher.Enabled = false;
            _eventLogWatcher.Dispose();
        }
    }

    private void OnSecurityEvent(object? sender, EventRecordWrittenEventArgs e)
    {
        try
        {
            var record = e.EventRecord;
            if (record == null) return;

            var eventId = record.Id;
            if (!EventIdToType.TryGetValue(eventId, out var eventType)) return;

            if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); return; }

            var now = DateTime.UtcNow;
            string? username = null;
            string? domain = null;
            string? sourceIp = null;
            string? logonTypeName = null;
            string? failureReason = null;

            // Extract properties from event XML
            try
            {
                var props = record.Properties;
                switch (eventId)
                {
                    case 4624: // Logon success
                        username = props.Count > 5 ? props[5].Value?.ToString() : null;
                        domain = props.Count > 6 ? props[6].Value?.ToString() : null;
                        if (props.Count > 8 && int.TryParse(props[8].Value?.ToString(), out var lt))
                            logonTypeName = LogonTypes.GetValueOrDefault(lt, lt.ToString());
                        sourceIp = props.Count > 18 ? props[18].Value?.ToString() : null;
                        break;
                    case 4625: // Failed logon
                        username = props.Count > 5 ? props[5].Value?.ToString() : null;
                        domain = props.Count > 6 ? props[6].Value?.ToString() : null;
                        if (props.Count > 10 && int.TryParse(props[10].Value?.ToString(), out var flt))
                            logonTypeName = LogonTypes.GetValueOrDefault(flt, flt.ToString());
                        failureReason = props.Count > 8 ? props[8].Value?.ToString() : null;
                        sourceIp = props.Count > 19 ? props[19].Value?.ToString() : null;
                        break;
                    case 4634: // Logoff
                        username = props.Count > 1 ? props[1].Value?.ToString() : null;
                        domain = props.Count > 2 ? props[2].Value?.ToString() : null;
                        break;
                    case 4648: // Explicit credentials
                        username = props.Count > 1 ? props[1].Value?.ToString() : null;
                        domain = props.Count > 2 ? props[2].Value?.ToString() : null;
                        break;
                    case 4672: // Special privileges
                        username = props.Count > 1 ? props[1].Value?.ToString() : null;
                        domain = props.Count > 2 ? props[2].Value?.ToString() : null;
                        break;
                }
            }
            catch { /* best effort property extraction */ }

            var severity = "info";

            // Brute force detection for failed logons
            if (eventId == 4625 && username != null)
            {
                var key = $"{username}@{sourceIp ?? "unknown"}";
                var timestamps = _failedLogonTracker.GetOrAdd(key, _ => new List<DateTime>());
                lock (timestamps)
                {
                    timestamps.Add(now);
                    timestamps.RemoveAll(t => (now - t).TotalSeconds > BruteForceWindowSeconds);
                    if (timestamps.Count >= BruteForceThreshold)
                        severity = "high";
                }
            }

            _eventQueue.Enqueue(new Dictionary<string, object?>
            {
                ["event_type"] = eventType,
                ["node_id"] = Environment.MachineName,
                ["timestamp"] = (record.TimeCreated ?? now).ToString("o"),
                ["user"] = new { username = username ?? "UNKNOWN", domain },
                ["process"] = (object?)null,
                ["success"] = eventId != 4625,
                ["severity"] = severity,
                ["metadata"] = new
                {
                    logon_type = logonTypeName,
                    source_ip = sourceIp,
                    failure_reason = failureReason,
                    event_id = eventId
                }
            });
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error processing security event");
        }
    }

    private void CleanupFailedLogonTracker()
    {
        var now = DateTime.UtcNow;
        foreach (var key in _failedLogonTracker.Keys.ToList())
        {
            if (_failedLogonTracker.TryGetValue(key, out var timestamps))
            {
                lock (timestamps)
                {
                    timestamps.RemoveAll(t => (now - t).TotalSeconds > BruteForceWindowSeconds);
                    if (timestamps.Count == 0)
                        _failedLogonTracker.TryRemove(key, out _);
                }
            }
        }
    }

    private async Task FlushEventsAsync(ServiceConfig config)
    {
        var batch = new List<object>();
        int count = 0;
        while (_eventQueue.TryDequeue(out var evt) && count < MaxBatchSize) { batch.Add(evt); count++; }
        if (batch.Count == 0) return;
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            client.DefaultRequestHeaders.Add("X-API-Key", config.InventoryApiKey);
            var payload = JsonSerializer.Serialize(new { events = batch });
            var resp = await client.PostAsync(
                $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/ingest/events/normalized",
                new StringContent(payload, System.Text.Encoding.UTF8, "application/json"));
            if (!resp.IsSuccessStatusCode)
                _logger.LogWarning("Failed to flush logon events: {Status}", resp.StatusCode);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Error flushing logon events"); }
    }

    private async Task ReportHealthAsync(ServiceConfig config)
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            client.DefaultRequestHeaders.Add("X-API-Key", config.InventoryApiKey);
            var health = new Dictionary<string, object?>
            {
                ["event_type"] = "agent.health",
                ["node_id"] = Environment.MachineName,
                ["timestamp"] = DateTime.UtcNow.ToString("o"),
                ["metadata"] = new { sensor = "logon_events", queue_depth = _eventQueue.Count, drop_count = _droppedCount }
            };
            var payload = JsonSerializer.Serialize(new { events = new[] { health } });
            await client.PostAsync(
                $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/ingest/events/normalized",
                new StringContent(payload, System.Text.Encoding.UTF8, "application/json"));
        }
        catch { }
    }

    private async Task<bool?> FetchSensorEnabledAsync(ServiceConfig config, string sensorName)
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            client.DefaultRequestHeaders.Add("X-API-Key", config.InventoryApiKey);
            var response = await client.GetAsync(
                $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/monitoring/nodes/{Environment.MachineName}/effective-policy");
            if (!response.IsSuccessStatusCode) return null;
            var json = await response.Content.ReadAsStringAsync();
            var doc = JsonDocument.Parse(json);
            var policy = doc.RootElement.GetProperty("policy");
            if (policy.ValueKind == JsonValueKind.Null) return null;
            if (policy.TryGetProperty("sensors", out var sensors) && sensors.TryGetProperty(sensorName, out var val))
                return val.GetBoolean();
            return null;
        }
        catch { return null; }
    }
}
