using System.Collections.Concurrent;

namespace OctofleetAgent.Service;

/// <summary>
/// Beautiful console UI for Octofleet Agent
/// </summary>
public static class ConsoleUI
{
    private static readonly ConcurrentQueue<LogEntry> _logEntries = new();
    private static readonly object _renderLock = new();
    private static int _maxLogEntries = 10;
    private static bool _initialized = false;
    private static DateTime _lastStatsRender = DateTime.MinValue;
    
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
    
    // UI State
    public static string? CurrentOperation { get; set; }
    public static bool ShowLog { get; set; } = false; // Log hidden by default
    
    private record LogEntry(DateTime Time, string Level, string Message, ConsoleColor Color);

    public static void Initialize(string version, string nodeName, string? gatewayUrl, string? inventoryUrl)
    {
        Version = version;
        NodeName = nodeName;
        GatewayUrl = gatewayUrl;
        InventoryUrl = inventoryUrl;
        CurrentUser = $"{Environment.UserDomainName}\\{Environment.UserName}";
        _initialized = true;
        
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
        
        while (_logEntries.Count > _maxLogEntries)
            _logEntries.TryDequeue(out _);
        
        if (_initialized && ShowLog)
            RenderLogSection();
    }

    public static void AddBytesSent(long bytes)
    {
        BytesSent += bytes;
        RequestCount++;
        TryRenderStats();
    }

    public static void AddBytesReceived(long bytes)
    {
        BytesReceived += bytes;
        TryRenderStats();
    }

    public static void AddError()
    {
        ErrorCount++;
        TryRenderStats();
    }
    
    private static void TryRenderStats()
    {
        // Throttle stats rendering to avoid flicker
        if (_initialized && (DateTime.Now - _lastStatsRender).TotalMilliseconds > 500)
        {
            _lastStatsRender = DateTime.Now;
            RenderStatsSection();
        }
    }

    public static void SetOperation(string? operation)
    {
        CurrentOperation = operation;
        if (_initialized)
            RenderStatusSection();
    }
    
    public static void Refresh()
    {
        if (_initialized)
            RenderFull();
    }
    
    public static void ClearLog()
    {
        while (_logEntries.TryDequeue(out _)) { }
        if (_initialized && ShowLog)
            RenderLogSection();
    }
    
    public static void ToggleLog()
    {
        ShowLog = !ShowLog;
        RenderFull();
    }

    private static void RenderFull()
    {
        lock (_renderLock)
        {
            Console.Clear();
            RenderBanner();
            RenderStatusSection();
            RenderStatsSection();
            if (ShowLog)
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
        Console.Write("│  ");
        Console.ForegroundColor = ConsoleColor.Green;
        Console.Write($"{NodeName,-20}");
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.Write("│  ");
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.Write($"{DateTime.Now:yyyy-MM-dd HH:mm}  ");
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
            
            // Inventory API status
            Console.Write("│   ");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Server:     ");
            WriteStatus(InventoryApiConnected);
            Console.ForegroundColor = ConsoleColor.DarkGray;
            var invText = InventoryUrl ?? "Not configured";
            Console.Write($"  {invText,-50}");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("│");
            
            // User
            Console.Write("│   ");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("User:       ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{CurrentUser,-61}");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("│");
            
            // Operation
            Console.Write("│   ");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Operation:  ");
            if (!string.IsNullOrEmpty(CurrentOperation))
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.Write($"⚡ {CurrentOperation,-58}");
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.DarkGray;
                Console.Write($"{"Idle",-61}");
            }
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("│");
            
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
            Console.SetCursorPosition(0, 20);
            
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
            Console.Write("Sent: ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{FormatBytes(BytesSent),-12}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Recv: ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{FormatBytes(BytesReceived),-12}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Requests: ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write($"{RequestCount,-10}");
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.Write("Errors: ");
            Console.ForegroundColor = ErrorCount > 0 ? ConsoleColor.Red : ConsoleColor.Green;
            Console.Write($"{ErrorCount,-5}");
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
            Console.SetCursorPosition(0, 26);
            
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("┌─────────────────────────────────────────────────────────────────────────────┐");
            Console.Write("│ ");
            Console.ForegroundColor = ConsoleColor.White;
            Console.Write("ACTIVITY LOG");
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write(" (press V to hide)");
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("                                              │");
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
                    var msg = entry.Message.Length > 62 ? entry.Message[..59] + "..." : entry.Message;
                    Console.Write($"{msg,-65}");
                }
                else
                {
                    Console.Write($"{"",73}");
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
        lock (_renderLock)
        {
            int y = ShowLog ? 38 : 26;
            Console.SetCursorPosition(0, y);
            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.DarkGray;
            Console.Write(" [P] Push Inventory  [L] Push Live Data  [R] Refresh  ");
            if (ShowLog)
                Console.Write("[V] Hide Log  [C] Clear Log  ");
            else
                Console.Write("[V] Show Log  ");
            Console.Write("[Q] Quit");
            Console.ResetColor();
            Console.WriteLine();
        }
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
        if (!time.HasValue) return "Never";
        var diff = DateTime.Now - time.Value;
        if (diff.TotalSeconds < 5) return "Just now";
        if (diff.TotalSeconds < 60) return $"{(int)diff.TotalSeconds}s ago";
        if (diff.TotalMinutes < 60) return $"{(int)diff.TotalMinutes}m ago";
        if (diff.TotalHours < 24) return $"{(int)diff.TotalHours}h ago";
        return time.Value.ToString("MM-dd HH:mm");
    }
}
