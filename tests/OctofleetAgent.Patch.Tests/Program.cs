using System.Text.Json;
using OctofleetAgent.Service;

// Patch installation results: the Windows Update history overrides a reported success
var start = new DateTime(2026, 11, 15, 14, 42, 0, DateTimeKind.Utc);

PatchInstallResult Installed(params string[] kbs)
{
    var r = new PatchInstallResult { RebootRequired = true, Success = true };
    foreach (var kb in kbs) { r.InstalledKBs.Add(kb); r.Details[kb] = new PatchDetail(2, 0, "installer"); }
    return r;
}

// A cumulative update reported as installed, failed in the history with 0x800F0823 (servicing stack first)
var r1 = Installed("KB5136489", "KB890830");
PatchInstallCheck.ApplyHistory(r1, new[]
{
    new PatchHistoryEntry("KB5136489", start.AddMinutes(2), 1, 4, unchecked((int)0x800F0823)),
    new PatchHistoryEntry("KB890830", start.AddMinutes(1), 1, 2, 0),
}, start);
Assert(!r1.Success, "a KB the history marks as failed fails the installation");
Assert(r1.InstalledKBs.SequenceEqual(new[] { "KB890830" }) && r1.FailedKBs.SequenceEqual(new[] { "KB5136489" }), "only that KB moves to the failed ones");
Assert(r1.Details["KB5136489"] == new PatchDetail(4, unchecked((int)0x800F0823), "history"), "the history's HRESULT is kept");
Assert(r1.ErrorMessage?.Contains("0x800F0823") == true && r1.ErrorMessage.Contains("install this update again"), "the error names the code and what to do");
Assert(r1.RebootRequired, "the restart is still required");
var json = JsonDocument.Parse(r1.ToJson()).RootElement;
Assert(json.GetProperty("details").GetProperty("KB5136489").GetProperty("hresult").GetString() == "0x800F0823", "the JSON has the HRESULT");
Assert(json.GetProperty("details").GetProperty("KB5136489").GetProperty("hint").GetString() != null, "the JSON has the hint");
Assert(json.GetProperty("details").GetProperty("KB890830").GetProperty("hint").ValueKind == JsonValueKind.Null, "no hint for a success");

// Older history entries and other operations do not count; the newest entry of a KB wins
var r2 = Installed("KB5136489");
PatchInstallCheck.ApplyHistory(r2, new[]
{
    new PatchHistoryEntry("KB5136489", start.AddDays(-30), 1, 4, unchecked((int)0x80070005)),
    new PatchHistoryEntry("KB5136489", start.AddMinutes(1), 2, 4, unchecked((int)0x80070005)), // uninstallation
}, start);
Assert(r2.Success && r2.FailedKBs.Count == 0 && r2.ErrorMessage == null, "entries before the installation or of another operation are ignored");
var r3 = Installed("KB5136489");
PatchInstallCheck.ApplyHistory(r3, new[]
{
    new PatchHistoryEntry("KB5136489", start.AddMinutes(1), 1, 4, unchecked((int)0x800F0823)),
    new PatchHistoryEntry("KB5136489", start.AddMinutes(5), 1, 2, 0),
}, start);
Assert(r3.Success, "the newest entry of a KB decides");

// An unreadable history (no entries) keeps the installer's result
var r4 = Installed("KB5136489");
PatchInstallCheck.ApplyHistory(r4, Array.Empty<PatchHistoryEntry>(), start);
Assert(r4.Success && r4.InstalledKBs.Count == 1, "without history the installer's result stays");

Console.WriteLine("Patch install result tests passed");

static void Assert(bool condition, string message)
{
    if (!condition) throw new Exception($"FAILED: {message}");
    Console.WriteLine($"ok - {message}");
}
