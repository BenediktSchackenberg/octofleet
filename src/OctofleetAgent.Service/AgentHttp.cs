using System.Net.Http;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service;

/// <summary>
/// One connection pool for the agent's HTTP calls. Each <c>AgentHttp.Create()</c> had its own pool, and
/// the security collectors created one per upload (a new connection each time, the old ones left in
/// TIME_WAIT).
/// </summary>
public static class AgentHttp
{
    /// <summary>
    /// Idle connections are closed after this time. The server (uvicorn) closes keep-alive connections
    /// after 5 s without a request; the screen and live-data pollers ask every 5 s and kept sending on a
    /// connection the server was closing at that moment (SocketException 10053, logged as an error with
    /// a stack trace dozens of times a day). Closing them earlier on our side avoids the race.
    /// </summary>
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromSeconds(2);

    private static readonly SocketsHttpHandler Handler = new()
    {
        PooledConnectionIdleTimeout = IdleTimeout,
        // Reconnect now and then, so a changed DNS entry of the server is picked up
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        ConnectTimeout = TimeSpan.FromSeconds(15),
    };

    /// <summary>A client on the shared pool; disposing it leaves the pool open</summary>
    public static HttpClient Create(TimeSpan? timeout = null) =>
        new(Handler, disposeHandler: false) { Timeout = timeout ?? TimeSpan.FromSeconds(100) };

    /// <summary>
    /// A connection problem that usually goes away by itself: the server is not reachable (restarting,
    /// network, DNS), a connection was dropped, a request timed out, or the server answered 5xx.
    /// Not: the agent stopping (<paramref name="stopping"/>), 4xx answers, or errors in the agent itself.
    /// </summary>
    public static bool IsTransient(Exception ex, CancellationToken stopping = default)
    {
        if (stopping.IsCancellationRequested && ex is OperationCanceledException) return false;
        return ex switch
        {
            TaskCanceledException => true, // HttpClient.Timeout
            HttpRequestException h => h.StatusCode is null || IsRetryable(h.StatusCode.Value),
            IOException or SocketException => true,
            _ => false,
        };
    }

    /// <summary>An answer worth trying again later: the server failed (5xx) or is busy (429, 408)</summary>
    public static bool IsRetryable(System.Net.HttpStatusCode status) =>
        (int)status >= 500 || status is System.Net.HttpStatusCode.TooManyRequests or System.Net.HttpStatusCode.RequestTimeout;

    /// <summary>The outer and the innermost message, on one line and without repeating itself -
    /// enough for a connection problem</summary>
    public static string Reason(Exception ex)
    {
        var inner = ex;
        while (inner.InnerException != null) inner = inner.InnerException;
        string message;
        if (inner == ex || ex.Message.Contains(inner.Message)) message = ex.Message;
        else if (inner.Message.Contains(ex.Message)) message = inner.Message;
        else message = $"{ex.Message} {inner.Message}";
        return message.ReplaceLineEndings(" ").Trim();
    }
}

/// <summary>
/// Logs connection problems of one component (e.g. "Screen session check") as one short warning,
/// the first at once and then at most once per <c>interval</c> with the number of failures, and once
/// when it works again - instead of an error with a stack trace on every attempt. Other exceptions are
/// left to the caller, who logs them as errors with the stack trace as before.
/// </summary>
public sealed class ConnectionProblems
{
    private readonly ILogger _logger;
    private readonly string _what;
    private readonly TimeSpan _interval;
    private readonly Func<DateTime> _now;
    private readonly object _lock = new();
    private int _failures;
    private DateTime _since;
    private DateTime _lastLogged;

    public ConnectionProblems(ILogger logger, string what, TimeSpan? interval = null, Func<DateTime>? now = null)
    {
        _logger = logger;
        _what = what;
        _interval = interval ?? TimeSpan.FromMinutes(5);
        _now = now ?? (() => DateTime.Now);
    }

    /// <summary>Failures in a row since the last success</summary>
    public int Failures { get { lock (_lock) return _failures; } }

    /// <summary>
    /// Records a failure. Returns false for an exception that is not a connection problem: the caller
    /// logs it as an error.
    /// </summary>
    public bool Report(Exception ex, CancellationToken stopping = default)
    {
        if (!AgentHttp.IsTransient(ex, stopping)) return false;
        lock (_lock)
        {
            var now = _now();
            if (_failures++ == 0) _since = now;
            if (_failures == 1 || now - _lastLogged >= _interval)
            {
                _lastLogged = now;
                _logger.LogWarning("{What} failed: {Reason} (attempt {Count}, failing since {Since:HH:mm:ss})",
                    _what, AgentHttp.Reason(ex), _failures, _since);
            }
        }
        return true;
    }

    /// <summary>Records a success; logs once that it works again after failures</summary>
    public void Success()
    {
        lock (_lock)
        {
            if (_failures == 0) return;
            _logger.LogInformation("{What} works again (failed attempts: {Count}, failing since {Since:HH:mm:ss})",
                _what, _failures, _since);
            _failures = 0;
        }
    }

    /// <summary>
    /// The wait before the next attempt: <paramref name="normal"/> while it works, then doubling with
    /// each failure up to <paramref name="max"/> - a poller asking every 0.5 s does not hammer a server
    /// that is down.
    /// </summary>
    public TimeSpan Delay(TimeSpan normal, TimeSpan max)
    {
        var failures = Failures;
        if (failures == 0) return normal;
        var factor = Math.Pow(2, Math.Min(failures, 10));
        return TimeSpan.FromMilliseconds(Math.Min(normal.TotalMilliseconds * factor, max.TotalMilliseconds));
    }
}
