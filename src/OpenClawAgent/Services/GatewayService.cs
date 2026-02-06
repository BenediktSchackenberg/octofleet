using System;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using OpenClawAgent.Models;

namespace OpenClawAgent.Services;

/// <summary>
/// Service for communicating with OpenClaw Gateway via WebSocket protocol
/// </summary>
public class GatewayService : IDisposable
{
    private ClientWebSocket? _webSocket;
    private GatewayConfig? _currentGateway;
    private CancellationTokenSource? _receiveCts;
    private int _requestId = 0;
    private string? _challengeNonce;

    public bool IsConnected => _webSocket?.State == WebSocketState.Open;
    public event EventHandler<ConnectionStateChangedEventArgs>? ConnectionStateChanged;
    public event EventHandler<GatewayMessageEventArgs>? MessageReceived;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public async Task<ConnectionTestResult> TestConnectionAsync(GatewayConfig gateway)
    {
        try
        {
            using var ws = new ClientWebSocket();
            var wsUrl = GetWebSocketUrl(gateway.Url);
            var startTime = DateTime.Now;
            
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await ws.ConnectAsync(new Uri(wsUrl), cts.Token);
            
            var latency = (int)(DateTime.Now - startTime).TotalMilliseconds;

            if (ws.State == WebSocketState.Open)
            {
                // Wait for challenge
                var challengeMsg = await ReceiveMessageAsync(ws, cts.Token);
                
                // Send connect request
                var connectResult = await SendConnectRequestAsync(ws, gateway.Token, null, cts.Token);
                
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Test complete", CancellationToken.None);
                
                if (connectResult.Ok)
                {
                    return new ConnectionTestResult
                    {
                        Success = true,
                        Latency = latency,
                        Version = connectResult.Version ?? "unknown"
                    };
                }
                else
                {
                    return new ConnectionTestResult
                    {
                        Success = false,
                        Error = connectResult.Error ?? "Connect failed"
                    };
                }
            }

            return new ConnectionTestResult
            {
                Success = false,
                Error = "WebSocket connection failed"
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
        _webSocket = new ClientWebSocket();

        var wsUrl = GetWebSocketUrl(gateway.Url);
        
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await _webSocket.ConnectAsync(new Uri(wsUrl), cts.Token);

        if (_webSocket.State != WebSocketState.Open)
        {
            throw new Exception("WebSocket connection failed");
        }

        // Wait for challenge event
        var challengeMsg = await ReceiveMessageAsync(_webSocket, cts.Token);
        if (challengeMsg != null)
        {
            var challengeEvent = JsonSerializer.Deserialize<GatewayEvent>(challengeMsg, JsonOptions);
            if (challengeEvent?.Event == "connect.challenge")
            {
                _challengeNonce = challengeEvent.Payload?.GetProperty("nonce").GetString();
            }
        }

        // Send connect request
        var connectResult = await SendConnectRequestAsync(_webSocket, gateway.Token, _challengeNonce, cts.Token);
        
        if (!connectResult.Ok)
        {
            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Connect rejected", CancellationToken.None);
            throw new Exception($"Connection rejected: {connectResult.Error}");
        }

        _currentGateway.IsConnected = true;
        _currentGateway.Version = connectResult.Version;
        _currentGateway.LastConnected = DateTime.Now;

        // Start receive loop
        _receiveCts = new CancellationTokenSource();
        _ = ReceiveLoopAsync(_receiveCts.Token);

        OnConnectionStateChanged(true);
    }

    public async Task DisconnectAsync()
    {
        _receiveCts?.Cancel();
        
        if (_webSocket != null && _webSocket.State == WebSocketState.Open)
        {
            try
            {
                await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disconnect", CancellationToken.None);
            }
            catch { }
        }
        
        if (_currentGateway != null)
        {
            _currentGateway.IsConnected = false;
            _currentGateway = null;
        }

        _webSocket?.Dispose();
        _webSocket = null;

        OnConnectionStateChanged(false);
    }

    public async Task<GatewayResponse?> SendRequestAsync(string method, object? parameters = null)
    {
        if (_webSocket == null || _webSocket.State != WebSocketState.Open)
        {
            throw new InvalidOperationException("Not connected to gateway");
        }

        var requestId = Interlocked.Increment(ref _requestId).ToString();
        var request = new GatewayRequest
        {
            Type = "req",
            Id = requestId,
            Method = method,
            Params = parameters
        };

        var json = JsonSerializer.Serialize(request, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        
        await _webSocket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);

        // Wait for response with matching id
        // Note: In a real implementation, we'd use a proper request/response correlation
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var responseMsg = await ReceiveMessageAsync(_webSocket, cts.Token);
        
        if (responseMsg != null)
        {
            return JsonSerializer.Deserialize<GatewayResponse>(responseMsg, JsonOptions);
        }

        return null;
    }

    private async Task<ConnectResult> SendConnectRequestAsync(ClientWebSocket ws, string? token, string? nonce, CancellationToken ct)
    {
        var requestId = Interlocked.Increment(ref _requestId).ToString();
        var deviceId = $"win-{Environment.MachineName.GetHashCode():X8}";
        
        var request = new
        {
            type = "req",
            id = requestId,
            method = "connect",
            @params = new
            {
                minProtocol = 3,
                maxProtocol = 3,
                client = new
                {
                    id = "openclaw-windows-agent",
                    version = "0.2.0",
                    platform = "windows",
                    mode = "operator"
                },
                role = "operator",
                scopes = new[] { "operator.read" },
                caps = Array.Empty<string>(),
                commands = Array.Empty<string>(),
                permissions = new { },
                auth = new { token = token ?? "" },
                locale = "en-US",
                userAgent = "openclaw-windows-agent/0.2.0",
                device = new
                {
                    id = deviceId
                }
            }
        };

        var json = JsonSerializer.Serialize(request, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);

        // Wait for response
        var responseMsg = await ReceiveMessageAsync(ws, ct);
        
        if (responseMsg != null)
        {
            var response = JsonSerializer.Deserialize<GatewayResponse>(responseMsg, JsonOptions);
            if (response?.Type == "res" && response.Id == requestId)
            {
                return new ConnectResult
                {
                    Ok = response.Ok,
                    Version = response.Payload?.GetProperty("protocol").GetInt32().ToString(),
                    Error = response.Error?.ToString()
                };
            }
        }

        return new ConnectResult { Ok = false, Error = "No response" };
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[8192];
        var messageBuilder = new StringBuilder();

        while (!ct.IsCancellationRequested && _webSocket?.State == WebSocketState.Open)
        {
            try
            {
                var result = await _webSocket.ReceiveAsync(buffer, ct);
                
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    OnConnectionStateChanged(false);
                    break;
                }

                messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                if (result.EndOfMessage)
                {
                    var message = messageBuilder.ToString();
                    messageBuilder.Clear();
                    
                    MessageReceived?.Invoke(this, new GatewayMessageEventArgs(message));
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception)
            {
                OnConnectionStateChanged(false);
                break;
            }
        }
    }

    private async Task<string?> ReceiveMessageAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[8192];
        var messageBuilder = new StringBuilder();

        while (true)
        {
            var result = await ws.ReceiveAsync(buffer, ct);
            
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

            if (result.EndOfMessage)
            {
                return messageBuilder.ToString();
            }
        }
    }

    private string GetWebSocketUrl(string url)
    {
        // Convert http(s) to ws(s)
        var wsUrl = url.TrimEnd('/');
        if (wsUrl.StartsWith("http://"))
        {
            wsUrl = "ws://" + wsUrl.Substring(7);
        }
        else if (wsUrl.StartsWith("https://"))
        {
            wsUrl = "wss://" + wsUrl.Substring(8);
        }
        else if (!wsUrl.StartsWith("ws://") && !wsUrl.StartsWith("wss://"))
        {
            wsUrl = "ws://" + wsUrl;
        }
        
        return wsUrl;
    }

    private void OnConnectionStateChanged(bool connected)
    {
        ConnectionStateChanged?.Invoke(this, new ConnectionStateChangedEventArgs(connected));
    }

    public void Dispose()
    {
        _receiveCts?.Cancel();
        _receiveCts?.Dispose();
        _webSocket?.Dispose();
    }
}

#region Protocol Models

public class GatewayRequest
{
    public string Type { get; set; } = "req";
    public string Id { get; set; } = "";
    public string Method { get; set; } = "";
    public object? Params { get; set; }
}

public class GatewayResponse
{
    public string Type { get; set; } = "";
    public string Id { get; set; } = "";
    public bool Ok { get; set; }
    public JsonElement? Payload { get; set; }
    public JsonElement? Error { get; set; }
}

public class GatewayEvent
{
    public string Type { get; set; } = "";
    public string Event { get; set; } = "";
    public JsonElement? Payload { get; set; }
}

public class ConnectResult
{
    public bool Ok { get; set; }
    public string? Version { get; set; }
    public string? Error { get; set; }
}

#endregion

#region Event Args

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

#endregion
