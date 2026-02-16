using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OctofleetAgent.Models;
using System.Collections.ObjectModel;

namespace OctofleetAgent.ViewModels;

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
    private string _filterLevel = "all";

    [ObservableProperty]
    private bool _autoScroll = true;

    [ObservableProperty]
    private bool _isFollowing;

    public LogsViewModel()
    {
        // Add sample logs
        AddLog("info", "Agent", "Agent started");
        AddLog("info", "Config", "Loading configuration...");
        AddLog("debug", "Config", "Config loaded from %APPDATA%\\Octofleet\\config.json");
    }

    public void AddLog(string level, string source, string message)
    {
        Logs.Add(new LogEntry
        {
            Timestamp = DateTime.Now,
            Level = level,
            Source = source,
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
            FileName = $"octofleet-agent-{DateTime.Now:yyyyMMdd-HHmmss}.log"
        };

        if (dialog.ShowDialog() == true)
        {
            var lines = Logs.Select(l => $"[{l.Timestamp:yyyy-MM-dd HH:mm:ss}] [{l.Level}] {l.Source}: {l.Message}");
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
        var text = string.Join("\n", Logs.Select(l => $"[{l.Timestamp:HH:mm:ss}] [{l.Level}] {l.Source}: {l.Message}"));
        System.Windows.Clipboard.SetText(text);
    }
}
