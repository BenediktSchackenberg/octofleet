using System.Diagnostics;
using System.Management;
using System.Text.Json;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects security information: AV, Firewall, BitLocker, TPM
/// </summary>
public static class SecurityCollector
{
    public static async Task<object> CollectAsync()
    {
        var tasks = new List<Task<(string key, object value)>>
        {
            Task.Run(() => ("antivirus", GetAntivirusInfo())),
            Task.Run(() => ("firewall", GetFirewallInfo())),
            Task.Run(() => ("bitlocker", GetBitLockerInfo())),
            Task.Run(() => ("tpm", GetTpmInfo())),
            Task.Run(() => ("uac", GetUacInfo())),
            Task.Run(() => ("secureBoot", GetSecureBootInfo()))
        };

        var results = await Task.WhenAll(tasks);
        var dict = results.ToDictionary(r => r.key, r => r.value);

        return dict;
    }

    private static object GetAntivirusInfo()
    {
        try
        {
            // Try Windows Security Center first (Win10+)
            using var searcher = new ManagementObjectSearcher(
                @"root\SecurityCenter2",
                "SELECT * FROM AntiVirusProduct");
            
            var products = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                var state = Convert.ToUInt32(obj["productState"] ?? 0);
                var enabled = ((state >> 12) & 0xF) == 1;
                var upToDate = ((state >> 4) & 0xF) == 0;

                products.Add(new
                {
                    name = obj["displayName"]?.ToString(),
                    enabled = enabled,
                    upToDate = upToDate,
                    productState = state,
                    pathToSignedProductExe = obj["pathToSignedProductExe"]?.ToString()
                });
            }

            // Also try Windows Defender specific
            var defender = GetDefenderStatus();

            return new
            {
                products = products,
                windowsDefender = defender
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetDefenderStatus()
    {
        try
        {
            // Use PowerShell to get Defender status
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Get-MpComputerStatus | ConvertTo-Json\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return new { error = "Failed to start PowerShell" };

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);

            if (string.IsNullOrEmpty(output)) return new { available = false };

            var json = JsonDocument.Parse(output);
            var root = json.RootElement;

            return new
            {
                available = true,
                antivirusEnabled = GetBoolProp(root, "AntivirusEnabled"),
                antispywareEnabled = GetBoolProp(root, "AntispywareEnabled"),
                realTimeProtectionEnabled = GetBoolProp(root, "RealTimeProtectionEnabled"),
                behaviorMonitorEnabled = GetBoolProp(root, "BehaviorMonitorEnabled"),
                ioavProtectionEnabled = GetBoolProp(root, "IoavProtectionEnabled"),
                nicProtectionEnabled = GetBoolProp(root, "NISEnabled"),
                signatureLastUpdated = GetStringProp(root, "AntivirusSignatureLastUpdated"),
                signatureVersion = GetStringProp(root, "AntivirusSignatureVersion"),
                engineVersion = GetStringProp(root, "AMEngineVersion"),
                productVersion = GetStringProp(root, "AMProductVersion"),
                lastQuickScan = GetStringProp(root, "QuickScanEndTime"),
                lastFullScan = GetStringProp(root, "FullScanEndTime")
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetFirewallInfo()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return new { error = "Failed to start PowerShell" };

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);

            if (string.IsNullOrEmpty(output)) return new { available = false };

            var profiles = JsonSerializer.Deserialize<List<FirewallProfile>>(output);
            
            return new
            {
                profiles = profiles?.Select(p => new
                {
                    name = p.Name,
                    enabled = p.Enabled
                }).ToList()
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private class FirewallProfile
    {
        public string? Name { get; set; }
        public bool Enabled { get; set; }
    }

    private static object GetBitLockerInfo()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Get-BitLockerVolume | Select-Object MountPoint,VolumeStatus,ProtectionStatus,EncryptionMethod | ConvertTo-Json\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return new { error = "Failed to start PowerShell" };

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(5000);

            if (!string.IsNullOrEmpty(error) && error.Contains("not recognized"))
            {
                return new { available = false, reason = "BitLocker cmdlet not available" };
            }

            if (string.IsNullOrEmpty(output)) return new { volumes = new List<object>() };

            // Handle single object vs array
            object? parsed;
            if (output.TrimStart().StartsWith("["))
            {
                parsed = JsonSerializer.Deserialize<List<Dictionary<string, JsonElement>>>(output);
            }
            else
            {
                var single = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(output);
                parsed = single != null ? new List<Dictionary<string, JsonElement>> { single } : null;
            }

            if (parsed is List<Dictionary<string, JsonElement>> volumes)
            {
                return new
                {
                    volumes = volumes.Select(v => new
                    {
                        mountPoint = GetElementString(v, "MountPoint"),
                        volumeStatus = GetElementString(v, "VolumeStatus"),
                        protectionStatus = GetElementString(v, "ProtectionStatus"),
                        encryptionMethod = GetElementString(v, "EncryptionMethod")
                    }).ToList()
                };
            }

            return new { volumes = new List<object>() };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetTpmInfo()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Get-Tpm | ConvertTo-Json\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return new { error = "Failed to start PowerShell" };

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(5000);

            if (!string.IsNullOrEmpty(error) && error.Contains("not recognized"))
            {
                return new { available = false };
            }

            if (string.IsNullOrEmpty(output)) return new { present = false };

            var json = JsonDocument.Parse(output);
            var root = json.RootElement;

            return new
            {
                present = GetBoolProp(root, "TpmPresent"),
                ready = GetBoolProp(root, "TpmReady"),
                enabled = GetBoolProp(root, "TpmEnabled"),
                activated = GetBoolProp(root, "TpmActivated"),
                owned = GetBoolProp(root, "TpmOwned"),
                manufacturerId = GetStringProp(root, "ManufacturerId"),
                manufacturerVersion = GetStringProp(root, "ManufacturerVersion")
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetUacInfo()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System");
            
            if (key == null) return new { error = "Cannot read UAC settings" };

            var enableLUA = key.GetValue("EnableLUA");
            var consentPrompt = key.GetValue("ConsentPromptBehaviorAdmin");
            var secureDesktop = key.GetValue("PromptOnSecureDesktop");

            return new
            {
                enabled = enableLUA != null && Convert.ToInt32(enableLUA) == 1,
                consentPromptBehavior = consentPrompt != null ? Convert.ToInt32(consentPrompt) : -1,
                secureDesktopPrompt = secureDesktop != null && Convert.ToInt32(secureDesktop) == 1
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetSecureBootInfo()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Confirm-SecureBootUEFI\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null) return new { error = "Failed to start PowerShell" };

            var output = process.StandardOutput.ReadToEnd().Trim();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(5000);

            if (!string.IsNullOrEmpty(error))
            {
                if (error.Contains("not supported"))
                    return new { supported = false, reason = "Not UEFI system" };
                if (error.Contains("Cmdlet not supported"))
                    return new { supported = false, reason = "Cmdlet not available" };
            }

            return new
            {
                supported = true,
                enabled = output.Equals("True", StringComparison.OrdinalIgnoreCase)
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static bool GetBoolProp(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.True)
            return true;
        return false;
    }

    private static string? GetStringProp(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.String)
                return prop.GetString();
            return prop.ToString();
        }
        return null;
    }

    private static string? GetElementString(Dictionary<string, JsonElement> dict, string key)
    {
        if (dict.TryGetValue(key, out var element))
        {
            if (element.ValueKind == JsonValueKind.String)
                return element.GetString();
            if (element.ValueKind == JsonValueKind.Number)
                return element.GetInt32().ToString();
            return element.ToString();
        }
        return null;
    }
}
