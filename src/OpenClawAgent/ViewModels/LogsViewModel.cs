using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;

namespace OpenClawAgent.ViewModels;

/// <summary>
/// Logs view model - display and filter logs
/// </summary>
public partial class LogsViewModel : ObservableObject
{
    [ObservableProperty]
    private string _title = "Logs";

    [ObservableProperty]
    private ObservableCollection<LogEntry> _logs = new();

    [ObservableProperty]
    private string _filterText = "";

    [ObservableProperty]
    private LogLevel _filterLevel = LogLevel.All;

    [ObservableProperty]
    private bool _autoScroll = true;

    [ObservableProperty]
    private bool _isFollowing;

    public LogsViewModel()
    {
        // Add sample logs
        AddLog(LogLevel.Info, "Agent started");
        AddLog(LogLevel.Info, "Loading configuration...");
        AddLog(LogLevel.Debug, "Config loaded from %APPDATA%\\OpenClaw\\config.json");
    }

    public void AddLog(LogLevel level, string message)
    {
        Logs.Add(new LogEntry
        {
            Timestamp = DateTime.Now,
            Level = level,
            Message = message
        });
    }

    [RelayCommand]
    private void ClearLogs()
    {
        Logs.Clear();
    }

    [RelayCommand]
    private void ExportLogs()
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Filter = "Log files (*.log)|*.log|Text files (*.txt)|*.txt|All files (*.*)|*.*",
            DefaultExt = ".log",
            FileName = $"openclaw-agent-{DateTime.Now:yyyyMMdd-HHmmss}.log"
        };

        if (dialog.ShowDialog() == true)
        {
            var lines = Logs.Select(l => $"[{l.Timestamp:yyyy-MM-dd HH:mm:ss}] [{l.Level}] {l.Message}");
            System.IO.File.WriteAllLines(dialog.FileName, lines);
        }
    }

    [RelayCommand]
    private void ToggleFollow()
    {
        IsFollowing = !IsFollowing;
        // TODO: Start/stop log streaming from gateway
    }

    [RelayCommand]
    private void CopyToClipboard()
    {
        var text = string.Join("\n", Logs.Select(l => $"[{l.Timestamp:HH:mm:ss}] [{l.Level}] {l.Message}"));
        System.Windows.Clipboard.SetText(text);
    }
}

public class LogEntry
{
    public DateTime Timestamp { get; set; }
    public LogLevel Level { get; set; }
    public string Message { get; set; } = "";
    public string Source { get; set; } = "Agent";
}

public enum LogLevel
{
    All,
    Debug,
    Info,
    Warning,
    Error
}
