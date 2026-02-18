using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service.Screen;

/// <summary>
/// Captures desktop frames using Windows DXGI Desktop Duplication API.
/// Falls back to GDI+ if DXGI is not available.
/// </summary>
public class DesktopCapture : IDisposable
{
    private readonly ILogger _logger;
    private readonly int _monitorIndex;
    private bool _disposed;
    
    // Capture settings
    public int Quality { get; set; } = 50; // JPEG quality 1-100
    public int MaxWidth { get; set; } = 1920;
    public int MaxHeight { get; set; } = 1080;
    
    // Stats
    public int FramesCaptured { get; private set; }
    public long BytesCaptured { get; private set; }
    
    public DesktopCapture(ILogger logger, int monitorIndex = 0)
    {
        _logger = logger;
        _monitorIndex = monitorIndex;
    }
    
    /// <summary>
    /// Capture a single frame as JPEG bytes.
    /// </summary>
    public async Task<byte[]?> CaptureFrameAsync(CancellationToken cancellationToken = default)
    {
        return await Task.Run(() => CaptureFrameGdi(), cancellationToken);
    }
    
    /// <summary>
    /// GDI+ based screen capture (simple, works everywhere).
    /// NOTE: Requires interactive session - won't work from Session 0 (Windows Service).
    /// </summary>
    private byte[]? CaptureFrameGdi()
    {
        try
        {
            // Check if we're in an interactive session
            if (!Environment.UserInteractive)
            {
                _logger.LogError("Screen capture requires an interactive session. " +
                    "The agent service is running in Session 0 without desktop access. " +
                    "To enable screen sharing, run the agent as a logged-in user or configure " +
                    "the service to 'Allow service to interact with desktop'.");
                return null;
            }
            
            // Get screen bounds
            var screens = System.Windows.Forms.Screen.AllScreens;
            
            if (screens == null || screens.Length == 0)
            {
                _logger.LogError("No screens found. This usually means the agent is running " +
                    "without access to a desktop session.");
                return null;
            }
            
            if (_monitorIndex >= screens.Length)
            {
                _logger.LogWarning("Monitor index {Index} not found, using primary", _monitorIndex);
            }
            
            var screen = _monitorIndex < screens.Length 
                ? screens[_monitorIndex] 
                : System.Windows.Forms.Screen.PrimaryScreen;
            
            if (screen == null)
            {
                _logger.LogError("No screen found - primary screen is null");
                return null;
            }
            
            var bounds = screen.Bounds;
            
            // Calculate scaled dimensions
            int targetWidth = bounds.Width;
            int targetHeight = bounds.Height;
            
            if (bounds.Width > MaxWidth || bounds.Height > MaxHeight)
            {
                float scaleX = (float)MaxWidth / bounds.Width;
                float scaleY = (float)MaxHeight / bounds.Height;
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
                    encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)Quality);
                    outputBitmap.Save(ms, jpegEncoder, encoderParams);
                }
                else
                {
                    outputBitmap.Save(ms, ImageFormat.Jpeg);
                }
                
                FramesCaptured++;
                var data = ms.ToArray();
                BytesCaptured += data.Length;
                
                return data;
            }
            finally
            {
                if (needsDispose)
                {
                    outputBitmap.Dispose();
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to capture screen");
            return null;
        }
    }
    
    /// <summary>
    /// Get information about available monitors.
    /// </summary>
    public static MonitorInfo[] GetMonitors()
    {
        var screens = System.Windows.Forms.Screen.AllScreens;
        var monitors = new MonitorInfo[screens.Length];
        
        for (int i = 0; i < screens.Length; i++)
        {
            var screen = screens[i];
            monitors[i] = new MonitorInfo
            {
                Index = i,
                Name = screen.DeviceName,
                Width = screen.Bounds.Width,
                Height = screen.Bounds.Height,
                IsPrimary = screen.Primary
            };
        }
        
        return monitors;
    }
    
    public void Dispose()
    {
        if (!_disposed)
        {
            _disposed = true;
        }
    }
}

public class MonitorInfo
{
    public int Index { get; set; }
    public string Name { get; set; } = "";
    public int Width { get; set; }
    public int Height { get; set; }
    public bool IsPrimary { get; set; }
}
