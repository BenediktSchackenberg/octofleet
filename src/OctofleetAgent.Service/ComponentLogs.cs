using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Display;

namespace OctofleetAgent.Service;

/// <summary>
/// "Logging" in service-config.json. Read at service start; a change needs a service restart.
/// </summary>
public class LogSettings
{
    /// <summary>"CMTrace" (default, readable in CMTrace/OneTrace) or "Text".</summary>
    public string Format { get; set; } = "CMTrace";
    /// <summary>Level of all components without an entry in <see cref="Levels"/>.</summary>
    public string Level { get; set; } = "Information";
    /// <summary>Level per component, e.g. { "Updates": "Debug" }.</summary>
    public Dictionary<string, string> Levels { get; set; } = new();
    public int MaxFileSizeMB { get; set; } = 2;
    public int MaxOldFiles { get; set; } = 4;
}

/// <summary>
/// The agent's log components (#330): one file per component in the log folder, e.g. Updates.log.
/// Each class is mapped to its component by its logger name (Serilog's SourceContext).
/// </summary>
public static class LogComponents
{
    public const string Agent = "Agent";
    public const string Inventory = "Inventory";
    public const string Jobs = "Jobs";
    public const string Updates = "Updates";
    public const string Remediation = "Remediation";
    public const string Security = "Security";
    public const string Events = "Events";
    public const string LiveData = "LiveData";
    public const string RemoteTools = "RemoteTools";
    public const string SelfUpdate = "SelfUpdate";

    public static readonly string[] All =
        { Agent, Inventory, Jobs, Updates, Remediation, Security, Events, LiveData, RemoteTools, SelfUpdate };

    /// <summary>Name of the event property that carries the component.</summary>
    public const string Property = "Component";

    private const string RootNamespace = "OctofleetAgent.Service.";

    private static readonly Dictionary<string, string> ByNamespace = new()
    {
        ["Inventory"] = Inventory,
        ["Packages"] = Jobs,
        ["Security"] = Security,
        ["Shell"] = RemoteTools,
        ["Screen"] = RemoteTools,
    };

    private static readonly Dictionary<string, string> ByClass = new()
    {
        ["InventoryScheduler"] = Inventory,
        ["JobPoller"] = Jobs,
        ["DeploymentPoller"] = Jobs,
        ["RepoResolver"] = Jobs,
        ["PatchScanner"] = Updates,
        ["PatchInstaller"] = Updates,
        ["RemediationPoller"] = Remediation,
        ["ServiceReconciliationPoller"] = Remediation,
        ["EventLogPusher"] = Events,
        ["LiveDataPoller"] = LiveData,
        ["TerminalPoller"] = RemoteTools,
        ["AutoUpdater"] = SelfUpdate,
        ["ReleaseFinder"] = SelfUpdate,
    };

    private static readonly ConcurrentDictionary<string, string> Cache = new();

    /// <summary>
    /// Component of a logger name, e.g. "OctofleetAgent.Service.Inventory.BrowserCollector" →
    /// Inventory. Everything else (Program, NodeWorker, registration, Microsoft.*) is Agent.
    /// </summary>
    public static string ForSource(string? sourceContext)
    {
        if (string.IsNullOrEmpty(sourceContext) || !sourceContext.StartsWith(RootNamespace, StringComparison.Ordinal))
            return Agent;
        return Cache.GetOrAdd(sourceContext, static source =>
        {
            var name = source[RootNamespace.Length..];
            var dot = name.IndexOf('.');
            if (dot > 0)
                return ByNamespace.TryGetValue(name[..dot], out var byNamespace) ? byNamespace : Agent;
            var plus = name.IndexOf('+');  // nested class
            if (plus > 0) name = name[..plus];
            return ByClass.TryGetValue(name, out var byClass) ? byClass : Agent;
        });
    }

    /// <summary>The component of an event (set by <see cref="ComponentEnricher"/>; a message property of the same name is ignored).</summary>
    public static string Of(LogEvent logEvent) =>
        logEvent.Properties.TryGetValue(Property, out var value) && value is ScalarValue { Value: string component }
            && Array.IndexOf(All, component) >= 0
            ? component
            : ForSource(SourceOf(logEvent));

    public static string? SourceOf(LogEvent logEvent) =>
        logEvent.Properties.TryGetValue(Constants.SourceContextPropertyName, out var value) && value is ScalarValue { Value: string source }
            ? source
            : null;

    /// <summary>Accepts Serilog's names (Verbose, Debug, Information, Warning, Error, Fatal) and Info/Warn/Trace.</summary>
    public static LogEventLevel? ParseLevel(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        switch (value.Trim().ToLowerInvariant())
        {
            case "info": return LogEventLevel.Information;
            case "warn": return LogEventLevel.Warning;
            case "trace": return LogEventLevel.Verbose;
        }
        return Enum.TryParse<LogEventLevel>(value.Trim(), ignoreCase: true, out var level) && Enum.IsDefined(level)
            ? level
            : null;
    }

