using System.Windows.Controls;
using OpenClawAgent.ViewModels;

namespace OpenClawAgent.Views;

public partial class DashboardView : UserControl
{
    public DashboardView()
    {
        InitializeComponent();
        DataContext = new DashboardViewModel();
    }
}
