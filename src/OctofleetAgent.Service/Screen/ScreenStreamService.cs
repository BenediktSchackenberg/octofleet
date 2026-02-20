using System;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service.Screen;

/// <summary>
/// Background service that polls for screen sharing requests and streams frames via helper process.
/// Uses IPC to communicate with OctofleetScreenHelper running in user session.
/// </summary>
public class ScreenStreamService : BackgroundService
{
    private readonly ILogger<ScreenStreamService> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    private readonly string _nodeId;
    private readonly ScreenHelperManager _helperManager;
    
    private ClientWebSocket? _webSocket;
    private ScreenIpcClient? _ipcClient;
    private bool _isStreaming;
    
    private const int PollIntervalSeconds = 5;
    
    public ScreenStreamService(ILogger<ScreenStreamService> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _nodeId = Environment.MachineName.ToUpperInvariant();
        _helperManager = new ScreenHelperManager(logger);
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ScreenStreamService started for node {NodeId}", _nodeId);
        
        // Wait for inventory config
        while (!stoppingToken.IsCancellationRequested && !_config.IsInventoryConfigured)
        {
            await Task.Delay(1000, stoppingToken);
        }
        
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!_isStreaming)
                {
                    // Poll for pending sessions
                    await CheckForPendingSession(stoppingToken);
                }
                
