using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OpenClawAgent.Services;

namespace OpenClawAgent.ViewModels;

/// <summary>
/// Dashboard view model - shows overview and status
/// </summary>
public partial class DashboardViewModel : ObservableObject
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
    private int _activeJobs;

    [ObservableProperty]
    private int _pendingTasks;

    [ObservableProperty]
    private string _lastSync = "Never";

    private readonly GatewayManager _gatewayManager = GatewayManager.Instance;

    public DashboardViewModel()
    {
        // Subscribe to GatewayManager state changes
        _gatewayManager.PropertyChanged += (s, e) =>
        {
            switch (e.PropertyName)
            {
                case nameof(GatewayManager.IsConnected):
                    GatewayConnected = _gatewayManager.IsConnected;
                    break;
                case nameof(GatewayManager.ActiveGateway):
                    GatewayUrl = _gatewayManager.ActiveGateway?.Url ?? "-";
                    break;
            }
        };
        
        // Initialize with current state
        GatewayConnected = _gatewayManager.IsConnected;
        GatewayUrl = _gatewayManager.ActiveGateway?.Url ?? "-";
    }

    [RelayCommand]
    private void RefreshStatus()
    {
        GatewayConnected = _gatewayManager.IsConnected;
        GatewayUrl = _gatewayManager.ActiveGateway?.Url ?? "-";
        LastSync = DateTime.Now.ToString("HH:mm:ss");
    }
}
