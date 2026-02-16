using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace OctofleetAgent.Service.Packages;

/// <summary>
/// Manages package downloads, detection, and installation (E4-10 through E4-16)
/// </summary>
public class PackageManager
{
    private readonly HttpClient _httpClient;
    private readonly string _cacheDir;
    private readonly string _apiBaseUrl;
    private readonly bool _isElevated;

    public PackageManager(string apiBaseUrl)
    {
        _apiBaseUrl = apiBaseUrl.TrimEnd('/');
        _httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        _cacheDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Octofleet", "PackageCache"
        );
        Directory.CreateDirectory(_cacheDir);
        
        // Check if running with admin rights (E6: Pre-flight check)
        _isElevated = CheckElevation();
    }

    /// <summary>
    /// Check if the current process has administrator privileges (E6)
    /// </summary>
    public static bool CheckElevation()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Returns whether the agent is running with admin rights
    /// </summary>
    public bool IsElevated => _isElevated;

    /// <summary>
    /// Pre-flight check before package operations (E6)
    /// </summary>
    public InstallResult PreFlightCheck(bool requiresAdmin = true)
    {
        if (requiresAdmin && !_isElevated)
        {
            return new InstallResult
            {
                Success = false,
                ExitCode = -1,
                Error = "Agent is not running with Administrator privileges. " +
                        "MSI/EXE installations require the Octofleet Agent service to run as Local System or an admin account. " +
                        "Please check the service configuration in services.msc."
            };
        }
        return new InstallResult { Success = true };
    }

    #region E4-15: Detection Rules

    /// <summary>
    /// Check if package is already installed using detection rules
    /// </summary>
    public async Task<DetectionResult> CheckInstalled(string packageId, string versionId)
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_apiBaseUrl}/api/v1/packages/{packageId}/versions/{versionId}/detect");
            if (!response.IsSuccessStatusCode)
            {
                return new DetectionResult { IsInstalled = false, Error = $"API error: {response.StatusCode}" };
            }

            var json = await response.Content.ReadAsStringAsync();
            var info = JsonSerializer.Deserialize<DetectionInfo>(json, JsonOptions);

            if (info?.Rules == null || info.Rules.Count == 0)
            {
                return new DetectionResult { IsInstalled = false, Message = "No detection rules defined" };
            }

            var results = new List<(string Type, bool Passed, string Detail)>();
            
            foreach (var rule in info.Rules)
            {
                var passed = rule.Type switch
                {
                    "msi" => CheckMsiRule(rule.Config),
                    "registry" => CheckRegistryRule(rule.Config),
                    "file" => CheckFileRule(rule.Config),
                    "service" => CheckServiceRule(rule.Config),
                    _ => (false, $"Unknown rule type: {rule.Type}")
                };
                
                results.Add((rule.Type, passed.Item1, passed.Item2));
            }

            // AND logic: all rules must pass
            var allPassed = results.TrueForAll(r => r.Passed);
            
            return new DetectionResult
            {
                IsInstalled = allPassed,
                Version = info.Version,
                PackageName = info.PackageName,
                RuleResults = results
            };
        }
        catch (Exception ex)
        {
            return new DetectionResult { IsInstalled = false, Error = ex.Message };
        }
    }

    private (bool, string) CheckMsiRule(JsonElement config)
    {
        // Check if MSI product code is installed
        if (!config.TryGetProperty("productCode", out var productCodeEl))
            return (false, "Missing productCode in config");
        
        var productCode = productCodeEl.GetString();
        if (string.IsNullOrEmpty(productCode))
            return (false, "Empty productCode");

        // Check Uninstall registry keys
        var paths = new[]
        {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        };

        foreach (var basePath in paths)
        {
            using var key = Registry.LocalMachine.OpenSubKey($@"{basePath}\{productCode}");
            if (key != null)
            {
                var displayName = key.GetValue("DisplayName")?.ToString();
                return (true, $"Found: {displayName}");
            }
        }

        return (false, $"Product code {productCode} not found");
    }

    private (bool, string) CheckRegistryRule(JsonElement config)
    {
        if (!config.TryGetProperty("path", out var pathEl))
            return (false, "Missing path in config");
        
        var path = pathEl.GetString();
        var valueName = config.TryGetProperty("valueName", out var vn) ? vn.GetString() : null;
        var expectedValue = config.TryGetProperty("expectedValue", out var ev) ? ev.GetString() : null;

        // Parse hive from path
        var parts = path?.Split('\\', 2);
        if (parts?.Length != 2)
            return (false, $"Invalid registry path: {path}");

        RegistryKey? hive = parts[0].ToUpperInvariant() switch
        {
            "HKLM" or "HKEY_LOCAL_MACHINE" => Registry.LocalMachine,
            "HKCU" or "HKEY_CURRENT_USER" => Registry.CurrentUser,
            "HKCR" or "HKEY_CLASSES_ROOT" => Registry.ClassesRoot,
            _ => null
        };

        if (hive == null)
            return (false, $"Unknown registry hive: {parts[0]}");

        using var key = hive.OpenSubKey(parts[1]);
        if (key == null)
            return (false, $"Key not found: {path}");

        if (valueName != null)
        {
            var value = key.GetValue(valueName);
            if (value == null)
                return (false, $"Value {valueName} not found");
            
            if (expectedValue != null && value.ToString() != expectedValue)
                return (false, $"Value mismatch: expected '{expectedValue}', got '{value}'");
            
            return (true, $"Found: {valueName}={value}");
        }

        return (true, "Key exists");
    }

    private (bool, string) CheckFileRule(JsonElement config)
    {
        if (!config.TryGetProperty("path", out var pathEl))
            return (false, "Missing path in config");
        
        var path = Environment.ExpandEnvironmentVariables(pathEl.GetString() ?? "");
        
        if (!File.Exists(path))
            return (false, $"File not found: {path}");

        // Optional version check
        if (config.TryGetProperty("minVersion", out var minVerEl))
        {
            var minVersion = minVerEl.GetString();
            try
            {
                var fileVersion = FileVersionInfo.GetVersionInfo(path).FileVersion;
                if (!string.IsNullOrEmpty(minVersion) && !string.IsNullOrEmpty(fileVersion))
                {
                    if (new Version(fileVersion.Split(' ')[0]) < new Version(minVersion))
                        return (false, $"Version {fileVersion} < {minVersion}");
                }
            }
            catch
            {
                // Ignore version check errors
            }
        }

        return (true, $"File exists: {path}");
    }

    private (bool, string) CheckServiceRule(JsonElement config)
    {
        if (!config.TryGetProperty("serviceName", out var nameEl))
            return (false, "Missing serviceName in config");
        
        var serviceName = nameEl.GetString();
        
        try
        {
            using var sc = new System.ServiceProcess.ServiceController(serviceName);
            var status = sc.Status;
            return (true, $"Service {serviceName}: {status}");
        }
        catch
        {
            return (false, $"Service not found: {serviceName}");
        }
    }

    #endregion

    #region E4-10/11/14: Download with Fallback

    /// <summary>
    /// Download package with fallback logic (Share → HTTP)
    /// </summary>
    public async Task<DownloadResult> DownloadPackage(string packageId, string versionId, 
        IProgress<DownloadProgress>? progress = null, CancellationToken ct = default)
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_apiBaseUrl}/api/v1/packages/{packageId}/versions/{versionId}/download-info", ct);
            if (!response.IsSuccessStatusCode)
            {
                return new DownloadResult { Success = false, Error = $"API error: {response.StatusCode}" };
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            var info = JsonSerializer.Deserialize<DownloadInfo>(json, JsonOptions);

            if (info == null || string.IsNullOrEmpty(info.Filename))
            {
                return new DownloadResult { Success = false, Error = "Invalid download info" };
            }

            // Check cache first (E4-13)
            var cachedPath = GetCachedPath(info.Filename, info.Sha256Hash);
            if (cachedPath != null)
            {
                return new DownloadResult
                {
                    Success = true,
                    LocalPath = cachedPath,
                    FromCache = true,
                    DownloadInfo = info
                };
            }

            // Try sources in priority order (E4-14: Fallback)
            var sources = info.Sources ?? new List<SourceInfo>();
            
            // Add HTTP fallback if we have a filename but no sources
            if (sources.Count == 0)
            {
                return new DownloadResult { Success = false, Error = "No download sources available" };
            }

            Exception? lastError = null;
            foreach (var source in sources)
            {
                try
                {
                    progress?.Report(new DownloadProgress 
                    { 
                        Status = $"Trying {source.Type}: {source.Url}",
                        Percentage = 0
                    });

                    var localPath = source.Type == "smb" 
                        ? await DownloadFromShare(source.Url, info.Filename, info.FileSize, progress, ct)
                        : await DownloadFromHttp(source.Url, info.Filename, info.FileSize, progress, ct);

                    // Verify hash (E4-12)
                    if (!string.IsNullOrEmpty(info.Sha256Hash))
                    {
                        progress?.Report(new DownloadProgress { Status = "Verifying hash...", Percentage = 100 });
                        var hash = await ComputeFileHash(localPath);
                        if (!hash.Equals(info.Sha256Hash, StringComparison.OrdinalIgnoreCase))
                        {
                            File.Delete(localPath);
                            throw new Exception($"Hash mismatch: expected {info.Sha256Hash}, got {hash}");
                        }
                    }

                    // Move to cache
                    var finalPath = MoveToCache(localPath, info.Filename, info.Sha256Hash);

                    return new DownloadResult
                    {
                        Success = true,
                        LocalPath = finalPath,
                        FromCache = false,
                        DownloadInfo = info
                    };
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    progress?.Report(new DownloadProgress 
                    { 
                        Status = $"Failed: {ex.Message}",
                        Percentage = 0 
                    });
                }
            }

            return new DownloadResult
            {
                Success = false,
                Error = $"All sources failed. Last error: {lastError?.Message}"
            };
        }
        catch (Exception ex)
        {
            return new DownloadResult { Success = false, Error = ex.Message };
        }
    }

    /// <summary>
    /// Download from UNC/SMB share (E4-10)
    /// </summary>
    private async Task<string> DownloadFromShare(string uncPath, string filename, long? fileSize,
        IProgress<DownloadProgress>? progress, CancellationToken ct)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"octofleet_{Guid.NewGuid()}_{filename}");

        await Task.Run(() =>
        {
            using var source = File.OpenRead(uncPath);
            using var dest = File.Create(tempPath);
            
            var buffer = new byte[81920];
            long totalRead = 0;
            int bytesRead;
            
            while ((bytesRead = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                ct.ThrowIfCancellationRequested();
                dest.Write(buffer, 0, bytesRead);
                totalRead += bytesRead;
                
                if (fileSize > 0)
                {
                    progress?.Report(new DownloadProgress
                    {
                        Status = "Downloading from share...",
                        BytesDownloaded = totalRead,
                        TotalBytes = fileSize.Value,
                        Percentage = (int)(totalRead * 100 / fileSize.Value)
                    });
                }
            }
        }, ct);

        return tempPath;
    }

    /// <summary>
    /// Download from HTTP with progress (E4-11)
    /// </summary>
    private async Task<string> DownloadFromHttp(string url, string filename, long? fileSize,
        IProgress<DownloadProgress>? progress, CancellationToken ct)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"octofleet_{Guid.NewGuid()}_{filename}");

        using var response = await _httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        var totalBytes = response.Content.Headers.ContentLength ?? fileSize ?? 0;

        using var contentStream = await response.Content.ReadAsStreamAsync(ct);
        using var fileStream = File.Create(tempPath);

        var buffer = new byte[81920];
        long totalRead = 0;
        int bytesRead;

        while ((bytesRead = await contentStream.ReadAsync(buffer, 0, buffer.Length, ct)) > 0)
        {
            await fileStream.WriteAsync(buffer, 0, bytesRead, ct);
            totalRead += bytesRead;

            if (totalBytes > 0)
            {
                progress?.Report(new DownloadProgress
                {
                    Status = "Downloading...",
                    BytesDownloaded = totalRead,
                    TotalBytes = totalBytes,
                    Percentage = (int)(totalRead * 100 / totalBytes)
                });
            }
        }

        return tempPath;
    }

    #endregion

    #region E4-12/13: Hash & Cache

    private async Task<string> ComputeFileHash(string filePath)
    {
        using var sha256 = SHA256.Create();
        using var stream = File.OpenRead(filePath);
        var hash = await Task.Run(() => sha256.ComputeHash(stream));
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }

    private string? GetCachedPath(string filename, string? hash)
    {
        if (string.IsNullOrEmpty(hash)) return null;

        var cachedPath = Path.Combine(_cacheDir, hash, filename);
        if (File.Exists(cachedPath))
        {
            // Verify hash still matches
            var actualHash = ComputeFileHash(cachedPath).GetAwaiter().GetResult();
            if (actualHash.Equals(hash, StringComparison.OrdinalIgnoreCase))
                return cachedPath;
            
            // Hash mismatch, delete corrupted cache
            try { File.Delete(cachedPath); } catch { }
        }

        return null;
    }

    private string MoveToCache(string tempPath, string filename, string? hash)
    {
        if (string.IsNullOrEmpty(hash))
        {
            // No hash, keep in temp
            return tempPath;
        }

        var cacheSubDir = Path.Combine(_cacheDir, hash);
        Directory.CreateDirectory(cacheSubDir);
        var finalPath = Path.Combine(cacheSubDir, filename);

        if (File.Exists(finalPath))
            File.Delete(finalPath);

        File.Move(tempPath, finalPath);
        return finalPath;
    }

    #endregion

    #region E4-16: Install/Uninstall

    /// <summary>
    /// Execute package installation (E4-16 + E6 improvements)
    /// </summary>
    public async Task<InstallResult> InstallPackage(DownloadResult download, CancellationToken ct = default)
    {
        if (!download.Success || string.IsNullOrEmpty(download.LocalPath))
        {
            return new InstallResult { Success = false, Error = "No package file available" };
        }

        var info = download.DownloadInfo;
        if (info == null)
        {
            return new InstallResult { Success = false, Error = "Missing download info" };
        }

        // E6: Pre-flight admin check for MSI/EXE
        var isMsi = download.LocalPath.EndsWith(".msi", StringComparison.OrdinalIgnoreCase);
        var isExe = download.LocalPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
        
        if ((isMsi || isExe || info.RequiresAdmin) && !_isElevated)
        {
            return new InstallResult
            {
                Success = false,
                ExitCode = 1603,
                Error = "Installation requires Administrator privileges. " +
                        "The Octofleet Agent service must run as Local System or an admin account. " +
                        "Check services.msc > OctofleetNodeAgent > Log On tab."
            };
        }

        var command = info.InstallCommand;
        if (string.IsNullOrEmpty(command))
        {
            // Default MSI install
            if (isMsi)
            {
                command = "msiexec";
                info.InstallArgs = JsonSerializer.SerializeToElement(new[] { "/i", download.LocalPath, "/qn", "/norestart" });
            }
            else if (isExe)
            {
                command = download.LocalPath;
            }
            else
            {
                return new InstallResult { Success = false, Error = "No install command and unknown file type" };
            }
        }

        return await ExecuteCommand(command, info.InstallArgs, download.LocalPath, ct);
    }

    /// <summary>
    /// Execute package uninstallation
    /// </summary>
    public async Task<InstallResult> UninstallPackage(string packageId, string versionId, CancellationToken ct = default)
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_apiBaseUrl}/api/v1/packages/{packageId}/versions/{versionId}/download-info", ct);
            if (!response.IsSuccessStatusCode)
            {
                return new InstallResult { Success = false, Error = $"API error: {response.StatusCode}" };
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            var info = JsonSerializer.Deserialize<DownloadInfo>(json, JsonOptions);

            if (info == null || string.IsNullOrEmpty(info.UninstallCommand))
            {
                return new InstallResult { Success = false, Error = "No uninstall command defined" };
            }

            return await ExecuteCommand(info.UninstallCommand, info.UninstallArgs, null, ct);
        }
        catch (Exception ex)
        {
            return new InstallResult { Success = false, Error = ex.Message };
        }
    }

    private async Task<InstallResult> ExecuteCommand(string command, JsonElement? args, string? filePath, CancellationToken ct)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = command,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            // Build arguments
            if (args.HasValue && args.Value.ValueKind == JsonValueKind.Array)
            {
                var argList = new List<string>();
                foreach (var arg in args.Value.EnumerateArray())
                {
                    var argStr = arg.GetString() ?? "";
                    // Replace placeholder
                    argStr = argStr.Replace("{file}", filePath ?? "");
                    argList.Add(argStr);
                }
                psi.Arguments = string.Join(" ", argList);
            }

            using var process = Process.Start(psi);
            if (process == null)
            {
                return new InstallResult { Success = false, Error = "Failed to start process" };
            }

            var stdout = await process.StandardOutput.ReadToEndAsync();
            var stderr = await process.StandardError.ReadToEndAsync();

            await process.WaitForExitAsync(ct);

            // E6: Interpret common MSI exit codes
            var result = new InstallResult
            {
                Success = process.ExitCode == 0 || process.ExitCode == 3010, // 3010 = reboot required
                ExitCode = process.ExitCode,
                Stdout = stdout,
                Stderr = stderr,
                RequiresReboot = process.ExitCode == 3010
            };

            // Add helpful error messages for common failure codes
            if (!result.Success)
            {
                result.Error = process.ExitCode switch
                {
                    1603 => "MSI error 1603: Installation failed. This usually means insufficient privileges. " +
                            "Ensure the Octofleet Agent service runs as Local System or an Administrator account.",
                    1618 => "MSI error 1618: Another installation is in progress. Wait and retry.",
                    1619 => "MSI error 1619: Package could not be opened. File may be corrupted or inaccessible.",
                    1620 => "MSI error 1620: Package could not be opened. Invalid MSI package.",
                    1625 => "MSI error 1625: Installation prohibited by system policy (GPO).",
                    1633 => "MSI error 1633: Platform not supported (32-bit vs 64-bit mismatch).",
                    1638 => "MSI error 1638: Another version of this product is already installed.",
                    1641 => "MSI code 1641: Installation succeeded, reboot initiated.",
                    5 => "Error 5: Access denied. The service account lacks required permissions.",
                    _ => $"Installation failed with exit code {process.ExitCode}. {stderr}".Trim()
                };
            }

            return result;
        }
        catch (Exception ex)
        {
            return new InstallResult { Success = false, Error = ex.Message };
        }
    }

    #endregion

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };
}

