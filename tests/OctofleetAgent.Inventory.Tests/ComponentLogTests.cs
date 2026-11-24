using OctofleetAgent.Service;
using Serilog;
using Serilog.Events;
using Serilog.Parsing;

/// <summary>Per-component logs (#330): CMTrace lines, component mapping, levels, files and rotation.</summary>
static class ComponentLogTests
{
    public static void Run(string root)
    {
        // CMTrace line: time with the bias (UTC - local, in minutes), US date, type 2 for a warning
        var warning = Event(LogEventLevel.Warning, "OctofleetAgent.Service.PatchScanner",
            new DateTimeOffset(2026, 11, 15, 16, 26, 4, 561, TimeSpan.FromHours(1)),
            "Update {KB} failed with {HResult}", ("KB", "KB5034123"), ("HResult", "0x80240022"));
        var line = LogComponents.FormatCMTrace(warning, "Updates", 7);
        Assert(line == "<![LOG[Update KB5034123 failed with 0x80240022]LOG]!><time=\"16:26:04.561-060\" date=\"11-15-2026\" "
            + "component=\"Updates\" context=\"\" type=\"2\" thread=\"7\" file=\"PatchScanner\">" + Environment.NewLine,
            "CMTrace line has message, time with bias, date, component, type, thread and class");

        var west = Event(LogEventLevel.Information, null, new DateTimeOffset(2026, 1, 2, 3, 4, 5, 6, TimeSpan.FromHours(-8)), "Started");
        Assert(LogComponents.FormatCMTrace(west, "Agent", 1).Contains("<time=\"03:04:05.006+480\" date=\"01-02-2026\"")
            && LogComponents.FormatCMTrace(west, "Agent", 1).Contains("type=\"1\"")
            && LogComponents.FormatCMTrace(west, "Agent", 1).Contains("file=\"\""),
            "CMTrace time zone bias is positive west of UTC; information is type 1");

        var error = new LogEvent(DateTimeOffset.Now, LogEventLevel.Error, new InvalidOperationException("boom"),
            new MessageTemplateParser().Parse("Bad ]LOG]!> marker"), Array.Empty<LogEventProperty>());
        var errorLine = LogComponents.FormatCMTrace(error, "Jobs", 1);
        Assert(errorLine.Contains("type=\"3\"") && errorLine.Contains("InvalidOperationException: boom")
            && errorLine.IndexOf("]LOG]!>", StringComparison.Ordinal) == errorLine.LastIndexOf("]LOG]!>", StringComparison.Ordinal),
            "Errors are type 3 with the exception; the end marker in a message cannot cut the line");

        Assert(LogComponents.FormatText(Enriched(warning)).Contains("[WRN] [Updates] Update KB5034123 failed with 0x80240022"),
            "Text format carries level and component");

        // Component mapping by logger name
        var mapping = new (string? Source, string Component)[]
        {
            ("OctofleetAgent.Service.Inventory.BrowserCollector", "Inventory"),
            ("OctofleetAgent.Service.InventoryScheduler", "Inventory"),
            ("OctofleetAgent.Service.Packages.PackageManager", "Jobs"),
            ("OctofleetAgent.Service.JobPoller", "Jobs"),
            ("OctofleetAgent.Service.DeploymentPoller", "Jobs"),
            ("OctofleetAgent.Service.PatchScanner", "Updates"),
            ("OctofleetAgent.Service.PatchInstaller", "Updates"),
            ("OctofleetAgent.Service.RemediationPoller", "Remediation"),
            ("OctofleetAgent.Service.ServiceReconciliationPoller", "Remediation"),
            ("OctofleetAgent.Service.Security.FileAuditCollector", "Security"),
            ("OctofleetAgent.Service.EventLogPusher", "Events"),
            ("OctofleetAgent.Service.LiveDataPoller", "LiveData"),
            ("OctofleetAgent.Service.TerminalPoller", "RemoteTools"),
            ("OctofleetAgent.Service.Shell.RemoteShellService", "RemoteTools"),
            ("OctofleetAgent.Service.Screen.ScreenStreamService", "RemoteTools"),
            ("OctofleetAgent.Service.AutoUpdater", "SelfUpdate"),
            ("OctofleetAgent.Service.NodeWorker", "Agent"),
            ("OctofleetAgent.Service.PendingNodeRegistration", "Agent"),
            ("Microsoft.Hosting.Lifetime", "Agent"),
            (null, "Agent"),
        };
        var wrong = mapping.Where(m => LogComponents.ForSource(m.Source) != m.Component)
            .Select(m => $"{m.Source} -> {LogComponents.ForSource(m.Source)}").ToList();
        Assert(wrong.Count == 0, $"Logger names map to the components of the issue's table {string.Join(", ", wrong)}");

        // Levels from service-config.json
        var problems = new List<string>();
        var defaults = LogComponents.ResolveLevels(null, problems);
        Assert(problems.Count == 0 && defaults.Count == LogComponents.All.Length
            && defaults.Values.All(l => l == LogEventLevel.Information),
            "Without settings every component logs Information");

        var levels = LogComponents.ResolveLevels(new LogSettings
        {
            Level = "warn",
            Levels = new() { ["updates"] = "Debug", ["Inventory"] = "info", ["Nope"] = "Debug", ["Jobs"] = "loud" },
        }, problems);
        Assert(levels["Updates"] == LogEventLevel.Debug && levels["Inventory"] == LogEventLevel.Information
            && levels["Jobs"] == LogEventLevel.Warning && levels["Agent"] == LogEventLevel.Warning,
            "Level per component (any case, short names) over the default level");
        Assert(problems.Count == 2 && problems.Any(p => p.Contains("Nope")) && problems.Any(p => p.Contains("loud")),
            "Unknown components and levels are reported");
        problems.Clear();
        Assert(LogComponents.ResolveLevels(new LogSettings { Level = "chatty" }, problems)["Agent"] == LogEventLevel.Information
            && problems.Count == 1, "An invalid default level falls back to Information");

        // Files: one per component, levels applied, warnings also in Agent.log
        var folder = Path.Combine(root, "logs");
        var settings = new LogSettings { Levels = new() { ["Updates"] = "Debug" } };
        using (var logger = new LoggerConfiguration()
            .ComponentLogging(folder, settings, LogComponents.ResolveLevels(settings, new List<string>()))
            .CreateLogger())
        {
            logger.ForContext("SourceContext", "OctofleetAgent.Service.PatchScanner").Debug("Searching for updates");
            logger.ForContext("SourceContext", "OctofleetAgent.Service.Inventory.HardwareCollector").Debug("Disk health not available");
            logger.ForContext("SourceContext", "OctofleetAgent.Service.Inventory.InventoryPusher").Information("Inventory full pushed");
            logger.ForContext("SourceContext", "OctofleetAgent.Service.Inventory.InventoryPusher").Warning("Inventory full rejected");
            logger.Information("Service starting");
        }
        var updates = File.ReadAllText(Path.Combine(folder, "Updates.log"));
        var inventory = File.ReadAllText(Path.Combine(folder, "Inventory.log"));
        var agent = File.ReadAllText(Path.Combine(folder, "Agent.log"));
        Assert(updates.Contains("Searching for updates") && updates.Contains("component=\"Updates\""),
            "Debug reaches Updates.log when Updates is set to Debug");
        Assert(!inventory.Contains("Disk health") && inventory.Contains("Inventory full pushed"),
            "Inventory stays at Information");
        Assert(agent.Contains("Service starting") && agent.Contains("Inventory full rejected")
            && !agent.Contains("Inventory full pushed") && inventory.Contains("Inventory full rejected"),
            "Agent.log gets its own lines and the warnings of all components");

        // Size rotation: the current file keeps its name, at most MaxOldFiles old ones
        var rolling = Path.Combine(root, "rolling");
        using (var file = new RollingLogFile(rolling, "Jobs", maxBytes: 10_000, maxOldFiles: 2))
        {
            // 1000 bytes per line: a rotation every 10 lines, the last one before line 50
            for (var i = 0; i < 55; i++) file.Write($"line {i:00} " + new string('x', 991) + "\n");
        }
        var names = Directory.GetFiles(rolling).Select(Path.GetFileName).OrderBy(n => n).ToList();
        Assert(names.Count == 3 && names.Contains("Jobs.log")
            && names.Count(n => System.Text.RegularExpressions.Regex.IsMatch(n!, @"^Jobs-\d{8}-\d{6}(-\d+)?\.log$")) == 2,
            $"Rotation keeps Jobs.log and 2 old files ({string.Join(", ", names)})");
        var oldText = string.Concat(names.Where(n => n != "Jobs.log").Select(n => File.ReadAllText(Path.Combine(rolling, n!))));
        Assert(oldText.Contains("line 30 ") && oldText.Contains("line 49 ") && !oldText.Contains("line 29 "),
            "The newest old files are kept (also for several rotations within one second)");
        Assert(File.ReadAllText(Path.Combine(rolling, "Jobs.log")).StartsWith("line 50 "), "Jobs.log holds the newest lines");
        Assert(new FileInfo(Path.Combine(rolling, "Jobs.log")).Length <= 10_000, "The current file stays below the size limit");

        Console.WriteLine("All component log checks passed.");
    }

    private static LogEvent Event(LogEventLevel level, string? source, DateTimeOffset time, string template,
        params (string Name, string Value)[] properties)
    {
        var props = properties.Select(p => new LogEventProperty(p.Name, new ScalarValue(p.Value))).ToList();
        if (source != null) props.Add(new LogEventProperty("SourceContext", new ScalarValue(source)));
        return new LogEvent(time, level, null, new MessageTemplateParser().Parse(template), props);
    }

    private static LogEvent Enriched(LogEvent logEvent)
    {
        new ComponentEnricher().Enrich(logEvent, null!);
        return logEvent;
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        Console.WriteLine($"PASS: {message}");
    }
}
