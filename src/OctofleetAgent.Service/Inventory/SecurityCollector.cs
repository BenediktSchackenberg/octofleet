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
    public string? ManufacturerIdTxt { get; set; }
    public string? ManufacturerVersion { get; set; }
    /// <summary>e.g. "2.0, 0, 1.59" (Win32_Tpm.SpecVersion); the first part is the TPM version.</summary>
    public string? SpecVersion { get; set; }
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

/// <summary>
/// Win32_DeviceGuard (root\Microsoft\Windows\DeviceGuard) as reported; the server turns the numbers into
/// off/audit/enforced (App Control) and the VBS state. Null values: the class or property is missing.
/// </summary>
public class DeviceGuardInfo
{
    public bool Available { get; set; }
    /// <summary>App Control kernel mode: 0 off, 1 audit, 2 enforced</summary>
    public int? CodeIntegrityPolicyEnforcementStatus { get; set; }
    /// <summary>App Control user mode: 0 off, 1 audit, 2 enforced</summary>
    public int? UsermodeCodeIntegrityPolicyEnforcementStatus { get; set; }
    /// <summary>0 not enabled, 1 enabled but not running, 2 running</summary>
    public int? VirtualizationBasedSecurityStatus { get; set; }
    /// <summary>1 Credential Guard, 2 memory integrity (HVCI), 3 System Guard Secure Launch, ...</summary>
    public List<int>? SecurityServicesConfigured { get; set; }
    public List<int>? SecurityServicesRunning { get; set; }
    public string? Error { get; set; }
}

public class AppControlPolicy
{
    public string? PolicyId { get; set; }
    public string? BasePolicyId { get; set; }
    public string? FriendlyName { get; set; }
    public string? Version { get; set; }
    public bool? IsSystemPolicy { get; set; }
    public bool? IsSignedPolicy { get; set; }
    public bool? IsEnforced { get; set; }
}

/// <summary>App Control for Business (WDAC): active policies and the vulnerable driver blocklist.</summary>
public class AppControlInfo
{
    /// <summary>"citool" (CiTool --list-policies), "files" (CiPolicies\Active, ids only) or null (unknown)</summary>
    public string? PolicySource { get; set; }
    public List<AppControlPolicy>? Policies { get; set; }
    /// <summary>HKLM\SYSTEM\CurrentControlSet\Control\CI\Config VulnerableDriverBlocklistEnable; null when not set</summary>
    public int? VulnerableDriverBlocklistEnable { get; set; }
    public string? Error { get; set; }
}

public class AppLockerCollection
{
    /// <summary>Exe, Msi, Script, Dll, Appx</summary>
    public string? Type { get; set; }
    /// <summary>NotConfigured, Enabled, AuditOnly</summary>
    public string? EnforcementMode { get; set; }
    public int RuleCount { get; set; }
}

/// <summary>AppLocker effective policy (Get-AppLockerPolicy -Effective) and the Application Identity service.</summary>
public class AppLockerInfo
{
    public bool Available { get; set; }
    /// <summary>Rule collections in the effective policy; collections without rules may be left out</summary>
    public List<AppLockerCollection> Collections { get; set; } = new();
    /// <summary>AppIDSvc status (Running, Stopped, ...); null when the service does not exist</summary>
    public string? AppIdSvcStatus { get; set; }
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
    public DeviceGuardInfo DeviceGuard { get; set; } = new();
    public AppControlInfo AppControl { get; set; } = new();
    public AppLockerInfo AppLocker { get; set; } = new();
}
#endregion