#region DTOs

public class DetectionInfo
{
    public string? Version { get; set; }
    public string? PackageName { get; set; }
    public string? DisplayName { get; set; }
    public List<DetectionRule>? Rules { get; set; }
}

public class DetectionRule
{
    public string? Type { get; set; }
    public JsonElement Config { get; set; }
    public string? Operator { get; set; }
    public int Order { get; set; }
}

public class DetectionResult
{
    public bool IsInstalled { get; set; }
    public string? Version { get; set; }
    public string? PackageName { get; set; }
    public string? Error { get; set; }
    public string? Message { get; set; }
    public List<(string Type, bool Passed, string Detail)>? RuleResults { get; set; }
}

public class DownloadInfo
{
    public string? Filename { get; set; }
    public string? Sha256Hash { get; set; }
    public long? FileSize { get; set; }
    public string? InstallCommand { get; set; }
    public JsonElement? InstallArgs { get; set; }
    public string? UninstallCommand { get; set; }
    public JsonElement? UninstallArgs { get; set; }
    public bool RequiresReboot { get; set; }
    public bool RequiresAdmin { get; set; }
    public bool SilentInstall { get; set; }
    public List<SourceInfo>? Sources { get; set; }
}

public class SourceInfo
{
    public string? Type { get; set; }
    public string? Url { get; set; }
    public int Priority { get; set; }
}

public class DownloadProgress
{
    public string? Status { get; set; }
    public long BytesDownloaded { get; set; }
    public long TotalBytes { get; set; }
    public int Percentage { get; set; }
}

public class DownloadResult
{
    public bool Success { get; set; }
    public string? LocalPath { get; set; }
    public string? Error { get; set; }
    public bool FromCache { get; set; }
    public DownloadInfo? DownloadInfo { get; set; }
}

public class InstallResult
{
    public bool Success { get; set; }
    public int ExitCode { get; set; }
    public string? Stdout { get; set; }
    public string? Stderr { get; set; }
    public string? Error { get; set; }
    public bool RequiresReboot { get; set; }
}

#endregion
