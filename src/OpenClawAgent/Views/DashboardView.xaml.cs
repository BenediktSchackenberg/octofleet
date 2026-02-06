using System.Windows.Controls;

namespace OpenClawAgent.Views;

public partial class DashboardView : UserControl
{
    public DashboardView()
    {
        InitializeComponent();
        // DataContext is set by MainViewModel when navigating
    }
}
