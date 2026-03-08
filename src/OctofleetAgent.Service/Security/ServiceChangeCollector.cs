using System.Collections.Concurrent;
using System.Management;
using System.Text.Json;

namespace OctofleetAgent.Service.Security;

/// <summary>
/// Monitors Windows service changes via WMI __InstanceModificationEvent on Win32_Service.
/// Detects installs, removals, state changes, and config modifications.
/// Flags suspicious services (temp paths, user dirs).
/// </summary>
public class ServiceChangeCollector : BackgroundService
{
    private readonly ILogger<ServiceChangeCollector> _logger;
    private readonly ConcurrentQueue<Dictionary<string, object?>> _eventQueue = new();

    private const int FlushIntervalMs = 5000;
    private const int MaxQueueSize = 10000;
    private const int MaxBatchSize = 200;

    private Dictionary<string, ServiceSnapshot> _serviceSnapshot = new();
    private ManagementEventWatcher? _modWatcher;
    private ManagementEventWatcher? _createWatcher;
    private ManagementEventWatcher? _deleteWatcher;
    private int _droppedCount;

    private static readonly string[] SuspiciousPaths = new[]
    {
        @"\temp\", @"\tmp\", @"\appdata\", @"\users\", @"\downloads\", @"\desktop\"
    };

    public ServiceChangeCollector(ILogger<ServiceChangeCollector> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Service Change Collector starting...");
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        var config = ServiceConfig.Load();
        if (!config.IsInventoryConfigured)
        {
            _logger.LogWarning("Inventory API not configured, Service Change Collector disabled.");
            return;
        }

        var sensorEnabled = await FetchSensorEnabledAsync(config, "service_changes");
        if (sensorEnabled == false)
        {
            _logger.LogInformation("Service Changes sensor disabled by profile.");
            return;
        }

        // Take initial snapshot
        _serviceSnapshot = TakeServiceSnapshot();
        _logger.LogInformation("Service Change Collector: initial snapshot of {Count} services", _serviceSnapshot.Count);

        try
        {
            // Watch for modifications (state changes, config changes)
            _modWatcher = new ManagementEventWatcher(
                new WqlEventQuery("__InstanceModificationEvent",
                    TimeSpan.FromSeconds(10),
                    "TargetInstance ISA 'Win32_Service'"));
            _modWatcher.EventArrived += OnServiceModified;
            _modWatcher.Start();

            // Watch for new services
            _createWatcher = new ManagementEventWatcher(
                new WqlEventQuery("__InstanceCreationEvent",
                    TimeSpan.FromSeconds(10),
                    "TargetInstance ISA 'Win32_Service'"));
            _createWatcher.EventArrived += OnServiceCreated;
            _createWatcher.Start();

            // Watch for removed services
            _deleteWatcher = new ManagementEventWatcher(
                new WqlEventQuery("__InstanceDeletionEvent",
                    TimeSpan.FromSeconds(10),
                    "TargetInstance ISA 'Win32_Service'"));
            _deleteWatcher.EventArrived += OnServiceDeleted;
            _deleteWatcher.Start();

            _logger.LogInformation("Service Change Collector active.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to start WMI service watchers. Service Change Collector disabled.");
            return;
        }

        var lastHealth = DateTime.UtcNow;
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(FlushIntervalMs, stoppingToken);

            if (!_eventQueue.IsEmpty)
                await FlushEventsAsync(config);

            if ((DateTime.UtcNow - lastHealth).TotalMinutes >= 5)
            {
                await ReportHealthAsync(config);
                lastHealth = DateTime.UtcNow;
            }
        }

