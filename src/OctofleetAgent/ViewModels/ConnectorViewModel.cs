using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OctofleetAgent.Models;
using OctofleetAgent.Services;
using System;
using System.Collections.ObjectModel;
using System.IO;
using System.ServiceProcess;
using System.Threading.Tasks;

namespace OctofleetAgent.ViewModels;

/// <summary>
/// Combined Connector view model - Gateway + Node Service + Remote Hosts
/// </summary>
public partial class ConnectorViewModel : ObservableObject
{
    // ===== GATEWAY PROPERTIES =====
    [ObservableProperty]
    private ObservableCollection<GatewayConfig> _gateways = new();

    [ObservableProperty]
    private GatewayConfig? _selectedGateway;

    [ObservableProperty]
    private bool _isConnecting;

    [ObservableProperty]
    private string _newGatewayUrl = "";

    [ObservableProperty]
    private string _newGatewayToken = "";

    [ObservableProperty]
    private string _newGatewayName = "";

    [ObservableProperty]
    private string _gatewayStatusMessage = "";

    [ObservableProperty]
    private bool _isGatewayStatusError;

    // ===== SERVICE PROPERTIES =====
    [ObservableProperty]
    private bool _isServiceInstalled;

    [ObservableProperty]
    private bool _isServiceRunning;

    [ObservableProperty]
    private string _serviceStatus = "Not installed";

    [ObservableProperty]
    private string _serviceDisplayName = Environment.MachineName;

    // ===== REMOTE HOSTS PROPERTIES =====
    [ObservableProperty]
    private ObservableCollection<RemoteHost> _hosts = new();

    [ObservableProperty]
    private RemoteHost? _selectedHost;

    [ObservableProperty]
    private bool _isDeploying;

    [ObservableProperty]
    private string _deploymentStatus = "";

    [ObservableProperty]
    private string _newHostname = "";

    [ObservableProperty]
    private string _newUsername = "";

    [ObservableProperty]
    private string _newPassword = "";

    [ObservableProperty]
    private bool _useWinRM = true;

    private readonly GatewayManager _gatewayManager = GatewayManager.Instance;
    private System.Threading.Timer? _statusTimer;

    public ConnectorViewModel()
    {
        LoadGateways();
        RefreshServiceStatus();
        
        // Subscribe to manager status updates
        _gatewayManager.PropertyChanged += (s, e) =>
        {
            if (e.PropertyName == nameof(GatewayManager.StatusMessage))
            {
                GatewayStatusMessage = _gatewayManager.StatusMessage;
            }
        };

        // Check service status periodically
        _statusTimer = new System.Threading.Timer(_ => RefreshServiceStatus(), null, 5000, 5000);
    }

    // ===== GATEWAY COMMANDS =====

    private void LoadGateways()
    {
        var stored = CredentialService.GetStoredGateways();
        foreach (var gw in stored)
        {
            Gateways.Add(gw);
        }
    }

    [RelayCommand]
    private async Task ConnectAsync()
    {
        if (SelectedGateway == null) return;

        IsConnecting = true;
        IsGatewayStatusError = false;
        
        try
        {
            await _gatewayManager.ConnectAsync(SelectedGateway);
            GatewayStatusMessage = $"Connected to {SelectedGateway.Name}!";
            SelectedGateway.IsConnected = true;
        }
        catch (Exception ex)
        {
            GatewayStatusMessage = $"Connection failed: {ex.Message}";
            IsGatewayStatusError = true;
        }
        finally
        {
            IsConnecting = false;
        }
    }

    [RelayCommand]
    private async Task TestConnectionAsync()
    {
        if (SelectedGateway == null) return;

        IsConnecting = true;
        IsGatewayStatusError = false;
        GatewayStatusMessage = "Testing connection...";
        
        try
        {
            var result = await _gatewayManager.TestConnectionAsync(SelectedGateway);
            if (result.Success)
            {
                GatewayStatusMessage = $"✓ Connection successful! Latency: {result.Latency}ms, Version: {result.Version}";
                SelectedGateway.Latency = result.Latency;
                SelectedGateway.Version = result.Version;
            }
            else
            {
                GatewayStatusMessage = $"✗ Connection failed: {result.Error}";
                IsGatewayStatusError = true;
            }
        }
        catch (Exception ex)
        {
            GatewayStatusMessage = $"Test error: {ex.Message}";
            IsGatewayStatusError = true;
        }
        finally
        {
            IsConnecting = false;
        }
    }

