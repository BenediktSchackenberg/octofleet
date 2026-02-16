using System;
using System.Windows;
using System.Drawing;
using Hardcodet.Wpf.TaskbarNotification;
using OctofleetAgent.Views;
using OctofleetAgent.ViewModels;
using OctofleetAgent.Properties;

namespace OctofleetAgent;

/// <summary>
/// Octofleet Windows Agent - Main Application with System Tray support
/// </summary>
public partial class App : Application
{
    private TaskbarIcon? _trayIcon;
    private MainWindow? _mainWindow;
    private MainViewModel? _mainViewModel;

    /// <summary>
    /// Gets the current application instance
    /// </summary>
    public static new App Current => (App)Application.Current;

    /// <summary>
    /// Gets the main window instance
    /// </summary>
    public MainWindow? MainWindowInstance => _mainWindow;

    /// <summary>
    /// Gets the main view model
    /// </summary>
    public MainViewModel? MainViewModel => _mainViewModel;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Create view model (shared between window and tray)
        _mainViewModel = new MainViewModel();

        // Create and configure tray icon
        InitializeTrayIcon();

        // Create and show main window
        _mainWindow = new MainWindow();
        _mainWindow.DataContext = _mainViewModel;
        _mainWindow.Closing += MainWindow_Closing;
        _mainWindow.Show();

        // Subscribe to connection status changes
        _mainViewModel.PropertyChanged += MainViewModel_PropertyChanged;
    }

    private void InitializeTrayIcon()
    {
        _trayIcon = new TaskbarIcon
        {
            Icon = LoadAppIcon(),
            ToolTipText = "Octofleet Agent - Disconnected",
            ContextMenu = (System.Windows.Controls.ContextMenu)FindResource("TrayContextMenu"),
            Visibility = Visibility.Visible
        };

        // Double-click to open window
        _trayIcon.TrayMouseDoubleClick += TrayIcon_DoubleClick;
    }

    private System.Drawing.Icon LoadAppIcon()
    {
        try
        {
            // Load icon from embedded resource
            var uri = new Uri("pack://application:,,,/Assets/octofleet.ico", UriKind.Absolute);
            var stream = Application.GetResourceStream(uri)?.Stream;
            if (stream != null)
            {
                return new System.Drawing.Icon(stream);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to load tray icon: {ex.Message}");
        }

        // Fallback to default application icon
        return System.Drawing.SystemIcons.Application;
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        // Minimize to tray instead of closing
        e.Cancel = true;
        _mainWindow?.Hide();

        // Show balloon tip first time
        if (_trayIcon != null && !Settings.Default.TrayHintShown)
        {
            _trayIcon.ShowBalloonTip(
                "Octofleet Agent",
                "Application minimized to system tray. Double-click to open.",
                BalloonIcon.Info);
            
            Settings.Default.TrayHintShown = true;
            Settings.Default.Save();
        }
    }

    private void MainViewModel_PropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainViewModel.IsConnected) || 
            e.PropertyName == nameof(MainViewModel.ConnectionStatusText))
        {
            UpdateTrayStatus();
        }
    }

    private void UpdateTrayStatus()
    {
        if (_trayIcon == null || _mainViewModel == null) return;

        var isConnected = _mainViewModel.IsConnected;
        var statusText = _mainViewModel.ConnectionStatusText ?? "Unknown";

        // Update tooltip
        _trayIcon.ToolTipText = $"Octofleet Agent - {statusText}";

        // Update context menu status item
        var contextMenu = _trayIcon.ContextMenu;
        if (contextMenu != null)
        {
            foreach (var item in contextMenu.Items)
            {
                if (item is System.Windows.Controls.MenuItem menuItem && 
                    menuItem.Name == "TrayMenuConnectionStatus")
                {
                    menuItem.Header = $"Status: {statusText}";
                    
                    // Update status indicator color
                    if (menuItem.Icon is System.Windows.Shapes.Ellipse ellipse)
                    {
                        ellipse.Fill = new System.Windows.Media.SolidColorBrush(
                            isConnected 
                                ? System.Windows.Media.Color.FromRgb(34, 197, 94)   // Green
                                : System.Windows.Media.Color.FromRgb(107, 114, 128) // Gray
                        );
                    }
                    break;
                }
            }
        }
    }

    private void TrayIcon_DoubleClick(object? sender, RoutedEventArgs e)
    {
        ShowMainWindow();
    }

    private void ShowMainWindow()
    {
        if (_mainWindow == null) return;

        _mainWindow.Show();
        _mainWindow.WindowState = WindowState.Normal;
        _mainWindow.Activate();
        _mainWindow.Focus();
    }

    private void TrayMenu_Open_Click(object sender, RoutedEventArgs e)
    {
        ShowMainWindow();
    }

    private void TrayMenu_Dashboard_Click(object sender, RoutedEventArgs e)
    {
        ShowMainWindow();
        _mainViewModel?.NavigateToDashboardCommand.Execute(null);
    }

    private void TrayMenu_Connector_Click(object sender, RoutedEventArgs e)
    {
        ShowMainWindow();
        _mainViewModel?.NavigateToConnectorCommand.Execute(null);
    }

    private void TrayMenu_Exit_Click(object sender, RoutedEventArgs e)
    {
        ExitApplication();
    }

    /// <summary>
    /// Properly exit the application
    /// </summary>
    public void ExitApplication()
    {
        // Dispose tray icon
        _trayIcon?.Dispose();
        _trayIcon = null;

        // Allow window to close
        if (_mainWindow != null)
        {
            _mainWindow.Closing -= MainWindow_Closing;
            _mainWindow.Close();
        }

        // Shutdown application
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _trayIcon?.Dispose();
        base.OnExit(e);
    }
}
