using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using OpenClawAgent.Models;

namespace OpenClawAgent.Services;

/// <summary>
/// Service for communicating with OpenClaw Gateway via WebSocket protocol v3
/// </summary>
public class GatewayService : IDisposable
{
    private ClientWebSocket? _webSocket;
    private GatewayConfig? _currentGateway;
    private CancellationTokenSource? _receiveCts;
    private int _requestId = 0;
    private string? _challengeNonce;
    
    // Pending request tracking for request/response correlation
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement?>> _pendingRequests = new();

    public bool IsConnected => _webSocket?.State == WebSocketState.Open;
    public event EventHandler<ConnectionStateChangedEventArgs>? ConnectionStateChanged;
    public event EventHandler<GatewayMessageEventArgs>? MessageReceived;
    public event EventHandler<string>? DebugMessage;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private void Log(string message)
    {
        Debug.WriteLine($"[GatewayService] {message}");
        DebugMessage?.Invoke(this, message);
    }

    public async Task<ConnectionTestResult> TestConnectionAsync(GatewayConfig gateway)
    {
        try
        {
            using var ws = new ClientWebSocket();
            var wsUrl = GetWebSocketUrl(gateway.Url);
            
            // Set Origin header to match gateway URL (required for allowedOrigins check)
            var originUrl = gateway.Url.TrimEnd('/');
            if (originUrl.StartsWith("ws://"))
                originUrl = "http://" + originUrl.Substring(5);
            else if (originUrl.StartsWith("wss://"))
                originUrl = "https://" + originUrl.Substring(6);
            ws.Options.SetRequestHeader("Origin", originUrl);
            
            Log($"Testing connection to {wsUrl} (Origin: {originUrl})");
            var startTime = DateTime.Now;
            
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await ws.ConnectAsync(new Uri(wsUrl), cts.Token);
            
            var latency = (int)(DateTime.Now - startTime).TotalMilliseconds;
            Log($"WebSocket connected in {latency}ms");

            if (ws.State == WebSocketState.Open)
            {
                // Wait for challenge
                var challengeMsg = await ReceiveMessageAsync(ws, cts.Token);
                Log($"Received challenge: {challengeMsg?.Substring(0, Math.Min(200, challengeMsg?.Length ?? 0))}...");
                
                // Extract nonce from challenge
                string? nonce = null;
                if (challengeMsg != null)
                {
                    try
                    {
                        var challenge = JsonSerializer.Deserialize<GatewayEvent>(challengeMsg, JsonOptions);
                        if (challenge?.Event == "connect.challenge" && challenge.Payload.HasValue)
                        {
                            nonce = challenge.Payload.Value.GetProperty("nonce").GetString();
                            Log($"Challenge nonce: {nonce}");
                        }
                    }
                    catch (Exception ex)
                    {
                        Log($"Failed to parse challenge: {ex.Message}");
                    }
                }
                
                // Send connect request
                var connectResult = await SendConnectRequestAsync(ws, gateway.Token, nonce, cts.Token);
                Log($"Connect result: ok={connectResult.Ok}, error={connectResult.Error}");
                
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
        Log($"ConnectAsync starting for {gateway.Url}");
        
        // Disconnect existing connection
        if (_currentGateway != null)
        {
            await DisconnectAsync();
        }

        _currentGateway = gateway;
        _webSocket = new ClientWebSocket();
        
        // Set Origin header to match gateway URL (required for allowedOrigins check)
        var wsUrl = GetWebSocketUrl(gateway.Url);
        var originUrl = gateway.Url.TrimEnd('/');
        if (originUrl.StartsWith("ws://"))
            originUrl = "http://" + originUrl.Substring(5);
        else if (originUrl.StartsWith("wss://"))
            originUrl = "https://" + originUrl.Substring(6);
        _webSocket.Options.SetRequestHeader("Origin", originUrl);
        
        Log($"Connecting to WebSocket: {wsUrl} (Origin: {originUrl})");
        
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await _webSocket.ConnectAsync(new Uri(wsUrl), cts.Token);

        if (_webSocket.State != WebSocketState.Open)
        {
            throw new Exception("WebSocket connection failed");
        }
        Log("WebSocket connected, waiting for challenge...");

        // Wait for challenge event
        var challengeMsg = await ReceiveMessageAsync(_webSocket, cts.Token);
        if (challengeMsg != null)
        {
            Log($"Received: {challengeMsg.Substring(0, Math.Min(200, challengeMsg.Length))}...");
            try
            {
                var challengeEvent = JsonSerializer.Deserialize<GatewayEvent>(challengeMsg, JsonOptions);
                if (challengeEvent?.Event == "connect.challenge" && challengeEvent.Payload.HasValue)
                {
                    _challengeNonce = challengeEvent.Payload.Value.GetProperty("nonce").GetString();
                    Log($"Got challenge nonce: {_challengeNonce}");
                }
            }
            catch (Exception ex)
            {
                Log($"Failed to parse challenge: {ex.Message}");
            }
        }

        // Send connect request
        Log("Sending connect request...");
        var connectResult = await SendConnectRequestAsync(_webSocket, gateway.Token, _challengeNonce, cts.Token);
        Log($"Connect response: ok={connectResult.Ok}, version={connectResult.Version}, error={connectResult.Error}");
        
        if (!connectResult.Ok)
        {
            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Connect rejected", CancellationToken.None);
            throw new Exception($"Connection rejected: {connectResult.Error}");
        }

        _currentGateway.IsConnected = true;
        _currentGateway.Version = connectResult.Version;
        _currentGateway.LastConnected = DateTime.Now;
        Log($"Connected successfully! Protocol version: {connectResult.Version}");

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

    public async Task<JsonElement?> SendRequestAsync(string method, object? parameters = null, int timeoutSeconds = 30)
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

        // Create completion source for this request
        var tcs = new TaskCompletionSource<JsonElement?>();
        _pendingRequests[requestId] = tcs;

        try
        {
            var json = JsonSerializer.Serialize(request, JsonOptions);
            Log($"SendRequest: {method} (id={requestId})");
            var bytes = Encoding.UTF8.GetBytes(json);
            
            await _webSocket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);

            // Wait for response with timeout
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
            cts.Token.Register(() => tcs.TrySetCanceled());
            
            return await tcs.Task;
        }
        finally
        {
            _pendingRequests.TryRemove(requestId, out _);
        }
    }

    private async Task<ConnectResult> SendConnectRequestAsync(ClientWebSocket ws, string? token, string? nonce, CancellationToken ct)
    {
        var requestId = Interlocked.Increment(ref _requestId).ToString();
        
        // Build connect request following OpenClaw Gateway Protocol v3
        // When allowInsecureAuth is enabled on the gateway, device can be omitted
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
                    id = "openclaw-control-ui",  // Known client ID for control UIs
                    version = "0.2.0",
                    platform = "windows",
                    mode = "ui"  // UI mode for graphical control clients
                },
                role = "operator",
                scopes = new[] { "operator.read", "operator.write" },
                caps = Array.Empty<string>(),
                commands = Array.Empty<string>(),
                permissions = new { },
                auth = new { token = token ?? "" },
                locale = System.Globalization.CultureInfo.CurrentCulture.Name,
                userAgent = $"openclaw-windows-agent/0.2.0 ({Environment.OSVersion.Platform})"
                // device omitted - requires gateway.controlUi.allowInsecureAuth: true
            }
        };

        var json = JsonSerializer.Serialize(request, JsonOptions);
        Log($"Sending connect request (full): {json}");
        var bytes = Encoding.UTF8.GetBytes(json);
        
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);

        // Wait for response
        var responseMsg = await ReceiveMessageAsync(ws, ct);
        Log($"Received response: {responseMsg ?? "(null)"}");
        
        if (responseMsg != null)
        {
            var response = JsonSerializer.Deserialize<GatewayResponse>(responseMsg, JsonOptions);
            if (response?.Type == "res" && response.Id == requestId)
            {
                if (response.Ok && response.Payload.HasValue)
                {
                    string? version = null;
                    if (response.Payload.Value.TryGetProperty("protocol", out var protocolProp))
                    {
                        version = protocolProp.GetInt32().ToString();
                    }
                    return new ConnectResult
                    {
                        Ok = true,
                        Version = version
                    };
                }
                else
                {
                    // Extract error message
                    string? errorMsg = null;
                    if (response.Error.HasValue)
                    {
                        if (response.Error.Value.ValueKind == JsonValueKind.String)
                        {
                            errorMsg = response.Error.Value.GetString();
                        }
                        else if (response.Error.Value.TryGetProperty("message", out var msgProp))
                        {
                            errorMsg = msgProp.GetString();
                        }
                        else
                        {
                            errorMsg = response.Error.Value.GetRawText();
                        }
                    }
                    return new ConnectResult
                    {
                        Ok = false,
                        Error = errorMsg ?? "Connection rejected"
                    };
                }
            }
        }

        return new ConnectResult { Ok = false, Error = "No response from gateway" };
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
                    
                    // Try to parse and route responses to pending requests
                    try
                    {
                        using var doc = JsonDocument.Parse(message);
                        var root = doc.RootElement;
                        
                        if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "res")
                        {
                            if (root.TryGetProperty("id", out var idProp))
                            {
                                var requestId = idProp.GetString();
                                if (requestId != null && _pendingRequests.TryRemove(requestId, out var tcs))
                                {
                                    if (root.TryGetProperty("ok", out var okProp) && okProp.GetBoolean())
                                    {
                                        if (root.TryGetProperty("payload", out var payload))
                                        {
                                            tcs.TrySetResult(payload.Clone());
                                        }
                                        else
                                        {
                                            tcs.TrySetResult(null);
                                        }
                                    }
                                    else
                                    {
                                        // Error response
                                        var errorMsg = "Request failed";
                                        if (root.TryGetProperty("error", out var errorProp))
                                        {
                                            if (errorProp.TryGetProperty("message", out var msgProp))
                                            {
                                                errorMsg = msgProp.GetString() ?? errorMsg;
                                            }
                                        }
                                        tcs.TrySetException(new Exception(errorMsg));
                                    }
                                    continue; // Don't emit to MessageReceived for handled responses
                                }
                            }
                        }
                    }
                    catch (JsonException)
                    {
                        // Not JSON or malformed, continue to emit as-is
                    }
                    
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