                await Task.Delay(PollIntervalSeconds * 1000, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in ScreenStreamService loop");
                await Task.Delay(5000, stoppingToken);
            }
        }
        
        await StopStreaming();
        _logger.LogInformation("ScreenStreamService stopped");
    }
    
    private async Task CheckForPendingSession(CancellationToken cancellationToken)
    {
        try
        {
            var url = $"{_config.InventoryApiUrl}/api/v1/screen/pending/{_nodeId}";
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("X-API-Key", _config.InventoryApiKey);
            var response = await _httpClient.SendAsync(request, cancellationToken);
            
            if (!response.IsSuccessStatusCode)
                return;
            
            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            
            if (!root.GetProperty("pending").GetBoolean())
                return;
            
            var sessionId = root.GetProperty("session_id").GetString()!;
            var quality = root.GetProperty("quality").GetString() ?? "medium";
            var maxFps = root.GetProperty("max_fps").GetInt32();
            var monitorIndex = root.GetProperty("monitor_index").GetInt32();
            
            _logger.LogInformation("Screen session pending: {SessionId}, quality={Quality}, fps={Fps}", 
                sessionId, quality, maxFps);
            
            // Start streaming
            await StartStreaming(sessionId, quality, maxFps, monitorIndex, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking for pending screen session");
        }
    }
    
    private async Task StartStreaming(
        string sessionId, 
        string quality, 
        int maxFps, 
        int monitorIndex,
        CancellationToken cancellationToken)
    {
        if (_isStreaming)
            return;
        
        _isStreaming = true;
        
        try
        {
            // Step 1: Ensure screen helper is running in user session
            _logger.LogInformation("Ensuring screen helper is running...");
            
            if (!await _helperManager.EnsureHelperRunningAsync(cancellationToken))
            {
                _logger.LogError("Failed to start screen helper - screen sharing unavailable. " +
                    "This may happen if no user is logged in or the helper executable is missing.");
                _isStreaming = false;
                return;
            }
            
            // Step 2: Connect to helper via named pipe
            _ipcClient = new ScreenIpcClient(_logger);
            
            // Give helper time to start pipe server
            await Task.Delay(500, cancellationToken);
            
            var connected = false;
            for (int attempt = 0; attempt < 5 && !connected; attempt++)
            {
                connected = await _ipcClient.ConnectAsync(2000, cancellationToken);
                if (!connected)
                {
                    _logger.LogDebug("IPC connect attempt {Attempt} failed, retrying...", attempt + 1);
                    await Task.Delay(1000, cancellationToken);
                }
            }
            
            if (!connected)
            {
                _logger.LogError("Failed to connect to screen helper via IPC");
                _isStreaming = false;
                return;
            }
            
            // Step 3: Connect WebSocket to backend
            var wsUrl = _config.InventoryApiUrl
                .Replace("http://", "ws://")
                .Replace("https://", "wss://");
            wsUrl += $"/api/v1/screen/ws/agent/{sessionId}?api_key={_config.InventoryApiKey}";
            
            _webSocket = new ClientWebSocket();
            await _webSocket.ConnectAsync(new Uri(wsUrl), cancellationToken);
            
            _logger.LogInformation("Connected to screen session WebSocket: {SessionId}", sessionId);
            
            // Receive config
            var buffer = new byte[4096];
            var result = await _webSocket.ReceiveAsync(buffer, cancellationToken);
            var configJson = Encoding.UTF8.GetString(buffer, 0, result.Count);
            _logger.LogDebug("Received config: {Config}", configJson);
            
            // Send ready
            await SendWebSocketJsonAsync(new { type = "ready" }, cancellationToken);
            
            // Step 4: Tell helper to start capturing
            await _ipcClient.StartCaptureAsync(sessionId, quality, maxFps, monitorIndex, cancellationToken);
            
            _logger.LogInformation("🖥️ Screen sharing ACTIVE - session {SessionId}", sessionId);
            
            // Step 5: Forward frames from helper to backend
            int consecutiveErrors = 0;
            const int maxConsecutiveErrors = 3;
            
            _ipcClient.OnFrame += async (frame) =>
            {
                if (consecutiveErrors >= maxConsecutiveErrors)
                {
                    return; // Already stopping, ignore further frames
                }
                
                try
                {
                    var base64 = Convert.ToBase64String(frame.Data);
                    await SendWebSocketJsonAsync(new
                    {
                        type = "frame",
                        data = base64,
                        width = frame.Width,
                        height = frame.Height
                    }, cancellationToken);
                    consecutiveErrors = 0; // Reset on success
                }
                catch (Exception ex)
                {
                    consecutiveErrors++;
                    if (consecutiveErrors == 1)
                    {
                        _logger.LogWarning("Error forwarding frame to backend: {Message}", ex.Message);
                    }
                    if (consecutiveErrors >= maxConsecutiveErrors)
                    {
                        _logger.LogError("Too many frame errors ({Count}), stopping screen streaming", consecutiveErrors);
                        _ = StopStreaming();
                    }
                }
            };
            
            _ipcClient.OnDisconnected += () =>
            {
                _logger.LogWarning("Screen helper disconnected");
                _ = StopStreaming();
            };
            
            // Run receive loop until cancelled or disconnected
            await _ipcClient.RunReceiveLoopAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Screen streaming cancelled");
        }
        catch (WebSocketException ex)
        {
            _logger.LogWarning("WebSocket error: {Message}", ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during screen streaming");
        }
        finally
        {
            await StopStreaming();
        }
    }
    
    private async Task StopStreaming()
    {
        _isStreaming = false;
        
        // Stop IPC client
        if (_ipcClient != null)
        {
            try
            {
                await _ipcClient.StopCaptureAsync();
            }
            catch { }
            _ipcClient.Dispose();
            _ipcClient = null;
        }
        
        // Close WebSocket
        if (_webSocket != null)
        {
            if (_webSocket.State == WebSocketState.Open)
            {
                try
                {
                    await _webSocket.CloseAsync(
                        WebSocketCloseStatus.NormalClosure, 
                        "Streaming stopped", 
                        CancellationToken.None);
                }
                catch { }
            }
            _webSocket.Dispose();
            _webSocket = null;
        }
        
        _logger.LogInformation("Screen streaming stopped");
    }
    
    private async Task SendWebSocketJsonAsync(object data, CancellationToken cancellationToken)
    {
        if (_webSocket?.State != WebSocketState.Open)
            return;
        
        var json = JsonSerializer.Serialize(data);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _webSocket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }
}
