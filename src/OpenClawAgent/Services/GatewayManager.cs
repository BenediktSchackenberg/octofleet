using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
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
        await _service.DisconnectAsync();
        IsConnected = false;
        ActiveGateway = null;
        StatusMessage = "Disconnected";
    }

    private void OnConnectionStateChanged(object? sender, ConnectionStateChangedEventArgs e)
    {
        IsConnected = e.IsConnected;
        if (!e.IsConnected)
        {
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
