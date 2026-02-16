using System.Diagnostics;
using System.Management;
using System.Text.Json;

namespace OctofleetAgent.Service.Inventory;

#region DTOs
public class AntivirusProduct
{
    public string? Name { get; set; }
    public bool Enabled { get; set; }
    public bool UpToDate { get; set; }
    public uint ProductState { get; set; }
    public string? PathToSignedProductExe { get; set; }
}

public class DefenderStatus
{
    public bool Available { get; set; }
    public bool? AntivirusEnabled { get; set; }
    public bool? AntispywareEnabled { get; set; }
    public bool? RealTimeProtectionEnabled { get; set; }
    public bool? BehaviorMonitorEnabled { get; set; }
    public bool? IoavProtectionEnabled { get; set; }
    public bool? NicProtectionEnabled { get; set; }
    public string? SignatureLastUpdated { get; set; }
    public string? SignatureVersion { get; set; }
    public string? EngineVersion { get; set; }
    public string? ProductVersion { get; set; }
    public string? LastQuickScan { get; set; }
    public string? LastFullScan { get; set; }
    public string? Error { get; set; }
}

public class AntivirusResult
{
    public List<AntivirusProduct> Products { get; set; } = new();
    public DefenderStatus? WindowsDefender { get; set; }
}

public class FirewallProfile
{
    public string? Name { get; set; }
    public bool Enabled { get; set; }
}

public class FirewallResult
{
    public List<FirewallProfile> Profiles { get; set; } = new();
}

public class BitlockerVolume
{
    public string? MountPoint { get; set; }
    public string? VolumeStatus { get; set; }
    public string? ProtectionStatus { get; set; }
    public string? EncryptionMethod { get; set; }
}

public class BitlockerResult
{
    public bool Available { get; set; } = true;
    public string? Reason { get; set; }
    public List<BitlockerVolume> Volumes { get; set; } = new();
}

public class TpmInfo
{
    public bool Present { get; set; }
    public bool Ready { get; set; }
    public bool Enabled { get; set; }
    public bool Activated { get; set; }
    public bool Owned { get; set; }
    public string? ManufacturerId { get; set; }
    public string? ManufacturerVersion { get; set; }
    public string? Error { get; set; }
}

public class UacInfo
{
    public bool Enabled { get; set; }
    public int ConsentPromptBehavior { get; set; }
    public bool SecureDesktopPrompt { get; set; }
    public string? Error { get; set; }
}

public class SecureBootInfo
{
    public bool Supported { get; set; }
    public bool Enabled { get; set; }
    public string? Reason { get; set; }
}

// E1-07: Local Admin Info
public class LocalAdminInfo
{
    public string? Name { get; set; }
    public string? Domain { get; set; }
    public string? AccountType { get; set; }  // User, Group
    public string? Sid { get; set; }
    public bool IsBuiltIn { get; set; }
}

public class LocalAdminsResult
{
    public int Count { get; set; }
    public List<LocalAdminInfo> Members { get; set; } = new();
    public string? Error { get; set; }
}

public class SecurityResult
{
    public AntivirusResult Antivirus { get; set; } = new();
    public FirewallResult Firewall { get; set; } = new();
    public BitlockerResult Bitlocker { get; set; } = new();
    public TpmInfo Tpm { get; set; } = new();
    public UacInfo Uac { get; set; } = new();
    public SecureBootInfo SecureBoot { get; set; } = new();
    public LocalAdminsResult LocalAdmins { get; set; } = new();  // E1-07
}
#endregion

/// <summary>
/// Collects security information: AV, Firewall, BitLocker, TPM
/// </summary>
public static class SecurityCollector
{
    public static async Task<SecurityResult> CollectAsync()
    {
        var result = new SecurityResult();

        var tasks = new List<Task>
        {
            Task.Run(() => result.Antivirus = GetAntivirusInfo()),
            Task.Run(() => result.Firewall = GetFirewallInfo()),
            Task.Run(() => result.Bitlocker = GetBitLockerInfo()),
            Task.Run(() => result.Tpm = GetTpmInfo()),
            Task.Run(() => result.Uac = GetUacInfo()),
            Task.Run(() => result.SecureBoot = GetSecureBootInfo()),
            Task.Run(() => result.LocalAdmins = GetLocalAdmins())  // E1-07
        };

        await Task.WhenAll(tasks);

        return result;
    }

