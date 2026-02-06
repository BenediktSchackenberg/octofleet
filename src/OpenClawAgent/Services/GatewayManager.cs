using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using OpenClawAgent.Models;

namespace OpenClawAgent.Services;

/// <summary>
/// Singleton manager for gateway connections.
/// Provides a shared state across all ViewModels.
/// </summary>
public sealed class GatewayManager : INotifyPropertyChanged
{
    private static readonly Lazy<GatewayManager> _instance = new(() => new GatewayManager());
    public static GatewayManager Instance => _instance.Value;

    private readonly GatewayService _service;
    private GatewayConfig? _activeGateway;
    private bool _isConnected;
    private string? _version;
    private int _latency;
    private string _statusMessage = "Disconnected";
    private DateTime? _lastSync;
    private string _gatewayUptime = "-";
    private int _activeSessions;
    private int _cronJobs;
    private Timer? _syncTimer;

    public event PropertyChangedEventHandler? PropertyChanged;
    public event EventHandler<string>? DebugLog;

    private GatewayManager()
    {
        _service = new GatewayService();
        _service.ConnectionStateChanged += OnConnectionStateChanged;
        _service.MessageReceived += OnMessageReceived;
        _service.DebugMessage += (s, msg) => DebugLog?.Invoke(this, msg);
    }

    public GatewayService Service => _service;

    public bool IsConnected
    {
        get => _isConnected;
        private set { _isConnected = value; OnPropertyChanged(); }
    }

    public string? Version
    {
        get => _version;
        private set { _version = value; OnPropertyChanged(); }
    }

    public int Latency
    {
        get => _latency;
        private set { _latency = value; OnPropertyChanged(); }
    }

    public string StatusMessage
    {
        get => _statusMessage;
        private set { _statusMessage = value; OnPropertyChanged(); }
    }

    public GatewayConfig? ActiveGateway
    {
        get => _activeGateway;
        private set { _activeGateway = value; OnPropertyChanged(); }
    }

    public DateTime? LastSync
    {
        get => _lastSync;
        private set { _lastSync = value; OnPropertyChanged(); OnPropertyChanged(nameof(LastSyncText)); }
    }

    public string LastSyncText => LastSync?.ToString("HH:mm:ss") ?? "Never";

    public string GatewayUptime
    {
        get => _gatewayUptime;
        private set { _gatewayUptime = value; OnPropertyChanged(); }
    }

    public int ActiveSessions
    {
        get => _activeSessions;
        private set { _activeSessions = value; OnPropertyChanged(); }
    }

    public int CronJobs
    {
        get => _cronJobs;
        private set { _cronJobs = value; OnPropertyChanged(); }
    }

    public async Task<ConnectionTestResult> TestConnectionAsync(GatewayConfig gateway)
    {
        StatusMessage = "Testing connection...";
        var result = await _service.TestConnectionAsync(gateway);
        
        if (result.Success)
        {
            Latency = result.Latency;
            StatusMessage = $"Test successful ({result.Latency}ms)";
        }
        else
        {
            StatusMessage = $"Test failed: {result.Error}";
        }
        
        return result;
    }

    public async Task ConnectAsync(GatewayConfig gateway)
    {
        StatusMessage = "Connecting...";
        try
        {
            await _service.ConnectAsync(gateway);
            ActiveGateway = gateway;
            IsConnected = true;
            Version = gateway.Version;
            StatusMessage = $"Connected to {gateway.Name}";
            
            // Start periodic sync
            StartSyncTimer();
            
            // Initial sync
            await SyncStatusAsync();
        }
        catch (Exception ex)
        {
            IsConnected = false;
            ActiveGateway = null;
            StatusMessage = $"Connection failed: {ex.Message}";
            throw;
        }
    }

    public async Task DisconnectAsync()
    {
        StopSyncTimer();
        await _service.DisconnectAsync();
        IsConnected = false;
        ActiveGateway = null;
        StatusMessage = "Disconnected";
    }

    /// <summary>
    /// Sync status from the gateway (health, sessions, cron jobs, etc.)
    /// </summary>
    public async Task SyncStatusAsync()
    {
        if (!IsConnected) return;

        try
        {
            // Request health status
            var healthResponse = await _service.SendRequestAsync("health", new { });
            if (healthResponse != null && healthResponse.Value.TryGetProperty("uptimeMs", out var uptimeProp))
            {
                var uptimeMs = uptimeProp.GetInt64();
                var uptime = TimeSpan.FromMilliseconds(uptimeMs);
                GatewayUptime = FormatUptime(uptime);
            }

            // Request sessions list
            var sessionsResponse = await _service.SendRequestAsync("sessions.list", new { limit = 100 });
            if (sessionsResponse != null && sessionsResponse.Value.TryGetProperty("sessions", out var sessionsProp))
            {
                ActiveSessions = sessionsProp.GetArrayLength();
            }

            // Request cron jobs
            var cronResponse = await _service.SendRequestAsync("cron.list", new { });
            if (cronResponse != null && cronResponse.Value.TryGetProperty("jobs", out var jobsProp))
            {
                CronJobs = jobsProp.GetArrayLength();
            }

            LastSync = DateTime.Now;
            DebugLog?.Invoke(this, $"Status synced: uptime={GatewayUptime}, sessions={ActiveSessions}, cron={CronJobs}");
        }
        catch (Exception ex)
        {
            DebugLog?.Invoke(this, $"Sync failed: {ex.Message}");
        }
    }

    private string FormatUptime(TimeSpan uptime)
    {
        if (uptime.TotalDays >= 1)
            return $"{(int)uptime.TotalDays}d {uptime.Hours}h";
        if (uptime.TotalHours >= 1)
            return $"{(int)uptime.TotalHours}h {uptime.Minutes}m";
        return $"{uptime.Minutes}m {uptime.Seconds}s";
    }

    private void StartSyncTimer()
    {
        StopSyncTimer();
        // Sync every 30 seconds
        _syncTimer = new Timer(async _ => await SyncStatusAsync(), null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
    }

    private void StopSyncTimer()
    {
        _syncTimer?.Dispose();
        _syncTimer = null;
    }

    private void OnConnectionStateChanged(object? sender, ConnectionStateChangedEventArgs e)
    {
        IsConnected = e.IsConnected;
        if (!e.IsConnected)
        {
            StopSyncTimer();
            StatusMessage = "Disconnected";
            ActiveGateway = null;
        }
    }

    private void OnMessageReceived(object? sender, GatewayMessageEventArgs e)
    {
        // Handle incoming messages (events from gateway)
        // Could dispatch to specific handlers based on message type
    }

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
