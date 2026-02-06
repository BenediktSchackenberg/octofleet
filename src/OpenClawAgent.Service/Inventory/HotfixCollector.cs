using System.Management;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects Windows Hotfixes/Updates via WMI
/// </summary>
public static class HotfixCollector
{
    public static async Task<object> CollectAsync()
    {
        return await Task.Run(() =>
        {
            var hotfixes = new List<object>();

            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_QuickFixEngineering");
                
                foreach (ManagementObject obj in searcher.Get())
                {
                    var hotfixId = obj["HotFixID"]?.ToString();
                    if (string.IsNullOrEmpty(hotfixId)) continue;

                    hotfixes.Add(new
                    {
                        kbId = hotfixId,
                        description = obj["Description"]?.ToString(),
                        installedOn = ParseDate(obj["InstalledOn"]?.ToString()),
                        installedBy = obj["InstalledBy"]?.ToString()
                    });
                }
            }
            catch (Exception ex)
            {
                return new { error = ex.Message, hotfixes = hotfixes };
            }

            return new
            {
                count = hotfixes.Count,
                hotfixes = hotfixes.OrderByDescending(h => ((dynamic)h).installedOn).ToList()
            };
        });
    }

    private static string? ParseDate(string? dateStr)
    {
        if (string.IsNullOrEmpty(dateStr)) return null;
        
        // WMI sometimes returns dates in different formats
        if (DateTime.TryParse(dateStr, out var date))
        {
            return date.ToString("yyyy-MM-dd");
        }
        
        return dateStr;
    }
}
