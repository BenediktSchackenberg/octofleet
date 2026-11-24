using System.Runtime.Versioning;

namespace OctofleetAgent.Service;

/// <summary>
/// Checks the rules of C:\ProgramData\Octofleet every hour and restores them if someone widened
/// them (e.g. granted users access to the folder).
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class ConfigProtectionWatcher : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);
    private readonly ILogger<ConfigProtectionWatcher> _logger;

    public ConfigProtectionWatcher(ILogger<ConfigProtectionWatcher> logger) => _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var folder = ServiceConfig.GetConfigDir();
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { return; }
            try
            {
                if (ConfigProtection.IsIntact(folder)) continue;
                var error = ConfigProtection.Restrict(folder);
                if (error == null)
                    _logger.LogWarning("The access rules of {Folder} had been widened; restored them to SYSTEM and Administrators", folder);
                else
                    _logger.LogWarning("The access rules of {Folder} had been widened and could not be restored: {Error}", folder, error);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not check the access rules of {Folder}", folder);
            }
        }
    }
}
