using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace OctofleetAgent.Service;

/// <summary>
/// Installs Windows Updates via the WUA COM API (Microsoft.Update.Session).
/// Called by JobPoller when command_type is "patch_install".
/// </summary>
public static class PatchInstaller
{
    /// <summary>Default time limit of a patch_install job (the installation itself is never stopped)</summary>
    public static readonly TimeSpan InstallTimeout = TimeSpan.FromMinutes(30);

    public static async Task<PatchInstallResult> InstallPatchesAsync(
        List<string> kbIds, string rebootPolicy, string? rebootScheduleTime,
        ILogger logger, CancellationToken ct)
    {
        logger.LogInformation("PatchInstaller: Installing {Count} patches: {KBs}", kbIds.Count, string.Join(", ", kbIds));

        var result = new PatchInstallResult();

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            result.ErrorMessage = "PatchInstaller only runs on Windows";
            return result;
        }

        // COM calls on a dedicated thread
        await Task.Run(() =>
        {
            dynamic? session = null;
            try
            {
                var sessionType = Type.GetTypeFromProgID("Microsoft.Update.Session");
                if (sessionType == null)
                {
                    result.ErrorMessage = "Windows Update Session COM not available";
                    return;
                }

                session = Activator.CreateInstance(sessionType);
                if (session == null) { result.ErrorMessage = "Failed to create Update Session"; return; }

                // --- Search ---
                logger.LogInformation("PatchInstaller: Searching for updates...");
                dynamic searcher = session.CreateUpdateSearcher();
                dynamic searchResult = searcher.Search("IsInstalled=0 AND IsHidden=0");

                // Filter to requested KB IDs
                var kbSet = new HashSet<string>(kbIds, StringComparer.OrdinalIgnoreCase);

                // Build collection of matching updates
                var updateCollType = Type.GetTypeFromProgID("Microsoft.Update.UpdateColl");
                dynamic toDownload = Activator.CreateInstance(updateCollType!)!;
                dynamic toInstall = Activator.CreateInstance(updateCollType!)!;

                var matched = new Dictionary<string, string>(); // kb -> title
                foreach (dynamic update in searchResult.Updates)
                {
                    string title = update.Title?.ToString() ?? "";
                    string? kb = UpdateKey(update);
                    if (kb != null && kbSet.Contains(kb))
                    {
                        // Accept EULA if needed
                        try { if (!update.EulaAccepted) update.AcceptEula(); } catch { }

                        toDownload.Add(update);
                        toInstall.Add(update);
                        matched[kb] = title;
                        logger.LogInformation("PatchInstaller: Matched {KB} — {Title}", kb, title);
                    }
                }

                // Report unmatched
                foreach (var kb in kbSet)
                {
                    if (!matched.ContainsKey(kb))
                    {
                        result.FailedKBs.Add(kb);
                        logger.LogWarning("PatchInstaller: KB {KB} not found in available updates", kb);
                    }
                }

                if ((int)toInstall.Count == 0)
                {
                    result.ErrorMessage = result.FailedKBs.Count > 0
                        ? $"None of the requested KBs found in available updates: {string.Join(", ", result.FailedKBs)}"
                        : "No matching updates to install";
                    return;
                }

                // --- Download ---
                logger.LogInformation("PatchInstaller: Downloading {Count} updates...", (int)toDownload.Count);
                dynamic downloader = session.CreateUpdateDownloader();
                downloader.Updates = toDownload;
                dynamic downloadResult = downloader.Download();

                int dlResultCode = (int)downloadResult.ResultCode;
                // orcSucceeded=2, orcSucceededWithErrors=3
                if (dlResultCode != 2 && dlResultCode != 3)
                {
                    result.ErrorMessage = $"Download failed with result code {dlResultCode}";
                    foreach (var kb in matched.Keys) result.FailedKBs.Add(kb);
                    return;
                }
                logger.LogInformation("PatchInstaller: Download complete (code {Code})", dlResultCode);

                // --- Install ---
                logger.LogInformation("PatchInstaller: Installing {Count} updates...", (int)toInstall.Count);
                dynamic installer = session.CreateUpdateInstaller();
                installer.Updates = toInstall;
                var installStart = DateTime.UtcNow;
                dynamic installResult = installer.Install();

                int instResultCode = (int)installResult.ResultCode;
                result.RebootRequired = (bool)installResult.RebootRequired;

                for (int i = 0; i < (int)toInstall.Count; i++)
                {
                    dynamic upd = toInstall.Item(i);
                    string title = upd.Title?.ToString() ?? "";
                    string? kb = UpdateKey(upd);
                    if (kb == null) continue;

                    dynamic updateResult = installResult.GetUpdateResult(i);
                    int itemCode = (int)updateResult.ResultCode;
                    int itemHResult = (int)updateResult.HResult;
                    result.Details[kb] = new PatchDetail(itemCode, itemHResult, "installer");
                    if (itemCode == 2) // succeeded
                    {
                        result.InstalledKBs.Add(kb);
                        logger.LogInformation("PatchInstaller: Installed {KB}", kb);
                    }
                    else
                    {
                        result.FailedKBs.Add(kb);
                        logger.LogWarning("PatchInstaller: Failed {KB} (code {Code}, 0x{HResult:X8})", kb, itemCode, itemHResult);
                    }
                }

                // The installer can report success while the update history records a failure (e.g.
                // 0x800F0823: Windows installed a newer servicing stack first; the update is offered
                // again after the restart) - the history decides
                PatchInstallCheck.ApplyHistory(result, ReadHistory(searcher, logger), installStart.AddMinutes(-1));
                foreach (var kb in result.FailedKBs)
                    if (result.Details.TryGetValue(kb, out var d) && d.Source == "history")
                        logger.LogWarning("PatchInstaller: {KB} reported as installed, but the update history says failed (0x{HResult:X8})", kb, d.HResult);
                result.Success = result.FailedKBs.Count == 0;
                logger.LogInformation("PatchInstaller: Done. Installed={Installed}, Failed={Failed}, RebootRequired={Reboot}",
                    result.InstalledKBs.Count, result.FailedKBs.Count, result.RebootRequired);
            }
            catch (COMException ex)
            {
                result.ErrorMessage = $"COM error: 0x{ex.HResult:X8} — {ex.Message}";
                logger.LogError(ex, "PatchInstaller COM error");
            }
            catch (Exception ex)
            {
                result.ErrorMessage = ex.Message;
                logger.LogError(ex, "PatchInstaller error");
            }
            finally
            {
                if (session != null)
                    try { Marshal.ReleaseComObject(session); } catch { }
            }
        }, ct);

