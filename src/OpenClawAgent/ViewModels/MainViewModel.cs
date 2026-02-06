using System;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OpenClawAgent.Services;

namespace OpenClawAgent.ViewModels;

/// <summary>
/// Main window view model
/// </summary>
public partial class MainViewModel : ObservableObject
{
    [ObservableProperty]
    private string _clientId = GenerateClientId();

    [ObservableProperty]
    private bool _isConnected;

    [ObservableProperty]
    private string _connectionStatusText = "Disconnected";

    [ObservableProperty]
    private Style? _connectionStatusStyle;

    [ObservableProperty]
    private string _statusMessage = "Ready";

    [ObservableProperty]
    private int _gatewayLatency;

    [ObservableProperty]
    private string _gatewayVersion = "-";

    [ObservableProperty]
    private object? _currentView;

    private readonly GatewayManager _gatewayManager = GatewayManager.Instance;

    public MainViewModel()
    {
        // Subscribe to GatewayManager state changes
        _gatewayManager.PropertyChanged += (s, e) =>
        {
            switch (e.PropertyName)
            {
                case nameof(GatewayManager.IsConnected):
                    IsConnected = _gatewayManager.IsConnected;
                    UpdateConnectionStatus();
                    break;
                case nameof(GatewayManager.StatusMessage):
                    StatusMessage = _gatewayManager.StatusMessage;
                    break;
                case nameof(GatewayManager.Latency):
                    GatewayLatency = _gatewayManager.Latency;
                    break;
                case nameof(GatewayManager.Version):
                    GatewayVersion = _gatewayManager.Version ?? "-";
                    break;
            }
        };
        
        // Initialize with dashboard view
        CurrentView = new Views.DashboardView { DataContext = new DashboardViewModel() };
        UpdateConnectionStatus();
    }

    private void UpdateConnectionStatus()
    {
        if (IsConnected)
        {
            ConnectionStatusText = "Connected";
        }
        else
        {
            ConnectionStatusText = "Disconnected";
        }
    }

    partial void OnIsConnectedChanged(bool value)
    {
        UpdateConnectionStatus();
    }

    [RelayCommand]
    private void OpenSettings()
    {
        // TODO: Open settings dialog
    }

    [RelayCommand]
    private void NavigateToDashboard()
    {
        CurrentView = new Views.DashboardView { DataContext = new DashboardViewModel() };
    }

    [RelayCommand]
    private void NavigateToGateways()
    {
        CurrentView = new Views.GatewaysView { DataContext = new GatewaysViewModel() };
    }

    [RelayCommand]
    private void NavigateToCommands()
    {
        CurrentView = new Views.CommandsView { DataContext = new CommandsViewModel() };
    }

    [RelayCommand]
    private void NavigateToHosts()
    {
        CurrentView = new Views.HostsView { DataContext = new HostsViewModel() };
    }

    [RelayCommand]
    private void NavigateToLogs()
    {
        CurrentView = new Views.LogsView { DataContext = new LogsViewModel() };
    }

    private static string GenerateClientId()
    {
        // Generate a stable client ID based on machine
        var machineGuid = Environment.MachineName;
        var hash = machineGuid.GetHashCode();
        return $"win-{Math.Abs(hash):X8}";
    }
}
