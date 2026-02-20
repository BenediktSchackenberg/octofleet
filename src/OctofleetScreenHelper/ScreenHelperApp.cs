using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OctofleetScreenHelper;

/// <summary>
/// Screen helper application - runs in user session, provides screen capture via named pipe IPC.
/// </summary>
public class ScreenHelperApp : ApplicationContext
{
    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _contextMenu;
    private readonly CancellationTokenSource _cts = new();
    
    private NamedPipeServerStream? _pipeServer;
    private bool _isStreaming;
    private int _framesSent;
    private Task? _pipeTask;
    
    // Capture settings (set by service)
    private int _quality = 50;
    private int _maxWidth = 1920;
    private int _maxHeight = 1080;
    private int _monitorIndex = 0;
    private int _targetFps = 10;
    private string? _currentSessionId;
    
    public ScreenHelperApp()
    {
        // Create context menu
        _contextMenu = new ContextMenuStrip();
        _contextMenu.Items.Add("Status: Idle", null, null);
        _contextMenu.Items.Add("-");
        _contextMenu.Items.Add("Exit", null, OnExit);
        
        // Create tray icon
        _trayIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application, // TODO: Custom icon
            Text = "Octofleet Screen Helper",
            Visible = true,
            ContextMenuStrip = _contextMenu
        };
        
        _trayIcon.DoubleClick += (s, e) => ShowStatus();
        
        // Start pipe server
        _pipeTask = Task.Run(() => RunPipeServerAsync(_cts.Token));
        
