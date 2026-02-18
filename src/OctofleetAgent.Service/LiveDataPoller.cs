using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OctofleetAgent.Service.Inventory;

namespace OctofleetAgent.Service;

/// <summary>
/// Background service that periodically sends live monitoring data to the backend.
/// Runs every 5 seconds to push process and metrics data.
/// </summary>
public class LiveDataPoller : BackgroundService
{
    private readonly ILogger<LiveDataPoller> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    private readonly ProcessCollector _processCollector;
    private readonly string _nodeId;
    
    // Network rate calculation cache
    private Dictionary<string, (long rxBytes, long txBytes, DateTime time)> _lastNetworkStats = new();

    private const int PollIntervalSeconds = 5;

    public LiveDataPoller(ILogger<LiveDataPoller> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _processCollector = new ProcessCollector(logger);
        _nodeId = Environment.MachineName.ToUpperInvariant(); // Same as inventory reports
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("LiveDataPoller started for node {NodeId}, polling every {Interval}s", _nodeId, PollIntervalSeconds);

        // Wait for config to be ready
        while (!stoppingToken.IsCancellationRequested && !_config.IsConfigured)
        {
            await Task.Delay(1000, stoppingToken);
        }

        // Initial delay
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PushLiveData(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error pushing live data");
            }

            await Task.Delay(TimeSpan.FromSeconds(PollIntervalSeconds), stoppingToken);
        }
    }

    private async Task PushLiveData(CancellationToken ct)
    {
        var config = ServiceConfig.Load();
        if (string.IsNullOrEmpty(config.InventoryApiUrl))
        {
            return;
        }

        // Get processes
        var processes = _processCollector.GetTopProcesses(20);

        // Get system metrics
        double cpu = 0, memory = 0, disk = 0;
        try
        {
            // CPU via WMI
            var cpuQuery = "SELECT PercentProcessorTime FROM Win32_PerfFormattedData_PerfOS_Processor WHERE Name='_Total'";
            using var cpuSearcher = new System.Management.ManagementObjectSearcher(cpuQuery);
            foreach (System.Management.ManagementObject obj in cpuSearcher.Get())
            {
                cpu = Convert.ToDouble(obj["PercentProcessorTime"]);
            }
            
            // Memory via WMI
            var memQuery = "SELECT * FROM Win32_OperatingSystem";
            using var searcher = new System.Management.ManagementObjectSearcher(memQuery);
            foreach (System.Management.ManagementObject obj in searcher.Get())
            {
                var total = Convert.ToDouble(obj["TotalVisibleMemorySize"]);
                var free = Convert.ToDouble(obj["FreePhysicalMemory"]);
                memory = Math.Round(((total - free) / total) * 100, 1);
            }
            
            // Disk (C:)
            var drive = new System.IO.DriveInfo("C");
            if (drive.IsReady)
            {
                disk = Math.Round(((drive.TotalSize - drive.AvailableFreeSpace) / (double)drive.TotalSize) * 100, 1);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not get system metrics");
        }

        // Get network interface stats
        var networkInterfaces = new List<object>();
        try
        {
            var now = DateTime.UtcNow;
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                if (nic.OperationalStatus != OperationalStatus.Up && 
                    nic.OperationalStatus != OperationalStatus.Down) continue;

                var stats = nic.GetIPv4Statistics();
                var rxBytes = stats.BytesReceived;
                var txBytes = stats.BytesSent;
                
                double rxBytesPerSec = 0, txBytesPerSec = 0;
                
                if (_lastNetworkStats.TryGetValue(nic.Name, out var last))
                {
                    var elapsed = (now - last.time).TotalSeconds;
                    if (elapsed > 0)
                    {
                        rxBytesPerSec = (rxBytes - last.rxBytes) / elapsed;
                        txBytesPerSec = (txBytes - last.txBytes) / elapsed;
                    }
                }
                _lastNetworkStats[nic.Name] = (rxBytes, txBytes, now);

                networkInterfaces.Add(new
                {
                    name = nic.Name,
                    description = nic.Description,
                    linkUp = nic.OperationalStatus == OperationalStatus.Up,
                    speedMbps = nic.Speed / 1_000_000,
                    rxBytesPerSec = Math.Round(rxBytesPerSec, 0),
                    txBytesPerSec = Math.Round(txBytesPerSec, 0),
                    rxTotalMb = Math.Round(rxBytes / (1024.0 * 1024.0), 1),
                    txTotalMb = Math.Round(txBytes / (1024.0 * 1024.0), 1)
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not get network stats");
        }

        // Get agent service logs from Windows Event Log
        var agentLogs = new List<object>();
        try
        {
            agentLogs = GetAgentServiceLogs(50);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not get agent logs");
        }
        
        // Get Windows Event Logs (System, Security, Application)
        var eventLogs = new List<object>();
        try
        {
            eventLogs = GetWindowsEventLogs(50);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not get Windows event logs");
        }

        var payload = new
        {
            nodeId = _nodeId,
            timestamp = DateTime.UtcNow.ToString("o"),
            metrics = new
            {
                cpuPercent = cpu,
                memoryPercent = memory,
                diskPercent = disk
            },
            processes = processes.ConvertAll(p => new
            {
                name = p.Name,
                pid = p.Pid,
                cpuPercent = p.CpuPercent,
                memoryMb = p.MemoryMb,
                userName = p.UserName,
                threadCount = p.ThreadCount
            }),
            network = networkInterfaces,
            agentLogs = agentLogs,
            eventLogs = eventLogs
        };

        var json = JsonSerializer.Serialize(payload);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var baseUrl = config.InventoryApiUrl.TrimEnd('/');

        // Track stats
        ConsoleUI.AddBytesSent(Encoding.UTF8.GetByteCount(json));
        
        var response = await _httpClient.PostAsync($"{baseUrl}/api/v1/live-data", content, ct);
        
        if (response.IsSuccessStatusCode)
        {
            ConsoleUI.LastLiveDataPush = DateTime.Now;
            ConsoleUI.InventoryApiConnected = true;
            _logger.LogDebug("Pushed live data: {ProcessCount} processes, Mem={Mem}%, Disk={Disk}%", 
                processes.Count, memory, disk);
        }
        else
        {
            ConsoleUI.AddError();
            _logger.LogWarning("Failed to push live data: {Status}", response.StatusCode);
        }
    }

    /// <summary>
    /// Get recent agent service logs from Windows Event Log.
    /// </summary>
    private List<object> GetAgentServiceLogs(int maxEntries)
    {
        var logs = new List<object>();
        
        try
        {
            // Try to read from Application log with source filter
            using var eventLog = new System.Diagnostics.EventLog("Application");
            
            // Get entries, newest first
            var entries = eventLog.Entries.Cast<System.Diagnostics.EventLogEntry>()
                .Where(e => e.Source.Contains("Octofleet", StringComparison.OrdinalIgnoreCase) ||
                           e.Source.Contains("DIOOctofleetAgent", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(e => e.TimeWritten)
                .Take(maxEntries);

            foreach (var entry in entries)
            {
                logs.Add(new
                {
                    timestamp = entry.TimeWritten.ToString("o"),
                    level = entry.EntryType.ToString(),
                    source = entry.Source,
                    message = entry.Message.Length > 500 ? entry.Message.Substring(0, 500) + "..." : entry.Message,
                    eventId = entry.InstanceId
                });
            }
        }
        catch (System.Security.SecurityException)
        {
            // No permission to read event log - this is expected for some services
            _logger.LogDebug("No permission to read Application event log");
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not read agent logs from Event Log");
        }

        return logs;
    }
    
    /// <summary>
    /// Get recent Windows Event Log entries from System, Security, and Application logs.
    /// Focuses on Error and Warning events from the last 5 minutes.
    /// </summary>
    private List<object> GetWindowsEventLogs(int maxEntries)
    {
        var logs = new List<object>();
        var cutoffTime = DateTime.Now.AddMinutes(-5);
        var logNames = new[] { "System", "Application", "Security" };
        
        foreach (var logName in logNames)
        {
            try
            {
                using var eventLog = new System.Diagnostics.EventLog(logName);
                
                // Get recent Error and Warning entries
                var entries = eventLog.Entries.Cast<System.Diagnostics.EventLogEntry>()
                    .Where(e => e.TimeWritten >= cutoffTime)
                    .Where(e => e.EntryType == System.Diagnostics.EventLogEntryType.Error ||
                               e.EntryType == System.Diagnostics.EventLogEntryType.Warning ||
                               e.EntryType == System.Diagnostics.EventLogEntryType.FailureAudit)
                    .OrderByDescending(e => e.TimeWritten)
                    .Take(maxEntries / logNames.Length);

                foreach (var entry in entries)
                {
                    logs.Add(new
                    {
                        logName = logName,
                        timestamp = entry.TimeWritten.ToString("o"),
                        level = entry.EntryType.ToString(),
                        source = entry.Source,
                        eventId = entry.InstanceId,
                        message = entry.Message?.Length > 500 
                            ? entry.Message.Substring(0, 500) + "..." 
                            : entry.Message ?? "",
                        category = entry.Category,
                        machineName = entry.MachineName
                    });
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
        
        // Sort all by timestamp descending and limit
        return logs.OrderByDescending(l => ((dynamic)l).timestamp)
            .Take(maxEntries)
            .ToList();
    }
}
