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
    private readonly HttpClient _httpClient;
    private readonly string _nodeId;
    private readonly string _backendUrl;
    private readonly ProcessCollector _processCollector;

    private const int PollIntervalSeconds = 5;

    public LiveDataPoller(ILogger<LiveDataPoller> logger, IHttpClientFactory httpClientFactory, ConfigService config)
    {
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient("Backend");
        _nodeId = config.NodeId;
        _backendUrl = config.BackendUrl;
        _processCollector = new ProcessCollector(logger);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("LiveDataPoller started, polling every {Interval}s", PollIntervalSeconds);

        // Wait a bit before starting
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
        // Get processes
        var processes = _processCollector.GetTopProcesses(20);

        // Get system metrics
        var (cpu, memory, disk) = _processCollector.GetSystemMetrics();

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

        var response = await _httpClient.PostAsync($"{_backendUrl}/api/v1/live-data", content, ct);
        
        if (response.IsSuccessStatusCode)
        {
            _logger.LogDebug("Pushed live data: {ProcessCount} processes, CPU={Cpu}%, Mem={Mem}%", 
                processes.Count, cpu, memory);
        }
        else
        {
            _logger.LogWarning("Failed to push live data: {Status}", response.StatusCode);
        }
    }
}
