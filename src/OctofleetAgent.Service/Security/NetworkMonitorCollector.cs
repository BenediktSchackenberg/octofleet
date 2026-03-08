using System.Collections.Concurrent;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace OctofleetAgent.Service.Security;

/// <summary>
/// Monitors TCP connections by polling and diffing state every 30s.
/// Uses P/Invoke GetExtendedTcpTable for process association.
/// </summary>
public class NetworkMonitorCollector : BackgroundService
{
    private readonly ILogger<NetworkMonitorCollector> _logger;
    private readonly ConcurrentQueue<Dictionary<string, object?>> _eventQueue = new();

    private const int FlushIntervalMs = 5000;
    private const int PollIntervalMs = 30000;
    private const int MaxQueueSize = 10000;
    private const int MaxBatchSize = 200;

    private Dictionary<string, ConnectionInfo> _previousSnapshot = new();
    private int _droppedCount;

    public NetworkMonitorCollector(ILogger<NetworkMonitorCollector> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Network Monitor Collector starting...");
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        var config = ServiceConfig.Load();
        if (!config.IsInventoryConfigured)
        {
            _logger.LogWarning("Inventory API not configured, Network Monitor disabled.");
            return;
        }

        var profile = await FetchSensorEnabledAsync(config, "network_monitor");
        if (profile == false)
        {
            _logger.LogInformation("Network Monitor sensor disabled by profile.");
            return;
        }

        _logger.LogInformation("Network Monitor Collector active.");

        var lastPoll = DateTime.MinValue;
        var lastHealth = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(FlushIntervalMs, stoppingToken);

            if ((DateTime.UtcNow - lastPoll).TotalMilliseconds >= PollIntervalMs)
            {
                try { PollConnections(); }
                catch (Exception ex) { _logger.LogWarning(ex, "Error polling connections"); }
                lastPoll = DateTime.UtcNow;
            }

            if (!_eventQueue.IsEmpty)
                await FlushEventsAsync(config);

            if ((DateTime.UtcNow - lastHealth).TotalMinutes >= 5)
            {
                await ReportHealthAsync(config);
                lastHealth = DateTime.UtcNow;
            }
        }
    }

    private void PollConnections()
    {
        var currentSnapshot = new Dictionary<string, ConnectionInfo>();

        // Get connections with process info via P/Invoke
        var tcpRows = GetExtendedTcpTableEntries();

        foreach (var row in tcpRows)
        {
            // Skip localhost
            if (IsLocalhost(row.LocalAddress) && IsLocalhost(row.RemoteAddress))
                continue;

            var key = $"{row.LocalAddress}:{row.LocalPort}-{row.RemoteAddress}:{row.RemotePort}-{row.State}";
            currentSnapshot[key] = row;
        }

        // Also add listeners
        try
        {
            var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
            foreach (var ep in listeners)
            {
                if (IsLocalhost(ep.Address.ToString())) continue;
                var key = $"LISTEN:{ep.Address}:{ep.Port}";
                currentSnapshot[key] = new ConnectionInfo
                {
                    LocalAddress = ep.Address.ToString(),
                    LocalPort = ep.Port,
                    RemoteAddress = "*",
                    RemotePort = 0,
                    State = "Listen",
                    ProcessId = 0,
                    ProcessName = null
                };
            }
        }
        catch { /* best effort */ }

        var now = DateTime.UtcNow;

        // New connections
        foreach (var kvp in currentSnapshot)
        {
            if (!_previousSnapshot.ContainsKey(kvp.Key))
            {
                if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); continue; }

                var eventType = kvp.Value.State == "Listen" ? "network.listen" : "network.connect";
                _eventQueue.Enqueue(BuildEvent(eventType, kvp.Value, now));
            }
        }

        // Closed connections
        foreach (var kvp in _previousSnapshot)
        {
            if (!currentSnapshot.ContainsKey(kvp.Key) && kvp.Value.State != "Listen")
            {
                if (_eventQueue.Count >= MaxQueueSize) { Interlocked.Increment(ref _droppedCount); continue; }
                _eventQueue.Enqueue(BuildEvent("network.close", kvp.Value, now));
            }
        }

        _previousSnapshot = currentSnapshot;
    }

    private static Dictionary<string, object?> BuildEvent(string eventType, ConnectionInfo conn, DateTime timestamp)
    {
        return new Dictionary<string, object?>
        {
            ["event_type"] = eventType,
            ["node_id"] = Environment.MachineName,
            ["timestamp"] = timestamp.ToString("o"),
            ["user"] = new { username = Environment.UserName },
            ["process"] = conn.ProcessName != null ? new { name = conn.ProcessName, pid = conn.ProcessId } : null,
            ["success"] = true,
            ["metadata"] = new
            {
                local_address = conn.LocalAddress,
                local_port = conn.LocalPort,
                remote_address = conn.RemoteAddress,
                remote_port = conn.RemotePort,
                protocol = "tcp",
                state = conn.State
            }
        };
    }

    private static bool IsLocalhost(string addr)
    {
        return addr is "127.0.0.1" or "::1" or "0.0.0.0" or "::";
    }

    #region P/Invoke for GetExtendedTcpTable

    private const int AF_INET = 2;
    private const int TCP_TABLE_OWNER_PID_ALL = 5;

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern uint GetExtendedTcpTable(IntPtr pTcpTable, ref int dwOutBufLen, bool sort, int ipVersion, int tblClass, uint reserved);

    private List<ConnectionInfo> GetExtendedTcpTableEntries()
    {
        var result = new List<ConnectionInfo>();
        try
        {
            int bufferSize = 0;
            GetExtendedTcpTable(IntPtr.Zero, ref bufferSize, true, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);

            var buffer = Marshal.AllocHGlobal(bufferSize);
            try
            {
                var ret = GetExtendedTcpTable(buffer, ref bufferSize, true, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
                if (ret != 0) return result;

                int numEntries = Marshal.ReadInt32(buffer);
                var rowPtr = buffer + 4;
                int rowSize = Marshal.SizeOf<MIB_TCPROW_OWNER_PID>();

                for (int i = 0; i < numEntries; i++)
                {
                    var row = Marshal.PtrToStructure<MIB_TCPROW_OWNER_PID>(rowPtr);
                    if (row != null)
                    {
                        string? procName = null;
                        try
                        {
                            var proc = System.Diagnostics.Process.GetProcessById((int)row.owningPid);
                            procName = proc.ProcessName;
                        }
                        catch { }

                        var localAddr = new System.Net.IPAddress(row.localAddr);
                        var remoteAddr = new System.Net.IPAddress(row.remoteAddr);

                        result.Add(new ConnectionInfo
                        {
                            LocalAddress = localAddr.ToString(),
                            LocalPort = (ushort)System.Net.IPAddress.NetworkToHostOrder((short)row.localPort),
                            RemoteAddress = remoteAddr.ToString(),
                            RemotePort = (ushort)System.Net.IPAddress.NetworkToHostOrder((short)row.remotePort),
                            State = ((TcpState)row.state).ToString(),
                            ProcessId = (int)row.owningPid,
                            ProcessName = procName
                        });
                    }
                    rowPtr += rowSize;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error reading extended TCP table");
        }
        return result;
    }

    [StructLayout(LayoutKind.Sequential)]
    private class MIB_TCPROW_OWNER_PID
    {
        public uint state;
        public uint localAddr;
        public uint localPort;
        public uint remoteAddr;
        public uint remotePort;
        public uint owningPid;
    }

    private enum TcpState
    {
        Closed = 1, Listen = 2, SynSent = 3, SynRcvd = 4,
        Established = 5, FinWait1 = 6, FinWait2 = 7, CloseWait = 8,
        Closing = 9, LastAck = 10, TimeWait = 11, DeleteTcb = 12
    }

    #endregion

    private class ConnectionInfo
    {
        public string LocalAddress { get; set; } = "";
        public int LocalPort { get; set; }
        public string RemoteAddress { get; set; } = "";
        public int RemotePort { get; set; }
        public string State { get; set; } = "";
        public int ProcessId { get; set; }
        public string? ProcessName { get; set; }
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
                _logger.LogWarning("Failed to flush network events: {Status}", resp.StatusCode);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Error flushing network events"); }
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
                ["metadata"] = new { sensor = "network_monitor", queue_depth = _eventQueue.Count, drop_count = _droppedCount, tracked_connections = _previousSnapshot.Count }
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
