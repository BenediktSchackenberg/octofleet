using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenClawAgent.Service.Inventory;

namespace OpenClawAgent.Service;

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

        // Get system metrics (simplified - skip PerformanceCounter for now)
        double cpu = 0, memory = 0, disk = 0;
        try
        {
            // Memory via GC
            var gcMemory = GC.GetGCMemoryInfo();
            // Use simple WMI for memory
            var query = "SELECT * FROM Win32_OperatingSystem";
            using var searcher = new System.Management.ManagementObjectSearcher(query);
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
            })
        };

        var json = JsonSerializer.Serialize(payload);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var baseUrl = config.InventoryApiUrl.TrimEnd('/');

        var response = await _httpClient.PostAsync($"{baseUrl}/api/v1/live-data", content, ct);
        
        if (response.IsSuccessStatusCode)
        {
            _logger.LogDebug("Pushed live data: {ProcessCount} processes, Mem={Mem}%, Disk={Disk}%", 
                processes.Count, memory, disk);
        }
        else
        {
            _logger.LogWarning("Failed to push live data: {Status}", response.StatusCode);
        }
    }
}