/// <summary>
/// Collects security information: AV, Firewall, BitLocker, TPM
/// </summary>
public static class SecurityCollector
{
    private static readonly Serilog.ILogger Log = Serilog.Log.ForContext(typeof(SecurityCollector));

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
            Task.Run(() => result.LocalAdmins = GetLocalAdmins()),  // E1-07
            Task.Run(() => result.DeviceGuard = GetDeviceGuardInfo()),
            Task.Run(() => result.AppControl = GetAppControlInfo()),
            Task.Run(() => result.AppLocker = GetAppLockerInfo())
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
            using var searcher = Wmi.Searcher(
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
        catch (Exception ex)
        {
            // Security Center not available (e.g. Windows Server)
            Log.Debug("Antivirus: Security Center (SecurityCenter2) not available: {Error}", ex.Message);
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

            var run = ProcessRunner.Run(psi);
            if (run == null) return new DefenderStatus { Error = "Failed to start PowerShell" };

            var output = run.Stdout;

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
            Log.Debug("Defender status not available: {Error}", ex.Message);
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

            var run = ProcessRunner.Run(psi);
            if (run == null) return result;

            var output = run.Stdout;

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
        catch (Exception ex)
        {
            Log.Warning("Firewall profiles not readable: {Error}", ex.Message);
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
                // The statuses are enums - ConvertTo-Json would turn them into numbers, so convert them to text
                Arguments = "-NoProfile -Command \"Get-BitLockerVolume | Select-Object MountPoint,@{n='VolumeStatus';e={[string]$_.VolumeStatus}},@{n='ProtectionStatus';e={[string]$_.ProtectionStatus}},@{n='EncryptionMethod';e={[string]$_.EncryptionMethod}} | ConvertTo-Json\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            var run = ProcessRunner.Run(psi);
            if (run == null) return result;

            var output = run.Stdout;
            var error = run.Stderr;

            if (!string.IsNullOrEmpty(error) && error.Contains("not recognized"))
            {
                // No BitLocker module (e.g. Windows Server without the BitLocker feature): try the WMI
                // provider, which manage-bde uses too. Without it, BitLocker is not installed.
                return GetBitLockerViaWmi();
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
        catch (Exception ex)
        {
            Log.Warning("BitLocker volumes not readable: {Error}", ex.Message);
        }

        return result;
    }

    private static BitlockerResult GetBitLockerViaWmi()
    {
        var result = new BitlockerResult();
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Get-CimInstance -Namespace root/cimv2/Security/MicrosoftVolumeEncryption -ClassName Win32_EncryptableVolume -ErrorAction Stop | Select-Object @{n='MountPoint';e={$_.DriveLetter}},@{n='ProtectionStatus';e={@('Off','On','Unknown')[[int]$_.ProtectionStatus]}} | ConvertTo-Json\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            var run = ProcessRunner.Run(psi);
            if (run == null) return result;
            var output = run.Stdout;
            if (string.IsNullOrWhiteSpace(output))
            {
                result.Available = false;
                result.Reason = "BitLocker is not installed";
                return result;
            }
            var json = JsonSerializer.Deserialize<JsonElement>(output);
            foreach (var v in json.ValueKind == JsonValueKind.Array ? json.EnumerateArray() : new[] { json }.AsEnumerable())
            {
                result.Volumes.Add(new BitlockerVolume
                {
                    MountPoint = GetStringProp(v, "MountPoint"),
                    ProtectionStatus = GetStringProp(v, "ProtectionStatus")
                });
            }
        }
        catch (Exception ex)
        {
            Log.Debug("BitLocker WMI provider not available: {Error}", ex.Message);
            result.Available = false;
            result.Reason = "BitLocker is not installed";
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
                // Get-Tpm has no spec version; Win32_Tpm has it (e.g. "2.0, 0, 1.59")
                Arguments = "-NoProfile -Command \"$t = Get-Tpm; $c = Get-CimInstance -Namespace root/cimv2/Security/MicrosoftTpm -ClassName Win32_Tpm -ErrorAction SilentlyContinue; $t | Add-Member -NotePropertyName SpecVersion -NotePropertyValue $c.SpecVersion -PassThru | ConvertTo-Json\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            var run = ProcessRunner.Run(psi);
            if (run == null) return new TpmInfo { Error = "Failed to start PowerShell" };

            var output = run.Stdout;
            var error = run.Stderr;

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
                ManufacturerIdTxt = GetStringProp(root, "ManufacturerIdTxt"),
                ManufacturerVersion = GetStringProp(root, "ManufacturerVersion"),
                SpecVersion = GetStringProp(root, "SpecVersion")
            };
        }
        catch (Exception ex)
        {
            Log.Debug("TPM not readable: {Error}", ex.Message);
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
            Log.Warning("UAC settings not readable: {Error}", ex.Message);
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

            var run = ProcessRunner.Run(psi);
            if (run == null) return new SecureBootInfo { Supported = false };

            var output = run.Stdout.Trim();
            var error = run.Stderr;

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
        catch (Exception ex)
        {
            Log.Debug("Secure Boot not supported or not readable: {Error}", ex.Message);
            return new SecureBootInfo { Supported = false };
        }
    }

    // App Control for Business (WDAC) and VBS/HVCI/Credential Guard share Win32_DeviceGuard. Every probe below
    // fails soft: a missing class (older Windows), a missing tool or no access leaves its fields null ("unknown").
    private static DeviceGuardInfo GetDeviceGuardInfo()
    {
        try
        {
            using var searcher = Wmi.Searcher(@"root\Microsoft\Windows\DeviceGuard", "SELECT * FROM Win32_DeviceGuard");
            foreach (ManagementObject obj in searcher.Get())
            {
                return new DeviceGuardInfo
                {
                    Available = true,
                    CodeIntegrityPolicyEnforcementStatus = WmiInt(obj, "CodeIntegrityPolicyEnforcementStatus"),
                    UsermodeCodeIntegrityPolicyEnforcementStatus = WmiInt(obj, "UsermodeCodeIntegrityPolicyEnforcementStatus"),
                    VirtualizationBasedSecurityStatus = WmiInt(obj, "VirtualizationBasedSecurityStatus"),
                    SecurityServicesConfigured = WmiInts(obj, "SecurityServicesConfigured"),
                    SecurityServicesRunning = WmiInts(obj, "SecurityServicesRunning")
                };
            }
            return new DeviceGuardInfo { Error = "Win32_DeviceGuard returned no instance" };
        }
        catch (Exception ex)
        {
            Log.Debug("Device Guard (Win32_DeviceGuard) not readable: {Error}", ex.Message);
            return new DeviceGuardInfo { Error = ex.Message };
        }
    }

    private static int? WmiInt(ManagementBaseObject obj, string name)
    {
        try { return obj[name] is { } value ? Convert.ToInt32(value) : null; }
        catch { return null; }  // property missing on this Windows version
    }

    private static List<int>? WmiInts(ManagementBaseObject obj, string name)
    {
        try { return obj[name] is Array values ? values.Cast<object>().Select(Convert.ToInt32).ToList() : null; }
        catch { return null; }
    }

    private static AppControlInfo GetAppControlInfo()
    {
        var result = new AppControlInfo();
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\CI\Config");
            if (key?.GetValue("VulnerableDriverBlocklistEnable") is int blocklist)
                result.VulnerableDriverBlocklistEnable = blocklist;
        }
        catch (Exception ex)
        {
            // not readable: stays unknown
            Log.Debug("App Control: VulnerableDriverBlocklistEnable not readable: {Error}", ex.Message);
        }

        string? ciToolError = null;
        try
        {
            var policies = GetPoliciesFromCiTool();
            if (policies != null)
            {
                result.Policies = policies;
                result.PolicySource = "citool";
                return result;
            }
        }
        catch (Exception ex)
        {
            ciToolError = $"CiTool: {ex.Message}";  // e.g. timed out - fall back to the policy files
            Log.Debug("App Control: {Error}; reading the policy files", ciToolError);
        }

        try
        {
            // Multiple-policy format: one {PolicyId}.cip per active policy (no names without CiTool)
            var active = Path.Combine(Environment.SystemDirectory, "CodeIntegrity", "CiPolicies", "Active");
            if (Directory.Exists(active))
            {
                result.Policies = Directory.GetFiles(active, "*.cip")
                    .Select(f => new AppControlPolicy { PolicyId = Path.GetFileNameWithoutExtension(f) })
                    .OrderBy(p => p.PolicyId, StringComparer.OrdinalIgnoreCase)
                    .ToList();
                result.PolicySource = "files";
            }
            else
            {
                result.Error = ciToolError;
            }
        }
        catch (Exception ex)
        {
            Log.Warning("App Control policies not readable: {Error}", ciToolError ?? ex.Message);
            result.Error = ciToolError ?? ex.Message;
        }
        return result;
    }

    /// <summary>The active policies from CiTool (Windows 11 22H2, Server 2025); null without CiTool or on failure.</summary>
    private static List<AppControlPolicy>? GetPoliciesFromCiTool()
    {
        var ciTool = Path.Combine(Environment.SystemDirectory, "CiTool.exe");
        if (!File.Exists(ciTool)) return null;

        // CiTool can wait for input ("press any key"): closed stdin and a time limit
        var psi = new ProcessStartInfo { FileName = ciTool, Arguments = "--list-policies --json", RedirectStandardInput = true };
        var run = ProcessRunner.Run(psi, TimeSpan.FromSeconds(30));
        return run == null ? null : ParseCiToolPolicies(run.Stdout);
    }

    /// <summary>
    /// CiTool --list-policies --json: {"Policies":[{"PolicyID", "BasePolicyID", "FriendlyName", "VersionString",
    /// "IsSystemPolicy", "IsSignedPolicy", "IsEnforced", ...}], "OperationResult": 0}. Null when it reports a failure.
    /// </summary>
    internal static List<AppControlPolicy>? ParseCiToolPolicies(string output)
    {
        int start = output.IndexOf('{'), end = output.LastIndexOf('}');
        if (start < 0 || end < start) return null;
        using var json = JsonDocument.Parse(output[start..(end + 1)]);
        var root = json.RootElement;
        if (TryProp(root, "OperationResult", out var operation) && operation.ValueKind == JsonValueKind.Number && operation.GetInt64() != 0)
            return null;
        if (!TryProp(root, "Policies", out var policies) || policies.ValueKind != JsonValueKind.Array) return null;

        return policies.EnumerateArray().Select(p => new AppControlPolicy
        {
            PolicyId = PropText(p, "PolicyID"),
            BasePolicyId = PropText(p, "BasePolicyID"),
            FriendlyName = PropText(p, "FriendlyName"),
            Version = PropText(p, "VersionString") ?? PropText(p, "Version"),
            IsSystemPolicy = PropBool(p, "IsSystemPolicy"),
            IsSignedPolicy = PropBool(p, "IsSignedPolicy"),
            IsEnforced = PropBool(p, "IsEnforced")
        }).ToList();
    }

    private static AppLockerInfo GetAppLockerInfo()
    {
        var result = new AppLockerInfo { AppIdSvcStatus = GetServiceStatus("AppIDSvc") };
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -Command \"Get-AppLockerPolicy -Effective -Xml\""
            };
            var run = ProcessRunner.Run(psi);
            if (run == null)
            {
                result.Error = "Failed to start PowerShell";
                return result;
            }
            if (string.IsNullOrWhiteSpace(run.Stdout))
            {
                // e.g. no AppLocker module on this edition
                result.Error = run.Stderr.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "No AppLocker policy returned";
                return result;
            }
            result.Collections = ParseAppLockerPolicy(run.Stdout);
            result.Available = true;
        }
        catch (Exception ex)
        {
            Log.Warning("AppLocker policy not readable: {Error}", ex.Message);
            result.Error = ex.Message;
        }
        return result;
    }

    /// <summary>
    /// &lt;AppLockerPolicy&gt;&lt;RuleCollection Type="Exe" EnforcementMode="AuditOnly"&gt;&lt;FilePathRule/&gt;...
    /// Collections without rules are usually left out of the effective policy.
    /// </summary>
    internal static List<AppLockerCollection> ParseAppLockerPolicy(string xml)
    {
        var doc = System.Xml.Linq.XDocument.Parse(xml.Trim());
        return doc.Root!.Elements()
            .Where(e => e.Name.LocalName == "RuleCollection")
            .Select(e => new AppLockerCollection
            {
                Type = (string?)e.Attribute("Type"),
                EnforcementMode = (string?)e.Attribute("EnforcementMode"),
                RuleCount = e.Elements().Count(r => r.Name.LocalName.EndsWith("Rule", StringComparison.Ordinal))
            })
            .ToList();
    }

    private static string? GetServiceStatus(string name)
    {
        try
        {
            using var service = new System.ServiceProcess.ServiceController(name);
            return service.Status.ToString();
        }
        catch
        {
            return null;  // service does not exist (or no access)
        }
    }

    private static bool TryProp(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in element.EnumerateObject())
            {
                if (prop.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                {
                    value = prop.Value;
                    return true;
                }
            }
        }
        value = default;
        return false;
    }

    private static string? PropText(JsonElement element, string name) =>
        TryProp(element, name, out var value) && value.ValueKind is JsonValueKind.String or JsonValueKind.Number
            ? value.ToString()
            : null;

    private static bool? PropBool(JsonElement element, string name) =>
        TryProp(element, name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : null;

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
            using var searcher = Wmi.Searcher(
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
            Log.Debug("Local admins via WMI failed, trying net localgroup: {Error}", ex.Message);
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

                var run = ProcessRunner.Run(psi);
                if (run != null)
                {
                    var output = run.Stdout;

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
            catch (Exception fallbackEx)
            {
                Log.Warning("Local admins not readable (WMI: {Error}; net localgroup: {FallbackError})", ex.Message, fallbackEx.Message);
            }
        }

        return result;
    }
}
