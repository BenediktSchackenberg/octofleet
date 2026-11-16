using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using OctofleetAgent.Service;

// Connection problems with the Octofleet server: which exceptions count, and how they are logged

// Which exceptions are connection problems
Assert(AgentHttp.IsTransient(new HttpRequestException("refused", new SocketException(10061))), "server not reachable");
Assert(AgentHttp.IsTransient(new HttpRequestException("bad gateway", null, HttpStatusCode.BadGateway)), "5xx answer");
Assert(!AgentHttp.IsTransient(new HttpRequestException("unauthorized", null, HttpStatusCode.Unauthorized)), "4xx answer is not");
Assert(AgentHttp.IsTransient(new HttpRequestException("busy", null, HttpStatusCode.TooManyRequests)), "429 (server busy) is");
Assert(AgentHttp.IsRetryable(HttpStatusCode.ServiceUnavailable) && AgentHttp.IsRetryable(HttpStatusCode.RequestTimeout)
    && !AgentHttp.IsRetryable(HttpStatusCode.BadRequest) && !AgentHttp.IsRetryable(HttpStatusCode.Unauthorized), "retryable answers");
Assert(AgentHttp.IsTransient(new TaskCanceledException("HttpClient.Timeout")), "timeout");
Assert(AgentHttp.IsTransient(new IOException("aborted", new SocketException(10053))), "connection dropped");
Assert(!AgentHttp.IsTransient(new InvalidOperationException("bug")), "an error in the agent is not");
using (var stopping = new CancellationTokenSource())
{
    stopping.Cancel();
    Assert(!AgentHttp.IsTransient(new TaskCanceledException(), stopping.Token), "the agent stopping is not");
}
var socket = new SocketException(10053);
var reason = AgentHttp.Reason(new HttpRequestException("An error occurred while sending the request.",
    new IOException("Unable to read data.", socket)));
Assert(reason == $"An error occurred while sending the request. {socket.Message}".ReplaceLineEndings(" ").Trim(), "reason: outer and innermost message");
var refusedSocket = new SocketException(10061);
var refusedHttp = new HttpRequestException($"{refusedSocket.Message} (server:8080)", refusedSocket);
Assert(AgentHttp.Reason(refusedHttp) == refusedHttp.Message, "reason: the inner message is not repeated");
Assert(!AgentHttp.Reason(new IOException("line one\r\nline two")).Contains('\n'), "reason: on one line");

// Logging: the first failure at once, then at most once per interval, the recovery once
var log = new ListLogger();
var now = new DateTime(2026, 11, 15, 18, 0, 0);
var problems = new ConnectionProblems(log, "Screen session check", TimeSpan.FromMinutes(5), () => now);
var refused = new HttpRequestException("No connection could be made because the target machine actively refused it.");
Assert(problems.Report(refused), "reported");
Assert(log.Lines.Count == 1 && log.Lines[0].StartsWith("Warning: Screen session check failed: No connection") && log.Lines[0].Contains("(attempt 1, failing since 18:00:00)"),
    "first failure: one warning line");
for (var i = 0; i < 59; i++) { now = now.AddSeconds(5); problems.Report(refused); }
Assert(log.Lines.Count == 1, "further failures within 5 minutes: nothing");
now = now.AddSeconds(5);
problems.Report(refused);
Assert(log.Lines.Count == 2 && log.Lines[1].Contains("(attempt 61, failing since 18:00:00)"), "after 5 minutes: one line with the count");
Assert(problems.Failures == 61, "failures counted");
problems.Success();
Assert(log.Lines.Count == 3 && log.Lines[2] == "Information: Screen session check works again (failed attempts: 61, failing since 18:00:00)", "recovery logged once");
problems.Success();
Assert(log.Lines.Count == 3 && problems.Failures == 0, "success without failures: nothing");
Assert(!problems.Report(new InvalidOperationException("bug")) && log.Lines.Count == 3, "other exceptions are left to the caller");

// Wait before the next attempt
var poll = TimeSpan.FromMilliseconds(500);
Assert(problems.Delay(poll, TimeSpan.FromSeconds(30)) == poll, "normal interval while it works");
problems.Report(refused);
Assert(problems.Delay(poll, TimeSpan.FromSeconds(30)) == TimeSpan.FromSeconds(1), "doubles after a failure");
for (var i = 0; i < 20; i++) problems.Report(refused);
Assert(problems.Delay(poll, TimeSpan.FromSeconds(30)) == TimeSpan.FromSeconds(30), "up to the maximum");

Console.WriteLine("Connection handling tests passed");

static void Assert(bool condition, string message)
{
    if (!condition) throw new Exception($"FAILED: {message}");
    Console.WriteLine($"ok - {message}");
}

sealed class ListLogger : ILogger
{
    public List<string> Lines { get; } = new();
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        => Lines.Add($"{logLevel}: {formatter(state, exception)}");
}
