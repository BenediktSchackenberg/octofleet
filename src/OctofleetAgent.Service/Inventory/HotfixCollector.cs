using System.Management;
using System.Runtime.InteropServices;

namespace OctofleetAgent.Service.Inventory;

public class HotfixInfo
{
    public string? KbId { get; set; }
    public string? Description { get; set; }
    public string? InstalledOn { get; set; }
    public string? InstalledBy { get; set; }
    public string? Source { get; set; }  // "WMI" or "UpdateHistory"
}

public class UpdateHistoryEntry
{
    public string? Title { get; set; }
    public string? KbId { get; set; }
    public string? Description { get; set; }
    public string? InstalledOn { get; set; }
    public string? Operation { get; set; }  // Installation, Uninstallation
    public string? ResultCode { get; set; }  // Succeeded, Failed, etc.
    public string? UpdateId { get; set; }
    public string? SupportUrl { get; set; }
    public List<string> Categories { get; set; } = new();
}

public class HotfixResult
{
    public int HotfixCount { get; set; }
    public int UpdateHistoryCount { get; set; }
    public int TotalCount { get; set; }
    public List<HotfixInfo> Hotfixes { get; set; } = new();
    public List<UpdateHistoryEntry> UpdateHistory { get; set; } = new();
    public string? Error { get; set; }
    public string? UpdateHistoryError { get; set; }
}

/// <summary>
/// Collects Windows Hotfixes via WMI AND Windows Update History via COM
/// </summary>
public static class HotfixCollector
{
    public static async Task<HotfixResult> CollectAsync()
    {
        return await Task.Run(() =>
        {
            var result = new HotfixResult();

            // 1. Collect classic hotfixes via WMI
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
                        InstalledBy = obj["InstalledBy"]?.ToString(),
                        Source = "WMI"
                    });
                }

                result.HotfixCount = result.Hotfixes.Count;
                result.Hotfixes = result.Hotfixes
                    .OrderByDescending(h => h.InstalledOn)
                    .ToList();
            }
            catch (Exception ex)
            {
                result.Error = ex.Message;
            }

            // 2. Collect Windows Update History via COM
            try
            {
                result.UpdateHistory = GetWindowsUpdateHistory();
                result.UpdateHistoryCount = result.UpdateHistory.Count;
            }
            catch (Exception ex)
            {
                result.UpdateHistoryError = ex.Message;
            }

            result.TotalCount = result.HotfixCount + result.UpdateHistoryCount;
            return result;
        });
    }

    private static List<UpdateHistoryEntry> GetWindowsUpdateHistory()
    {
        var updates = new List<UpdateHistoryEntry>();
        
        try
        {
            // Create Windows Update Session via COM
            var updateSessionType = Type.GetTypeFromProgID("Microsoft.Update.Session");
            if (updateSessionType == null) return updates;
            
            dynamic? session = Activator.CreateInstance(updateSessionType);
            if (session == null) return updates;
            
            try
            {
                dynamic searcher = session.CreateUpdateSearcher();
                int count = searcher.GetTotalHistoryCount();
                
                if (count == 0) return updates;
                
                // Get last 200 entries (or all if less)
                int queryCount = Math.Min(count, 200);
                dynamic history = searcher.QueryHistory(0, queryCount);
                
                foreach (dynamic entry in history)
                {
                    try
                    {
                        string title = entry.Title?.ToString() ?? "";
                        string? kbId = ExtractKbId(title);
                        
                        var categories = new List<string>();
                        try
                        {
                            foreach (dynamic cat in entry.Categories)
                            {
                                categories.Add(cat.Name?.ToString() ?? "");
                            }
                        }
                        catch { }
                        
                        updates.Add(new UpdateHistoryEntry
                        {
                            Title = title,
                            KbId = kbId,
                            Description = entry.Description?.ToString(),
                            InstalledOn = ParseComDate(entry.Date),
                            Operation = ParseOperation(entry.Operation),
                            ResultCode = ParseResultCode(entry.ResultCode),
                            UpdateId = entry.UpdateIdentity?.UpdateID?.ToString(),
                            SupportUrl = entry.SupportUrl?.ToString(),
                            Categories = categories
                        });
                    }
                    catch
                    {
                        // Skip problematic entries
                    }
                }
            }
            finally
            {
                if (session != null)
                    Marshal.ReleaseComObject(session);
            }
        }
        catch
        {
            // COM not available or failed
        }
        
        return updates.OrderByDescending(u => u.InstalledOn).ToList();
    }

    private static string? ExtractKbId(string title)
    {
        // Extract KB number from title like "2024-01 Cumulative Update for Windows 11 (KB5034123)"
        var match = System.Text.RegularExpressions.Regex.Match(title, @"KB(\d+)", 
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return match.Success ? $"KB{match.Groups[1].Value}" : null;
    }

    private static string ParseOperation(int operation)
    {
        return operation switch
        {
            1 => "Installation",
            2 => "Uninstallation",
            3 => "Other",
            _ => $"Unknown ({operation})"
        };
    }

    private static string ParseResultCode(int resultCode)
    {
        return resultCode switch
        {
            0 => "NotStarted",
            1 => "InProgress",
            2 => "Succeeded",
            3 => "SucceededWithErrors",
            4 => "Failed",
            5 => "Aborted",
            _ => $"Unknown ({resultCode})"
        };
    }

    private static string? ParseComDate(dynamic date)
    {
        try
        {
            if (date == null) return null;
            DateTime dt = (DateTime)date;
            return dt.ToString("yyyy-MM-dd HH:mm:ss");
        }
        catch
        {
            return null;
        }
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
