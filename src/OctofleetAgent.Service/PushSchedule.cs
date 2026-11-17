namespace OctofleetAgent.Service;

/// <summary>
/// When the scheduled inventory push runs (#283). Many nodes start at the same moment (after an
/// agent update, a power cut, Patch Tuesday reboots); without spreading they would all push at the
/// same second, every interval. So:
/// - the push after the service start waits a random 30-120 s;
/// - the first scheduled push after that comes at a random point between 0.5 and 1.5 intervals,
///   which spreads the nodes over a whole interval;
/// - every later one after the interval +/- 10 %;
/// - after a failed push the agent tries again after 5 minutes (+/- 10 %, at most the interval).
/// Jobs and "Collect inventory" push immediately and do not use this schedule.
/// </summary>
public static class PushSchedule
{
    public const int DefaultIntervalMinutes = 60;
    public const int RetryMinutes = 5;

    public static TimeSpan StartupDelay(Random random) => TimeSpan.FromSeconds(30 + random.Next(0, 91));

    public static TimeSpan FirstDelay(int intervalMinutes, Random random) =>
        TimeSpan.FromMinutes(Interval(intervalMinutes) * (0.5 + random.NextDouble()));

    public static TimeSpan NextDelay(int intervalMinutes, Random random) =>
        TimeSpan.FromMinutes(Interval(intervalMinutes) * (0.9 + 0.2 * random.NextDouble()));

    public static TimeSpan RetryDelay(int intervalMinutes, Random random) =>
        TimeSpan.FromMinutes(Math.Min(RetryMinutes, Interval(intervalMinutes)) * (0.9 + 0.2 * random.NextDouble()));

    /// <summary>The configured interval, at least one minute.</summary>
    public static int Interval(int intervalMinutes) => Math.Max(1, intervalMinutes);
}
