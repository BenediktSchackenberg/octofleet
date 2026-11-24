using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OctofleetAgent.Service;

/// <summary>
/// The console's `reboot` job: {"action": "reboot", "at": UTC ISO time, "message": "..."} restarts the
/// machine at that time (at the earliest in a minute, so the job result reaches the server first)
/// with shutdown.exe, which warns logged-on users with the message and can be withdrawn;
/// {"action": "cancel"} withdraws it (shutdown /a, also a reboot an update installation scheduled).
/// Only parsing and the shutdown.exe arguments live here, so they can be tested off Windows.
/// </summary>
public sealed record RebootRequest(bool Cancel, int DelaySeconds, string Message)
{
    public const int MinDelaySeconds = 60;
    // shutdown /t takes at most 10 years; the server allows 7 days
    public const int MaxDelaySeconds = 7 * 24 * 3600 + 3600;
    public const string DefaultMessage = "Octofleet: this machine restarts";
    // shutdown.exe: "A system shutdown has already been scheduled"
    public const int AlreadyScheduled = 1190;

    /// <summary>Null with a reason when the payload is not a valid reboot request.</summary>
    public static RebootRequest? Parse(JsonElement payload, DateTimeOffset now, out string? error)
    {
        error = null;
        var action = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("action", out var a) && a.ValueKind == JsonValueKind.String
            ? a.GetString() : "reboot";
        if (action == "cancel")
            return new RebootRequest(true, 0, "");
        if (action != "reboot")
        {
            error = $"Unknown reboot action: {action}";
            return null;
        }
        var delay = MinDelaySeconds;
        if (payload.TryGetProperty("at", out var at) && at.ValueKind == JsonValueKind.String)
        {
            if (!DateTimeOffset.TryParse(at.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var when))
            {
                error = $"Reboot: invalid time '{at.GetString()}'";
                return null;
            }
            delay = (int)Math.Clamp(Math.Ceiling((when - now).TotalSeconds), MinDelaySeconds, MaxDelaySeconds);
        }
        var message = payload.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? "" : "";
        message = Regex.Replace(message, @"[\x00-\x1f\x7f\s]+", " ").Trim();
        if (message.Length > 200) message = message[..200];
        return new RebootRequest(false, delay, message.Length == 0 ? DefaultMessage : message);
    }

    /// <summary>shutdown.exe arguments: a planned restart ("Other (Planned)") after the delay, or abort.</summary>
    public IReadOnlyList<string> ShutdownArguments() => Cancel
        ? new[] { "/a" }
        : new[] { "/r", "/t", DelaySeconds.ToString(CultureInfo.InvariantCulture), "/d", "p:0:0", "/c", Message };
}
