using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using OpenClawAgent.Service.Inventory;

namespace OpenClawAgent.Service;

/// <summary>
/// Background worker that maintains the Node connection to the Gateway
/// with automatic reconnection using exponential backoff
/// </summary>
public class NodeWorker : BackgroundService
{
    private readonly ILogger<NodeWorker> _logger;
    private readonly ServiceConfig _config;
    private ClientWebSocket? _webSocket;
    private int _requestId = 0;
    private string _nodeId = "";  // Will be set from connect response or machine name
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement?>> _pendingRequests = new();

    // Reconnection settings
    private const int MinReconnectDelayMs = 1000;      // 1 second
    private const int MaxReconnectDelayMs = 300000;   // 5 minutes
    private const double ReconnectBackoffMultiplier = 2.0;
    private int _currentReconnectDelayMs = MinReconnectDelayMs;
    private int _reconnectAttempts = 0;
    private DateTime _lastConnectedTime = DateTime.MinValue;
    private bool _wasConnected = false;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    public NodeWorker(ILogger<NodeWorker> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("OpenClaw Node Agent starting...");

        // Load config
        var config = ServiceConfig.Load();
        
        if (!config.IsConfigured)
        {
            _logger.LogWarning("Service not configured. Please configure via the OpenClaw Agent GUI.");
            
            // Wait until configured or stopped
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(5000, stoppingToken);
                config = ServiceConfig.Load();
                if (config.IsConfigured) break;
            }
        }

        // Main connection loop with auto-reconnect and exponential backoff
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConnectAndRunAsync(config, stoppingToken);
                
                // If we get here, connection closed gracefully
                // Reset backoff on clean disconnect
                if (_wasConnected && (DateTime.UtcNow - _lastConnectedTime).TotalMinutes > 1)
                {
                    // Was connected for more than 1 minute, reset backoff
                    ResetReconnectBackoff();
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Normal shutdown, don't retry
                break;
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _reconnectAttempts++;
                _logger.LogError(ex, "Connection failed (attempt {Attempt}), retrying in {Delay}ms...", 
                    _reconnectAttempts, _currentReconnectDelayMs);
                
                try
                {
                    await Task.Delay(_currentReconnectDelayMs, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                
                // Increase delay with exponential backoff
                _currentReconnectDelayMs = Math.Min(
                    (int)(_currentReconnectDelayMs * ReconnectBackoffMultiplier),
                    MaxReconnectDelayMs);
            }
        }

        _logger.LogInformation("OpenClaw Node Agent stopped.");
    }

