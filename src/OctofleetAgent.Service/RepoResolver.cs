using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service;

/// <summary>
/// Resolves download URLs through local repository when available.
/// Agents check local repo first, fallback to source URL if unavailable.
/// Epic #57 Issue #62
/// </summary>
public class RepoResolver
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<RepoResolver>? _logger;
    private readonly string? _repoBaseUrl;
    private readonly bool _preferRepo;
    private readonly bool _fallbackToSource;

    public RepoResolver(string? repoBaseUrl, ILogger<RepoResolver>? logger = null, bool preferRepo = true, bool fallbackToSource = true)
    {
        _repoBaseUrl = repoBaseUrl?.TrimEnd('/');
        _logger = logger;
        _preferRepo = preferRepo;
        _fallbackToSource = fallbackToSource;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    /// <summary>
    /// Result of URL resolution
    /// </summary>
    public class ResolveResult
    {
        public string Url { get; set; } = "";
        public bool FromRepo { get; set; }
        public string? RepoFileId { get; set; }
        public string? Sha256 { get; set; }
        public long? Size { get; set; }
        public string? Error { get; set; }
    }

    /// <summary>
    /// Resolve a URL - check local repo first, then use original URL.
    /// </summary>
    /// <param name="sourceUrl">Original download URL</param>
    /// <param name="filename">Optional filename to search by (extracts from URL if null)</param>
    /// <param name="expectedHash">Optional SHA256 hash to match</param>
    public async Task<ResolveResult> ResolveUrl(string sourceUrl, string? filename = null, string? expectedHash = null, CancellationToken ct = default)
    {
        // Extract filename from URL if not provided
        if (string.IsNullOrEmpty(filename))
        {
            try
            {
                var uri = new Uri(sourceUrl);
                filename = System.IO.Path.GetFileName(uri.LocalPath);
            }
            catch
            {
                filename = null;
            }
        }

        // Try local repo first if configured
        if (_preferRepo && !string.IsNullOrEmpty(_repoBaseUrl) && !string.IsNullOrEmpty(filename))
        {
            var repoResult = await TryRepoLookup(filename, expectedHash, ct);
            if (repoResult != null)
            {
                _logger?.LogInformation("Resolved {Filename} from local repo: {RepoUrl}", filename, repoResult.Url);
                return repoResult;
            }
        }

        // Fallback to source URL
        if (_fallbackToSource)
        {
            _logger?.LogInformation("Using source URL: {Url}", sourceUrl);
            return new ResolveResult
            {
                Url = sourceUrl,
                FromRepo = false
            };
        }

        return new ResolveResult
        {
            Url = sourceUrl,
            FromRepo = false,
            Error = "File not found in local repo and fallback disabled"
        };
    }

    /// <summary>
    /// Look up a file in the local repository by filename or hash
    /// </summary>
    private async Task<ResolveResult?> TryRepoLookup(string filename, string? expectedHash, CancellationToken ct)
    {
        try
        {
            // Search by filename
            var searchUrl = $"{_repoBaseUrl}/files?search={Uri.EscapeDataString(filename)}&limit=5";
            
            using var response = await _httpClient.GetAsync(searchUrl, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger?.LogDebug("Repo search failed: {StatusCode}", response.StatusCode);
                return null;
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            
            if (!doc.RootElement.TryGetProperty("files", out var files) || files.GetArrayLength() == 0)
            {
                _logger?.LogDebug("No files found in repo for: {Filename}", filename);
                return null;
            }

            // Find best match
            foreach (var file in files.EnumerateArray())
            {
                var repoFilename = file.GetProperty("filename").GetString();
                var repoHash = file.TryGetProperty("sha256", out var h) ? h.GetString() : null;
                var repoId = file.GetProperty("id").GetString();
                var downloadUrl = file.TryGetProperty("downloadUrl", out var d) ? d.GetString() : null;
                var size = file.TryGetProperty("size", out var s) ? s.GetInt64() : (long?)null;

                // If we have an expected hash, match by hash
                if (!string.IsNullOrEmpty(expectedHash) && !string.IsNullOrEmpty(repoHash))
                {
                    if (repoHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
                    {
                        return new ResolveResult
                        {
                            Url = $"{_repoBaseUrl}/download/{repoId}",
                            FromRepo = true,
                            RepoFileId = repoId,
                            Sha256 = repoHash,
                            Size = size
                        };
                    }
                }
                // Otherwise match by exact filename
                else if (repoFilename?.Equals(filename, StringComparison.OrdinalIgnoreCase) == true)
                {
                    return new ResolveResult
                    {
                        Url = $"{_repoBaseUrl}/download/{repoId}",
                        FromRepo = true,
                        RepoFileId = repoId,
                        Sha256 = repoHash,
                        Size = size
                    };
                }
            }

            return null;
        }
        catch (Exception ex)
        {
            _logger?.LogDebug(ex, "Repo lookup failed");
            return null;
        }
    }

    /// <summary>
    /// Check if a file exists in the local repository
    /// </summary>
    public async Task<bool> ExistsInRepo(string filename, string? expectedHash = null, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_repoBaseUrl))
            return false;

        var result = await TryRepoLookup(filename, expectedHash, ct);
        return result != null;
    }
}
