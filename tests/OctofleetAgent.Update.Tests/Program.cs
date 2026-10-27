using System.Net;
using System.Text;
using OctofleetAgent.Service;

// Self-contained regression runner for the update source lookup; all responses are synthetic.
const string ServerUrl = "http://octofleet.test:8080/api/v1/agent/releases/latest";
const string GitHubUrl = "https://api.github.test/releases/latest";

var failures = 0;
void Assert(bool condition, string description)
{
    Console.WriteLine($"{(condition ? "PASS" : "FAIL")}  {description}");
    if (!condition) failures++;
}

string Release(string tag, bool zip = true, bool sha256 = true)
{
    var assets = new List<string>();
    if (zip) assets.Add($$"""{"name":"OctofleetAgent-{{tag}}.zip","browser_download_url":"https://download.test/{{tag}}.zip"}""");
    if (sha256) assets.Add($$"""{"name":"OctofleetAgent-{{tag}}.sha256","browser_download_url":"https://download.test/{{tag}}.sha256"}""");
    return $$"""{"tag_name":"{{tag}}","assets":[{{string.Join(",", assets)}}]}""";
}

const string Html = "<!doctype html><html><body>Please sign in</body></html>";

// --- Parse: complete and incomplete release descriptions ---
var valid = ReleaseFinder.Parse("test", Release("v0.7.8"), out var problem);
Assert(valid is { Version: "0.7.8", ZipUrl: "https://download.test/v0.7.8.zip", Sha256Url: "https://download.test/v0.7.8.sha256" } && problem == null,
    "complete release is accepted");

foreach (var (json, what) in new[]
{
    (Html, "HTML page"),
    ("", "empty body"),
    ("[]", "JSON array"),
    ("""{"assets":[]}""", "missing tag_name"),
    ("""{"tag_name":42,"assets":[]}""", "tag_name is not a string"),
    ("""{"tag_name":"latest","assets":[]}""", "tag_name is not a version"),
    ("""{"tag_name":"v0.7.8"}""", "missing assets"),
    ("""{"tag_name":"v0.7.8","assets":{}}""", "assets is not an array"),
    ("""{"tag_name":"v0.7.8","assets":[{"name":"a.zip"},{"name":"a.sha256"}]}""", "assets without download URLs"),
    (Release("v0.7.8", zip: false), "no ZIP asset"),
    (Release("v0.7.8", sha256: false), "no SHA256 file"),
})
{
    var result = ReleaseFinder.Parse("test", json, out problem);
    Assert(result == null && !string.IsNullOrEmpty(problem), $"rejected without exception: {what} ({problem})");
}

// --- Sources: order and fallback setting ---
var both = ReleaseFinder.Sources(true, "http://octofleet.test:8080/", true, GitHubUrl);
Assert(both.Count == 2 && both[0].Url == ServerUrl && both[1].Url == GitHubUrl, "server first, then GitHub");
var serverOnly = ReleaseFinder.Sources(true, "http://octofleet.test:8080", false, GitHubUrl);
Assert(serverOnly.Count == 1 && serverOnly[0].Url == ServerUrl, "fallback disabled: server only");
var noServer = ReleaseFinder.Sources(true, "", false, GitHubUrl);
Assert(noServer.Count == 1 && noServer[0].Url == GitHubUrl, "no server configured: GitHub");
var serverDisabled = ReleaseFinder.Sources(false, "http://octofleet.test:8080", false, GitHubUrl);
Assert(serverDisabled.Count == 1 && serverDisabled[0].Url == GitHubUrl, "server updates disabled: GitHub");

// --- FindAsync: a broken server answer must not stop the GitHub fallback ---
async Task<(AgentRelease? Release, FakeHandler Handler, List<string> Warnings)> Find(
    Func<HttpRequestMessage, HttpResponseMessage> server, bool fallback = true)
{
    var handler = new FakeHandler(request => request.RequestUri!.ToString() == ServerUrl
        ? server(request)
        : Respond(HttpStatusCode.OK, Release("v0.7.9")));
    using var http = new HttpClient(handler);
    var warnings = new List<string>();
    var sources = ReleaseFinder.Sources(true, "http://octofleet.test:8080", fallback, GitHubUrl);
    var release = await ReleaseFinder.FindAsync(http, sources, warnings.Add, CancellationToken.None);
    return (release, handler, warnings);
}

var (found, handler, warnings) = await Find(_ => Respond(HttpStatusCode.OK, Html, "text/html"));
Assert(found?.Source == "GitHub" && handler.Requests(ServerUrl) == 1 && handler.Requests(GitHubUrl) == 1 && warnings.Count == 1,
    "server answers 200 with an HTML page: GitHub is asked");

(found, handler, _) = await Find(_ => Respond(HttpStatusCode.OK, """{"tag_name":"v0.7.8"}"""));
Assert(found?.Source == "GitHub" && handler.Requests(GitHubUrl) == 1, "server release without assets: GitHub is asked");

(found, handler, _) = await Find(_ => Respond(HttpStatusCode.OK, Release("v0.7.8", sha256: false)));
Assert(found?.Source == "GitHub" && handler.Requests(GitHubUrl) == 1, "server release without SHA256 file: GitHub is asked");

(found, handler, _) = await Find(_ => RespondWith(HttpStatusCode.OK, ThrowingContent.Instance));
Assert(found?.Source == "GitHub" && handler.Requests(GitHubUrl) == 1, "reading the server response fails: GitHub is asked");

(found, handler, _) = await Find(_ => throw new HttpRequestException("connection refused"));
Assert(found?.Source == "GitHub" && handler.Requests(GitHubUrl) == 1, "server unreachable: GitHub is asked");

(found, handler, warnings) = await Find(_ => Respond(HttpStatusCode.InternalServerError, "error"));
Assert(found?.Source == "GitHub" && warnings.Count == 1, "server error status: warning, GitHub is asked");

(found, handler, warnings) = await Find(_ => Respond(HttpStatusCode.NotFound, "{}"));
Assert(found?.Source == "GitHub" && warnings.Count == 0, "server has no release (404): no warning, GitHub is asked");

(found, handler, _) = await Find(_ => Respond(HttpStatusCode.OK, Release("v0.7.8")));
Assert(found is { Source: "Octofleet server", Version: "0.7.8" } && handler.Requests(GitHubUrl) == 0,
    "server offers a complete release: GitHub is not asked");

(found, handler, _) = await Find(_ => Respond(HttpStatusCode.OK, Html, "text/html"), fallback: false);
Assert(found == null && handler.Requests(GitHubUrl) == 0, "fallback disabled, HTML from server: no release, no exception, GitHub not asked");

Console.WriteLine(failures == 0 ? "All update lookup tests passed." : $"{failures} test(s) failed.");
return failures == 0 ? 0 : 1;

static HttpResponseMessage Respond(HttpStatusCode status, string body, string mediaType = "application/json") =>
    new(status) { Content = new StringContent(body, Encoding.UTF8, mediaType) };

static HttpResponseMessage RespondWith(HttpStatusCode status, HttpContent content) => new(status) { Content = content };

sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    private readonly List<string> _requests = new();

    public int Requests(string url) => _requests.Count(r => r == url);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        _requests.Add(request.RequestUri!.ToString());
        return Task.FromResult(respond(request));
    }
}

/// <summary>Content whose body cannot be read, like a connection that drops mid-response.</summary>
sealed class ThrowingContent : HttpContent
{
    public static ThrowingContent Instance => new();

    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
        throw new IOException("connection reset while reading the response");

    protected override bool TryComputeLength(out long length)
    {
        length = 0;
        return false;
    }
}