    private async Task ConnectAndRunAsync(ServiceConfig config, CancellationToken ct)
    {
        _webSocket = new ClientWebSocket();
        
        // Convert http to ws
        var wsUrl = config.GatewayUrl!
            .Replace("http://", "ws://")
            .Replace("https://", "wss://");
        if (!wsUrl.EndsWith("/")) wsUrl += "/";

        _logger.LogInformation("Connecting to {Url}...", wsUrl);

        await _webSocket.ConnectAsync(new Uri(wsUrl), ct);
        _logger.LogInformation("WebSocket connected, waiting for challenge...");

        // Wait for challenge
        var challengeMsg = await ReceiveMessageAsync(ct);
        var challenge = JsonDocument.Parse(challengeMsg).RootElement;
        
        string? nonce = null;
        if (challenge.TryGetProperty("payload", out var payload) &&
            payload.TryGetProperty("nonce", out var nonceProp))
        {
            nonce = nonceProp.GetString();
        }

        // Send connect request
        var requestId = Interlocked.Increment(ref _requestId).ToString();
        // Generate a stable device ID from machine name (for pairing)
        var deviceId = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes($"openclaw-windows-{Environment.MachineName}")
            )
        ).ToLowerInvariant().Substring(0, 40);
        
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
                    id = "node-host",  // Must be a known client type from GATEWAY_CLIENT_IDS
                    version = "0.3.8",
                    platform = "windows",
                    mode = "node",
                    instanceId = $"win-{Environment.MachineName.ToLowerInvariant()}",  // Unique instance identifier
                    displayName = config.DisplayName ?? Environment.MachineName
                },
                role = "node",
                scopes = Array.Empty<string>(),
                caps = new[] { "system", "inventory" },
                commands = new[] 
                { 
                    "system.run", 
                    "system.which",
                    "inventory.hardware",
                    "inventory.software",
                    "inventory.hotfixes",
                    "inventory.system",
                    "inventory.security",
                    "inventory.browser",
                    "inventory.browser.chrome",
                    "inventory.browser.firefox",
                    "inventory.browser.edge",
                    "inventory.network",
                    "inventory.full",
                    "inventory.push"
                },
                permissions = new Dictionary<string, bool>
                {
                    { "system.run", true },
                    { "system.which", true },
                    { "inventory.hardware", true },
                    { "inventory.software", true },
                    { "inventory.hotfixes", true },
                    { "inventory.system", true },
                    { "inventory.security", true },
                    { "inventory.browser", true },
                    { "inventory.browser.chrome", true },
                    { "inventory.browser.firefox", true },
                    { "inventory.browser.edge", true },
                    { "inventory.network", true },
                    { "inventory.full", true },
                    { "inventory.push", true }
                },
                auth = new { token = config.GatewayToken },
                device = new
                {
                    id = deviceId
                },
                userAgent = $"openclaw-windows-service/0.3.8 ({config.DisplayName})"
            }
        };

        var requestJson = JsonSerializer.Serialize(request, JsonOptions);
        _logger.LogInformation("Connect request: {Request}", requestJson);
        await SendJsonAsync(request, ct);
        _logger.LogInformation("Sent connect request");

        // Wait for response
        var responseMsg = await ReceiveMessageAsync(ct);
        var response = JsonDocument.Parse(responseMsg).RootElement;
        
        if (response.TryGetProperty("ok", out var okProp) && okProp.GetBoolean())
        {
            // Try to get nodeId from response, fallback to machine name
            if (response.TryGetProperty("payload", out var respPayload) &&
                respPayload.TryGetProperty("nodeId", out var nodeIdProp))
            {
                _nodeId = nodeIdProp.GetString() ?? $"win-{Environment.MachineName.ToLowerInvariant()}";
            }
            else
            {
                _nodeId = $"win-{Environment.MachineName.ToLowerInvariant()}";
            }
            _logger.LogInformation("Connected as Node: {DisplayName} (nodeId: {NodeId})", config.DisplayName, _nodeId);
            
            // Mark as connected and reset backoff
            _wasConnected = true;
            _lastConnectedTime = DateTime.UtcNow;
            ResetReconnectBackoff();
        }
        else
        {
            var error = response.TryGetProperty("error", out var errProp) 
                ? errProp.ToString() 
                : "Unknown error";
            throw new Exception($"Connect failed: {error}");
        }

        // Main receive loop
        await ReceiveLoopAsync(ct);
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
                    _logger.LogWarning("WebSocket closed by server");
                    break;
                }

                messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                if (result.EndOfMessage)
                {
                    var message = messageBuilder.ToString();
                    messageBuilder.Clear();
                    
                    await HandleMessageAsync(message, ct);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task HandleMessageAsync(string message, CancellationToken ct)
    {
        try
        {
            var doc = JsonDocument.Parse(message);
            var root = doc.RootElement;
            
            if (!root.TryGetProperty("type", out var typeProp))
                return;

            var type = typeProp.GetString();
            
            // Log all non-tick/health messages
            if (type == "event")
            {
                if (root.TryGetProperty("event", out var evtName))
                {
                    var eventName = evtName.GetString();
                    if (eventName != "tick" && eventName != "health")
                    {
                        _logger.LogInformation("Event received: {Event}", eventName);
                    }
                }
            }
            else if (type == "req")
            {
                if (root.TryGetProperty("method", out var methodProp))
                {
                    _logger.LogInformation("Request received: {Method}", methodProp.GetString());
                }
            }

            switch (type)
            {
                case "req":
                    // Incoming request from Gateway (command invocation)
                    await HandleRequestAsync(root, ct);
                    break;
                    
                case "event":
                    // Handle events
                    if (root.TryGetProperty("event", out var eventProp))
                    {
                        var eventName = eventProp.GetString();
                        
                        if (eventName == "node.invoke.request")
                        {
                            // This is the actual command invocation!
                            await HandleInvokeEventAsync(root, ct);
                        }
                        else if (eventName != "tick" && eventName != "health")
                        {
                            _logger.LogDebug("Event: {Event}", eventName);
                        }
                    }
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to handle message");
        }
    }

    private async Task HandleRequestAsync(JsonElement root, CancellationToken ct)
    {
        string? id = null;
        if (root.TryGetProperty("id", out var idProp))
            id = idProp.GetString();

        string? method = null;
        if (root.TryGetProperty("method", out var methodProp))
            method = methodProp.GetString();

        _logger.LogInformation("Received request: {Method}", method);

        object? result = null;
        string? error = null;

        try
        {
            switch (method)
            {
                case "system.run":
                    result = await HandleSystemRunAsync(root, ct);
                    break;
                    
                case "system.which":
                    result = await HandleSystemWhichAsync(root);
                    break;
                    
                case "node.ping":
                    result = new { pong = true, ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                    break;
                    
                default:
                    error = $"Unknown method: {method}";
                    break;
            }
        }
        catch (Exception ex)
        {
            error = ex.Message;
            _logger.LogError(ex, "Command execution failed: {Method}", method);
        }

        // Send response
        if (id != null)
        {
            var response = new
            {
                type = "res",
                id = id,
                ok = error == null,
                payload = result,
                error = error != null ? new { message = error } : null
            };
            await SendJsonAsync(response, ct);
        }
    }

    private async Task HandleInvokeEventAsync(JsonElement root, CancellationToken ct)
    {
        // Event payload contains: { requestId, command, params }
        if (!root.TryGetProperty("payload", out var payload))
            return;

        string? requestId = null;
        if (payload.TryGetProperty("requestId", out var reqIdProp))
            requestId = reqIdProp.GetString();
        // Also try "id" as fallback
        if (requestId == null && payload.TryGetProperty("id", out var idProp))
            requestId = idProp.GetString();

        string? command = null;
        if (payload.TryGetProperty("command", out var cmdProp))
            command = cmdProp.GetString();

        _logger.LogInformation("Invoke request: {Command} (requestId: {RequestId})", command, requestId);
        
        // Debug: log the full payload structure
        _logger.LogInformation("Payload: {Payload}", payload.ToString());

        object? result = null;
        string? error = null;

        try
        {
            // params might be in "params" object, "paramsJSON" string, or directly in payload
            JsonElement paramsElement = payload;
            
            if (payload.TryGetProperty("params", out var nestedParams))
            {
                paramsElement = nestedParams;
            }
            else if (payload.TryGetProperty("paramsJSON", out var paramsJsonProp))
            {
                // paramsJSON is a JSON string that needs to be parsed
                var paramsJsonStr = paramsJsonProp.GetString();
                if (!string.IsNullOrEmpty(paramsJsonStr))
                {
                    var parsedParams = JsonDocument.Parse(paramsJsonStr);
                    paramsElement = parsedParams.RootElement;
                    _logger.LogInformation("Parsed paramsJSON: {Params}", paramsJsonStr);
                }
            }

            switch (command)
            {
                case "system.run":
                    result = await HandleSystemRunFromPayloadAsync(paramsElement, ct);
                    break;
                    
                case "system.which":
                    result = HandleSystemWhichFromPayload(paramsElement);
                    break;
                    
                case "node.ping":
                    result = new { pong = true, ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                    break;
                
                // Inventory commands
                case "inventory.full":
                    result = await InventoryCollector.CollectFullAsync();
                    break;
                    
                case "inventory.hardware":
                    result = await InventoryCollector.CollectAsync("hardware");
                    break;
                    
                case "inventory.software":
                    result = await InventoryCollector.CollectAsync("software");
                    break;
                    
                case "inventory.hotfixes":
                    result = await InventoryCollector.CollectAsync("hotfixes");
                    break;
                    
                case "inventory.system":
                    result = await InventoryCollector.CollectAsync("system");
                    break;
                    
                case "inventory.security":
                    result = await InventoryCollector.CollectAsync("security");
                    break;
                    
                case "inventory.browser":
                    result = await InventoryCollector.CollectAsync("browser");
                    break;
                    
                case "inventory.browser.chrome":
                    result = await InventoryCollector.CollectAsync("browser.chrome");
                    break;
                    
                case "inventory.browser.firefox":
                    result = await InventoryCollector.CollectAsync("browser.firefox");
                    break;
                    
                case "inventory.browser.edge":
                    result = await InventoryCollector.CollectAsync("browser.edge");
                    break;
                    
                case "inventory.network":
                    result = await InventoryCollector.CollectAsync("network");
                    break;
                    
                case "inventory.push":
                    // Collect all inventory and push to backend API
                    var pushResult = await InventoryPusher.CollectAndPushAllAsync(_config);
                    result = new 
                    { 
                        success = pushResult.Success,
                        summary = pushResult.Summary,
                        details = pushResult.FullPush
                    };
                    break;
                    
                default:
                    error = $"Unknown command: {command}";
                    break;
            }
        }
        catch (Exception ex)
        {
            error = ex.Message;
            _logger.LogError(ex, "Command execution failed: {Command}", command);
        }

        // Send result back via node.invoke.result
        if (requestId != null)
        {
            var resultMsg = new
            {
                type = "req",
                id = Interlocked.Increment(ref _requestId).ToString(),
                method = "node.invoke.result",
                @params = new
                {
                    id = requestId,  // Gateway expects "id" not "requestId"
                    nodeId = _nodeId,  // Gateway requires nodeId
                    ok = error == null,
                    payload = result,  // Gateway expects "payload" not "result"
                    error = error
                }
            };
            
            _logger.LogInformation("Sending result for {RequestId}: ok={Ok}", requestId, error == null);
            await SendJsonAsync(resultMsg, ct);
        }
        else
        {
            _logger.LogWarning("No requestId found, cannot send result. Result: {Result}, Error: {Error}", 
                result?.ToString(), error);
        }
    }

    private async Task<object> HandleSystemRunFromPayloadAsync(JsonElement payload, CancellationToken ct)
    {
        var command = new List<string>();
        bool background = false;  // Don't wait for exit
        int timeoutMs = 30000;    // Default 30s timeout
        
        // Try direct "command" array first
        if (payload.TryGetProperty("command", out var cmdProp) &&
            cmdProp.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in cmdProp.EnumerateArray())
            {
                if (item.GetString() is string s)
                    command.Add(s);
            }
        }

        // Check for background flag
        if (payload.TryGetProperty("background", out var bgProp))
        {
            background = bgProp.GetBoolean();
        }

        // Check for timeout
        if (payload.TryGetProperty("timeoutMs", out var timeoutProp))
        {
            timeoutMs = timeoutProp.GetInt32();
        }

        if (command.Count == 0)
            throw new ArgumentException("No command specified");

        _logger.LogInformation("Executing: {Command} (background: {Background})", string.Join(" ", command), background);

        var psi = new ProcessStartInfo
        {
            FileName = command[0],
            UseShellExecute = background,  // UseShellExecute for GUI apps
            CreateNoWindow = !background
        };

        if (!background)
        {
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
        }

        for (int i = 1; i < command.Count; i++)
            psi.ArgumentList.Add(command[i]);

        using var process = Process.Start(psi);
        if (process == null)
            throw new Exception("Failed to start process");

        // For background processes, just return the PID
        if (background)
        {
            return new
            {
                pid = process.Id,
                started = true,
                background = true
            };
        }

        // For foreground processes, wait with timeout
        using var timeoutCts = new CancellationTokenSource(timeoutMs);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        try
        {
            var stdout = await process.StandardOutput.ReadToEndAsync(linkedCts.Token);
            var stderr = await process.StandardError.ReadToEndAsync(linkedCts.Token);
            
            await process.WaitForExitAsync(linkedCts.Token);

            return new
            {
                exitCode = process.ExitCode,
                stdout = stdout,
                stderr = stderr
            };
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            // Timeout - kill process and return partial result
            try { process.Kill(); } catch { }
            
            return new
            {
                exitCode = -1,
                stdout = "",
                stderr = "",
                timedOut = true,
                message = $"Process timed out after {timeoutMs}ms"
            };
        }
    }

    private object HandleSystemWhichFromPayload(JsonElement payload)
    {
        string? name = null;
        
        // Try direct "name" property first
        if (payload.TryGetProperty("name", out var nameProp))
        {
            name = nameProp.GetString();
        }

        if (string.IsNullOrEmpty(name))
        {
            _logger.LogWarning("system.which payload: {Payload}", payload.ToString());
            throw new ArgumentException($"No name specified in payload");
        }

        // Search in PATH
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        var paths = pathEnv.Split(Path.PathSeparator);
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

        return new { path = (string?)null, found = false };
    }

    private async Task<object> HandleSystemRunAsync(JsonElement root, CancellationToken ct)
    {
        var command = new List<string>();
        
        if (root.TryGetProperty("params", out var paramsProp) &&
            paramsProp.TryGetProperty("command", out var cmdProp) &&
            cmdProp.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in cmdProp.EnumerateArray())
            {
                if (item.GetString() is string s)
                    command.Add(s);
            }
        }

        if (command.Count == 0)
            throw new ArgumentException("No command specified");

        _logger.LogInformation("Executing: {Command}", string.Join(" ", command));

        var psi = new ProcessStartInfo
        {
            FileName = command[0],
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        for (int i = 1; i < command.Count; i++)
            psi.ArgumentList.Add(command[i]);

        using var process = Process.Start(psi);
        if (process == null)
            throw new Exception("Failed to start process");

        var stdout = await process.StandardOutput.ReadToEndAsync(ct);
        var stderr = await process.StandardError.ReadToEndAsync(ct);
        
        await process.WaitForExitAsync(ct);

        return new
        {
            exitCode = process.ExitCode,
            stdout = stdout,
            stderr = stderr
        };
    }

    private Task<object> HandleSystemWhichAsync(JsonElement root)
    {
        string? name = null;
        
        if (root.TryGetProperty("params", out var paramsProp) &&
            paramsProp.TryGetProperty("name", out var nameProp))
        {
            name = nameProp.GetString();
        }

        if (string.IsNullOrEmpty(name))
            throw new ArgumentException("No name specified");

        // Search in PATH
        var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        var paths = pathEnv.Split(Path.PathSeparator);
        var extensions = new[] { ".exe", ".cmd", ".bat", ".ps1", "" };

        foreach (var dir in paths)
        {
            foreach (var ext in extensions)
            {
                var fullPath = Path.Combine(dir, name + ext);
                if (File.Exists(fullPath))
                {
                    return Task.FromResult<object>(new { path = fullPath, found = true });
                }
            }
        }

        return Task.FromResult<object>(new { path = (string?)null, found = false });
    }

    private async Task SendJsonAsync(object obj, CancellationToken ct)
    {
        if (_webSocket?.State != WebSocketState.Open)
            return;

        var json = JsonSerializer.Serialize(obj, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _webSocket.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    private async Task<string> ReceiveMessageAsync(CancellationToken ct)
    {
        var buffer = new byte[8192];
        var messageBuilder = new StringBuilder();

        while (true)
        {
            var result = await _webSocket!.ReceiveAsync(buffer, ct);
            messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            
            if (result.EndOfMessage)
                return messageBuilder.ToString();
        }
    }

    private void ResetReconnectBackoff()
    {
        _currentReconnectDelayMs = MinReconnectDelayMs;
        _reconnectAttempts = 0;
        _logger.LogDebug("Reconnect backoff reset");
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Stopping OpenClaw Node Agent...");
        
        if (_webSocket?.State == WebSocketState.Open)
        {
            try
            {
                await _webSocket.CloseAsync(
                    WebSocketCloseStatus.NormalClosure, 
                    "Service stopping", 
                    cancellationToken);
            }
            catch { }
        }

        await base.StopAsync(cancellationToken);
    }
}
