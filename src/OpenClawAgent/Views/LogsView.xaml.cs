using System.Windows.Controls;
using OpenClawAgent.ViewModels;

namespace OpenClawAgent.Views;

public partial class LogsView : UserControl
{
    public LogsView()
    {
        InitializeComponent();
        DataContext = new LogsViewModel();
    }
}
