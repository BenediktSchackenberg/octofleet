using System.Collections.Concurrent;
using System.Management;
using System.Text.Json;
using Microsoft.Win32;

namespace OctofleetAgent.Service.Security;

/// <summary>
/// Monitors Windows Registry changes on security-sensitive keys via WMI events.
/// Periodically snapshots autorun keys to detect drift.
/// </summary>
public class RegistryMonitorCollector : BackgroundService
{
    private readonly ILogger<RegistryMonitorCollector> _logger;
    private ConnectionProblems? _uploadProblems;
    // A batch the server could not take (not reachable, timeout, 5xx/429): sent first next time
    private List<object>? _pendingBatch;
    private ConnectionProblems UploadProblems => _uploadProblems ??= new ConnectionProblems(_logger, "Uploading registry events");
    private readonly ConcurrentQueue<Dictionary<string, object?>> _eventQueue = new();
    private readonly List<ManagementEventWatcher> _watchers = new();

    private const int FlushIntervalMs = 5000;
    private const int MaxQueueSize = 10000;
    private const int MaxBatchSize = 200;
    private const int SnapshotIntervalMs = 5 * 60 * 1000; // 5 min

    private Dictionary<string, string?> _autorunSnapshot = new();
    private int _droppedCount;

    // Monitored paths: (hive constant for WMI, key path, friendly hive name)
    private static readonly (uint Hive, string Path, string HiveName)[] MonitoredKeys = new[]
    {
        (0x80000002u, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKLM"),
        (0x80000002u, @"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce", "HKLM"),
        (0x80000002u, @"SYSTEM\CurrentControlSet\Services", "HKLM"),
        (0x80000002u, @"SOFTWARE\Policies", "HKLM"),
        (0x80000001u, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKCU"),
    };

    public RegistryMonitorCollector(ILogger<RegistryMonitorCollector> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Registry Monitor Collector starting...");
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        var config = ServiceConfig.Load();
        if (!config.IsInventoryConfigured)
        {
            _logger.LogWarning("Inventory API not configured, Registry Monitor disabled.");
            return;
        }

        var sensorEnabled = await FetchSensorEnabledAsync(config, "registry_monitor");
        if (sensorEnabled == false)
        {
            _logger.LogInformation("Registry Monitor sensor disabled by profile.");
            return;
        }

        // Take initial autorun snapshot
        _autorunSnapshot = TakeAutorunSnapshot();

        // Set up WMI watchers
        try
        {
            foreach (var (hive, path, hiveName) in MonitoredKeys)
            {
                try
                {
                    // Watch for value changes
                    var valueQuery = new WqlEventQuery(
                        "__InstanceModificationEvent",
                        TimeSpan.FromSeconds(2),
                        $"TargetInstance ISA 'Win32_Registry'");

                    // Use RegistryKeyChangeEvent for key-level changes
                    var keyQuery = $"SELECT * FROM RegistryKeyChangeEvent WHERE Hive='HKEY_LOCAL_MACHINE' AND KeyPath='{path.Replace("\\", "\\\\")}'";
                    if (hive == 0x80000001u)
                        keyQuery = $"SELECT * FROM RegistryKeyChangeEvent WHERE Hive='HKEY_CURRENT_USER' AND KeyPath='{path.Replace("\\", "\\\\")}'";

                    var watcher = new ManagementEventWatcher(new EventQuery(keyQuery));
                    watcher.EventArrived += (s, e) => OnRegistryChange(hiveName, path);
                    watcher.Start();
                    _watchers.Add(watcher);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Could not watch registry key {Hive}\\{Path}", hiveName, path);
                }
            }

            _logger.LogInformation("Registry Monitor Collector active: watching {Count} keys", _watchers.Count);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to start WMI registry watchers. Registry Monitor disabled.");
            return;
        }

        var lastHealth = DateTime.UtcNow;
        var lastSnapshot = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(FlushIntervalMs, stoppingToken);

            if (_pendingBatch is not null || !_eventQueue.IsEmpty)
                await FlushEventsAsync(config);

            // Periodic snapshot to detect drift
            if ((DateTime.UtcNow - lastSnapshot).TotalMilliseconds >= SnapshotIntervalMs)
            {
                DetectAutorunDrift();
                lastSnapshot = DateTime.UtcNow;
            }

            if ((DateTime.UtcNow - lastHealth).TotalMinutes >= 5)
            {
                await ReportHealthAsync(config);
                lastHealth = DateTime.UtcNow;
            }
        }

        foreach (var w in _watchers) { try { w.Stop(); w.Dispose(); } catch { } }
    }

    private void OnRegistryChange(string hiveName, string keyPath)
    {
        if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); return; }

