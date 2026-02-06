using System.Management;

namespace OpenClawAgent.Service.Inventory;

public class HotfixInfo
{
    public string? KbId { get; set; }
    public string? Description { get; set; }
    public string? InstalledOn { get; set; }
    public string? InstalledBy { get; set; }
}

public class HotfixResult
{
    public int Count { get; set; }
    public List<HotfixInfo> Hotfixes { get; set; } = new();
    public string? Error { get; set; }
}

/// <summary>
/// Collects Windows Hotfixes/Updates via WMI
/// </summary>
public static class HotfixCollector
{
    public static async Task<HotfixResult> CollectAsync()
    {
        return await Task.Run(() =>
        {
            var result = new HotfixResult();

            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_QuickFixEngineering");
                
                foreach (ManagementObject obj in searcher.Get())
                {
                    var hotfixId = obj["HotFixID"]?.ToString();
                    if (string.IsNullOrEmpty(hotfixId)) continue;

                    result.Hotfixes.Add(new HotfixInfo
                    {
                        KbId = hotfixId,
                        Description = obj["Description"]?.ToString(),
                        InstalledOn = ParseDate(obj["InstalledOn"]?.ToString()),
                        InstalledBy = obj["InstalledBy"]?.ToString()
                    });
                }

                result.Count = result.Hotfixes.Count;
                result.Hotfixes = result.Hotfixes
                    .OrderByDescending(h => h.InstalledOn)
                    .ToList();
            }
            catch (Exception ex)
            {
                result.Error = ex.Message;
            }

            return result;
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
