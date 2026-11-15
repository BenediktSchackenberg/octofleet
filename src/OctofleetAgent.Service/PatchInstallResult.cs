using System.Text.Json;

namespace OctofleetAgent.Service;

/// <summary>An update's result: the WUA result code (2 succeeded, 3 with errors, 4 failed, 5 aborted),
/// its HRESULT, and where it comes from ("installer" or "history")</summary>
public record PatchDetail(int ResultCode, int HResult, string Source);

/// <summary>An entry of the Windows Update history (IUpdateHistoryEntry); Operation 1 = installation</summary>
public record PatchHistoryEntry(string? Kb, DateTime DateUtc, int Operation, int ResultCode, int HResult);

public class PatchInstallResult
{
    public bool Success { get; set; }
    public bool RebootRequired { get; set; }
    public List<string> InstalledKBs { get; set; } = new();
    public List<string> FailedKBs { get; set; } = new();
    /// <summary>Per KB: result code and HRESULT</summary>
    public Dictionary<string, PatchDetail> Details { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public string? ErrorMessage { get; set; }
    /// <summary>Result of the update search after the installation (null: not run)</summary>
    public string? SearchAfter { get; set; }

    public string ToJson() => JsonSerializer.Serialize(new
    {
        installed = InstalledKBs,
        failed = FailedKBs,
        reboot_required = RebootRequired,
        error = ErrorMessage,
        search_after = SearchAfter,
        details = Details.ToDictionary(d => d.Key, d => new
        {
            result_code = d.Value.ResultCode,
            hresult = $"0x{d.Value.HResult:X8}",
            source = d.Value.Source,
            hint = PatchInstallCheck.Hint(d.Value.HResult),
        }),
    });
}

public static class PatchInstallCheck
{
    public const int Failed = 4, Aborted = 5;
    /// <summary>CBS_E_NEW_SERVICING_STACK_REQUIRED</summary>
    public const int NewServicingStackRequired = unchecked((int)0x800F0823);

    /// <summary>
    /// The installer can report an update as installed while the Windows Update history records it as
    /// failed - e.g. a cumulative update whose newer servicing stack Windows installs first
    /// (0x800F0823): it needs a restart and is offered again afterwards. Such KBs move to the failed
    /// ones, with the history's HRESULT; the error message names them.
    /// </summary>
    public static void ApplyHistory(PatchInstallResult result, IEnumerable<PatchHistoryEntry> history, DateTime sinceUtc)
    {
        var entries = history.ToList();
        var messages = new List<string>();
        foreach (var kb in result.InstalledKBs.ToList())
        {
            var entry = entries
                .Where(h => h.Operation == 1 && h.DateUtc >= sinceUtc && string.Equals(h.Kb, kb, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(h => h.DateUtc)
                .FirstOrDefault();
            if (entry == null || (entry.ResultCode != Failed && entry.ResultCode != Aborted)) continue;
            result.InstalledKBs.Remove(kb);
            result.FailedKBs.Add(kb);
            result.Details[kb] = new PatchDetail(entry.ResultCode, entry.HResult, "history");
            messages.Add($"{kb}: 0x{entry.HResult:X8}" + (Hint(entry.HResult) is string hint ? $" – {hint}" : ""));
        }
        if (messages.Count > 0)
            result.ErrorMessage = string.Join("; ", new[] { result.ErrorMessage }.Where(m => !string.IsNullOrEmpty(m)).Concat(messages));
        result.Success = result.FailedKBs.Count == 0;
    }

    /// <summary>A short explanation for HRESULTs that need an action</summary>
    public static string? Hint(int hresult) => hresult switch
    {
        NewServicingStackRequired => "Windows installed a newer servicing stack first; restart the node and install this update again",
        _ => null,
    };
}
