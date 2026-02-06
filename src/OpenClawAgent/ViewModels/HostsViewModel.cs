using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OpenClawAgent.Models;
using System.Collections.ObjectModel;

namespace OpenClawAgent.ViewModels;

/// <summary>
/// Remote hosts view model - manage and deploy to remote Windows machines
/// </summary>
public partial class HostsViewModel : ObservableObject
{
    [ObservableProperty]
    private string _title = "Remote Hosts";

    [ObservableProperty]
    private ObservableCollection<RemoteHost> _hosts = new();

    [ObservableProperty]
    private RemoteHost? _selectedHost;

    [ObservableProperty]
    private bool _isDeploying;

    [ObservableProperty]
    private string _deploymentStatus = "";

    // New host form
    [ObservableProperty]
    private string _newHostname = "";

    [ObservableProperty]
    private string _newUsername = "";

    [ObservableProperty]
    private string _newPassword = "";

    [ObservableProperty]
    private bool _useWinRM = true;

    public HostsViewModel()
    {
        LoadHosts();
    }

    private void LoadHosts()
    {
        // TODO: Load from storage
    }

    [RelayCommand]
    private async Task AddHostAsync()
    {
        if (string.IsNullOrWhiteSpace(NewHostname)) return;

        var host = new RemoteHost
        {
            Hostname = NewHostname,
            Username = NewUsername,
            ConnectionType = UseWinRM ? ConnectionType.WinRM : ConnectionType.SMB,
            Status = HostStatus.Unknown
        };

        // Test connection
        host.Status = HostStatus.Testing;
        Hosts.Add(host);

        try
        {
            var success = await TestConnectionAsync(host);
            host.Status = success ? HostStatus.Online : HostStatus.Offline;
        }
        catch
        {
            host.Status = HostStatus.Error;
        }

        // Clear form
        NewHostname = "";
        NewUsername = "";
        NewPassword = "";
    }

    [RelayCommand]
    private void RemoveHost()
    {
        if (SelectedHost == null) return;
        Hosts.Remove(SelectedHost);
    }

    [RelayCommand]
    private async Task DeployToHostAsync()
    {
        if (SelectedHost == null) return;

        IsDeploying = true;
        DeploymentStatus = $"Deploying to {SelectedHost.Hostname}...";

        try
        {
            await DeployAgentAsync(SelectedHost);
            SelectedHost.Status = HostStatus.Deployed;
            DeploymentStatus = $"Successfully deployed to {SelectedHost.Hostname}";
        }
        catch (Exception ex)
        {
            SelectedHost.Status = HostStatus.Error;
            DeploymentStatus = $"Failed: {ex.Message}";
        }
        finally
        {
            IsDeploying = false;
        }
    }

    [RelayCommand]
    private async Task DeployToAllAsync()
    {
        IsDeploying = true;
        var results = new List<(RemoteHost Host, bool Success, string Message)>();

        foreach (var host in Hosts.Where(h => h.Status == HostStatus.Online))
        {
            DeploymentStatus = $"Deploying to {host.Hostname}...";
            
            try
            {
                await DeployAgentAsync(host);
                host.Status = HostStatus.Deployed;
                results.Add((host, true, "Success"));
            }
            catch (Exception ex)
            {
                host.Status = HostStatus.Error;
                results.Add((host, false, ex.Message));
            }
        }

        var successCount = results.Count(r => r.Success);
        DeploymentStatus = $"Deployment complete: {successCount}/{results.Count} succeeded";
        IsDeploying = false;
    }

    [RelayCommand]
    private async Task RefreshStatusAsync()
    {
        foreach (var host in Hosts)
        {
            host.Status = HostStatus.Testing;
            try
            {
                var online = await TestConnectionAsync(host);
                host.Status = online ? HostStatus.Online : HostStatus.Offline;
            }
            catch
            {
                host.Status = HostStatus.Error;
            }
        }
    }

    private async Task<bool> TestConnectionAsync(RemoteHost host)
    {
        // TODO: Implement WinRM/SMB connection test
        await Task.Delay(1000); // Simulate test
        return true;
    }

    private async Task DeployAgentAsync(RemoteHost host)
    {
        // TODO: Implement remote deployment via WinRM/PowerShell Remoting
        // 1. Copy agent files to remote host
        // 2. Execute installation
        // 3. Register with gateway
        await Task.Delay(2000); // Simulate deployment
    }
}
