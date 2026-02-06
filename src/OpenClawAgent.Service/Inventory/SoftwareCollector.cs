using Microsoft.Win32;

namespace OpenClawAgent.Service.Inventory;

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

    public static async Task<object> CollectAsync()
    {
        return await Task.Run(() =>
        {
            var software = new List<object>();
            var seen = new HashSet<string>(); // Dedupe by name+version

            foreach (var keyPath in UninstallKeys)
            {
                CollectFromKey(RegistryHive.LocalMachine, keyPath, software, seen);
            }

            // Also check HKCU for user-installed apps
            CollectFromKey(RegistryHive.CurrentUser, UninstallKeys[0], software, seen);

            return new
            {
                count = software.Count,
                software = software.OrderBy(s => ((dynamic)s).name).ToList()
            };
        });
    }

    private static void CollectFromKey(RegistryHive hive, string keyPath, List<object> software, HashSet<string> seen)
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
                    
                    software.Add(new
                    {
                        name = displayName.Trim(),
                        version = version?.Trim(),
                        publisher = subKey.GetValue("Publisher")?.ToString()?.Trim(),
                        installDate = installDate,
                        installPath = subKey.GetValue("InstallLocation")?.ToString()?.Trim(),
                        sizeMB = estimatedSize != null 
                            ? Math.Round(Convert.ToInt64(estimatedSize) / 1024.0, 2) 
                            : (double?)null,
                        uninstallString = subKey.GetValue("UninstallString")?.ToString(),
                        registryKey = $"{hive}\\{keyPath}\\{subKeyName}"
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
