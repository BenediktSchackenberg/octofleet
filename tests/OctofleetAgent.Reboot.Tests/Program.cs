using System.Text.Json;
using OctofleetAgent.Service;

// Self-contained checks for the reboot job's payload and shutdown.exe arguments.
var failures = 0;
void Assert(bool condition, string description)
{
    Console.WriteLine($"{(condition ? "PASS" : "FAIL")}  {description}");
    if (!condition) failures++;
}

var now = new DateTimeOffset(2026, 11, 23, 10, 0, 0, TimeSpan.Zero);
RebootRequest? Parse(string json, out string? error) => RebootRequest.Parse(JsonDocument.Parse(json).RootElement, now, out error);

var r = Parse("""{"action":"reboot","at":"2026-11-23T10:01:00Z","message":null}""", out var e);
Assert(r is { Cancel: false, DelaySeconds: 60 } && e == null, "now: in a minute");
Assert(r!.Message == RebootRequest.DefaultMessage, "no message: the default one");
Assert(string.Join(" ", r.ShutdownArguments()) == "/r /t 60 /d p:0:0 /c Octofleet: this machine restarts", "shutdown /r /t 60 as a planned restart");

r = Parse("""{"action":"reboot","at":"2026-11-23T11:30:00+01:00","message":"Updates"}""", out _);
Assert(r!.DelaySeconds == 30 * 60, "a time with offset: seconds until then (30 min)");
Assert(r.ShutdownArguments()[^1] == "Updates", "the message is one argument");

r = Parse("""{"action":"reboot","at":"2026-11-23T09:00:00Z"}""", out _);
Assert(r!.DelaySeconds == RebootRequest.MinDelaySeconds, "a past time: in a minute, never at once");
r = Parse("""{"action":"reboot","at":"2027-11-23T09:00:00Z"}""", out _);
Assert(r!.DelaySeconds == RebootRequest.MaxDelaySeconds, "far ahead: capped");
r = Parse("""{"action":"reboot"}""", out _);
Assert(r!.DelaySeconds == 60, "no time: in a minute");

r = Parse("""{"action":"reboot","message":"Save\nyour\u0007 work  "}""", out _);
Assert(r!.Message == "Save your work", "control characters removed");
r = Parse("{\"action\":\"reboot\",\"message\":\"" + new string('x', 300) + "\"}", out _);
Assert(r!.Message.Length == 200, "message cut to 200 characters");

r = Parse("""{"action":"cancel"}""", out _);
Assert(r is { Cancel: true } && string.Join(" ", r.ShutdownArguments()) == "/a", "cancel: shutdown /a");

Assert(Parse("""{"action":"format"}""", out e) == null && e!.Contains("format"), "unknown action rejected");
Assert(Parse("""{"action":"reboot","at":"soon"}""", out e) == null && e!.Contains("invalid time"), "invalid time rejected");

Console.WriteLine(failures == 0 ? "All reboot tests passed" : $"{failures} test(s) failed");
return failures == 0 ? 0 : 1;
