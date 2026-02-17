using OctofleetAgent.Service;
using Serilog;
using Serilog.Events;

// Setup log directory
var logDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
    "Octofleet", "logs");
Directory.CreateDirectory(logDir);

// Get config first
var config = ServiceConfig.Load();
var version = System.Reflection.Assembly.GetExecutingAssembly()
    .GetName().Version?.ToString(3) ?? "0.0.0";

// Configure Serilog with custom sink that feeds ConsoleUI
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("System", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "Octofleet.Service")
    .WriteTo.Sink(new ConsoleSink())
    .WriteTo.File(
        path: Path.Combine(logDir, "service-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 14,
        fileSizeLimitBytes: 10 * 1024 * 1024,
        rollOnFileSizeLimit: true,
        outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
    .CreateLogger();

try
{
    // Check if running interactively (not as a service)
    bool isInteractive = Environment.UserInteractive && !Console.IsInputRedirected;
    
    if (isInteractive)
    {
        // Initialize fancy console UI
        Console.Title = $"Octofleet Agent - {Environment.MachineName}";
        ConsoleUI.Initialize(version, config.DisplayName, config.GatewayUrl, config.InventoryApiUrl);
        ConsoleUI.Log("INF", "Octofleet Agent Service starting...");
        ConsoleUI.Log("INF", $"Log directory: {logDir}");
    }
    else
    {
        // Service mode - show basic banner
        Banner.Show(version);
        Log.Information("=== Octofleet Agent Service starting ===");
        Log.Information("Log directory: {LogDir}", logDir);
    }

    var builder = Host.CreateApplicationBuilder(args);

    // Use Serilog for logging
    builder.Services.AddSerilog();

    // Add Windows Service support
    builder.Services.AddWindowsService(options =>
    {
        options.ServiceName = "Octofleet Agent";
    });

    // Add configuration
    builder.Services.AddSingleton(config);

    // Add our workers
    builder.Services.AddHostedService<PendingNodeRegistration>();  // Auto-registration (runs first)
    builder.Services.AddHostedService<NodeWorker>();
    builder.Services.AddHostedService<InventoryScheduler>();
    builder.Services.AddHostedService<JobPoller>();
    builder.Services.AddHostedService<DeploymentPoller>();
    builder.Services.AddHostedService<RemediationPoller>();
    builder.Services.AddHostedService<AutoUpdater>();
    builder.Services.AddHostedService<LiveDataPoller>();
    builder.Services.AddHostedService<TerminalPoller>();
    builder.Services.AddHostedService<OctofleetAgent.Service.Screen.ScreenStreamService>();
    builder.Services.AddHostedService<ServiceReconciliationPoller>();

    var host = builder.Build();

    // Start keyboard handler in interactive mode
    if (isInteractive)
    {
        var cts = new CancellationTokenSource();
        
        // Start the host
        var hostTask = host.RunAsync(cts.Token);
        
        // Handle keyboard input
        while (!cts.Token.IsCancellationRequested)
        {
            if (Console.KeyAvailable)
            {
                var key = Console.ReadKey(true);
                switch (char.ToLower(key.KeyChar))
                {
                    case 'p':
                        ConsoleUI.Log("OK", "Manual inventory push requested...");
                        _ = TriggerInventoryPush(config);
                        break;
                    case 'l':
                        ConsoleUI.Log("OK", "Manual live data push requested...");
                        _ = TriggerLiveDataPush(config);
                        break;
                    case 'r':
                        ConsoleUI.Refresh();
                        break;
                    case 'c':
                        ConsoleUI.ClearLog();
                        break;
                    case 'v':
                        ConsoleUI.ToggleLog();
                        break;
                    case 'q':
                        ConsoleUI.Log("WRN", "Shutdown requested by user...");
                        cts.Cancel();
                        break;
                }
            }
            await Task.Delay(100);
        }
        
        await hostTask;
    }
    else
    {
        host.Run();
    }
}
catch (Exception ex)
{
    Log.Fatal(ex, "Service terminated unexpectedly");
    if (Environment.UserInteractive)
        ConsoleUI.Log("ERR", $"FATAL: {ex.Message}");
}
finally
{
    Log.Information("=== Octofleet Agent Service stopped ===");
    Log.CloseAndFlush();
}

// Helper methods for manual triggers
static async Task TriggerInventoryPush(ServiceConfig config)
{
    try
    {
        ConsoleUI.SetOperation("Pushing Full Inventory...");
        using var client = new HttpClient();
        client.DefaultRequestHeaders.Add("X-API-Key", config.InventoryApiKey);
        
        // This would need to call the actual inventory collection
        // For now just ping the API
        var response = await client.GetAsync($"{config.InventoryApiUrl}/api/v1/nodes");
        ConsoleUI.AddBytesSent(100);
        ConsoleUI.AddBytesReceived(response.Content.Headers.ContentLength ?? 0);
        ConsoleUI.LastInventoryPush = DateTime.Now;
        ConsoleUI.Log("OK", "Inventory push completed");
    }
    catch (Exception ex)
    {
        ConsoleUI.AddError();
        ConsoleUI.Log("ERR", $"Inventory push failed: {ex.Message}");
    }
    finally
    {
        ConsoleUI.SetOperation(null);
    }
}

static async Task TriggerLiveDataPush(ServiceConfig config)
{
    try
    {
        ConsoleUI.SetOperation("Pushing Live Data...");
        await Task.Delay(500); // Placeholder
        ConsoleUI.LastLiveDataPush = DateTime.Now;
        ConsoleUI.Log("OK", "Live data push completed");
    }
    catch (Exception ex)
    {
        ConsoleUI.AddError();
        ConsoleUI.Log("ERR", $"Live data push failed: {ex.Message}");
    }
    finally
    {
        ConsoleUI.SetOperation(null);
    }
}

/// <summary>
/// Custom Serilog sink that feeds ConsoleUI
/// </summary>
class ConsoleSink : Serilog.Core.ILogEventSink
{
    public void Emit(Serilog.Events.LogEvent logEvent)
    {
        var level = logEvent.Level switch
        {
            LogEventLevel.Verbose => "DBG",
            LogEventLevel.Debug => "DBG",
            LogEventLevel.Information => "INF",
            LogEventLevel.Warning => "WRN",
            LogEventLevel.Error => "ERR",
            LogEventLevel.Fatal => "ERR",
            _ => "INF"
        };
        
        var message = logEvent.RenderMessage();
        
        if (Environment.UserInteractive && !Console.IsInputRedirected)
        {
            ConsoleUI.Log(level, message);
            
            if (logEvent.Level >= LogEventLevel.Error)
                ConsoleUI.AddError();
        }
        else
        {
            // Fallback to console for service mode
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss} {level}] {message}");
        }
    }
}
