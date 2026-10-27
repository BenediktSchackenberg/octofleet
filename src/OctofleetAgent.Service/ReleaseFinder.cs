using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace OctofleetAgent.Service;

/// <summary>A place to ask for agent releases (GitHub releases API format).</summary>
public sealed record ReleaseSource(string Name, string Url);

/// <summary>A release with everything an update needs: version, ZIP and SHA256 file.</summary>
public sealed record AgentRelease(string Source, string Tag, string Version, string ZipUrl, string Sha256Url);

/// <summary>
/// Finds the first source that offers a complete release. A source is skipped, and the
/// next one asked, when it cannot be reached, answers with an error status, or returns
/// something that is not a complete release: an HTML page from a proxy, invalid JSON,
/// missing fields, no ZIP or no SHA256 file. No exception leaves this class for those
/// cases, so a broken first source cannot keep the fallback from running.
/// </summary>
public static class ReleaseFinder
{
    /// <summary>
    /// The sources to ask, in order: the Octofleet server (when enabled and configured),
    /// then GitHub if the fallback is allowed or there is no server to ask.
    /// </summary>
    public static List<ReleaseSource> Sources(bool fromServer, string? serverUrl, bool fallbackToGitHub, string gitHubUrl)
    {
        var sources = new List<ReleaseSource>();
        if (fromServer && !string.IsNullOrWhiteSpace(serverUrl))
            sources.Add(new ReleaseSource("Octofleet server", $"{serverUrl.TrimEnd('/')}/api/v1/agent/releases/latest"));
        if (sources.Count == 0 || fallbackToGitHub)
            sources.Add(new ReleaseSource("GitHub", gitHubUrl));
        return sources;
    }

    public static async Task<AgentRelease?> FindAsync(
        HttpClient http, IEnumerable<ReleaseSource> sources, Action<string> warn, CancellationToken ct)
    {
        foreach (var source in sources)
        {
            var release = await TryGetAsync(http, source, warn, ct);
            if (release != null)
                return release;
        }
        return null;
    }

    public static async Task<AgentRelease?> TryGetAsync(
        HttpClient http, ReleaseSource source, Action<string> warn, CancellationToken ct)
    {
        string body;
        try
        {
            using var response = await http.GetAsync(source.Url, ct);
            if (!response.IsSuccessStatusCode)
            {
                // 404 just means "no release here"; anything else is worth a warning
                if ((int)response.StatusCode != 404)
                    warn($"Update check at {source.Name} failed: HTTP {(int)response.StatusCode}");
                return null;
            }
            body = await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is HttpRequestException || ex is IOException)
        {
            warn($"Update check at {source.Name} failed: {ex.Message}");
            return null;
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            warn($"Update check at {source.Name} timed out");
            return null;
        }

        var release = Parse(source.Name, body, out var problem);
        if (release == null)
            warn($"Ignoring the answer from {source.Name}: {problem}");
        return release;
    }

    /// <summary>Parses a release description; returns null and the reason if it is not a complete release.</summary>
    public static AgentRelease? Parse(string source, string json, out string? problem)
    {
        problem = null;
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException)
        {
            problem = "not a JSON release description";
            return null;
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                problem = "not a JSON object";
                return null;
            }

            var tag = GetString(root, "tag_name");
            if (string.IsNullOrWhiteSpace(tag))
            {
                problem = "no tag_name";
                return null;
            }
            var version = tag.TrimStart('v');
            if (!System.Version.TryParse(version, out _))
            {
                problem = $"invalid version '{tag}'";
                return null;
            }

            if (!root.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array)
            {
                problem = $"release {tag} has no assets";
                return null;
            }

            string? zipUrl = null;
            string? sha256Url = null;
            foreach (var asset in assets.EnumerateArray())
            {
                if (asset.ValueKind != JsonValueKind.Object)
                    continue;
                var name = GetString(asset, "name");
                var url = GetString(asset, "browser_download_url");
                if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(url))
                    continue;
                if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    zipUrl = url;
                else if (name.EndsWith(".sha256", StringComparison.OrdinalIgnoreCase))
                    sha256Url = url;
            }

            if (zipUrl == null)
            {
                problem = $"release {tag} has no ZIP asset";
                return null;
            }
            if (sha256Url == null)
            {
                problem = $"release {tag} has no SHA256 file";
                return null;
            }
            return new AgentRelease(source, tag, version, zipUrl, sha256Url);
        }
    }

    private static string? GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