        _eventQueue.Enqueue(new Dictionary<string, object?>
        {
            ["event_type"] = "registry.key_create",
            ["node_id"] = Environment.MachineName,
            ["timestamp"] = DateTime.UtcNow.ToString("o"),
            ["user"] = new { username = Environment.UserName },
            ["process"] = (object?)null,
            ["success"] = true,
            ["metadata"] = new { hive = hiveName, key_path = keyPath }
        });
    }

    private void DetectAutorunDrift()
    {
        try
        {
            var current = TakeAutorunSnapshot();
            var now = DateTime.UtcNow;

            // New entries
            foreach (var kvp in current)
            {
                if (!_autorunSnapshot.ContainsKey(kvp.Key))
                {
                    if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); continue; }
                    _eventQueue.Enqueue(new Dictionary<string, object?>
                    {
                        ["event_type"] = "registry.value_set",
                        ["node_id"] = Environment.MachineName,
                        ["timestamp"] = now.ToString("o"),
                        ["user"] = new { username = Environment.UserName },
                        ["process"] = (object?)null,
                        ["success"] = true,
                        ["metadata"] = new { hive = "autorun", key_path = kvp.Key, value_data = kvp.Value, detection = "drift" }
                    });
                }
                else if (_autorunSnapshot[kvp.Key] != kvp.Value)
                {
                    if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); continue; }
                    _eventQueue.Enqueue(new Dictionary<string, object?>
                    {
                        ["event_type"] = "registry.value_set",
                        ["node_id"] = Environment.MachineName,
                        ["timestamp"] = now.ToString("o"),
                        ["user"] = new { username = Environment.UserName },
                        ["process"] = (object?)null,
                        ["success"] = true,
                        ["metadata"] = new { hive = "autorun", key_path = kvp.Key, value_data = kvp.Value, previous_value = _autorunSnapshot[kvp.Key], detection = "drift" }
                    });
                }
            }

            // Deleted entries
            foreach (var kvp in _autorunSnapshot)
            {
                if (!current.ContainsKey(kvp.Key))
                {
                    if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); continue; }
                    _eventQueue.Enqueue(new Dictionary<string, object?>
                    {
                        ["event_type"] = "registry.key_delete",
                        ["node_id"] = Environment.MachineName,
                        ["timestamp"] = now.ToString("o"),
                        ["user"] = new { username = Environment.UserName },
                        ["process"] = (object?)null,
                        ["success"] = true,
                        ["metadata"] = new { hive = "autorun", key_path = kvp.Key, previous_value = kvp.Value, detection = "drift" }
                    });
                }
            }

            _autorunSnapshot = current;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error during autorun drift detection");
        }
    }

    private static Dictionary<string, string?> TakeAutorunSnapshot()
    {
        var snapshot = new Dictionary<string, string?>();

        void ReadKey(RegistryKey? baseKey, string path, string prefix)
        {
            try
            {
                using var key = baseKey?.OpenSubKey(path);
                if (key == null) return;
                foreach (var name in key.GetValueNames())
                {
                    var fullPath = $"{prefix}\\{path}\\{name}";
                    snapshot[fullPath] = key.GetValue(name)?.ToString();
                }
            }
            catch { }
        }

        ReadKey(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKLM");
        ReadKey(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce", "HKLM");
        ReadKey(Registry.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKCU");

        return snapshot;
    }

    private async Task FlushEventsAsync(ServiceConfig config)
    {
        // the batch kept after a failed upload first; check the size before taking an event out of
        // the queue (the other order dropped one event with every full batch)
        var batch = _pendingBatch ?? new List<object>();
        _pendingBatch = null;
        int count = batch.Count;
        while (count < MaxBatchSize && _eventQueue.TryDequeue(out var evt)) { batch.Add(evt); count++; }
        if (batch.Count == 0) return;
        try
        {
            using var client = AgentHttp.Create(TimeSpan.FromSeconds(10));
            client.DefaultRequestHeaders.Add("X-API-Key", config.InventoryApiKey);
            var payload = JsonSerializer.Serialize(new { events = batch });
            var resp = await client.PostAsync(
                $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/ingest/events/normalized",
                new StringContent(payload, System.Text.Encoding.UTF8, "application/json"));
            if (resp.IsSuccessStatusCode)
                UploadProblems.Success();
            else if (AgentHttp.IsRetryable(resp.StatusCode))
            {
                _pendingBatch = batch;
                UploadProblems.Report(new HttpRequestException($"HTTP {(int)resp.StatusCode} {resp.StatusCode}", null, resp.StatusCode));
            }
            else
                _logger.LogWarning("Failed to flush registry events: {Status} - {Count} events dropped", resp.StatusCode, batch.Count);
        }
        catch (Exception ex)
        {
            if (AgentHttp.IsTransient(ex)) _pendingBatch = batch;
            if (!UploadProblems.Report(ex)) _logger.LogWarning(ex, "Error flushing registry events - {Count} events dropped", batch.Count);
        }
    }

    private async Task ReportHealthAsync(ServiceConfig config)
    {
        try
        {
            using var client = AgentHttp.Create(TimeSpan.FromSeconds(10));
            client.DefaultRequestHeaders.Add("X-API-Key", config.InventoryApiKey);
            var health = new Dictionary<string, object?>
            {
                ["event_type"] = "agent.health",
                ["node_id"] = Environment.MachineName,
                ["timestamp"] = DateTime.UtcNow.ToString("o"),
                ["metadata"] = new { sensor = "registry_monitor", queue_depth = _eventQueue.Count, drop_count = _droppedCount, watcher_count = _watchers.Count }
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
            using var client = AgentHttp.Create(TimeSpan.FromSeconds(10));
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
