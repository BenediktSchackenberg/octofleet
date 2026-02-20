using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service.Shell;

/// <summary>
/// Background service that polls for remote shell requests and manages shell sessions.
/// </summary>
public class RemoteShellService : BackgroundService
{
    private readonly ILogger<RemoteShellService> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    private readonly string _nodeId;
    
    private ClientWebSocket? _webSocket;
    private Process? _shellProcess;
    private CancellationTokenSource? _sessionCts;
    private bool _isSessionActive;
    
    private const int PollIntervalSeconds = 5;
    
    public RemoteShellService(ILogger<RemoteShellService> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        _nodeId = Environment.MachineName.ToUpperInvariant();
    }
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("RemoteShellService started for node {NodeId}", _nodeId);
        
        // Wait for inventory config
        while (!stoppingToken.IsCancellationRequested && !_config.IsInventoryConfigured)
        {
            await Task.Delay(1000, stoppingToken);
        }
        
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!_isSessionActive)
                {
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
                _logger.LogError(ex, "Error in RemoteShellService loop");
                await Task.Delay(5000, stoppingToken);
            }
        }
        
        await StopSession();
        _logger.LogInformation("RemoteShellService stopped");
    }
    
    private async Task CheckForPendingSession(CancellationToken cancellationToken)
    {
        try
        {
            var url = $"{_config.InventoryApiUrl}/api/v1/shell/pending/{_nodeId}";
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Add("X-API-Key", _config.InventoryApiKey);
            
            var response = await _httpClient.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode) return;
            
            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            using var doc = JsonDocument.Parse(content);
            
            var sessionElement = doc.RootElement.GetProperty("session");
            if (sessionElement.ValueKind == JsonValueKind.Null) return;
            
            var sessionId = sessionElement.GetProperty("session_id").GetString()!;
            var shellType = sessionElement.GetProperty("shell_type").GetString() ?? "powershell";
            
            _logger.LogInformation("🖥️ Shell session pending: {SessionId} (type={ShellType})", sessionId, shellType);
            
            // Start the session
            await StartSession(sessionId, shellType, cancellationToken);
        }
        catch (HttpRequestException)
        {
            // Server unavailable, will retry
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking for pending shell session");
        }
    }
    
    private async Task StartSession(string sessionId, string shellType, CancellationToken cancellationToken)
    {
        if (_isSessionActive)
        {
            _logger.LogWarning("Already have an active shell session");
            return;
        }
        
        _isSessionActive = true;
        _sessionCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var sessionToken = _sessionCts.Token;
        
        try
        {
            // Connect WebSocket to backend
            var wsUrl = _config.InventoryApiUrl
                .Replace("http://", "ws://")
                .Replace("https://", "wss://");
            wsUrl += $"/api/v1/shell/ws/agent/{sessionId}?api_key={_config.InventoryApiKey}";
            
            _webSocket = new ClientWebSocket();
            await _webSocket.ConnectAsync(new Uri(wsUrl), sessionToken);
            
            _logger.LogInformation("Connected to shell session WebSocket: {SessionId}", sessionId);
            
            // Receive config
            var buffer = new byte[4096];
            var result = await _webSocket.ReceiveAsync(buffer, sessionToken);
            var configJson = Encoding.UTF8.GetString(buffer, 0, result.Count);
            _logger.LogDebug("Received config: {Config}", configJson);
            
            // Start shell process
            _shellProcess = StartShellProcess(shellType);
            
            if (_shellProcess == null)
            {
                _logger.LogError("Failed to start shell process");
                return;
            }
            
            // Send ready
            await SendWebSocketJsonAsync(new { type = "ready" }, sessionToken);
            
            _logger.LogInformation("🖥️ Remote shell ACTIVE - session {SessionId}, shell={ShellType}", sessionId, shellType);
            
            // Start tasks for bidirectional communication
            var readOutputTask = ReadShellOutputAsync(sessionToken);
            var readInputTask = ReadWebSocketInputAsync(sessionToken);
            
            // Wait for either to complete
            await Task.WhenAny(readOutputTask, readInputTask);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Shell session cancelled");
        }
        catch (WebSocketException ex)
        {
            _logger.LogWarning("WebSocket error: {Message}", ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during shell session");
        }
        finally
        {
            await StopSession();
        }
    }
    
    private Process? StartShellProcess(string shellType)
    {
        var (fileName, args) = shellType.ToLower() switch
        {
            "powershell" => ("powershell.exe", "-NoLogo -NoProfile -ExecutionPolicy Bypass"),
            "cmd" => ("cmd.exe", "/Q"),
            "bash" => ("/bin/bash", "--login"),
            "sh" => ("/bin/sh", ""),
            _ => ("powershell.exe", "-NoLogo -NoProfile")
        };
        
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = args,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            };
            
            // Set environment for better terminal experience
            psi.Environment["TERM"] = "xterm-256color";
            
            var process = Process.Start(psi);
            
            if (process != null)
            {
                _logger.LogInformation("Started shell process: {FileName} (PID={Pid})", fileName, process.Id);
            }
            
            return process;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start shell process: {FileName}", fileName);
            return null;
        }
    }
    
    private async Task ReadShellOutputAsync(CancellationToken cancellationToken)
    {
        if (_shellProcess == null) return;
        
        try
        {
            var outputBuffer = new char[4096];
            var errorBuffer = new char[4096];
            
            // Read both stdout and stderr
            var stdoutTask = Task.Run(async () =>
            {
                while (!cancellationToken.IsCancellationRequested && !_shellProcess.HasExited)
                {
                    var read = await _shellProcess.StandardOutput.ReadAsync(outputBuffer, 0, outputBuffer.Length);
                    if (read > 0)
                    {
                        var output = new string(outputBuffer, 0, read);
                        await SendOutputAsync(output, cancellationToken);
                    }
                }
            }, cancellationToken);
            
            var stderrTask = Task.Run(async () =>
            {
                while (!cancellationToken.IsCancellationRequested && !_shellProcess.HasExited)
                {
                    var read = await _shellProcess.StandardError.ReadAsync(errorBuffer, 0, errorBuffer.Length);
                    if (read > 0)
                    {
                        var output = new string(errorBuffer, 0, read);
                        await SendOutputAsync(output, cancellationToken);
                    }
                }
            }, cancellationToken);
            
            await _shellProcess.WaitForExitAsync(cancellationToken);
            
            // Send exit code
            await SendWebSocketJsonAsync(new { type = "exit", code = _shellProcess.ExitCode }, cancellationToken);
            
            _logger.LogInformation("Shell process exited with code {ExitCode}", _shellProcess.ExitCode);
        }
        catch (OperationCanceledException)
        {
            // Expected
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading shell output");
        }
    }
    
    private async Task ReadWebSocketInputAsync(CancellationToken cancellationToken)
    {
        if (_webSocket == null || _shellProcess == null) return;
        
        try
        {
            var buffer = new byte[4096];
            
            while (!cancellationToken.IsCancellationRequested && 
                   _webSocket.State == WebSocketState.Open &&
                   !_shellProcess.HasExited)
            {
                var result = await _webSocket.ReceiveAsync(buffer, cancellationToken);
                
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogInformation("WebSocket closed by server");
                    break;
                }
                
                var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                
                var type = root.GetProperty("type").GetString();
                
                switch (type)
                {
                    case "input":
                        var input = root.GetProperty("data").GetString();
                        if (!string.IsNullOrEmpty(input))
                        {
                            await _shellProcess.StandardInput.WriteAsync(input);
                            await _shellProcess.StandardInput.FlushAsync();
                        }
                        break;
                        
                    case "resize":
                        // Terminal resize - not directly supported in .NET Process
                        // Would need ConPTY for proper support
                        _logger.LogDebug("Resize request: {Cols}x{Rows}", 
                            root.GetProperty("cols").GetInt32(),
                            root.GetProperty("rows").GetInt32());
                        break;
                        
                    case "stop":
                        _logger.LogInformation("Stop command received");
                        return;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected
        }
        catch (WebSocketException ex)
        {
            _logger.LogWarning("WebSocket error while reading input: {Message}", ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reading WebSocket input");
        }
    }
    
    private async Task SendOutputAsync(string output, CancellationToken cancellationToken)
    {
        if (_webSocket?.State != WebSocketState.Open) return;
        
        try
        {
            await SendWebSocketJsonAsync(new { type = "output", data = output }, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Failed to send output: {Message}", ex.Message);
        }
    }
    
    private async Task StopSession()
    {
        if (!_isSessionActive && _shellProcess == null && _webSocket == null)
        {
            return;
        }
        
        _logger.LogInformation("Stopping shell session...");
        _isSessionActive = false;
        
        // Cancel session token
        if (_sessionCts != null)
        {
            try { _sessionCts.Cancel(); } catch { }
            _sessionCts.Dispose();
            _sessionCts = null;
        }
        
        // Kill shell process
        if (_shellProcess != null)
        {
            try
            {
                if (!_shellProcess.HasExited)
                {
                    _shellProcess.Kill(true);
                    _logger.LogDebug("Shell process killed");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Error killing shell process: {Message}", ex.Message);
            }
            _shellProcess.Dispose();
            _shellProcess = null;
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
                        "Session stopped",
                        CancellationToken.None);
                }
                catch { }
            }
            _webSocket.Dispose();
            _webSocket = null;
        }
        
        _logger.LogInformation("Shell session stopped - ready for new session");
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
