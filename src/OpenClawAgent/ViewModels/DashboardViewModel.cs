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
    private int _activeSessions;

    [ObservableProperty]
    private int _cronJobs;

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
        };
        
        // Initialize with current state
        GatewayConnected = _gatewayManager.IsConnected;
        GatewayUrl = _gatewayManager.ActiveGateway?.Url ?? "-";
        GatewayUptime = _gatewayManager.GatewayUptime;
        ActiveSessions = _gatewayManager.ActiveSessions;
        CronJobs = _gatewayManager.CronJobs;
        LastSync = _gatewayManager.LastSyncText;
    }

    [RelayCommand]
    private async Task RefreshStatusAsync()
    {
        await _gatewayManager.SyncStatusAsync();
    }
}
