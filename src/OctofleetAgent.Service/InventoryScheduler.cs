using System.Text.Json;
using OctofleetAgent.Service.Inventory;

namespace OctofleetAgent.Service;

/// <summary>
/// Background worker that periodically pushes inventory data to the backend API, spread over the
/// interval (see PushSchedule): many nodes started at the same time do not push in the same second.
/// </summary>
public class InventoryScheduler : BackgroundService
{
    private readonly ILogger<InventoryScheduler> _logger;
    private readonly Random _random = new();
    private ServiceConfig _config;
    private DateTime _lastPushTime = DateTime.MinValue;
    private DateTime _nextPushTime = DateTime.MinValue;
    private bool _startupPushDone;
    private int _pushCount = 0;
    private int _failCount = 0;

    public InventoryScheduler(ILogger<InventoryScheduler> logger)
    {
        _logger = logger;
        _config = ServiceConfig.Load();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Inventory Scheduler starting...");

        // The push after the start (so the node does not keep showing its state from before a
        // restart) waits a random 30-120 s, so nodes started together do not push together.
        await Task.Delay(PushSchedule.StartupDelay(_random), stoppingToken);
        _nextPushTime = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Reload config to pick up any changes
                _config = ServiceConfig.Load();

                if (!_config.ScheduledPushEnabled)
                {
                    _logger.LogDebug("Scheduled push disabled, waiting...");
                    await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
                    continue;
                }

                var intervalMinutes = PushSchedule.Interval(_config.ScheduledPushIntervalMinutes);

                if (DateTime.UtcNow >= _nextPushTime)
                {
                    _logger.LogInformation("Starting scheduled inventory push (interval: {Interval} min)...", intervalMinutes);
                    var succeeded = false;
                    try
                    {
                        var result = await InventoryPusher.CollectAndPushAllAsync(_config);
                        succeeded = result.Success;
                        if (result.Success)
                        {
                            _pushCount++;
                            _lastPushTime = DateTime.UtcNow;
                            _logger.LogInformation("Scheduled inventory push #{Count} completed: {Summary}",
                                _pushCount, result.Summary);
                        }
                        else
                        {
                            _failCount++;
                            _logger.LogWarning("Scheduled inventory push failed: {Summary}", result.Summary);
                        }
                    }
                    catch (Exception ex)
                    {
                        _failCount++;
                        _logger.LogError(ex, "Scheduled inventory push failed with exception");
                    }

                    var delay = !succeeded ? PushSchedule.RetryDelay(intervalMinutes, _random)
                        : _startupPushDone ? PushSchedule.NextDelay(intervalMinutes, _random)
                        : PushSchedule.FirstDelay(intervalMinutes, _random);
                    if (succeeded) _startupPushDone = true;
                    _nextPushTime = DateTime.UtcNow + delay;
                    _logger.LogInformation("Next scheduled inventory push in {Minutes:F0} min", delay.TotalMinutes);
                }

                // Check every minute
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in inventory scheduler loop");
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            }
        }

        _logger.LogInformation("Inventory Scheduler stopped. Total pushes: {Count}, Failed: {Failed}",
            _pushCount, _failCount);
    }

    /// <summary>
    /// Force an immediate inventory push (can be called externally)
    /// </summary>
    public async Task<FullPushResult> PushNowAsync()
    {
        _logger.LogInformation("Manual inventory push requested...");

        var result = await InventoryPusher.CollectAndPushAllAsync(_config);

        if (result.Success)
        {
            _pushCount++;
            _lastPushTime = DateTime.UtcNow;
        }
        else
        {
            _failCount++;
        }

        return result;
    }

    /// <summary>
    /// Get scheduler status
    /// </summary>
    public SchedulerStatus GetStatus()
    {
        return new SchedulerStatus
        {
            Enabled = _config.ScheduledPushEnabled,
            IntervalMinutes = PushSchedule.Interval(_config.ScheduledPushIntervalMinutes),
            LastPushTime = _lastPushTime,
            NextPushTime = _nextPushTime == DateTime.MinValue ? DateTime.UtcNow : _nextPushTime,
            TotalPushes = _pushCount,
            FailedPushes = _failCount
        };
    }
}

public class SchedulerStatus
{
    public bool Enabled { get; set; }
    public int IntervalMinutes { get; set; }
    public DateTime LastPushTime { get; set; }
    public DateTime NextPushTime { get; set; }
    public int TotalPushes { get; set; }
    public int FailedPushes { get; set; }
}
