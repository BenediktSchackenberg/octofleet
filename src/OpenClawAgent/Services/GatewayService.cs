using OpenClawAgent.Models;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace OpenClawAgent.Services;

/// <summary>
/// Service for communicating with OpenClaw Gateway
/// </summary>
public class GatewayService : IDisposable
{
    private HttpClient? _httpClient;
    private GatewayConfig? _currentGateway;
    private CancellationTokenSource? _heartbeatCts;

    public bool IsConnected => _currentGateway?.IsConnected ?? false;
    public event EventHandler<ConnectionStateChangedEventArgs>? ConnectionStateChanged;
    public event EventHandler<GatewayMessageEventArgs>? MessageReceived;

    public async Task<ConnectionTestResult> TestConnectionAsync(GatewayConfig gateway)
    {
        try
        {
            using var client = CreateHttpClient(gateway);
            var startTime = DateTime.Now;
            
            var response = await client.GetAsync("status");
            var latency = (int)(DateTime.Now - startTime).TotalMilliseconds;

            if (response.IsSuccessStatusCode)
            {
                var status = await response.Content.ReadFromJsonAsync<GatewayStatus>();
                return new ConnectionTestResult
                {
                    Success = true,
                    Latency = latency,
                    Version = status?.Version ?? "unknown"
                };
            }

            return new ConnectionTestResult
            {
                Success = false,
                Error = $"HTTP {(int)response.StatusCode}: {response.ReasonPhrase}"
            };
        }
        catch (Exception ex)
        {
            return new ConnectionTestResult
            {
                Success = false,
                Error = ex.Message
            };
        }
    }

    public async Task ConnectAsync(GatewayConfig gateway)
    {
        // Disconnect existing connection
        if (_currentGateway != null)
        {
            await DisconnectAsync();
        }

        _currentGateway = gateway;
        _httpClient = CreateHttpClient(gateway);

        // Test connection
        var testResult = await TestConnectionAsync(gateway);
        if (!testResult.Success)
        {
            throw new Exception($"Connection failed: {testResult.Error}");
        }

        _currentGateway.IsConnected = true;
        _currentGateway.Latency = testResult.Latency;
        _currentGateway.Version = testResult.Version;
        _currentGateway.LastConnected = DateTime.Now;

        // Start heartbeat
        _heartbeatCts = new CancellationTokenSource();
        _ = HeartbeatLoopAsync(_heartbeatCts.Token);

        OnConnectionStateChanged(true);
    }

    public async Task DisconnectAsync()
    {
        _heartbeatCts?.Cancel();
        
        if (_currentGateway != null)
        {
            _currentGateway.IsConnected = false;
            _currentGateway = null;
        }

        _httpClient?.Dispose();
        _httpClient = null;

        OnConnectionStateChanged(false);
        await Task.CompletedTask;
    }

    public async Task<string> ExecuteCommandAsync(string command)
    {
        if (_httpClient == null || !IsConnected)
        {
            throw new InvalidOperationException("Not connected to gateway");
        }

        var response = await _httpClient.PostAsJsonAsync("exec", new { command });
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadAsStringAsync();
        return result;
    }

    public async Task<GatewayStatus?> GetStatusAsync()
    {
        if (_httpClient == null) return null;

        var response = await _httpClient.GetAsync("status");
        if (response.IsSuccessStatusCode)
        {
            return await response.Content.ReadFromJsonAsync<GatewayStatus>();
        }
        return null;
    }

    private async Task HeartbeatLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
                
                if (_httpClient != null)
                {
                    var startTime = DateTime.Now;
                    var response = await _httpClient.GetAsync("ping", cancellationToken);
                    
                    if (_currentGateway != null)
                    {
                        _currentGateway.Latency = (int)(DateTime.Now - startTime).TotalMilliseconds;
                    }

                    if (!response.IsSuccessStatusCode)
                    {
                        OnConnectionStateChanged(false);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                OnConnectionStateChanged(false);
            }
        }
    }

    private HttpClient CreateHttpClient(GatewayConfig gateway)
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri(gateway.Url.TrimEnd('/') + "/"),
            Timeout = TimeSpan.FromSeconds(30)
        };

        if (!string.IsNullOrEmpty(gateway.Token))
        {
            client.DefaultRequestHeaders.Authorization = 
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", gateway.Token);
        }

        return client;
    }

    private void OnConnectionStateChanged(bool connected)
    {
        ConnectionStateChanged?.Invoke(this, new ConnectionStateChangedEventArgs(connected));
    }

    public void Dispose()
    {
        _heartbeatCts?.Cancel();
        _heartbeatCts?.Dispose();
        _httpClient?.Dispose();
    }
}

public class ConnectionTestResult
{
    public bool Success { get; set; }
    public int Latency { get; set; }
    public string? Version { get; set; }
    public string? Error { get; set; }
}

public class GatewayStatus
{
    public string? Version { get; set; }
    public string? Mode { get; set; }
    public long Uptime { get; set; }
    public int ActiveSessions { get; set; }
}

public class ConnectionStateChangedEventArgs : EventArgs
{
    public bool IsConnected { get; }
    public ConnectionStateChangedEventArgs(bool isConnected) => IsConnected = isConnected;
}

public class GatewayMessageEventArgs : EventArgs
{
    public string Message { get; }
    public GatewayMessageEventArgs(string message) => Message = message;
}