        UpdateStatus("Ready - waiting for connection");
    }
    
    private async Task RunPipeServerAsync(CancellationToken cancellationToken)
    {
        // Use fixed pipe name - must match ScreenIpcClient
        var pipeName = "octofleet-screen";
        
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                UpdateStatus("Waiting for service connection...");
                
                // Create pipe with security that allows SYSTEM and Administrators to connect
                var pipeSecurity = new PipeSecurity();
                pipeSecurity.AddAccessRule(new PipeAccessRule(
                    new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                    PipeAccessRights.FullControl,
                    AccessControlType.Allow));
                pipeSecurity.AddAccessRule(new PipeAccessRule(
                    new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
                    PipeAccessRights.FullControl,
                    AccessControlType.Allow));
                pipeSecurity.AddAccessRule(new PipeAccessRule(
                    new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
                    PipeAccessRights.FullControl,
                    AccessControlType.Allow));
                
                _pipeServer = NamedPipeServerStreamAcl.Create(
                    pipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Message,
                    PipeOptions.Asynchronous,
                    0, 0,
                    pipeSecurity);
                
                await _pipeServer.WaitForConnectionAsync(cancellationToken);
                UpdateStatus("Service connected");
                
                // Handle commands from service
                await HandleServiceConnectionAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                UpdateStatus($"Error: {ex.Message}");
                await Task.Delay(2000, cancellationToken);
            }
            finally
            {
                _pipeServer?.Dispose();
                _pipeServer = null;
            }
        }
    }
    
    private async Task HandleServiceConnectionAsync(CancellationToken cancellationToken)
    {
        if (_pipeServer == null) return;
        
        var buffer = new byte[4096];
        
        while (!cancellationToken.IsCancellationRequested && _pipeServer.IsConnected)
        {
            try
            {
                var bytesRead = await _pipeServer.ReadAsync(buffer, 0, buffer.Length, cancellationToken);
                if (bytesRead == 0)
                {
                    // Connection closed
                    break;
                }
                
                var json = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                await HandleCommandAsync(json, cancellationToken);
            }
            catch (IOException)
            {
                // Pipe broken
                break;
            }
        }
        
        StopStreaming();
        UpdateStatus("Service disconnected");
    }
    
    private async Task HandleCommandAsync(string json, CancellationToken cancellationToken)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var cmd = root.GetProperty("cmd").GetString();
            
            switch (cmd)
            {
                case "start":
                    _currentSessionId = root.GetProperty("sessionId").GetString();
                    _quality = root.TryGetProperty("quality", out var q) ? GetQualityValue(q.GetString()) : 50;
                    _targetFps = root.TryGetProperty("fps", out var f) ? f.GetInt32() : 10;
                    _monitorIndex = root.TryGetProperty("monitor", out var m) ? m.GetInt32() : 0;
                    _maxWidth = root.TryGetProperty("maxWidth", out var mw) ? mw.GetInt32() : 1920;
                    _maxHeight = root.TryGetProperty("maxHeight", out var mh) ? mh.GetInt32() : 1080;
                    
                    await StartStreamingAsync(cancellationToken);
                    break;
                    
                case "stop":
                    StopStreaming();
                    await SendResponseAsync(new { type = "stopped" });
                    break;
                    
                case "get_monitors":
                    var monitors = GetMonitorInfo();
                    await SendResponseAsync(new { type = "monitors", monitors });
                    break;
                    
                case "ping":
                    await SendResponseAsync(new { type = "pong" });
                    break;
            }
        }
        catch (Exception ex)
        {
            await SendResponseAsync(new { type = "error", message = ex.Message });
        }
    }
    
    private int GetQualityValue(string? quality) => quality switch
    {
        "low" => 30,
        "medium" => 50,
        "high" => 75,
        _ => 50
    };
    
    private async Task StartStreamingAsync(CancellationToken cancellationToken)
    {
        if (_isStreaming)
        {
            await SendResponseAsync(new { type = "error", message = "Already streaming" });
            return;
        }
        
        _isStreaming = true;
        _framesSent = 0;
        UpdateStatus($"🖥️ STREAMING (Session: {_currentSessionId?.Substring(0, 8)}...)");
        ShowBalloon("Screen Sharing Active", "Your screen is being shared.", ToolTipIcon.Info);
        
        var frameDelayMs = 1000 / _targetFps;
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        
        try
        {
            while (!cancellationToken.IsCancellationRequested && _isStreaming && _pipeServer?.IsConnected == true)
            {
                stopwatch.Restart();
                
                var frameData = CaptureFrame();
                if (frameData != null)
                {
                    await SendResponseAsync(new
                    {
                        type = "frame",
                        data = Convert.ToBase64String(frameData),
                        width = _maxWidth,
                        height = _maxHeight
                    });
                    _framesSent++;
                    
                    if (_framesSent % 100 == 0)
                    {
                        UpdateStatus($"🖥️ STREAMING ({_framesSent} frames)");
                    }
                }
                
                // Maintain frame rate
                var elapsed = (int)stopwatch.ElapsedMilliseconds;
                if (elapsed < frameDelayMs)
                {
                    await Task.Delay(frameDelayMs - elapsed, cancellationToken);
                }
            }
        }
        finally
        {
            StopStreaming();
        }
    }
    
    private void StopStreaming()
    {
        if (!_isStreaming) return;
        
        _isStreaming = false;
        UpdateStatus($"Stopped after {_framesSent} frames");
        ShowBalloon("Screen Sharing Ended", $"Sent {_framesSent} frames.", ToolTipIcon.Info);
        _currentSessionId = null;
    }
    
    private byte[]? CaptureFrame()
    {
        try
        {
            var screens = Screen.AllScreens;
            if (screens.Length == 0) return null;
            
            var screen = _monitorIndex < screens.Length ? screens[_monitorIndex] : Screen.PrimaryScreen;
            if (screen == null) return null;
            
            var bounds = screen.Bounds;
            
            // Calculate scaled dimensions
            int targetWidth = bounds.Width;
            int targetHeight = bounds.Height;
            
            if (bounds.Width > _maxWidth || bounds.Height > _maxHeight)
            {
                float scaleX = (float)_maxWidth / bounds.Width;
                float scaleY = (float)_maxHeight / bounds.Height;
                float scale = Math.Min(scaleX, scaleY);
                
                targetWidth = (int)(bounds.Width * scale);
                targetHeight = (int)(bounds.Height * scale);
            }
            
            // Capture screen
            using var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            }
            
            // Scale if needed
            Bitmap outputBitmap = bitmap;
            bool needsDispose = false;
            
            if (targetWidth != bounds.Width || targetHeight != bounds.Height)
            {
                outputBitmap = new Bitmap(targetWidth, targetHeight);
                needsDispose = true;
                using (var graphics = Graphics.FromImage(outputBitmap))
                {
                    graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                    graphics.DrawImage(bitmap, 0, 0, targetWidth, targetHeight);
                }
            }
            
            try
            {
                // Convert to JPEG
                using var ms = new MemoryStream();
                var jpegEncoder = ImageCodecInfo.GetImageEncoders()
                    .FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);
                
                if (jpegEncoder != null)
                {
                    var encoderParams = new EncoderParameters(1);
                    encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, _quality);
                    outputBitmap.Save(ms, jpegEncoder, encoderParams);
                }
                else
                {
                    outputBitmap.Save(ms, ImageFormat.Jpeg);
                }
                
                return ms.ToArray();
            }
            finally
            {
                if (needsDispose)
                {
                    outputBitmap.Dispose();
                }
            }
        }
        catch
        {
            return null;
        }
    }
    
    private object[] GetMonitorInfo()
    {
        return Screen.AllScreens.Select((screen, index) => new
        {
            index,
            name = screen.DeviceName,
            width = screen.Bounds.Width,
            height = screen.Bounds.Height,
            isPrimary = screen.Primary
        }).ToArray<object>();
    }
    
    private async Task SendResponseAsync(object data)
    {
        if (_pipeServer?.IsConnected != true) return;
        
        try
        {
            var json = JsonSerializer.Serialize(data);
            var bytes = Encoding.UTF8.GetBytes(json);
            await _pipeServer.WriteAsync(bytes, 0, bytes.Length);
            await _pipeServer.FlushAsync();
        }
        catch (IOException)
        {
            // Pipe broken, will be handled by read loop
        }
    }
    
    private void UpdateStatus(string status)
    {
        if (_trayIcon.ContextMenuStrip?.InvokeRequired == true)
        {
            _trayIcon.ContextMenuStrip.Invoke(() => UpdateStatus(status));
            return;
        }
        
        _trayIcon.Text = $"Octofleet Screen Helper\n{status}";
        if (_contextMenu.Items.Count > 0)
        {
            _contextMenu.Items[0].Text = $"Status: {status}";
        }
    }
    
    private void ShowBalloon(string title, string text, ToolTipIcon icon)
    {
        _trayIcon.ShowBalloonTip(3000, title, text, icon);
    }
    
    private void ShowStatus()
    {
        var status = _isStreaming 
            ? $"Currently streaming (Session: {_currentSessionId})\nFrames sent: {_framesSent}"
            : "Not streaming";
        
        MessageBox.Show(status, "Octofleet Screen Helper", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
    
    private void OnExit(object? sender, EventArgs e)
    {
        StopStreaming();
        _cts.Cancel();
        _trayIcon.Visible = false;
        Application.Exit();
    }
    
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _cts.Cancel();
            _pipeServer?.Dispose();
            _trayIcon.Dispose();
            _contextMenu.Dispose();
            _cts.Dispose();
        }
        base.Dispose(disposing);
    }
}
