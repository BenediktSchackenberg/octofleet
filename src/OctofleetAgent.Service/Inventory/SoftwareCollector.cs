using Microsoft.Win32;

namespace OctofleetAgent.Service.Inventory;

public class SoftwareItem
{
    public string Name { get; set; } = "";
    public string? Version { get; set; }
    public string? Publisher { get; set; }
    public string? InstallDate { get; set; }
    public string? InstallPath { get; set; }
    public double? SizeMB { get; set; }
    public string? UninstallString { get; set; }
    public string? RegistryKey { get; set; }
    // E1-05: MSI Product Codes for detection rules
    public string? ProductCode { get; set; }
    public bool IsMsi { get; set; }
}

public class SoftwareResult
{
    public int Count { get; set; }
    public List<SoftwareItem> Software { get; set; } = new();
}

/// <summary>
/// Collects installed software from Windows Registry
/// </summary>
public static class SoftwareCollector
{
    private static readonly string[] UninstallKeys = new[]
    {
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
    };

    public static async Task<SoftwareResult> CollectAsync()
    {
        return await Task.Run(() =>
        {
            var software = new List<SoftwareItem>();
            var seen = new HashSet<string>(); // Dedupe by name+version

            foreach (var keyPath in UninstallKeys)
            {
                CollectFromKey(RegistryHive.LocalMachine, keyPath, software, seen);
            }

            // Also check HKCU for user-installed apps
            CollectFromKey(RegistryHive.CurrentUser, UninstallKeys[0], software, seen);

            return new SoftwareResult
            {
                Count = software.Count,
                Software = software.OrderBy(s => s.Name).ToList()
            };
        });
    }

    private static void CollectFromKey(RegistryHive hive, string keyPath, List<SoftwareItem> software, HashSet<string> seen)
    {
        try
        {
            using var baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default);
            using var key = baseKey.OpenSubKey(keyPath);
            
            if (key == null) return;

            foreach (var subKeyName in key.GetSubKeyNames())
            {
                try
                {
                    using var subKey = key.OpenSubKey(subKeyName);
                    if (subKey == null) continue;

                    var displayName = subKey.GetValue("DisplayName")?.ToString();
                    if (string.IsNullOrWhiteSpace(displayName)) continue;

                    // Skip system components
                    var systemComponent = subKey.GetValue("SystemComponent");
                    if (systemComponent != null && Convert.ToInt32(systemComponent) == 1) continue;

                    var version = subKey.GetValue("DisplayVersion")?.ToString();
                    var dedupeKey = $"{displayName}|{version}";
                    
                    if (seen.Contains(dedupeKey)) continue;
                    seen.Add(dedupeKey);

                    var installDate = ParseInstallDate(subKey.GetValue("InstallDate")?.ToString());
                    var estimatedSize = subKey.GetValue("EstimatedSize");
                    var uninstallString = subKey.GetValue("UninstallString")?.ToString();
                    
                    // E1-05: Detect MSI and extract Product Code
                    // MSI product codes are stored as the registry key name when it's a GUID
                    // Format: {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
                    var isMsi = false;
                    string? productCode = null;
                    
                    if (IsValidGuid(subKeyName))
                    {
                        isMsi = true;
                        productCode = subKeyName;
                    }
                    else if (uninstallString != null && uninstallString.Contains("msiexec", StringComparison.OrdinalIgnoreCase))
                    {
                        isMsi = true;
                        // Try to extract product code from uninstall string
                        // Example: MsiExec.exe /I{GUID} or MsiExec.exe /X{GUID}
                        productCode = ExtractGuidFromString(uninstallString);
                    }
                    
                    software.Add(new SoftwareItem
                    {
                        Name = displayName.Trim(),
                        Version = version?.Trim(),
                        Publisher = subKey.GetValue("Publisher")?.ToString()?.Trim(),
                        InstallDate = installDate,
                        InstallPath = subKey.GetValue("InstallLocation")?.ToString()?.Trim(),
                        SizeMB = estimatedSize != null 
                            ? Math.Round(Convert.ToInt64(estimatedSize) / 1024.0, 2) 
                            : null,
                        UninstallString = uninstallString,
                        RegistryKey = $"{hive}\\{keyPath}\\{subKeyName}",
                        IsMsi = isMsi,
                        ProductCode = productCode
                    });
                }
                catch
                {
                    // Skip entries we can't read
                }
            }
        }
        catch
        {
            // Skip keys we can't access
        }
    }
    
    private static bool IsValidGuid(string s)
    {
        return s.StartsWith("{") && s.EndsWith("}") && Guid.TryParse(s, out _);
    }
    
    private static string? ExtractGuidFromString(string s)
    {
        // Look for GUID pattern in string
        var start = s.IndexOf('{');
        var end = s.IndexOf('}');
        
        if (start >= 0 && end > start)
        {
            var potential = s.Substring(start, end - start + 1);
            if (Guid.TryParse(potential, out _))
            {
                return potential;
            }
        }
        
        return null;
    }

    private static string? ParseInstallDate(string? dateStr)
    {
        if (string.IsNullOrEmpty(dateStr) || dateStr.Length != 8) return null;
        
        try
        {
            var year = dateStr.Substring(0, 4);
            var month = dateStr.Substring(4, 2);
            var day = dateStr.Substring(6, 2);
            return $"{year}-{month}-{day}";
        }
        catch
        {
            return null;
        }
    }
}
