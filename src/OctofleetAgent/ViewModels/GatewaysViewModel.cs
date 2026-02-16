using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OctofleetAgent.Models;
using OctofleetAgent.Services;
using System.Collections.ObjectModel;

namespace OctofleetAgent.ViewModels;

/// <summary>
/// Gateways view model - manage gateway connections
/// </summary>
public partial class GatewaysViewModel : ObservableObject
{
    [ObservableProperty]
    private string _title = "Gateway Connections";

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
    private string _statusMessage = "";

    [ObservableProperty]
    private bool _isStatusError;

    private readonly GatewayManager _gatewayManager = GatewayManager.Instance;

    public GatewaysViewModel()
    {
        LoadGateways();
        
        // Subscribe to manager status updates
        _gatewayManager.PropertyChanged += (s, e) =>
        {
            if (e.PropertyName == nameof(GatewayManager.StatusMessage))
            {
                StatusMessage = _gatewayManager.StatusMessage;
            }
        };
    }

    private void LoadGateways()
    {
        // Load from credential store
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
        IsStatusError = false;
        
        try
        {
            await _gatewayManager.ConnectAsync(SelectedGateway);
            StatusMessage = $"Connected to {SelectedGateway.Name}!";
            SelectedGateway.IsConnected = true;
        }
        catch (Exception ex)
        {
            StatusMessage = $"Connection failed: {ex.Message}";
            IsStatusError = true;
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
        IsStatusError = false;
        StatusMessage = "Testing connection...";
        
        try
        {
            var result = await _gatewayManager.TestConnectionAsync(SelectedGateway);
            if (result.Success)
            {
                StatusMessage = $"✓ Connection successful! Latency: {result.Latency}ms, Version: {result.Version}";
                SelectedGateway.Latency = result.Latency;
                SelectedGateway.Version = result.Version;
            }
            else
            {
                StatusMessage = $"✗ Connection failed: {result.Error}";
                IsStatusError = true;
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Test error: {ex.Message}";
            IsStatusError = true;
        }
        finally
        {
            IsConnecting = false;
        }
    }

    [RelayCommand]
    private void AddGateway()
    {
        System.Diagnostics.Debug.WriteLine($"AddGateway called! URL={NewGatewayUrl}, Name={NewGatewayName}");
        
        if (string.IsNullOrWhiteSpace(NewGatewayUrl))
        {
            StatusMessage = "Please enter a Gateway URL";
            IsStatusError = true;
            return;
        }

        var gateway = new GatewayConfig
        {
            Name = string.IsNullOrWhiteSpace(NewGatewayName) ? "New Gateway" : NewGatewayName,
            Url = NewGatewayUrl,
            Token = NewGatewayToken,
            IsDefault = Gateways.Count == 0
        };

        // Add gateway to list (we'll test connection when user clicks Connect)
        Gateways.Add(gateway);
        CredentialService.SaveGateway(gateway);
        
        StatusMessage = $"Gateway '{gateway.Name}' added! Click Connect to test.";
        IsStatusError = false;
        
        // Clear form
        NewGatewayUrl = "";
        NewGatewayToken = "";
        NewGatewayName = "";
        
        // Select the new gateway
        SelectedGateway = gateway;
    }

    [RelayCommand]
    private void RemoveGateway()
    {
        if (SelectedGateway == null) return;

        CredentialService.RemoveGateway(SelectedGateway);
        Gateways.Remove(SelectedGateway);
        StatusMessage = "Gateway removed.";
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
        StatusMessage = $"{SelectedGateway.Name} set as default.";
    }

    [RelayCommand]
    private async Task DisconnectAsync()
    {
        await _gatewayManager.DisconnectAsync();
        
        if (SelectedGateway != null)
        {
            SelectedGateway.IsConnected = false;
        }
        
        StatusMessage = "Disconnected.";
    }
}