    private static AntivirusResult GetAntivirusInfo()
    {
        var result = new AntivirusResult();

        try
        {
            // Try Windows Security Center first (Win10+)
            using var searcher = new ManagementObjectSearcher(
                @"root\SecurityCenter2",
                "SELECT * FROM AntiVirusProduct");

            foreach (ManagementObject obj in searcher.Get())
            {
                var state = Convert.ToUInt32(obj["productState"] ?? 0);
                var enabled = ((state >> 12) & 0xF) == 1;
                var upToDate = ((state >> 4) & 0xF) == 0;

                result.Products.Add(new AntivirusProduct
                {
                    Name = obj["displayName"]?.ToString(),
                    Enabled = enabled,
                    UpToDate = upToDate,
                    ProductState = state,
                    PathToSignedProductExe = obj["pathToSignedProductExe"]?.ToString()
                });
            }

            // Also try Windows Defender specific
            result.WindowsDefender = GetDefenderStatus();
        }
        catch
        {
            // Security Center not available
        }

        return result;
    }

    private static DefenderStatus GetDefenderStatus()
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
            if (process == null) return new DefenderStatus { Error = "Failed to start PowerShell" };

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);

            if (string.IsNullOrEmpty(output)) return new DefenderStatus { Available = false };

            var json = JsonDocument.Parse(output);
            var root = json.RootElement;

            return new DefenderStatus
            {
                Available = true,
                AntivirusEnabled = GetBoolProp(root, "AntivirusEnabled"),
                AntispywareEnabled = GetBoolProp(root, "AntispywareEnabled"),
                RealTimeProtectionEnabled = GetBoolProp(root, "RealTimeProtectionEnabled"),
                BehaviorMonitorEnabled = GetBoolProp(root, "BehaviorMonitorEnabled"),
                IoavProtectionEnabled = GetBoolProp(root, "IoavProtectionEnabled"),
                NicProtectionEnabled = GetBoolProp(root, "NISEnabled"),
                SignatureLastUpdated = GetStringProp(root, "AntivirusSignatureLastUpdated"),
                SignatureVersion = GetStringProp(root, "AntivirusSignatureVersion"),
                EngineVersion = GetStringProp(root, "AMEngineVersion"),
                ProductVersion = GetStringProp(root, "AMProductVersion"),
                LastQuickScan = GetStringProp(root, "QuickScanEndTime"),
                LastFullScan = GetStringProp(root, "FullScanEndTime")
            };
        }
        catch (Exception ex)
        {
            return new DefenderStatus { Error = ex.Message };
        }
    }

    private static FirewallResult GetFirewallInfo()
    {
        var result = new FirewallResult();

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
            if (process == null) return result;

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);

            if (string.IsNullOrEmpty(output)) return result;

            // Handle single object vs array
            if (output.TrimStart().StartsWith("["))
            {
                var profiles = JsonSerializer.Deserialize<List<JsonElement>>(output);
                if (profiles != null)
                {
                    foreach (var p in profiles)
                    {
                        result.Profiles.Add(new FirewallProfile
                        {
                            Name = GetStringProp(p, "Name"),
                            Enabled = GetBoolProp(p, "Enabled") ?? false
                        });
                    }
                }
            }
            else
            {
                var p = JsonSerializer.Deserialize<JsonElement>(output);
                result.Profiles.Add(new FirewallProfile
                {
                    Name = GetStringProp(p, "Name"),
                    Enabled = GetBoolProp(p, "Enabled") ?? false
                });
            }
        }
        catch
        {
            // Ignore errors
        }

        return result;
    }

    private static BitlockerResult GetBitLockerInfo()
    {
        var result = new BitlockerResult();

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
            if (process == null) return result;

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(5000);

            if (!string.IsNullOrEmpty(error) && error.Contains("not recognized"))
            {
                result.Available = false;
                result.Reason = "BitLocker cmdlet not available";
                return result;
            }

            if (string.IsNullOrEmpty(output)) return result;

            // Handle single object vs array
            if (output.TrimStart().StartsWith("["))
            {
                var volumes = JsonSerializer.Deserialize<List<JsonElement>>(output);
                if (volumes != null)
                {
                    foreach (var v in volumes)
                    {
                        result.Volumes.Add(new BitlockerVolume
                        {
                            MountPoint = GetStringProp(v, "MountPoint"),
                            VolumeStatus = GetStringProp(v, "VolumeStatus"),
                            ProtectionStatus = GetStringProp(v, "ProtectionStatus"),
                            EncryptionMethod = GetStringProp(v, "EncryptionMethod")
                        });
                    }
                }
            }
            else
            {
                var v = JsonSerializer.Deserialize<JsonElement>(output);
                result.Volumes.Add(new BitlockerVolume
                {
                    MountPoint = GetStringProp(v, "MountPoint"),
                    VolumeStatus = GetStringProp(v, "VolumeStatus"),
                    ProtectionStatus = GetStringProp(v, "ProtectionStatus"),
                    EncryptionMethod = GetStringProp(v, "EncryptionMethod")
                });
            }
        }
        catch
        {
            // Ignore errors
        }

        return result;
    }

    private static TpmInfo GetTpmInfo()
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
            if (process == null) return new TpmInfo { Error = "Failed to start PowerShell" };

            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(5000);

            if (!string.IsNullOrEmpty(error) && error.Contains("not recognized"))
            {
                return new TpmInfo { Present = false };
            }

            if (string.IsNullOrEmpty(output)) return new TpmInfo { Present = false };

            var json = JsonDocument.Parse(output);
            var root = json.RootElement;

            return new TpmInfo
            {
                Present = GetBoolProp(root, "TpmPresent") ?? false,
                Ready = GetBoolProp(root, "TpmReady") ?? false,
                Enabled = GetBoolProp(root, "TpmEnabled") ?? false,
                Activated = GetBoolProp(root, "TpmActivated") ?? false,
                Owned = GetBoolProp(root, "TpmOwned") ?? false,
                ManufacturerId = GetStringProp(root, "ManufacturerId"),
                ManufacturerVersion = GetStringProp(root, "ManufacturerVersion")
            };
        }
        catch (Exception ex)
        {
            return new TpmInfo { Error = ex.Message };
        }
    }

    private static UacInfo GetUacInfo()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System");
            
            if (key == null) return new UacInfo { Error = "Cannot read UAC settings" };

            var enableLUA = key.GetValue("EnableLUA");
            var consentPrompt = key.GetValue("ConsentPromptBehaviorAdmin");
            var secureDesktop = key.GetValue("PromptOnSecureDesktop");

            return new UacInfo
            {
                Enabled = enableLUA != null && Convert.ToInt32(enableLUA) == 1,
                ConsentPromptBehavior = consentPrompt != null ? Convert.ToInt32(consentPrompt) : -1,
                SecureDesktopPrompt = secureDesktop != null && Convert.ToInt32(secureDesktop) == 1
            };
        }
        catch (Exception ex)
        {
            return new UacInfo { Error = ex.Message };
        }
    }

    private static SecureBootInfo GetSecureBootInfo()
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
            if (process == null) return new SecureBootInfo { Supported = false };

            var output = process.StandardOutput.ReadToEnd().Trim();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(5000);

            if (!string.IsNullOrEmpty(error))
            {
                if (error.Contains("not supported"))
                    return new SecureBootInfo { Supported = false, Reason = "Not UEFI system" };
                if (error.Contains("Cmdlet not supported"))
                    return new SecureBootInfo { Supported = false, Reason = "Cmdlet not available" };
            }

            return new SecureBootInfo
            {
                Supported = true,
                Enabled = output.Equals("True", StringComparison.OrdinalIgnoreCase)
            };
        }
        catch
        {
            return new SecureBootInfo { Supported = false };
        }
    }

    private static bool? GetBoolProp(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.True) return true;
            if (prop.ValueKind == JsonValueKind.False) return false;
        }
        return null;
    }

    private static string? GetStringProp(JsonElement element, string name)
    {
        if (element.TryGetProperty(name, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.String)
                return prop.GetString();
            if (prop.ValueKind == JsonValueKind.Number)
                return prop.GetInt32().ToString();
            return prop.ToString();
        }
        return null;
    }

    // E1-07: Get local administrators group members
    private static LocalAdminsResult GetLocalAdmins()
    {
        var result = new LocalAdminsResult();
        
        try
        {
            // Use WMI to get members of local Administrators group
            // Win32_GroupUser links groups to users
            using var searcher = new ManagementObjectSearcher(
                "SELECT * FROM Win32_GroupUser WHERE GroupComponent=\"Win32_Group.Domain='" + 
                Environment.MachineName + "',Name='Administrators'\"");

            foreach (ManagementObject obj in searcher.Get())
            {
                var partComponent = obj["PartComponent"]?.ToString();
                if (string.IsNullOrEmpty(partComponent)) continue;

                // Parse the PartComponent string
                // Format: \\HOSTNAME\root\cimv2:Win32_UserAccount.Domain="DOMAIN",Name="Username"
                var admin = new LocalAdminInfo();
                
                if (partComponent.Contains("Win32_UserAccount"))
                {
                    admin.AccountType = "User";
                }
                else if (partComponent.Contains("Win32_Group"))
                {
                    admin.AccountType = "Group";
                }
                else
                {
                    admin.AccountType = "Unknown";
                }

                // Extract Domain and Name
                var domainMatch = System.Text.RegularExpressions.Regex.Match(partComponent, @"Domain=""([^""]+)""");
                var nameMatch = System.Text.RegularExpressions.Regex.Match(partComponent, @"Name=""([^""]+)""");

                if (domainMatch.Success)
                    admin.Domain = domainMatch.Groups[1].Value;
                if (nameMatch.Success)
                    admin.Name = nameMatch.Groups[1].Value;

                // Check if built-in
                admin.IsBuiltIn = admin.Name?.Equals("Administrator", StringComparison.OrdinalIgnoreCase) == true ||
                                  admin.Name?.Equals("Domain Admins", StringComparison.OrdinalIgnoreCase) == true;

                result.Members.Add(admin);
            }

            result.Count = result.Members.Count;
        }
        catch (Exception ex)
        {
            result.Error = ex.Message;
            
            // Fallback: Try net localgroup command
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "net",
                    Arguments = "localgroup Administrators",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };

                using var process = Process.Start(psi);
                if (process != null)
                {
                    var output = process.StandardOutput.ReadToEnd();
                    process.WaitForExit();

                    // Parse output - members are listed after "Members" line and before "---" line
                    var lines = output.Split('\n');
                    bool inMembers = false;
                    
                    foreach (var line in lines)
                    {
                        var trimmed = line.Trim();
                        if (trimmed.StartsWith("---")) 
                        {
                            if (inMembers) break;
                            inMembers = true;
                            continue;
                        }
                        
                        if (inMembers && !string.IsNullOrEmpty(trimmed) && !trimmed.StartsWith("The command"))
                        {
                            result.Members.Add(new LocalAdminInfo
                            {
                                Name = trimmed,
                                AccountType = "Unknown"
                            });
                        }
                    }
                    result.Count = result.Members.Count;
                    result.Error = null; // Clear error if fallback worked
                }
            }
            catch { }
        }

        return result;
    }
}
