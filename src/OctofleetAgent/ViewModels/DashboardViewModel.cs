using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OctofleetAgent.Models;
using OctofleetAgent.Services;
using System;
using System.Collections.ObjectModel;
using System.Windows;

namespace OctofleetAgent.ViewModels;

/// <summary>
/// Dashboard view model - shows overview, status and live logs
/// </summary>
public partial class DashboardViewModel : ObservableObject, IDisposable
{
    [ObservableProperty]
    private string _title = "Dashboard";

    [ObservableProperty]
    private bool _gatewayConnected;

    [ObservableProperty]
    private string _gatewayUrl = "-";

    [ObservableProperty]
    private string _gatewayUptime = "-";

    [ObservableProperty]
    private int _activeSessions;

    [ObservableProperty]
    private int _cronJobs;

    [ObservableProperty]
    private string _lastSync = "Never";

    [ObservableProperty]
    private string _nodeStatus = "Not registered";

    [ObservableProperty]
    private string _serviceStatus = "Unknown";

    [ObservableProperty]
    private ObservableCollection<LogEntry> _logs = new();

    [ObservableProperty]
    private bool _autoScroll = true;

    private readonly GatewayManager _gatewayManager = GatewayManager.Instance;
    private readonly System.Threading.Timer _refreshTimer;
    private const int MaxLogEntries = 100;

