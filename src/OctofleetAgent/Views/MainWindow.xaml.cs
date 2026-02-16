using System.Windows;

namespace OctofleetAgent.Views;

/// <summary>
/// Main application window
/// </summary>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    protected override void OnStateChanged(EventArgs e)
    {
        base.OnStateChanged(e);
        
        // Minimize to tray support
        if (WindowState == WindowState.Minimized)
        {
            // TODO: Implement tray icon
            // Hide();
        }
    }
}
