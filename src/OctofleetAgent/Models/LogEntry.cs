using System.Windows.Media;

namespace OctofleetAgent.Models;

/// <summary>
/// Log entry for display in dashboard and logs view
/// </summary>
public class LogEntry
{
    public DateTime Timestamp { get; set; }
    public string Level { get; set; } = "info";
    public string Source { get; set; } = "";
    public string Message { get; set; } = "";
    
    public string TimeString => Timestamp.ToString("HH:mm:ss");
    
    // Legacy emoji support
    public string LevelEmoji => Level switch
    {
        "success" => "✅",
        "error" => "❌",
        "warning" => "⚠️",
        "event" => "📨",
        "debug" => "🔧",
        _ => "ℹ️"
    };
    
    // Fluent Icon codes (Segoe Fluent Icons / MDL2)
    public string LevelIcon => Level switch
    {
        "success" => "\uE73E",  // Checkmark
        "error" => "\uE711",    // StatusErrorFull
        "warning" => "\uE7BA",  // Warning
        "event" => "\uE8BD",    // Message
        "debug" => "\uE90F",    // DeveloperTools
        _ => "\uE946"           // Info
    };
    
    // Color brush for the icon
    public SolidColorBrush LevelBrush => Level switch
    {
        "success" => new SolidColorBrush(Color.FromRgb(0x48, 0xBB, 0x78)),  // Green
        "error" => new SolidColorBrush(Color.FromRgb(0xF5, 0x65, 0x65)),    // Red
        "warning" => new SolidColorBrush(Color.FromRgb(0xEC, 0xC9, 0x4B)),  // Yellow
        "event" => new SolidColorBrush(Color.FromRgb(0xFF, 0x6B, 0x35)),    // Primary orange
        "debug" => new SolidColorBrush(Color.FromRgb(0xA0, 0xAE, 0xC0)),    // Gray
        _ => new SolidColorBrush(Color.FromRgb(0x63, 0xB3, 0xED))           // Blue
    };
}
