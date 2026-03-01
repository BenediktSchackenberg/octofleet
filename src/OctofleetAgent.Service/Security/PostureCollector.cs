using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;

namespace OctofleetAgent.Service.Security;

/// <summary>
/// E21 Story #84: Collects system posture snapshots (OS, packages, services, config, ports)
/// and submits them to the backend for baseline tracking and drift detection.
/// Runs on startup (full snapshot) and then daily.
/// </summary>
public class PostureCollector : BackgroundService
{
    private readonly ILogger<PostureCollector> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public PostureCollector(ILogger<PostureCollector> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Wait for service to stabilize
        await Task.Delay(TimeSpan.FromSeconds(30), ct);
        _logger.LogInformation("PostureCollector started");

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var snapshot = await CollectSnapshotAsync(ct);
                await SubmitSnapshotAsync(snapshot, ct);
                _logger.LogInformation("Posture snapshot submitted successfully");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PostureCollector error");
            }

            // Wait 24 hours for next snapshot
            await Task.Delay(TimeSpan.FromHours(24), ct);
        }
    }

    private async Task<PostureSnapshot> CollectSnapshotAsync(CancellationToken ct)
    {
        var snapshot = new PostureSnapshot
        {
            NodeId = _config.DisplayName ?? Environment.MachineName,
            SnapshotType = "full"
        };

        // Collect all data in parallel where possible
        var tasks = new List<Task>
        {
            Task.Run(() => snapshot.OsInfo = CollectOsInfo(), ct),
            Task.Run(() => snapshot.RunningServices = CollectRunningServices(), ct),
            Task.Run(() => snapshot.ConfigSettings = CollectConfigSettings(), ct),
            Task.Run(() => snapshot.OpenPorts = CollectOpenPorts(), ct),
        };

        // Installed packages needs async (winget/wmic)
        tasks.Add(Task.Run(async () => snapshot.InstalledPackages = await CollectInstalledPackagesAsync(ct), ct));

        await Task.WhenAll(tasks);
        return snapshot;
    }

    private Dictionary<string, object> CollectOsInfo()
    {
        var info = new Dictionary<string, object>();
        try
        {
            info["machineName"] = Environment.MachineName;
            info["osVersion"] = Environment.OSVersion.ToString();
            info["osPlatform"] = RuntimeInformation.OSDescription;
            info["processorCount"] = Environment.ProcessorCount;
            info["is64Bit"] = Environment.Is64BitOperatingSystem;
            info["dotnetVersion"] = RuntimeInformation.FrameworkDescription;
            info["uptime"] = Environment.TickCount64 / 1000;

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                try
                {
                    using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
                    if (key != null)
                    {
                        info["productName"] = key.GetValue("ProductName")?.ToString() ?? "";
                        info["buildNumber"] = key.GetValue("CurrentBuildNumber")?.ToString() ?? "";
                        info["displayVersion"] = key.GetValue("DisplayVersion")?.ToString() ?? "";
                        info["ubr"] = key.GetValue("UBR")?.ToString() ?? "";
                    }
                }
                catch { /* registry access may fail */ }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting OS info");
        }
        return info;
    }

    private async Task<List<Dictionary<string, string>>> CollectInstalledPackagesAsync(CancellationToken ct)
    {
        var packages = new List<Dictionary<string, string>>();
        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                // Try registry-based package enumeration (faster, more reliable)
                var regPaths = new[]
                {
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
                };

                foreach (var regPath in regPaths)
                {
                    try
                    {
                        using var key = Registry.LocalMachine.OpenSubKey(regPath);
                        if (key == null) continue;

                        foreach (var subKeyName in key.GetSubKeyNames())
                        {
                            try
                            {
                                using var subKey = key.OpenSubKey(subKeyName);
                                var displayName = subKey?.GetValue("DisplayName")?.ToString();
                                if (string.IsNullOrWhiteSpace(displayName)) continue;

                                packages.Add(new Dictionary<string, string>
                                {
                                    ["name"] = displayName,
                                    ["version"] = subKey?.GetValue("DisplayVersion")?.ToString() ?? "",
                                    ["publisher"] = subKey?.GetValue("Publisher")?.ToString() ?? "",
                                    ["installDate"] = subKey?.GetValue("InstallDate")?.ToString() ?? ""
                                });
                            }
                            catch { /* skip inaccessible entries */ }
                        }
                    }
                    catch { /* skip inaccessible hive */ }
                }

                // Deduplicate by name
                packages = packages
                    .GroupBy(p => p["name"])
                    .Select(g => g.First())
                    .OrderBy(p => p["name"])
                    .ToList();
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting installed packages");
        }
        return packages;
    }

    private List<Dictionary<string, string>> CollectRunningServices()
    {
        var services = new List<Dictionary<string, string>>();
        try
        {
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                foreach (var svc in ServiceController.GetServices())
                {
                    try
                    {
                        services.Add(new Dictionary<string, string>
                        {
                            ["name"] = svc.ServiceName,
                            ["displayName"] = svc.DisplayName,
                            ["status"] = svc.Status.ToString(),
                            ["startType"] = svc.StartType.ToString()
                        });
                    }
                    catch { /* skip */ }
                    finally { svc.Dispose(); }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting running services");
        }
        return services;
    }

    private Dictionary<string, object> CollectConfigSettings()
    {
        var config = new Dictionary<string, object>();
        try
        {
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return config;

            // RDP enabled?
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Terminal Server");
                var rdpDisabled = key?.GetValue("fDenyTSConnections");
                config["rdpEnabled"] = rdpDisabled != null && (int)rdpDisabled == 0;
            }
            catch { config["rdpEnabled"] = "unknown"; }

            // SSH server installed?
            try
            {
                var sshSvc = ServiceController.GetServices().FirstOrDefault(s => s.ServiceName == "sshd");
                config["sshEnabled"] = sshSvc != null;
                config["sshStatus"] = sshSvc?.Status.ToString() ?? "not installed";
                sshSvc?.Dispose();
            }
            catch { config["sshEnabled"] = "unknown"; }

            // SMB enabled?
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters");
                config["smbV1Enabled"] = key?.GetValue("SMB1") is int smb1 && smb1 == 1;
                config["smbEnabled"] = true; // LanmanServer exists
            }
            catch { config["smbEnabled"] = "unknown"; }

            // Firewall status
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "netsh",
                    Arguments = "advfirewall show allprofiles state",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                var output = proc?.StandardOutput.ReadToEnd() ?? "";
                proc?.WaitForExit(5000);
                config["firewallEnabled"] = output.Contains("ON");
                config["firewallDetails"] = output.Trim();
            }
            catch { config["firewallEnabled"] = "unknown"; }

            // Local admins
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "net",
                    Arguments = "localgroup Administrators",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                var output = proc?.StandardOutput.ReadToEnd() ?? "";
                proc?.WaitForExit(5000);

                var members = output.Split('\n')
                    .SkipWhile(l => !l.Contains("---"))
                    .Skip(1)
                    .TakeWhile(l => !l.StartsWith("The command"))
                    .Select(l => l.Trim())
                    .Where(l => !string.IsNullOrWhiteSpace(l))
                    .ToList();
                config["localAdmins"] = members;
            }
            catch { config["localAdmins"] = new List<string>(); }

            // Guest account enabled?
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SAM\SAM");
                // SAM is usually not readable, try net user
                var psi = new ProcessStartInfo
                {
                    FileName = "net",
                    Arguments = "user Guest",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var proc = Process.Start(psi);
                var output = proc?.StandardOutput.ReadToEnd() ?? "";
                proc?.WaitForExit(5000);
                config["guestAccount"] = output.Contains("Account active               Yes");
            }
            catch { config["guestAccount"] = "unknown"; }

            // Auto-login
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon");
                var autoLogin = key?.GetValue("AutoAdminLogon")?.ToString();
                config["autoLogin"] = autoLogin == "1";
                if (autoLogin == "1")
                {
                    config["autoLoginUser"] = key?.GetValue("DefaultUserName")?.ToString() ?? "";
                }
            }
            catch { config["autoLogin"] = "unknown"; }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting config settings");
        }
        return config;
    }

    private List<Dictionary<string, object>> CollectOpenPorts()
    {
        var ports = new List<Dictionary<string, object>>();
        try
        {
            var properties = IPGlobalProperties.GetIPGlobalProperties();

            foreach (var listener in properties.GetActiveTcpListeners())
            {
                ports.Add(new Dictionary<string, object>
                {
                    ["port"] = listener.Port,
                    ["protocol"] = "tcp",
                    ["address"] = listener.Address.ToString()
                });
            }

            foreach (var listener in properties.GetActiveUdpListeners())
            {
                ports.Add(new Dictionary<string, object>
                {
                    ["port"] = listener.Port,
                    ["protocol"] = "udp",
                    ["address"] = listener.Address.ToString()
                });
            }

            // Deduplicate and sort
            ports = ports
                .GroupBy(p => $"{p["port"]}/{p["protocol"]}")
                .Select(g => g.First())
                .OrderBy(p => (int)p["port"])
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting open ports");
        }
        return ports;
    }

    private async Task SubmitSnapshotAsync(PostureSnapshot snapshot, CancellationToken ct)
    {
        var baseUrl = _config.InventoryApiUrl;
        if (string.IsNullOrEmpty(baseUrl)) return;

        var url = $"{baseUrl}/api/v1/posture/snapshots";
        var json = JsonSerializer.Serialize(snapshot, JsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        if (!string.IsNullOrEmpty(_config.InventoryApiKey))
            _httpClient.DefaultRequestHeaders.Remove("X-API-Key");
        _httpClient.DefaultRequestHeaders.Add("X-API-Key", _config.InventoryApiKey);

        var response = await _httpClient.PostAsync(url, content, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            _logger.LogWarning("Failed to submit posture snapshot: {Status} {Body}", response.StatusCode, body);
        }
    }
}

public class PostureSnapshot
{
    public string NodeId { get; set; } = "";
    public string SnapshotType { get; set; } = "full";
    public Dictionary<string, object> OsInfo { get; set; } = new();
    public List<Dictionary<string, string>> InstalledPackages { get; set; } = new();
    public List<Dictionary<string, string>> RunningServices { get; set; } = new();
    public Dictionary<string, object> ConfigSettings { get; set; } = new();
    public List<Dictionary<string, object>> OpenPorts { get; set; } = new();
}
