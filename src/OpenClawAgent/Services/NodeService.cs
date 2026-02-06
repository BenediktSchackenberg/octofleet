using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using OpenClawAgent.Models;

namespace OpenClawAgent.Services;

/// <summary>
/// Service for registering as a Node with OpenClaw Gateway.
/// Nodes can execute commands, take screenshots, etc.
/// </summary>
public class NodeService : IDisposable
{
    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _receiveCts;
    private int _requestId = 0;
    private string? _nodeId;
    private bool _isPaired;
    
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement?>> _pendingRequests = new();

    public bool IsConnected => _webSocket?.State == WebSocketState.Open;
    public bool IsPaired => _isPaired;
    public string? NodeId => _nodeId;
    
    public event EventHandler<bool>? ConnectionStateChanged;
    public event EventHandler<string>? DebugMessage;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    private void Log(string message)
    {
        DebugMessage?.Invoke(this, $"[NodeService] {message}");
    }

    /// <summary>
    /// Connect to Gateway as a Node (not Control UI)
    /// </summary>
    public async Task ConnectAsync(GatewayConfig gateway, string displayName)
    {
        if (_webSocket != null)
        {
            await DisconnectAsync();
        }

        _webSocket = new ClientWebSocket();
        
        // Set Origin header
        var uri = new Uri(gateway.Url);
        var origin = $"{uri.Scheme}://{uri.Host}:{uri.Port}";
        _webSocket.Options.SetRequestHeader("Origin", origin);

        // Convert http(s) to ws(s)
        var wsUrl = gateway.Url
            .Replace("https://", "wss://")
            .Replace("http://", "ws://");
        
        if (!wsUrl.EndsWith("/"))
            wsUrl += "/";

        Log($"Connecting to {wsUrl} as Node...");
        
        using var connectCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await _webSocket.ConnectAsync(new Uri(wsUrl), connectCts.Token);

        Log("WebSocket connected, waiting for challenge...");

        // Wait for connect.challenge event
        var challengeMsg = await ReceiveMessageAsync(_webSocket, connectCts.Token);
        if (challengeMsg == null)
        {
            throw new Exception("No challenge received from gateway");
        }

        Log($"Received: {challengeMsg}");

        string? nonce = null;
        using (var doc = JsonDocument.Parse(challengeMsg))
        {
            var root = doc.RootElement;
            if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "event")
            {
                if (root.TryGetProperty("event", out var eventProp) && eventProp.GetString() == "connect.challenge")
                {
                    if (root.TryGetProperty("payload", out var payload) && payload.TryGetProperty("nonce", out var nonceProp))
                    {
                        nonce = nonceProp.GetString();
                    }
                }
            }
        }

        if (nonce == null)
        {
            throw new Exception("Could not extract nonce from challenge");
        }

        // Send connect request with role: node
        var result = await SendNodeConnectRequestAsync(_webSocket, gateway.Token, nonce, displayName, connectCts.Token);
        
        if (!result.Ok)
        {
            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Connect failed", CancellationToken.None);
            _webSocket.Dispose();
            _webSocket = null;
            throw new Exception($"Node registration failed: {result.Error}");
        }

        _nodeId = result.NodeId;
        _isPaired = result.IsPaired;
        
        Log($"Connected as Node! ID={_nodeId}, Paired={_isPaired}");

        // Start receive loop for commands
        _receiveCts = new CancellationTokenSource();
        _ = ReceiveLoopAsync(_receiveCts.Token);

        ConnectionStateChanged?.Invoke(this, true);
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

        _webSocket?.Dispose();
        _webSocket = null;
        _isPaired = false;