    /// <summary>
    /// The level of every component. Unknown components and levels are left out and reported in
    /// <paramref name="problems"/> (written to Agent.log at start).
    /// </summary>
    public static Dictionary<string, LogEventLevel> ResolveLevels(LogSettings? settings, List<string> problems)
    {
        settings ??= new LogSettings();
        var fallback = ParseLevel(settings.Level);
        if (fallback == null)
            problems.Add($"Logging.Level \"{settings.Level}\" is not a level; using Information");
        if (!string.Equals(settings.Format, "CMTrace", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(settings.Format, "Text", StringComparison.OrdinalIgnoreCase))
            problems.Add($"Logging.Format \"{settings.Format}\" is neither CMTrace nor Text; using CMTrace");
        var levels = All.ToDictionary(c => c, _ => fallback ?? LogEventLevel.Information);
        foreach (var (key, value) in settings.Levels ?? new())
        {
            var component = All.FirstOrDefault(c => string.Equals(c, key, StringComparison.OrdinalIgnoreCase));
            var level = ParseLevel(value);
            if (component == null)
                problems.Add($"Logging.Levels: unknown component \"{key}\" (known: {string.Join(", ", All)})");
            else if (level == null)
                problems.Add($"Logging.Levels.{component}: \"{value}\" is not a level");
            else
                levels[component] = level.Value;
        }
        return levels;
    }

    /// <summary>
    /// The component files with their levels: every event gets its component, events below the
    /// component's level are dropped (for all sinks), the rest go to &lt;component&gt;.log.
    /// </summary>
    public static LoggerConfiguration ComponentLogging(this LoggerConfiguration configuration, string folder,
        LogSettings? settings, IReadOnlyDictionary<string, LogEventLevel> levels) =>
        configuration
            .MinimumLevel.Is(levels.Values.Min())
            .Enrich.With(new ComponentEnricher())
            .Filter.ByIncludingOnly(e => e.Level >= levels[Of(e)])
            .WriteTo.Sink(new ComponentFileSink(folder, settings));

    private static readonly MessageTemplateTextFormatter MessageFormatter = new("{Message:lj}", CultureInfo.InvariantCulture);
    private static readonly MessageTemplateTextFormatter TextFormatter = new(
        "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] [{Component}] {Message:lj}{NewLine}{Exception}",
        CultureInfo.InvariantCulture);

    /// <summary>
    /// One line in the ConfigMgr log format, read by CMTrace and OneTrace: type 1 = information
    /// (and debug), 2 = warning, 3 = error. "time" carries the time zone bias in minutes
    /// (UTC − local), as ConfigMgr writes it. An exception is part of the message.
    /// </summary>
    public static string FormatCMTrace(LogEvent logEvent, string component, int thread)
    {
        var message = new StringWriter(CultureInfo.InvariantCulture);
        MessageFormatter.Format(logEvent, message);
        if (logEvent.Exception != null)
            message.Write(Environment.NewLine + logEvent.Exception);
        // The end marker inside a message would cut the line for CMTrace
        var text = message.ToString().Replace("]LOG]!>", "]LOG] !>");

        var time = logEvent.Timestamp;
        var bias = -(int)time.Offset.TotalMinutes;
        var type = logEvent.Level switch
        {
            LogEventLevel.Warning => 2,
            LogEventLevel.Error or LogEventLevel.Fatal => 3,
            _ => 1,
        };
        var source = SourceOf(logEvent);
        var file = source == null ? "" : source[(source.LastIndexOf('.') + 1)..];
        return string.Create(CultureInfo.InvariantCulture,
            $"<![LOG[{text}]LOG]!><time=\"{time:HH:mm:ss.fff}{(bias < 0 ? '-' : '+')}{Math.Abs(bias):000}\" date=\"{time:MM-dd-yyyy}\" component=\"{component}\" context=\"\" type=\"{type}\" thread=\"{thread}\" file=\"{file}\">")
            + Environment.NewLine;
    }

    /// <summary>Plain text: "2026-11-24 15:26:04.561 +01:00 [INF] [Updates] message".</summary>
    public static string FormatText(LogEvent logEvent)
    {
        var line = new StringWriter(CultureInfo.InvariantCulture);
        TextFormatter.Format(logEvent, line);
        return line.ToString();
    }
}

/// <summary>Adds the component of the logger name to every event (used by the level filter and the files).</summary>
public sealed class ComponentEnricher : ILogEventEnricher
{
    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory) =>
        logEvent.AddPropertyIfAbsent(new LogEventProperty(LogComponents.Property,
            new ScalarValue(LogComponents.ForSource(LogComponents.SourceOf(logEvent)))));
}

/// <summary>
/// Writes each event to &lt;component&gt;.log; warnings and errors of all components also go to
/// Agent.log, the one file to look at first. Written on the logging thread with one write per
/// line, like Serilog's file sink - no extra thread or process.
/// </summary>
public sealed class ComponentFileSink : ILogEventSink, IDisposable
{
    private readonly string _folder;
    private readonly bool _cmTrace;
    private readonly long _maxBytes;
    private readonly int _maxOldFiles;
    private readonly ConcurrentDictionary<string, RollingLogFile> _files = new();

