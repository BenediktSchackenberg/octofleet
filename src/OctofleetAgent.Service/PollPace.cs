namespace OctofleetAgent.Service;

/// <summary>
/// How often a poller asks the server (#283): slowly while nothing happens, fast while a session is
/// open and for a short grace time after the last sign of one, so the next command does not wait.
/// </summary>
public sealed class PollPace
{
    /// <summary>Idle: about every 5 s (±10 %, so agents started together do not poll in the same second).</summary>
    public static readonly TimeSpan DefaultIdle = TimeSpan.FromSeconds(5);

    /// <summary>Stay fast this long after the server last reported an open session or sent work.</summary>
    public static readonly TimeSpan DefaultGrace = TimeSpan.FromSeconds(60);

    private readonly TimeSpan _fast;
    private readonly TimeSpan _idle;
    private readonly TimeSpan _grace;
    private readonly Func<DateTime> _now;
    private readonly Random _random;
    private DateTime _activeUntil = DateTime.MinValue;

    public PollPace(TimeSpan fast, TimeSpan? idle = null, TimeSpan? grace = null,
        Func<DateTime>? now = null, Random? random = null)
    {
        _fast = fast;
        _idle = idle ?? DefaultIdle;
        _grace = grace ?? DefaultGrace;
        _now = now ?? (() => DateTime.UtcNow);
        _random = random ?? Random.Shared;
    }

    /// <summary>True while the poller polls fast.</summary>
    public bool IsActive => _now() < _activeUntil;

    /// <summary>
    /// The wait before the next poll. <paramref name="active"/>: the last answer reported an open
    /// session or brought work.
    /// </summary>
    public TimeSpan Next(bool active)
    {
        var now = _now();
        if (active) _activeUntil = now + _grace;
        if (now < _activeUntil) return _fast;
        return TimeSpan.FromMilliseconds(_idle.TotalMilliseconds * (0.9 + 0.2 * _random.NextDouble()));
    }
}