        _modWatcher?.Stop(); _modWatcher?.Dispose();
        _createWatcher?.Stop(); _createWatcher?.Dispose();
        _deleteWatcher?.Stop(); _deleteWatcher?.Dispose();
    }

    private void OnServiceCreated(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var target = (ManagementBaseObject)e.NewEvent["TargetInstance"];
            var svcName = target["Name"]?.ToString() ?? "";
            var displayName = target["DisplayName"]?.ToString() ?? "";
            var pathName = target["PathName"]?.ToString() ?? "";
            var startType = target["StartMode"]?.ToString() ?? "";
            var state = target["State"]?.ToString() ?? "";

            var now = DateTime.UtcNow;
            var suspicious = IsSuspiciousPath(pathName);

            // Update snapshot
            _serviceSnapshot[svcName] = new ServiceSnapshot { DisplayName = displayName, PathName = pathName, StartMode = startType, State = state };

            if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); return; }

            _eventQueue.Enqueue(new Dictionary<string, object?>
            {
                ["event_type"] = "service.install",
                ["node_id"] = Environment.MachineName,
                ["timestamp"] = now.ToString("o"),
                ["user"] = new { username = Environment.UserName },
                ["process"] = (object?)null,
                ["success"] = true,
                ["severity"] = suspicious ? "high" : "info",
                ["metadata"] = new
                {
                    service_name = svcName, display_name = displayName,
                    start_type = startType, path_name = pathName, state,
                    suspicious
                }
            });
        }
        catch (Exception ex) { _logger.LogDebug(ex, "Error processing service creation"); }
    }

    private void OnServiceDeleted(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var target = (ManagementBaseObject)e.NewEvent["TargetInstance"];
            var svcName = target["Name"]?.ToString() ?? "";
            var displayName = target["DisplayName"]?.ToString() ?? "";

            _serviceSnapshot.Remove(svcName);

            if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); return; }

            _eventQueue.Enqueue(new Dictionary<string, object?>
            {
                ["event_type"] = "service.remove",
                ["node_id"] = Environment.MachineName,
                ["timestamp"] = DateTime.UtcNow.ToString("o"),
                ["user"] = new { username = Environment.UserName },
                ["process"] = (object?)null,
                ["success"] = true,
                ["metadata"] = new { service_name = svcName, display_name = displayName }
            });
        }
        catch (Exception ex) { _logger.LogDebug(ex, "Error processing service deletion"); }
    }

    private void OnServiceModified(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var target = (ManagementBaseObject)e.NewEvent["TargetInstance"];
            var prev = (ManagementBaseObject)e.NewEvent["PreviousInstance"];

            var svcName = target["Name"]?.ToString() ?? "";
            var newState = target["State"]?.ToString() ?? "";
            var oldState = prev["State"]?.ToString() ?? "";
            var pathName = target["PathName"]?.ToString() ?? "";
            var startType = target["StartMode"]?.ToString() ?? "";
            var displayName = target["DisplayName"]?.ToString() ?? "";

            var oldPathName = prev["PathName"]?.ToString() ?? "";
            var oldStartType = prev["StartMode"]?.ToString() ?? "";

            // Update snapshot
            _serviceSnapshot[svcName] = new ServiceSnapshot { DisplayName = displayName, PathName = pathName, StartMode = startType, State = newState };

            if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); return; }

            string eventType;
            if (newState != oldState)
            {
                eventType = newState switch
                {
                    "Running" => "service.start",
                    "Stopped" => "service.stop",
                    _ => "service.config_change"
                };
            }
            else if (pathName != oldPathName || startType != oldStartType)
            {
                eventType = "service.config_change";
            }
            else
            {
                return; // No meaningful change
            }

            _eventQueue.Enqueue(new Dictionary<string, object?>
            {
                ["event_type"] = eventType,
                ["node_id"] = Environment.MachineName,
                ["timestamp"] = DateTime.UtcNow.ToString("o"),
                ["user"] = new { username = Environment.UserName },
                ["process"] = (object?)null,
                ["success"] = true,
                ["metadata"] = new
                {
                    service_name = svcName, display_name = displayName,
                    start_type = startType, path_name = pathName,
                    state = newState, previous_state = oldState,
                    suspicious = IsSuspiciousPath(pathName)
                }
            });
        }
        catch (Exception ex) { _logger.LogDebug(ex, "Error processing service modification"); }
    }

    private static bool IsSuspiciousPath(string pathName)
    {
        if (string.IsNullOrEmpty(pathName)) return false;
        var lower = pathName.ToLowerInvariant();
        return Array.Exists(SuspiciousPaths, p => lower.Contains(p));
    }

    private static Dictionary<string, ServiceSnapshot> TakeServiceSnapshot()
    {
        var snapshot = new Dictionary<string, ServiceSnapshot>();
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name, DisplayName, PathName, StartMode, State FROM Win32_Service");
            foreach (var obj in searcher.Get())
            {
                var name = obj["Name"]?.ToString() ?? "";
                snapshot[name] = new ServiceSnapshot
                {
                    DisplayName = obj["DisplayName"]?.ToString() ?? "",
                    PathName = obj["PathName"]?.ToString() ?? "",
                    StartMode = obj["StartMode"]?.ToString() ?? "",
                    State = obj["State"]?.ToString() ?? ""
                };
            }
        }
        catch { }
        return snapshot;
    }

    private class ServiceSnapshot
    {
        public string DisplayName { get; set; } = "";
        public string PathName { get; set; } = "";
        public string StartMode { get; set; } = "";
        public string State { get; set; } = "";
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
                _logger.LogWarning("Failed to flush service events: {Status}", resp.StatusCode);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Error flushing service events"); }
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
                ["metadata"] = new { sensor = "service_changes", queue_depth = _eventQueue.Count, drop_count = _droppedCount, tracked_services = _serviceSnapshot.Count }
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
