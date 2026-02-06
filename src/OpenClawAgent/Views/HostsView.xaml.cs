using System.Windows.Controls;
using OpenClawAgent.ViewModels;

namespace OpenClawAgent.Views;

public partial class HostsView : UserControl
{
    public HostsView()
    {
        InitializeComponent();
        DataContext = new HostsViewModel();
    }
}
