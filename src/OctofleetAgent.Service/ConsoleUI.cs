using System.Collections.Concurrent;
using System.Diagnostics;

namespace OctofleetAgent.Service;

/// <summary>
/// Beautiful console UI for Octofleet Agent
/// </summary>
public static class ConsoleUI
{
    private static readonly ConcurrentQueue<LogEntry> _logEntries = new();
    private static readonly object _renderLock = new();
    private static int _maxLogEntries = 12;
    private static bool _initialized = false;
    
    // Stats
    public static long BytesSent { get; private set; }
    public static long BytesReceived { get; private set; }
    public static int RequestCount { get; private set; }
    public static int ErrorCount { get; private set; }
    public static DateTime? LastInventoryPush { get; set; }
    public static DateTime? LastLiveDataPush { get; set; }
    public static DateTime? LastJobPoll { get; set; }
    
    // Connection status
    public static bool GatewayConnected { get; set; }
    public static bool InventoryApiConnected { get; set; }
    public static string? CurrentUser { get; set; }
    public static string? GatewayUrl { get; set; }
    public static string? InventoryUrl { get; set; }
    public static string? NodeName { get; set; }
    public static string? Version { get; set; }
    
    // Active operations
    public static string? CurrentOperation { get; set; }
    
    private record LogEntry(DateTime Time, string Level, string Message, ConsoleColor Color);

    public static void Initialize(string version, string nodeName, string? gatewayUrl, string? inventoryUrl)
    {
        Version = version;
        NodeName = nodeName;
        GatewayUrl = gatewayUrl;
        InventoryUrl = inventoryUrl;
        CurrentUser = $"{Environment.UserDomainName}\\{Environment.UserName}";
        _initialized = true;
        
        // Initial render
        RenderFull();
    }

    public static void Log(string level, string message)
    {
        var color = level.ToUpper() switch
        {
            "INF" or "INFO" => ConsoleColor.Cyan,
            "WRN" or "WARN" or "WARNING" => ConsoleColor.Yellow,
            "ERR" or "ERROR" => ConsoleColor.Red,
            "DBG" or "DEBUG" => ConsoleColor.DarkGray,
            "OK" or "SUCCESS" => ConsoleColor.Green,
            _ => ConsoleColor.White
        };
        
        _logEntries.Enqueue(new LogEntry(DateTime.Now, level.ToUpper(), message, color));
        
        // Keep only last N entries
        while (_logEntries.Count > _maxLogEntries)
            _logEntries.TryDequeue(out _);
        
        if (_initialized)
            RenderLogSection();
    }

    public static void AddBytesSent(long bytes)
    {
        BytesSent += bytes;
        RequestCount++;
    }

    public static void AddBytesReceived(long bytes)
    {
        BytesReceived += bytes;
    }

    public static void AddError()
    {
        ErrorCount++;
    }

    public static void SetOperation(string? operation)
    {
        CurrentOperation = operation;
        if (_initialized)
            RenderStatusSection();
    }

    private static void RenderFull()
    {
        lock (_renderLock)
        {
            Console.Clear();
            RenderBanner();
            RenderStatusSection();
            RenderStatsSection();
            RenderLogSection();
            RenderHelpBar();
        }
    }

    private static void RenderBanner()
    {
        Console.ForegroundColor = ConsoleColor.Magenta;
        Console.WriteLine(@"
    ████████████        
  ██            ██      
██  ██      ██    ██    
██  ██      ██    ██    
██                ██    
  ██            ██      
██  ██  ██  ██  ██  ██  
█    █  █    █  █    █  
");
        
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("╔══════════════════════════════════════════════════════════════════════════════╗");
        Console.Write("║  ");
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("O C T O F L E E T");
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.Write($"  v{Version,-10}");
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.Write("│");
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write($"  {NodeName,-20}");
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.Write("│");
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.Write($"  {DateTime.Now:yyyy-MM-dd HH:mm}  ");
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("║");
        Console.WriteLine("╚══════════════════════════════════════════════════════════════════════════════╝");
        Console.ResetColor();
    }

    private static void RenderStatusSection()
    {
        lock (_renderLock)
        {
            Console.SetCursorPosition(0, 13);
            
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("┌─────────────────────────────────────────────────────────────────────────────┐");
            Console.Write("│ ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write("STATUS");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("                                                                        │");
            Console.WriteLine("├─────────────────────────────────────────────────────────────────────────────┤");
            
            // Gateway Status
            Console.Write("│   Gateway:    ");
            WriteStatus(GatewayConnected);
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($" {GatewayUrl,-40}");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("      │");
            
            // Inventory API Status  
            Console.Write("│   Inventory:  ");
            WriteStatus(InventoryApiConnected);
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($" {InventoryUrl,-40}");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("      │");
            
            // Current User
            Console.Write("│   User:       ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{CurrentUser,-50}");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("          │");
            
            // Current Operation
            Console.Write("│   Operation:  ");
            if (!string.IsNullOrEmpty(CurrentOperation))
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.Write($"⚡ {CurrentOperation,-47}");
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.DarkGray;
                Console.Write($"{"Idle",-50}");
            }
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("       │");
            
            Console.WriteLine("└─────────────────────────────────────────────────────────────────────────────┘");
            Console.ResetColor();
        }
    }

    private static void WriteStatus(bool connected)
    {
        if (connected)
        {
            Console.ForegroundColor = ConsoleColor.Green;
            Console.Write("● ONLINE ");
        }
        else
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.Write("○ OFFLINE");
        }
    }

