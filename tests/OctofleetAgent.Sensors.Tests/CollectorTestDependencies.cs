using System.Net;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service;

// Isolate the linked production collector from the service host and network.
public sealed class ServiceConfig
{
    public string InventoryApiUrl => "http://test.invalid";
    public string InventoryApiKey => "test-only";
    public bool IsInventoryConfigured => true;
    public static ServiceConfig Load() => new();
}

public static class AgentHttp
{
    public static string Body = "";
    public static HttpClient Create(TimeSpan? timeout = null) => new(new ReplyHandler());
    public static bool IsRetryable(HttpStatusCode status) => (int)status >= 500;
    public static bool IsTransient(Exception error) => false;

    private sealed class ReplyHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Body) });
    }
}

public sealed class ConnectionProblems
{
    public ConnectionProblems(ILogger logger, string description) { }
    public void Success() { }
    public bool Report(Exception error) => false;
}
