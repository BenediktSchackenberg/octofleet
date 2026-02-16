using OctofleetAgent.Service;
using Serilog;
using Serilog.Events;

// Setup log directory
var logDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
    "Octofleet", "logs");
Directory.CreateDirectory(logDir);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("System", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .Enrich.WithProperty("Application", "Octofleet.Service")
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
    // Show ASCII banner
    var version = System.Reflection.Assembly.GetExecutingAssembly()
        .GetName().Version?.ToString(3) ?? "0.0.0";
    Banner.Show(version);
    
    Log.Information("=== Octofleet Agent Service starting ===");
    Log.Information("Log directory: {LogDir}", logDir);

    var builder = Host.CreateApplicationBuilder(args);

    // Use Serilog for logging
    builder.Services.AddSerilog();

    // Add Windows Service support
    builder.Services.AddWindowsService(options =>
    {
        options.ServiceName = "Octofleet Node Agent";
    });

    // Add configuration
    builder.Services.AddSingleton(ServiceConfig.Load());

    // Add our workers
    builder.Services.AddHostedService<NodeWorker>();
    builder.Services.AddHostedService<InventoryScheduler>();
    builder.Services.AddHostedService<JobPoller>();
    builder.Services.AddHostedService<DeploymentPoller>();
    builder.Services.AddHostedService<RemediationPoller>();
    builder.Services.AddHostedService<AutoUpdater>();
    builder.Services.AddHostedService<LiveDataPoller>();
    builder.Services.AddHostedService<TerminalPoller>();
    builder.Services.AddHostedService<OctofleetAgent.Service.Screen.ScreenStreamService>();

    var host = builder.Build();
    host.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Service terminated unexpectedly");
}
finally
{
    Log.Information("=== Octofleet Node Agent Service stopped ===");
    Log.CloseAndFlush();
}
