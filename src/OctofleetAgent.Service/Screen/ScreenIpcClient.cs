using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service.Screen;

/// <summary>
/// Named pipe client for communicating with OctofleetScreenHelper running in user session.
/// </summary>
public class ScreenIpcClient : IDisposable
{
    private readonly ILogger _logger;
    private readonly string _pipeName;
    private NamedPipeClientStream? _pipeClient;
    private bool _disposed;
    
    public event Func<ScreenFrame, Task>? OnFrame;
    public event Action<string>? OnError;
    public event Action? OnDisconnected;
    
    public bool IsConnected => _pipeClient?.IsConnected == true;
    
    public ScreenIpcClient(ILogger logger, string? username = null)
    {
        _logger = logger;
        // Use fixed pipe name - simpler and avoids username detection issues
        _pipeName = "octofleet-screen";
        _logger.LogInformation("Screen IPC pipe name: {PipeName}", _pipeName);
    }
    
    /// <summary>
    /// Connect to the screen helper.
    /// </summary>
    public async Task<bool> ConnectAsync(int timeoutMs = 5000, CancellationToken cancellationToken = default)
    {
        try
        {
            _pipeClient = new NamedPipeClientStream(
                ".",
                _pipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);
            
            await _pipeClient.ConnectAsync(timeoutMs, cancellationToken);
            _logger.LogInformation("Connected to screen helper via pipe: {PipeName}", _pipeName);
            return true;
        }
        catch (TimeoutException)
        {
            _logger.LogWarning("Timeout connecting to screen helper - helper may not be running");
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to screen helper");
            return false;
        }
    }
    
    /// <summary>
    /// Start screen capture streaming.
    /// </summary>
    public async Task StartCaptureAsync(
        string sessionId,
        string quality = "medium",
        int fps = 10,
        int monitorIndex = 0,
        CancellationToken cancellationToken = default)
    {
        await SendCommandAsync(new
        {
            cmd = "start",
            sessionId,
            quality,
            fps,
            monitor = monitorIndex,
            maxWidth = quality switch { "low" => 1280, "medium" => 1920, "high" => 2560, _ => 1920 },
            maxHeight = quality switch { "low" => 720, "medium" => 1080, "high" => 1440, _ => 1080 }
        }, cancellationToken);
    }
    
    /// <summary>
    /// Stop screen capture streaming.
    /// </summary>
    public async Task StopCaptureAsync(CancellationToken cancellationToken = default)
    {
        await SendCommandAsync(new { cmd = "stop" }, cancellationToken);
    }
    
    /// <summary>
    /// Get available monitors.
    /// </summary>
    public async Task<MonitorInfo[]?> GetMonitorsAsync(CancellationToken cancellationToken = default)
    {
        await SendCommandAsync(new { cmd = "get_monitors" }, cancellationToken);
        
        var response = await ReadResponseAsync(cancellationToken);
        if (response == null) return null;
        
        using var doc = JsonDocument.Parse(response);
        var root = doc.RootElement;
        
        if (root.GetProperty("type").GetString() != "monitors")
            return null;
        
        var monitors = root.GetProperty("monitors");
        var result = new List<MonitorInfo>();
        
        foreach (var m in monitors.EnumerateArray())
        {
            result.Add(new MonitorInfo
            {
                Index = m.GetProperty("index").GetInt32(),
                Name = m.GetProperty("name").GetString() ?? "",
                Width = m.GetProperty("width").GetInt32(),
                Height = m.GetProperty("height").GetInt32(),
                IsPrimary = m.GetProperty("isPrimary").GetBoolean()
            });
        }
        
        return result.ToArray();
    }
    
    /// <summary>
    /// Run the receive loop - processes frames and forwards them.
    /// </summary>
    public async Task RunReceiveLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && IsConnected)
        {
            try
            {
                var response = await ReadResponseAsync(cancellationToken);
                if (response == null)
                {
                    _logger.LogWarning("Screen helper disconnected");
                    OnDisconnected?.Invoke();
                    break;
                }
                
                using var doc = JsonDocument.Parse(response);
                var root = doc.RootElement;
                var type = root.GetProperty("type").GetString();
                
                switch (type)
                {
                    case "frame":
                        var frame = new ScreenFrame
                        {
                            Data = Convert.FromBase64String(root.GetProperty("data").GetString()!),
                            Width = root.GetProperty("width").GetInt32(),
                            Height = root.GetProperty("height").GetInt32()
                        };
                        if (OnFrame != null)
                        {
                            await OnFrame(frame);
                        }
                        break;
                        
                    case "error":
                        var message = root.GetProperty("message").GetString();
                        _logger.LogError("Screen helper error: {Message}", message);
                        OnError?.Invoke(message ?? "Unknown error");
                        break;
                        
                    case "stopped":
                        _logger.LogInformation("Screen helper stopped streaming");
                        break;
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (IOException)
            {
                _logger.LogWarning("Screen helper pipe broken");
                OnDisconnected?.Invoke();
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing screen helper response");
            }
        }
    }
    
    private async Task SendCommandAsync(object command, CancellationToken cancellationToken)
    {
        if (_pipeClient?.IsConnected != true)
            throw new InvalidOperationException("Not connected to screen helper");
        
        var json = JsonSerializer.Serialize(command);
        var bytes = Encoding.UTF8.GetBytes(json);
        
        await _pipeClient.WriteAsync(bytes, 0, bytes.Length, cancellationToken);
        await _pipeClient.FlushAsync(cancellationToken);
    }
    
    private async Task<string?> ReadResponseAsync(CancellationToken cancellationToken)
    {
        if (_pipeClient?.IsConnected != true)
            return null;
        
        var buffer = new byte[1024 * 1024]; // 1MB buffer for frames
        var bytesRead = await _pipeClient.ReadAsync(buffer, 0, buffer.Length, cancellationToken);
        
        if (bytesRead == 0)
            return null;
        
        return Encoding.UTF8.GetString(buffer, 0, bytesRead);
    }
    
    /// <summary>
    /// Get the username of the currently active interactive session.
    /// </summary>
    private static string? GetActiveUsername()
    {
        // Try to get username from explorer.exe process (runs in user session)
        try
        {
            var explorer = System.Diagnostics.Process.GetProcessesByName("explorer").FirstOrDefault();
            if (explorer != null)
            {
                // This requires elevation, but the service should have it
                return GetProcessOwner(explorer.Id);
            }
        }
        catch { }
        
        return null;
    }
    
    private static string? GetProcessOwner(int processId)
    {
        // Simplified - in production would use WMI or native APIs
        return null;
    }
    
    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;
            _pipeClient?.Dispose();
            _pipeClient = null;
        }
    }
}

public class ScreenFrame
{
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public int Width { get; set; }
    public int Height { get; set; }
}
