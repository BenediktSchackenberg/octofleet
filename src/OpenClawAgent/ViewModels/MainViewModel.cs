using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Windows;

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

    public MainViewModel()
    {
        // Initialize with dashboard view
        CurrentView = new DashboardViewModel();
        UpdateConnectionStatus();
    }

    private void UpdateConnectionStatus()
    {
        if (IsConnected)
        {
            ConnectionStatusText = "Connected";
            // ConnectionStatusStyle = Application.Current.FindResource("StatusConnectedBadge") as Style;
        }
        else
        {
            ConnectionStatusText = "Disconnected";
            // ConnectionStatusStyle = Application.Current.FindResource("StatusDisconnectedBadge") as Style;
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
        CurrentView = new DashboardViewModel();
    }

    [RelayCommand]
    private void NavigateToGateways()
    {
        CurrentView = new GatewaysViewModel();
    }

    [RelayCommand]
    private void NavigateToCommands()
    {
        CurrentView = new CommandsViewModel();
    }

    [RelayCommand]
    private void NavigateToHosts()
    {
        CurrentView = new HostsViewModel();
    }

    [RelayCommand]
    private void NavigateToLogs()
    {
        CurrentView = new LogsViewModel();
    }

    private static string GenerateClientId()
    {
        // Generate a stable client ID based on machine
        var machineGuid = Environment.MachineName;
        var hash = machineGuid.GetHashCode();
        return $"win-{Math.Abs(hash):X8}";
    }
}
