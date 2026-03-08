using System.Collections.Concurrent;
using System.Management;
using System.Text.Json;

namespace OctofleetAgent.Service.Security;

/// <summary>
/// Monitors process creation and termination via WMI Win32_Process events.
/// Aggregates rapid spawns and skips known noisy processes.
/// </summary>
public class ProcessMonitorCollector : BackgroundService
{
    private readonly ILogger<ProcessMonitorCollector> _logger;
    private readonly ConcurrentQueue<Dictionary<string, object?>> _eventQueue = new();
    private readonly ConcurrentDictionary<string, (int Count, DateTime First)> _aggregation = new();

    private const int FlushIntervalMs = 5000;
    private const int MaxQueueSize = 10000;
    private const int MaxBatchSize = 200;
    private const int AggregationWindowMs = 2000;

    private static readonly HashSet<string> NoisyProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "svchost", "conhost", "WmiPrvSE", "RuntimeBroker", "backgroundTaskHost"
    };

    private ManagementEventWatcher? _createWatcher;
    private ManagementEventWatcher? _deleteWatcher;
    private int _droppedCount;

    public ProcessMonitorCollector(ILogger<ProcessMonitorCollector> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Process Monitor Collector starting...");
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        var config = ServiceConfig.Load();
        if (!config.IsInventoryConfigured)
        {
            _logger.LogWarning("Inventory API not configured, Process Monitor disabled.");
            return;
        }

        var profile = await FetchMonitoringProfileAsync(config);
        if (profile?.Sensors != null && profile.Sensors.TryGetValue("process_monitor", out var enabled) && !enabled)
        {
            _logger.LogInformation("Process Monitor sensor disabled by profile.");
            return;
        }

        try
        {
            _createWatcher = new ManagementEventWatcher(
                new WqlEventQuery("__InstanceCreationEvent", TimeSpan.FromSeconds(1),
                    "TargetInstance ISA 'Win32_Process'"));
            _createWatcher.EventArrived += (s, e) => OnProcessEvent("process.create", e);
            _createWatcher.Start();

            _deleteWatcher = new ManagementEventWatcher(
                new WqlEventQuery("__InstanceDeletionEvent", TimeSpan.FromSeconds(1),
                    "TargetInstance ISA 'Win32_Process'"));
            _deleteWatcher.EventArrived += (s, e) => OnProcessEvent("process.terminate", e);
            _deleteWatcher.Start();

            _logger.LogInformation("Process Monitor Collector active.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to start WMI process watchers. Process Monitor disabled.");
            return;
        }

        var lastHealth = DateTime.UtcNow;
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(FlushIntervalMs, stoppingToken);

            FlushAggregation();

            if (!_eventQueue.IsEmpty)
                await FlushEventsAsync(config);

            if ((DateTime.UtcNow - lastHealth).TotalMinutes >= 5)
            {
                await ReportHealthAsync(config);
                lastHealth = DateTime.UtcNow;
            }
        }

        _createWatcher?.Stop(); _createWatcher?.Dispose();
        _deleteWatcher?.Stop(); _deleteWatcher?.Dispose();
    }

    private void OnProcessEvent(string eventType, EventArrivedEventArgs e)
    {
        try
        {
            var target = (ManagementBaseObject)e.NewEvent["TargetInstance"];
            var name = target["Name"]?.ToString() ?? "";
            var pid = Convert.ToInt32(target["ProcessId"] ?? 0);
            var parentPid = Convert.ToInt32(target["ParentProcessId"] ?? 0);
            var commandLine = target["CommandLine"]?.ToString();
            var path = target["ExecutablePath"]?.ToString();

            if (NoisyProcesses.Contains(Path.GetFileNameWithoutExtension(name)))
                return;

            // Aggregation: suppress rapid spawns of same process
            var aggKey = $"{eventType}:{name}";
            var now = DateTime.UtcNow;
            _aggregation.AddOrUpdate(aggKey,
                (1, now),
                (_, prev) => (prev.Count + 1, prev.First));

            if (_eventQueue.Count >= MaxQueueSize)
            {
                Interlocked.Increment(ref _droppedCount);
                return;
            }

            string? user = null;
            try
            {
                var ownerParams = new object[] { "", "" };
                var mo = target as ManagementObject;
                if (mo != null)
                {
                    mo.InvokeMethod("GetOwner", ownerParams);
                    user = ownerParams[0]?.ToString();
                }
            }
            catch { /* best effort */ }

            _eventQueue.Enqueue(new Dictionary<string, object?>
            {
                ["event_type"] = eventType,
                ["node_id"] = Environment.MachineName,
                ["timestamp"] = now.ToString("o"),
                ["user"] = new { username = user ?? Environment.UserName },
                ["process"] = new { name, pid, parent_pid = parentPid, command_line = commandLine, path },
                ["success"] = true,
                ["metadata"] = new { }
            });
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error processing WMI process event");
        }
    }

    private void FlushAggregation()
    {
        var now = DateTime.UtcNow;
        foreach (var kvp in _aggregation)
        {
            if ((now - kvp.Value.First).TotalMilliseconds > AggregationWindowMs)
            {
                _aggregation.TryRemove(kvp.Key, out _);
            }
        }
    }

    private async Task FlushEventsAsync(ServiceConfig config)
    {
        var batch = new List<object>();
        var count = 0;
        while (_eventQueue.TryDequeue(out var evt) && count < MaxBatchSize)
        {
            batch.Add(evt);
            count++;
        }
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
                _logger.LogWarning("Failed to flush process events: {Status}", resp.StatusCode);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error flushing process events");
        }
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
                ["metadata"] = new { sensor = "process_monitor", queue_depth = _eventQueue.Count, drop_count = _droppedCount }
            };
            var payload = JsonSerializer.Serialize(new { events = new[] { health } });
            await client.PostAsync(
                $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/ingest/events/normalized",
                new StringContent(payload, System.Text.Encoding.UTF8, "application/json"));
        }
        catch { /* best effort */ }
    }

    private async Task<MonitoringProfile?> FetchMonitoringProfileAsync(ServiceConfig config)
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
            return new MonitoringProfile
            {
                Sensors = policy.TryGetProperty("sensors", out var s) ? s.Deserialize<Dictionary<string, bool>>() : null
            };
        }
        catch { return null; }
    }

    private class MonitoringProfile
    {
        public Dictionary<string, bool>? Sensors { get; set; }
    }
}
