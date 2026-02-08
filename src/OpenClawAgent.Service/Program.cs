using OpenClawAgent.Service;
using Serilog;
using Serilog.Events;

// Setup log directory
var logDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
    "OpenClaw", "logs");
Directory.CreateDirectory(logDir);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("System", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "OpenClaw.Service")
    .WriteTo.Console(
        outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj}{NewLine}{Exception}")
    .WriteTo.File(
        path: Path.Combine(logDir, "service-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 14,  // Keep 2 weeks of logs
        fileSizeLimitBytes: 10 * 1024 * 1024,  // 10 MB per file
        rollOnFileSizeLimit: true,
        outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
    .CreateLogger();

try
{
    Log.Information("=== OpenClaw Node Agent Service starting ===");
    Log.Information("Log directory: {LogDir}", logDir);

    var builder = Host.CreateApplicationBuilder(args);

    // Use Serilog for logging
    builder.Services.AddSerilog();

    // Add Windows Service support
    builder.Services.AddWindowsService(options =>
    {
        options.ServiceName = "OpenClaw Node Agent";
    });

    // Add configuration
    builder.Services.AddSingleton(ServiceConfig.Load());

    // Add our workers
    builder.Services.AddHostedService<NodeWorker>();
    builder.Services.AddHostedService<InventoryScheduler>();
    builder.Services.AddHostedService<JobPoller>();

    var host = builder.Build();
    host.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Service terminated unexpectedly");
}
finally
{
    Log.Information("=== OpenClaw Node Agent Service stopped ===");
    Log.CloseAndFlush();
}
