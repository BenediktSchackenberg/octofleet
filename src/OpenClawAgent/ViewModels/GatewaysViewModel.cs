using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using OpenClawAgent.Models;
using OpenClawAgent.Services;
using System.Collections.ObjectModel;

namespace OpenClawAgent.ViewModels;

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

    public GatewaysViewModel()
    {
        LoadGateways();
    }

    private void LoadGateways()
    {
        // TODO: Load from credential store
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
        try
        {
            var service = new GatewayService();
            await service.ConnectAsync(SelectedGateway);
        }
        finally
        {
            IsConnecting = false;
        }
    }

    [RelayCommand]
    private async Task AddGatewayAsync()
    {
        if (string.IsNullOrWhiteSpace(NewGatewayUrl)) return;

        var gateway = new GatewayConfig
        {
            Name = string.IsNullOrWhiteSpace(NewGatewayName) ? "New Gateway" : NewGatewayName,
            Url = NewGatewayUrl,
            Token = NewGatewayToken,
            IsDefault = Gateways.Count == 0
        };

        // Test connection first
        var service = new GatewayService();
        var testResult = await service.TestConnectionAsync(gateway);
        
        if (testResult.Success)
        {
            Gateways.Add(gateway);
            CredentialService.SaveGateway(gateway);
            
            // Clear form
            NewGatewayUrl = "";
            NewGatewayToken = "";
            NewGatewayName = "";
        }
    }

    [RelayCommand]
    private void RemoveGateway()
    {
        if (SelectedGateway == null) return;

        CredentialService.RemoveGateway(SelectedGateway);
        Gateways.Remove(SelectedGateway);
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
    }
}
