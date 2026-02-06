using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OpenClawAgent.Models;
using OpenClawAgent.Services;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.ServiceProcess;
using System.Threading.Tasks;

namespace OpenClawAgent.ViewModels;

/// <summary>
/// Remote hosts view model - manage and deploy to remote Windows machines
/// Also handles local node registration with Gateway
/// </summary>
public partial class HostsViewModel : ObservableObject
{
    [ObservableProperty]
    private string _title = "Hosts & Node";

    [ObservableProperty]
    private ObservableCollection<RemoteHost> _hosts = new();

    [ObservableProperty]
    private RemoteHost? _selectedHost;

    [ObservableProperty]
    private bool _isDeploying;

    [ObservableProperty]
    private string _deploymentStatus = "";

    // Service Status
    [ObservableProperty]
    private bool _isServiceInstalled;

    [ObservableProperty]
    private bool _isServiceRunning;

    [ObservableProperty]
    private string _serviceStatus = "Not installed";

    [ObservableProperty]
    private string _serviceDisplayName = Environment.MachineName;

    // Legacy Node registration (for testing without service)
    [ObservableProperty]
    private bool _isNodeConnected;

    [ObservableProperty]
    private bool _isNodePaired;

    [ObservableProperty]
    private string _nodeStatus = "Not registered";

    [ObservableProperty]
    private string _nodeDisplayName = Environment.MachineName;

    // New host form
    [ObservableProperty]
    private string _newHostname = "";

    [ObservableProperty]
    private string _newUsername = "";

    [ObservableProperty]
    private string _newPassword = "";

    [ObservableProperty]
    private bool _useWinRM = true;

    private readonly NodeManager _nodeManager = NodeManager.Instance;
    private readonly GatewayManager _gatewayManager = GatewayManager.Instance;
    private System.Threading.Timer? _statusTimer;

    public HostsViewModel()
    {
        // Subscribe to NodeManager state
        _nodeManager.PropertyChanged += (s, e) =>
        {
            switch (e.PropertyName)
            {
                case nameof(NodeManager.IsConnected):
                    IsNodeConnected = _nodeManager.IsConnected;
                    break;
                case nameof(NodeManager.IsPaired):
                    IsNodePaired = _nodeManager.IsPaired;
                    break;
                case nameof(NodeManager.StatusMessage):
                    NodeStatus = _nodeManager.StatusMessage;
                    break;
            }
        };

        // Initialize with current state
        IsNodeConnected = _nodeManager.IsConnected;
        IsNodePaired = _nodeManager.IsPaired;
        NodeStatus = _nodeManager.StatusMessage;
        NodeDisplayName = _nodeManager.DisplayName;

        // Check service status periodically
        RefreshServiceStatus();
        _statusTimer = new System.Threading.Timer(_ => RefreshServiceStatus(), null, 5000, 5000);

        LoadHosts();
    }

    private void RefreshServiceStatus()
    {
        try
        {
            IsServiceInstalled = Services.ServiceController.IsInstalled;
            var status = Services.ServiceController.Status;
            
            if (!IsServiceInstalled)
            {
                ServiceStatus = "Not installed";
                IsServiceRunning = false;
            }
            else if (status == ServiceControllerStatus.Running)
            {
                ServiceStatus = "Running";
                IsServiceRunning = true;
            }
            else if (status == ServiceControllerStatus.Stopped)
            {
                ServiceStatus = "Stopped";
                IsServiceRunning = false;
            }
            else if (status == ServiceControllerStatus.StartPending)
            {
                ServiceStatus = "Starting...";
                IsServiceRunning = false;
            }
            else if (status == ServiceControllerStatus.StopPending)
            {
                ServiceStatus = "Stopping...";
                IsServiceRunning = true;
            }
            else
            {
                ServiceStatus = status?.ToString() ?? "Unknown";
                IsServiceRunning = false;
            }
        }
        catch
        {
            IsServiceInstalled = false;
            IsServiceRunning = false;
            ServiceStatus = "Error checking status";
        }
    }

    private void LoadHosts()
    {
        // TODO: Load from storage
    }

    // ===== SERVICE COMMANDS =====

    [RelayCommand]
    private async Task InstallServiceAsync()
    {
        ServiceStatus = "Installing...";
        
        // First, save config for the service
        SaveServiceConfig();
        
        var (success, message) = await Services.ServiceController.InstallAsync();
        
        if (success)
        {
            ServiceStatus = "Installed - Starting...";
            await StartServiceAsync();
        }
        else
        {
            ServiceStatus = $"Install failed: {message}";
        }
        
        RefreshServiceStatus();
    }

    [RelayCommand]
    private async Task UninstallServiceAsync()
    {
        ServiceStatus = "Uninstalling...";
        var (success, message) = await Services.ServiceController.UninstallAsync();
        ServiceStatus = success ? "Uninstalled" : $"Failed: {message}";
        RefreshServiceStatus();
    }

    [RelayCommand]
    private async Task StartServiceAsync()
    {
        ServiceStatus = "Starting...";
        var (success, message) = await Services.ServiceController.StartAsync();
        ServiceStatus = success ? "Running" : $"Failed: {message}";
        RefreshServiceStatus();
    }

    [RelayCommand]
    private async Task StopServiceAsync()
    {
        ServiceStatus = "Stopping...";
        var (success, message) = await Services.ServiceController.StopAsync();
        ServiceStatus = success ? "Stopped" : $"Failed: {message}";
        RefreshServiceStatus();
    }

    [RelayCommand]
    private async Task RestartServiceAsync()
    {
        ServiceStatus = "Restarting...";
        var (success, message) = await Services.ServiceController.RestartAsync();
        ServiceStatus = success ? "Running" : $"Failed: {message}";
        RefreshServiceStatus();
    }

    private void SaveServiceConfig()
    {
        // Get gateway config and save for service
        var gateway = _gatewayManager.ActiveGateway;
        if (gateway == null) return;

        var configDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "OpenClaw");
        
        Directory.CreateDirectory(configDir);
        
        var config = new
        {
            GatewayUrl = gateway.Url,
            GatewayToken = gateway.Token,
            DisplayName = ServiceDisplayName,
            AutoStart = true
        };

        var json = System.Text.Json.JsonSerializer.Serialize(config, 
            new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        
        File.WriteAllText(Path.Combine(configDir, "service-config.json"), json);
    }

    // ===== LEGACY NODE REGISTRATION (for testing) =====

    [RelayCommand]
    private async Task RegisterAsNodeAsync()
    {
        var gateway = _gatewayManager.ActiveGateway;
        if (gateway == null)
        {
            NodeStatus = "Error: No gateway connected. Connect to a gateway first.";
            return;
        }

        _nodeManager.DisplayName = NodeDisplayName;

        try
        {
            await _nodeManager.RegisterAsync(gateway);
        }
        catch (Exception ex)
        {
            NodeStatus = $"Registration failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task UnregisterNodeAsync()
    {
        await _nodeManager.UnregisterAsync();
    }

    // ===== REMOTE HOSTS =====

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
        RefreshServiceStatus();
        
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
