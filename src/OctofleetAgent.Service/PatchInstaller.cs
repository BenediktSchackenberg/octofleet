using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace OctofleetAgent.Service;

/// <summary>
/// Installs Windows Updates via the WUA COM API (Microsoft.Update.Session).
/// Called by JobPoller when command_type is "patch_install".
/// </summary>
public static class PatchInstaller
{
    private static readonly TimeSpan InstallTimeout = TimeSpan.FromMinutes(30);

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
                    string? kb = ExtractKbId(title);
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
                dynamic installResult = installer.Install();

                int instResultCode = (int)installResult.ResultCode;
                result.RebootRequired = (bool)installResult.RebootRequired;

                for (int i = 0; i < (int)toInstall.Count; i++)
                {
                    dynamic upd = toInstall.Item(i);
                    string title = upd.Title?.ToString() ?? "";
                    string? kb = ExtractKbId(title);
                    if (kb == null) continue;

                    int itemCode = (int)installResult.GetUpdateResult(i).ResultCode;
                    if (itemCode == 2) // succeeded
                    {
                        result.InstalledKBs.Add(kb);
                        logger.LogInformation("PatchInstaller: Installed {KB}", kb);
                    }
                    else
                    {
                        result.FailedKBs.Add(kb);
                        logger.LogWarning("PatchInstaller: Failed {KB} (code {Code})", kb, itemCode);
                    }
                }

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
                    if (DateTime.TryParse(rebootScheduleTime, out var scheduled))
                    {
                        var delay = (int)Math.Max((scheduled - DateTime.UtcNow).TotalSeconds, 60);
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

    private static string? ExtractKbId(string title)
    {
        var match = System.Text.RegularExpressions.Regex.Match(title, @"KB(\d+)",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return match.Success ? $"KB{match.Groups[1].Value}" : null;
    }
}

public class PatchInstallResult
{
    public bool Success { get; set; }
    public bool RebootRequired { get; set; }
    public List<string> InstalledKBs { get; set; } = new();
    public List<string> FailedKBs { get; set; } = new();
    public string? ErrorMessage { get; set; }

    public string ToJson() => JsonSerializer.Serialize(new
    {
        installed = InstalledKBs,
        failed = FailedKBs,
        reboot_required = RebootRequired,
        error = ErrorMessage
    });
}