        ConnectionStateChanged?.Invoke(this, false);
    }

    private async Task<NodeConnectResult> SendNodeConnectRequestAsync(ClientWebSocket ws, string? token, string? nonce, string displayName, CancellationToken ct)
    {
        var requestId = Interlocked.Increment(ref _requestId).ToString();
        
        // Build connect request with role: node
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
                    id = "openclaw-windows-node",
                    version = "0.2.0",
                    platform = "windows",
                    mode = "node"
                },
                role = "node",
                scopes = new[] { "node" },
                displayName = displayName,
                capabilities = new
                {
                    system = new { run = true, which = true },
                    // Future: screen, clipboard, etc.
                },
                auth = new
                {
                    kind = "token",
                    token = token
                }
            }
        };

        var json = JsonSerializer.Serialize(request, JsonOptions);
        Log($"Sending node connect: {json}");
        
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);

        // Wait for response
        var responseMsg = await ReceiveMessageAsync(ws, ct);
        if (responseMsg != null)
        {
            Log($"Connect response: {responseMsg}");
            
            using var doc = JsonDocument.Parse(responseMsg);
            var root = doc.RootElement;
            
            if (root.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "res")
            {
                if (root.TryGetProperty("ok", out var okProp) && okProp.GetBoolean())
                {
                    string? nodeId = null;
                    bool isPaired = false;
                    
                    if (root.TryGetProperty("payload", out var payload))
                    {
                        if (payload.TryGetProperty("nodeId", out var nodeIdProp))
                            nodeId = nodeIdProp.GetString();
                        if (payload.TryGetProperty("paired", out var pairedProp))
                            isPaired = pairedProp.GetBoolean();
                    }
                    
                    return new NodeConnectResult { Ok = true, NodeId = nodeId, IsPaired = isPaired };
                }
                else
                {
                    // Error response
                    string? errorMsg = null;
                    if (root.TryGetProperty("error", out var errorProp))
                    {
                        if (errorProp.TryGetProperty("message", out var msgProp))
                            errorMsg = msgProp.GetString();
                        else if (errorProp.TryGetProperty("reason", out var reasonProp))
                            errorMsg = reasonProp.GetString();
                    }
                    return new NodeConnectResult { Ok = false, Error = errorMsg ?? "Unknown error" };
                }
            }
        }

        return new NodeConnectResult { Ok = false, Error = "No response from gateway" };
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
                    ConnectionStateChanged?.Invoke(this, false);
                    break;
                }

                messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                if (result.EndOfMessage)
                {
                    var message = messageBuilder.ToString();
                    messageBuilder.Clear();
                    
                    await HandleMessageAsync(message);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Log($"Receive error: {ex.Message}");
                ConnectionStateChanged?.Invoke(this, false);
                break;
            }
        }
    }

    private async Task HandleMessageAsync(string message)
    {
        try
        {
            using var doc = JsonDocument.Parse(message);
            var root = doc.RootElement;
            
            if (!root.TryGetProperty("type", out var typeProp))
                return;
                
            var type = typeProp.GetString();
            
            if (type == "req")
            {
                // Gateway is invoking a command on us
                await HandleCommandRequestAsync(root);
            }
            else if (type == "res")
            {
                // Response to our request
                if (root.TryGetProperty("id", out var idProp))
                {
                    var requestId = idProp.GetString();
                    if (requestId != null && _pendingRequests.TryRemove(requestId, out var tcs))
                    {
                        if (root.TryGetProperty("ok", out var okProp) && okProp.GetBoolean())
                        {
                            if (root.TryGetProperty("payload", out var payload))
                                tcs.TrySetResult(payload.Clone());
                            else
                                tcs.TrySetResult(null);
                        }
                        else
                        {
                            tcs.TrySetException(new Exception("Request failed"));
                        }
                    }
                }
            }
            else if (type == "event")
            {
                // Gateway event
                if (root.TryGetProperty("event", out var eventProp))
                {
                    var eventName = eventProp.GetString();
                    Log($"Event: {eventName}");
                    
                    if (eventName == "node.paired")
                    {
                        _isPaired = true;
                        Log("Node has been approved/paired!");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Log($"Error handling message: {ex.Message}");
        }
    }

    private async Task HandleCommandRequestAsync(JsonElement root)
    {
        string? requestId = null;
        string? method = null;
        JsonElement? parameters = null;
        
        if (root.TryGetProperty("id", out var idProp))
            requestId = idProp.GetString();
        if (root.TryGetProperty("method", out var methodProp))
            method = methodProp.GetString();
        if (root.TryGetProperty("params", out var paramsProp))
            parameters = paramsProp;

        Log($"Command request: {method} (id={requestId})");

        object? result = null;
        string? error = null;

        try
        {
            switch (method)
            {
                case "system.run":
                    result = await ExecuteSystemRunAsync(parameters);
                    break;
                case "system.which":
                    result = ExecuteSystemWhich(parameters);
                    break;
                case "node.ping":
                    result = new { pong = true, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                    break;
                default:
                    error = $"Unknown command: {method}";
                    break;
            }
        }
        catch (Exception ex)
        {
            error = ex.Message;
        }

        // Send response
        await SendResponseAsync(requestId, result, error);
    }

    private async Task<object> ExecuteSystemRunAsync(JsonElement? parameters)
    {
        if (parameters == null)
            throw new ArgumentException("Missing parameters");

        var p = parameters.Value;
        
        string? command = null;
        string? cwd = null;
        int timeoutMs = 30000;

        if (p.TryGetProperty("command", out var cmdProp))
        {
            if (cmdProp.ValueKind == JsonValueKind.Array)
            {
                var parts = new List<string>();
                foreach (var item in cmdProp.EnumerateArray())
                    parts.Add(item.GetString() ?? "");
                command = string.Join(" ", parts);
            }
            else
            {
                command = cmdProp.GetString();
            }
        }
        
        if (p.TryGetProperty("cwd", out var cwdProp))
            cwd = cwdProp.GetString();
        if (p.TryGetProperty("commandTimeoutMs", out var timeoutProp))
            timeoutMs = timeoutProp.GetInt32();

        if (string.IsNullOrEmpty(command))
            throw new ArgumentException("Command is required");

        Log($"Executing: {command}");

        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c {command}",
            WorkingDirectory = cwd ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = psi };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        process.OutputDataReceived += (s, e) => { if (e.Data != null) stdout.AppendLine(e.Data); };
        process.ErrorDataReceived += (s, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        var completed = await Task.Run(() => process.WaitForExit(timeoutMs));
        
        if (!completed)
        {
            process.Kill();
            throw new TimeoutException($"Command timed out after {timeoutMs}ms");
        }

        return new
        {
            exitCode = process.ExitCode,
            stdout = stdout.ToString(),
            stderr = stderr.ToString()
        };
    }

    private object ExecuteSystemWhich(JsonElement? parameters)
    {
        if (parameters == null)
            throw new ArgumentException("Missing parameters");

        var p = parameters.Value;
        string? name = null;
        
        if (p.TryGetProperty("name", out var nameProp))
            name = nameProp.GetString();

        if (string.IsNullOrEmpty(name))
            throw new ArgumentException("Name is required");

        // Search in PATH
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        var paths = pathEnv.Split(';');
        var extensions = new[] { ".exe", ".cmd", ".bat", ".ps1", "" };

        foreach (var dir in paths)
        {
            foreach (var ext in extensions)
            {
                var fullPath = Path.Combine(dir, name + ext);
                if (File.Exists(fullPath))
                {
                    return new { path = fullPath, found = true };
                }
            }
        }

        return new { found = false };
    }

    private async Task SendResponseAsync(string? requestId, object? result, string? error)
    {
        if (_webSocket == null || _webSocket.State != WebSocketState.Open)
            return;

        object response;
        if (error != null)
        {
            response = new
            {
                type = "res",
                id = requestId,
                ok = false,
                error = new { message = error }
            };
        }
        else
        {
            response = new
            {
                type = "res",
                id = requestId,
                ok = true,
                payload = result
            };
        }

        var json = JsonSerializer.Serialize(response, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        
        await _webSocket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private async Task<string?> ReceiveMessageAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[8192];
        var messageBuilder = new StringBuilder();

        while (true)
        {
            var result = await ws.ReceiveAsync(buffer, ct);
            
            if (result.MessageType == WebSocketMessageType.Close)
                return null;

            messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

            if (result.EndOfMessage)
                return messageBuilder.ToString();
        }
    }

    public void Dispose()
    {
        _receiveCts?.Cancel();
        _webSocket?.Dispose();
    }
}

public class NodeConnectResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? NodeId { get; set; }
    public bool IsPaired { get; set; }
}

public class NodeCommandEventArgs : EventArgs
{
    public string Method { get; }
    public JsonElement? Parameters { get; }

    public NodeCommandEventArgs(string method, JsonElement? parameters)
    {
        Method = method;
        Parameters = parameters;
    }
}
