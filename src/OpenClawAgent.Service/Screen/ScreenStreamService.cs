using System;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OpenClawAgent.Service.Screen;

/// <summary>
/// Background service that polls for screen sharing requests and streams frames.
/// </summary>
public class ScreenStreamService : BackgroundService
{
    private readonly ILogger<ScreenStreamService> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    private readonly string _nodeId;
    
    private ClientWebSocket? _webSocket;
    private DesktopCapture? _capture;
    private bool _isStreaming;
    
    private const int PollIntervalSeconds = 5;
    
    public ScreenStreamService(ILogger<ScreenStreamService> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _nodeId = Environment.MachineName.ToUpperInvariant();
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ScreenStreamService started for node {NodeId}", _nodeId);
        
        // Wait for config
        while (!stoppingToken.IsCancellationRequested && !_config.IsConfigured)
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
            var response = await _httpClient.GetAsync(url, cancellationToken);
            
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
            _logger.LogDebug(ex, "Error checking for pending screen session");
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
            // Configure capture
            _capture = new DesktopCapture(_logger, monitorIndex);
            _capture.Quality = quality switch
            {
                "low" => 30,
                "medium" => 50,
                "high" => 75,
                _ => 50
            };
            _capture.MaxWidth = quality switch
            {
                "low" => 1280,
                "medium" => 1920,
                "high" => 2560,
                _ => 1920
            };
            _capture.MaxHeight = quality switch
            {
                "low" => 720,
                "medium" => 1080,
                "high" => 1440,
                _ => 1080
            };
            
            // Connect WebSocket
            var wsUrl = _config.InventoryApiUrl
                .Replace("http://", "ws://")
                .Replace("https://", "wss://");
            wsUrl += $"/api/v1/screen/ws/agent/{sessionId}";
            
            _webSocket = new ClientWebSocket();
            await _webSocket.ConnectAsync(new Uri(wsUrl), cancellationToken);
            
            _logger.LogInformation("Connected to screen session WebSocket: {SessionId}", sessionId);
            
            // Receive config
            var buffer = new byte[4096];
            var result = await _webSocket.ReceiveAsync(buffer, cancellationToken);
            var configJson = Encoding.UTF8.GetString(buffer, 0, result.Count);
            _logger.LogDebug("Received config: {Config}", configJson);
            
            // Send ready
            await SendJsonAsync(new { type = "ready" }, cancellationToken);
            
            // Show tray notification (TODO: implement system tray)
            _logger.LogInformation("🖥️ Screen sharing ACTIVE - session {SessionId}", sessionId);
            
            // Calculate frame delay
            int frameDelayMs = 1000 / maxFps;
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();
            
            // Streaming loop
            while (!cancellationToken.IsCancellationRequested && 
                   _webSocket.State == WebSocketState.Open)
            {
                stopwatch.Restart();
                
                // Capture frame
                var frameData = await _capture.CaptureFrameAsync(cancellationToken);
                if (frameData != null)
                {
                    // Send as base64
                    var base64 = Convert.ToBase64String(frameData);
                    await SendJsonAsync(new
                    {
                        type = "frame",
                        data = base64,
                        width = _capture.MaxWidth,
                        height = _capture.MaxHeight
                    }, cancellationToken);
                }
                
                // Maintain frame rate
                var elapsed = (int)stopwatch.ElapsedMilliseconds;
                if (elapsed < frameDelayMs)
                {
                    await Task.Delay(frameDelayMs - elapsed, cancellationToken);
                }
            }
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
        
        if (_capture != null)
        {
            _logger.LogInformation("Screen capture stats: {Frames} frames, {Bytes} bytes",
                _capture.FramesCaptured, _capture.BytesCaptured);
            _capture.Dispose();
            _capture = null;
        }
        
        _logger.LogInformation("Screen streaming stopped");
    }
    
    private async Task SendJsonAsync(object data, CancellationToken cancellationToken)
    {
        if (_webSocket?.State != WebSocketState.Open)
            return;
        
        var json = JsonSerializer.Serialize(data);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _webSocket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }
}
