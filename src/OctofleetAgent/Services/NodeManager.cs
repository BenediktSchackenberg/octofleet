using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using OctofleetAgent.Models;

namespace OctofleetAgent.Services;

/// <summary>
/// Singleton manager for node registration.
/// Allows this Windows PC to be registered as an Octofleet Node.
/// </summary>
public sealed class NodeManager : INotifyPropertyChanged
{
    private static readonly Lazy<NodeManager> _instance = new(() => new NodeManager());
    public static NodeManager Instance => _instance.Value;

    private readonly NodeService _service;
    private bool _isConnected;
    private bool _isPaired;
    private string? _nodeId;
    private string _statusMessage = "Not registered";
    private string _displayName = Environment.MachineName;

    public event PropertyChangedEventHandler? PropertyChanged;
    public event EventHandler<string>? DebugLog;

    private NodeManager()
    {
        _service = new NodeService();
        _service.ConnectionStateChanged += OnConnectionStateChanged;
        _service.DebugMessage += (s, msg) => 
        {
            Console.WriteLine(msg);
            DebugLog?.Invoke(this, msg);
        };
    }

    public NodeService Service => _service;

    public bool IsConnected
    {
        get => _isConnected;
        private set { _isConnected = value; OnPropertyChanged(); }
    }

    public bool IsPaired
    {
        get => _isPaired;
        private set { _isPaired = value; OnPropertyChanged(); }
    }

    public string? NodeId
    {
        get => _nodeId;
        private set { _nodeId = value; OnPropertyChanged(); }
    }

    public string StatusMessage
    {
        get => _statusMessage;
        private set { _statusMessage = value; OnPropertyChanged(); }
    }

    public string DisplayName
    {
        get => _displayName;
        set { _displayName = value; OnPropertyChanged(); }
    }

    /// <summary>
    /// Register this PC as a Node with the Gateway
    /// </summary>
    public async Task RegisterAsync(GatewayConfig gateway)
    {
        StatusMessage = "Registering as node...";
        try
        {
            await _service.ConnectAsync(gateway, DisplayName);
            NodeId = _service.NodeId;
            IsPaired = _service.IsPaired;
            IsConnected = true;
            
            if (IsPaired)
            {
                StatusMessage = $"Registered and paired as {DisplayName}";
            }
            else
            {
                StatusMessage = $"Registered as {DisplayName} - waiting for approval on Gateway";
            }
        }
        catch (Exception ex)
        {
            IsConnected = false;
            IsPaired = false;
            StatusMessage = $"Registration failed: {ex.Message}";
            throw;
        }
    }

    public async Task UnregisterAsync()
    {
        await _service.DisconnectAsync();
        IsConnected = false;
        IsPaired = false;
        NodeId = null;
        StatusMessage = "Not registered";
    }

    private void OnConnectionStateChanged(object? sender, bool isConnected)
    {
        IsConnected = isConnected;
        if (!isConnected)
        {
            StatusMessage = "Disconnected";
            IsPaired = false;
        }
    }

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