    public DashboardViewModel()
    {
        // Subscribe to GatewayManager state changes
        _gatewayManager.PropertyChanged += (s, e) =>
        {
            Application.Current?.Dispatcher?.BeginInvoke(() =>
            {
                switch (e.PropertyName)
                {
                    case nameof(GatewayManager.IsConnected):
                        GatewayConnected = _gatewayManager.IsConnected;
                        break;
                    case nameof(GatewayManager.ActiveGateway):
                        GatewayUrl = _gatewayManager.ActiveGateway?.Url ?? "-";
                        break;
                    case nameof(GatewayManager.GatewayUptime):
                        GatewayUptime = _gatewayManager.GatewayUptime;
                        break;
                    case nameof(GatewayManager.ActiveSessions):
                        ActiveSessions = _gatewayManager.ActiveSessions;
                        break;
                    case nameof(GatewayManager.CronJobs):
                        CronJobs = _gatewayManager.CronJobs;
                        break;
                    case nameof(GatewayManager.LastSyncText):
                        LastSync = _gatewayManager.LastSyncText;
                        break;
                }
            });
        };

        // Subscribe to gateway messages for live logs
        _gatewayManager.Service.MessageReceived += OnGatewayMessage;
        _gatewayManager.Service.DebugMessage += OnDebugMessage;
        _gatewayManager.Service.ConnectionStateChanged += OnConnectionStateChanged;
        
        // Initialize with current state
        GatewayConnected = _gatewayManager.IsConnected;
        GatewayUrl = _gatewayManager.ActiveGateway?.Url ?? "-";
        GatewayUptime = _gatewayManager.GatewayUptime;
        ActiveSessions = _gatewayManager.ActiveSessions;
        CronJobs = _gatewayManager.CronJobs;
        LastSync = _gatewayManager.LastSyncText;

        // Add startup log
        AddLog("info", "Dashboard", "Dashboard initialized");

        // Auto-refresh every 5 seconds
        _refreshTimer = new System.Threading.Timer(async _ =>
        {
            try
            {
                if (_gatewayManager.IsConnected)
                {
                    await _gatewayManager.SyncStatusAsync();
                    Application.Current?.Dispatcher?.BeginInvoke(() =>
                    {
                        AddLog("info", "Sync", "Status refreshed");
                    });
                }
                
                // Update service status
                Application.Current?.Dispatcher?.BeginInvoke(() =>
                {
                    RefreshServiceStatus();
                });
            }
            catch { }
        }, null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5));
    }

    private void RefreshServiceStatus()
    {
        try
        {
            if (Services.ServiceController.IsInstalled)
            {
                var status = Services.ServiceController.Status;
                ServiceStatus = status switch
                {
                    System.ServiceProcess.ServiceControllerStatus.Running => "🟢 Running",
                    System.ServiceProcess.ServiceControllerStatus.Stopped => "🔴 Stopped",
                    System.ServiceProcess.ServiceControllerStatus.StartPending => "🟡 Starting...",
                    System.ServiceProcess.ServiceControllerStatus.StopPending => "🟡 Stopping...",
                    _ => "⚪ " + status?.ToString()
                };
            }
            else
            {
                ServiceStatus = "⚫ Not installed";
            }
        }
        catch
        {
            ServiceStatus = "❓ Unknown";
        }
    }

    private void OnGatewayMessage(object? sender, GatewayMessageEventArgs e)
    {
        Application.Current?.Dispatcher?.BeginInvoke(() =>
        {
            try
            {
                // Parse JSON to make it readable
                using var doc = System.Text.Json.JsonDocument.Parse(e.Message);
                var root = doc.RootElement;
                
                var type = root.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : "unknown";
                
                if (type == "event")
                {
                    var eventName = root.TryGetProperty("event", out var eventProp) ? eventProp.GetString() : "unknown";
                    var description = FormatEventDescription(eventName ?? "unknown", root);
                    AddLog("event", eventName ?? "Event", description);
                }
                else if (type == "res")
                {
                    var ok = root.TryGetProperty("ok", out var okProp) && okProp.GetBoolean();
                    var method = root.TryGetProperty("id", out var idProp) ? $"Response #{idProp.GetString()}" : "Response";
                    AddLog(ok ? "success" : "error", method, ok ? "OK" : "Failed");
                }
                else
                {
                    AddLog("debug", type ?? "Message", TruncateMessage(e.Message, 100));
                }
            }
            catch
            {
                AddLog("debug", "Raw", TruncateMessage(e.Message, 100));
            }
        });
    }

    private void OnDebugMessage(object? sender, string message)
    {
        Application.Current?.Dispatcher?.BeginInvoke(() =>
        {
            AddLog("debug", "Gateway", message);
        });
    }

    private void OnConnectionStateChanged(object? sender, ConnectionStateChangedEventArgs e)
    {
        Application.Current?.Dispatcher?.BeginInvoke(() =>
        {
            if (e.IsConnected)
            {
                AddLog("success", "Connection", "Connected to Gateway");
            }
            else
            {
                AddLog("warning", "Connection", "Disconnected from Gateway");
            }
        });
    }

    private string FormatEventDescription(string eventName, System.Text.Json.JsonElement root)
    {
        return eventName switch
        {
            "tick" => "Gateway heartbeat",
            "health" => FormatHealthEvent(root),
            "session.updated" => "Session state changed",
            "session.created" => "New session started",
            "session.ended" => "Session ended",
            "node.invoke.request" => FormatNodeInvokeRequest(root),
            "voicewake.changed" => "Voice wake state changed",
            "cron.fired" => "Scheduled job executed",
            "connect.challenge" => "Authentication challenge received",
            _ => eventName
        };
    }

    private string FormatHealthEvent(System.Text.Json.JsonElement root)
    {
        try
        {
            if (root.TryGetProperty("payload", out var payload))
            {
                var sessions = payload.TryGetProperty("activeSessions", out var s) ? s.GetInt32() : 0;
                var uptime = payload.TryGetProperty("uptimeMs", out var u) ? u.GetInt64() / 1000 / 60 : 0;
                return $"Sessions: {sessions}, Uptime: {uptime}m";
            }
        }
        catch { }
        return "Gateway health update";
    }

    private string FormatNodeInvokeRequest(System.Text.Json.JsonElement root)
    {
        try
        {
            if (root.TryGetProperty("payload", out var payload))
            {
                var cmd = payload.TryGetProperty("command", out var c) ? c.GetString() : "unknown";
                return $"Command: {cmd}";
            }
        }
        catch { }
        return "Node command request";
    }

    private void AddLog(string level, string source, string message)
    {
        var entry = new LogEntry
        {
            Timestamp = DateTime.Now,
            Level = level,
            Source = source,
            Message = message
        };

        Logs.Add(entry);

        // Keep log size manageable
        while (Logs.Count > MaxLogEntries)
        {
            Logs.RemoveAt(0);
        }
    }

    private string TruncateMessage(string message, int maxLength)
    {
        if (message.Length <= maxLength) return message;
        return message.Substring(0, maxLength) + "...";
    }

    [RelayCommand]
    private async Task RefreshStatusAsync()
    {
        AddLog("info", "User", "Manual refresh triggered");
        await _gatewayManager.SyncStatusAsync();
    }

    [RelayCommand]
    private void ClearLogs()
    {
        Logs.Clear();
        AddLog("info", "System", "Logs cleared");
    }

    public void Dispose()
    {
        _refreshTimer?.Dispose();
        _gatewayManager.Service.MessageReceived -= OnGatewayMessage;
        _gatewayManager.Service.DebugMessage -= OnDebugMessage;
        _gatewayManager.Service.ConnectionStateChanged -= OnConnectionStateChanged;
    }
}