    public ComponentFileSink(string folder, LogSettings? settings)
    {
        settings ??= new LogSettings();
        _folder = folder;
        _cmTrace = !string.Equals(settings.Format, "Text", StringComparison.OrdinalIgnoreCase);
        _maxBytes = Math.Max(1, settings.MaxFileSizeMB) * 1024L * 1024L;
        _maxOldFiles = Math.Max(0, settings.MaxOldFiles);
    }

    public void Emit(LogEvent logEvent)
    {
        var component = LogComponents.Of(logEvent);
        var line = _cmTrace
            ? LogComponents.FormatCMTrace(logEvent, component, Environment.CurrentManagedThreadId)
            : LogComponents.FormatText(logEvent);
        File(component).Write(line);
        if (logEvent.Level >= LogEventLevel.Warning && component != LogComponents.Agent)
            File(LogComponents.Agent).Write(line);
    }

    private RollingLogFile File(string component) =>
        _files.GetOrAdd(component, c => new RollingLogFile(_folder, c, _maxBytes, _maxOldFiles));

    public void Dispose()
    {
        foreach (var file in _files.Values) file.Dispose();
    }
}

/// <summary>
/// &lt;name&gt;.log, rotated by size like ConfigMgr's logs: the full file is renamed to
/// &lt;name&gt;-yyyyMMdd-HHmmss.log and only the newest <c>maxOldFiles</c> of those are kept.
/// The file is opened with read/write/delete sharing, so CMTrace can follow it live.
/// </summary>
public sealed class RollingLogFile : IDisposable
{
    private static readonly Encoding Utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
    private readonly object _lock = new();
    private readonly string _folder;
    private readonly string _name;
    private readonly long _maxBytes;
    private readonly int _maxOldFiles;
    private readonly Regex _oldFile;
    private StreamWriter? _writer;
    private long _size;
    private long _rollAt;

    public RollingLogFile(string folder, string name, long maxBytes, int maxOldFiles)
    {
        _folder = folder;
        _name = name;
        _maxBytes = maxBytes;
        _maxOldFiles = maxOldFiles;
        _oldFile = new Regex("^" + Regex.Escape(name) + @"-(?<stamp>\d{8}-\d{6})(-(?<n>\d{1,6}))?\.log$", RegexOptions.IgnoreCase);
    }

    public string Path => System.IO.Path.Combine(_folder, _name + ".log");

    public void Write(string line)
    {
        lock (_lock)
        {
            Open();
            var bytes = Utf8.GetByteCount(line);
            if (_size > 0 && _size + bytes > _rollAt)
            {
                Roll();
                Open();
            }
            _writer!.Write(line);
            _size += bytes;
        }
    }

    private void Open()
    {
        if (_writer != null) return;
        Directory.CreateDirectory(_folder);
        var stream = new FileStream(Path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
        _writer = new StreamWriter(stream, Utf8) { AutoFlush = true };
        _size = stream.Length;
        _rollAt = _maxBytes;
    }

    private void Roll()
    {
        _writer!.Dispose();
        _writer = null;
        try
        {
            // Several rotations within one second (tiny MaxFileSize) get -1, -2, ... after the newest
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            var sameSecond = OldFiles().Where(f => f.Stamp == stamp).Select(f => f.N).DefaultIfEmpty(-1).Max();
            var target = System.IO.Path.Combine(_folder, sameSecond < 0 ? $"{_name}-{stamp}.log" : $"{_name}-{stamp}-{sameSecond + 1}.log");
            System.IO.File.Move(Path, target);
            Prune();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Renaming fails while another program holds the file without delete sharing: keep
            // writing and try again after another MaxFileSize.
            Open();
            _rollAt = _size + _maxBytes;
        }
    }

    /// <summary>The rotated files &lt;name&gt;-yyyyMMdd-HHmmss[-N].log, newest first.</summary>
    private IEnumerable<(string Path, string Stamp, int N)> OldFiles() =>
        Directory.EnumerateFiles(_folder, _name + "-*.log")
            .Select(f => _oldFile.Match(System.IO.Path.GetFileName(f)) is { Success: true } m
                ? (Path: f, Stamp: m.Groups["stamp"].Value,
                   N: m.Groups["n"].Success ? int.Parse(m.Groups["n"].Value, CultureInfo.InvariantCulture) : 0)
                : (Path: f, Stamp: "", N: -1))
            .Where(f => f.Stamp.Length > 0)
            .OrderByDescending(f => f.Stamp, StringComparer.Ordinal)
            .ThenByDescending(f => f.N);

    /// <summary>Deletes all but the newest <c>maxOldFiles</c> rotated files.</summary>
    private void Prune()
    {
        var old = OldFiles().Skip(_maxOldFiles).Select(f => f.Path).ToList();
        foreach (var file in old)
        {
            try { System.IO.File.Delete(file); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* next rotation tries again */ }
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _writer?.Dispose();
            _writer = null;
        }
    }
}