        // --- Reboot policy ---
        if (result.RebootRequired)
        {
            switch (rebootPolicy?.ToLowerInvariant())
            {
                case "force":
                    logger.LogInformation("PatchInstaller: Forcing reboot in 60s");
                    StartReboot(60);
                    break;
                case "schedule" when !string.IsNullOrEmpty(rebootScheduleTime):
                    // DateTimeOffset keeps the time's offset ("…Z", "+01:00"); DateTime.TryParse turned it
                    // into local time, compared with UtcNow - an hour off on a UTC+1 machine
                    if (DateTimeOffset.TryParse(rebootScheduleTime, System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.AssumeUniversal, out var scheduled))
                    {
                        var delay = (int)Math.Max((scheduled - DateTimeOffset.UtcNow).TotalSeconds, 60);
                        logger.LogInformation("PatchInstaller: Scheduling reboot in {Delay}s", delay);
                        StartReboot(delay);
                    }
                    break;
                default: // no_reboot
                    logger.LogInformation("PatchInstaller: Reboot required but policy is no_reboot");
                    break;
            }
        }

        return result;
    }

    private static void StartReboot(int delaySec)
    {
        try
        {
            var psi = new ProcessStartInfo("shutdown.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("/r");
            psi.ArgumentList.Add("/t");
            psi.ArgumentList.Add(delaySec.ToString());
            psi.ArgumentList.Add("/c");
            psi.ArgumentList.Add("Octofleet Agent: Reboot after patch installation");
            Process.Start(psi);
        }
        catch { /* best effort */ }
    }

    /// <summary>The newest 50 entries of the Windows Update history (empty if it cannot be read)</summary>
    private static List<PatchHistoryEntry> ReadHistory(dynamic searcher, ILogger logger)
    {
        var entries = new List<PatchHistoryEntry>();
        try
        {
            int count = (int)searcher.GetTotalHistoryCount();
            if (count == 0) return entries;
            dynamic history = searcher.QueryHistory(0, Math.Min(count, 50));
            for (int i = 0; i < (int)history.Count; i++)
            {
                dynamic entry = history.Item(i);
                string title = entry.Title?.ToString() ?? "";
                // IUpdateHistoryEntry.Date is UTC
                entries.Add(new PatchHistoryEntry(ExtractKbId(title), DateTime.SpecifyKind((DateTime)entry.Date, DateTimeKind.Utc),
                    (int)entry.Operation, (int)entry.ResultCode, (int)entry.HResult));
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "PatchInstaller: could not read the update history");
        }
        return entries;
    }

    private static string? ExtractKbId(string title)
    {
        var match = System.Text.RegularExpressions.Regex.Match(title, @"KB(\d+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return match.Success ? $"KB{match.Groups[1].Value}" : null;
    }

    // The scanner lists updates without a KB as UPDATE-<first eight characters of UpdateID>.
    // Accept that key when the user selects such an update on the node page.
    private static string? UpdateKey(dynamic update)
    {
        string title = update.Title?.ToString() ?? "";
        var kb = ExtractKbId(title);
        if (kb != null) return kb;
        try
        {
            string? id = update.Identity.UpdateID?.ToString();
            return string.IsNullOrEmpty(id) ? null : $"UPDATE-{id[..Math.Min(8, id.Length)]}";
        }
        catch { return null; }
    }
}
