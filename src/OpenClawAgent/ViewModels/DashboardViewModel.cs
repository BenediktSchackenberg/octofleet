using CommunityToolkit.Mvvm.ComponentModel;

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

    public DashboardViewModel()
    {
        // Initialize with default values
    }
}