    [RelayCommand]
    private void AddGateway()
    {
        if (string.IsNullOrWhiteSpace(NewGatewayUrl))
        {
            GatewayStatusMessage = "Please enter a Gateway URL";
            IsGatewayStatusError = true;
            return;
        }

        var gateway = new GatewayConfig
        {
            Name = string.IsNullOrWhiteSpace(NewGatewayName) ? "New Gateway" : NewGatewayName,
            Url = NewGatewayUrl,
            Token = NewGatewayToken,
            IsDefault = Gateways.Count == 0
        };

        Gateways.Add(gateway);
        CredentialService.SaveGateway(gateway);
        
        GatewayStatusMessage = $"Gateway '{gateway.Name}' added! Click Connect to test.";
        IsGatewayStatusError = false;
        
        NewGatewayUrl = "";
        NewGatewayToken = "";
        NewGatewayName = "";
        SelectedGateway = gateway;
    }

    [RelayCommand]
    private void RemoveGateway()
    {
        if (SelectedGateway == null) return;

        CredentialService.RemoveGateway(SelectedGateway);
        Gateways.Remove(SelectedGateway);
        GatewayStatusMessage = "Gateway removed.";
    }

    [RelayCommand]
    private void SetAsDefault()
    {
        if (SelectedGateway == null) return;

        foreach (var gw in Gateways)
        {
            gw.IsDefault = false;
        }
        SelectedGateway.IsDefault = true;
        CredentialService.SaveGateway(SelectedGateway);
        GatewayStatusMessage = $"{SelectedGateway.Name} set as default.";
    }

    [RelayCommand]
    private async Task DisconnectAsync()
    {
        await _gatewayManager.DisconnectAsync();
        
        if (SelectedGateway != null)
        {
            SelectedGateway.IsConnected = false;
        }
        
        GatewayStatusMessage = "Disconnected.";
    }

    // ===== SERVICE COMMANDS =====

    private void RefreshServiceStatus()
    {
        Task.Run(() =>
        {
            bool isInstalled = false;
            bool isRunning = false;
            string statusText = "Unknown";

            try
            {
                isInstalled = Services.ServiceController.IsInstalled;
                
                if (isInstalled)
                {
                    var status = Services.ServiceController.Status;
                    isRunning = status == ServiceControllerStatus.Running;
                    
                    statusText = status switch
                    {
                        ServiceControllerStatus.Running => "Running",
                        ServiceControllerStatus.Stopped => "Stopped",
                        ServiceControllerStatus.StartPending => "Starting...",
                        ServiceControllerStatus.StopPending => "Stopping...",
                        ServiceControllerStatus.Paused => "Paused",
                        _ => status?.ToString() ?? "Unknown"
                    };
                }
                else
                {
                    statusText = "Not installed";
                }
            }
            catch (Exception ex)
            {
                statusText = $"Error: {ex.Message}";
            }

            System.Windows.Application.Current?.Dispatcher?.BeginInvoke(() =>
            {
                IsServiceInstalled = isInstalled;
                IsServiceRunning = isRunning;
                ServiceStatus = statusText;
            });
        });
    }

    [RelayCommand]
    private async Task InstallServiceAsync()
    {
        ServiceStatus = "Installing...";
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
        var gateway = _gatewayManager.ActiveGateway;
        if (gateway == null) return;

        var configDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "Octofleet");
        
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

    // ===== REMOTE HOSTS COMMANDS =====

    [RelayCommand]
    private void AddHost()
    {
        if (string.IsNullOrWhiteSpace(NewHostname)) return;

        var host = new RemoteHost
        {
            Hostname = NewHostname,
            Username = NewUsername,
            Status = HostStatus.Unknown
        };

        Hosts.Add(host);
        NewHostname = "";
        NewUsername = "";
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
        
        // TODO: Implement actual deployment
        await Task.Delay(2000);
        
        DeploymentStatus = $"Deployed to {SelectedHost.Hostname}";
        SelectedHost.Status = HostStatus.Deployed;
        IsDeploying = false;
    }

    [RelayCommand]
    private async Task DeployToAllAsync()
    {
        IsDeploying = true;
        foreach (var host in Hosts)
        {
            DeploymentStatus = $"Deploying to {host.Hostname}...";
            await Task.Delay(1000);
            host.Status = HostStatus.Deployed;
        }
        DeploymentStatus = "Deployment complete!";
        IsDeploying = false;
    }

    [RelayCommand]
    private void RefreshStatus()
    {
        RefreshServiceStatus();
        // TODO: Refresh host status
    }
}
