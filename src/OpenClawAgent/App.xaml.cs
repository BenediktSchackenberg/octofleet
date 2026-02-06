using System.Windows;

namespace OpenClawAgent;

/// <summary>
/// OpenClaw Windows Agent - Main Application
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        
        // Initialize services
        var serviceProvider = ConfigureServices();
        
        // Show main window
        var mainWindow = new MainWindow();
        mainWindow.Show();
    }

    private IServiceProvider ConfigureServices()
    {
        // TODO: Setup DI container
        return null!;
    }
}