    private static void RenderStatsSection()
    {
        lock (_renderLock)
        {
            Console.SetCursorPosition(0, 21);
            
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("┌─────────────────────────────────────────────────────────────────────────────┐");
            Console.Write("│ ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write("STATISTICS");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("                                                                    │");
            Console.WriteLine("├─────────────────────────────────────────────────────────────────────────────┤");
            
            // Stats row 1
            Console.Write("│   ");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("📤 Sent: ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{FormatBytes(BytesSent),-12}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("📥 Recv: ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{FormatBytes(BytesReceived),-12}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("📊 Requests: ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{RequestCount,-8}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("❌ Errors: ");
            Console.ForegroundColor = ErrorCount > 0 ? ConsoleColor.Red : ConsoleColor.Green;
            Console.Write($"{ErrorCount,-3}");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("│");
            
            // Stats row 2 - Last actions
            Console.Write("│   ");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Last Inventory: ");
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"{FormatTime(LastInventoryPush),-14}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Last Live: ");
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"{FormatTime(LastLiveDataPush),-14}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Last Job Poll: ");
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write($"{FormatTime(LastJobPoll),-8}");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("│");
            
            Console.WriteLine("└─────────────────────────────────────────────────────────────────────────────┘");
            Console.ResetColor();
        }
    }

    private static void RenderLogSection()
    {
        lock (_renderLock)
        {
            Console.SetCursorPosition(0, 27);
            
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("┌─────────────────────────────────────────────────────────────────────────────┐");
            Console.Write("│ ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write("ACTIVITY LOG");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("                                                                  │");
            Console.WriteLine("├─────────────────────────────────────────────────────────────────────────────┤");
            
            var entries = _logEntries.ToArray();
            for (int i = 0; i < _maxLogEntries; i++)
            {
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.Write("│ ");
                
                if (i < entries.Length)
                {
                    var entry = entries[i];
                    Console.ForegroundColor = ConsoleColor.DarkGray;
                    Console.Write($"[{entry.Time:HH:mm:ss}] ");
                    Console.ForegroundColor = entry.Color;
                    var msg = entry.Message.Length > 60 ? entry.Message[..57] + "..." : entry.Message;
                    Console.Write($"{msg,-64}");
                }
                else
                {
                    Console.Write(new string(' ', 74));
                }
                
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.WriteLine("│");
            }
            
            Console.WriteLine("└─────────────────────────────────────────────────────────────────────────────┘");
            Console.ResetColor();
        }
    }

    private static void RenderHelpBar()
    {
        Console.SetCursorPosition(0, 41);
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.Write(" [P] Push Inventory  [L] Push Live Data  [R] Refresh  [C] Clear Log  [Q] Quit");
        Console.ResetColor();
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} KB";
        if (bytes < 1024 * 1024 * 1024) return $"{bytes / (1024.0 * 1024):F1} MB";
        return $"{bytes / (1024.0 * 1024 * 1024):F1} GB";
    }

    private static string FormatTime(DateTime? time)
    {
        if (time == null) return "Never";
        var ago = DateTime.Now - time.Value;
        if (ago.TotalSeconds < 60) return $"{ago.Seconds}s ago";
        if (ago.TotalMinutes < 60) return $"{(int)ago.TotalMinutes}m ago";
        return $"{(int)ago.TotalHours}h ago";
    }

    public static void Refresh()
    {
        if (_initialized)
            RenderFull();
    }

    public static void ClearLog()
    {
        while (_logEntries.TryDequeue(out _)) { }
        if (_initialized)
            RenderLogSection();
    }
}
