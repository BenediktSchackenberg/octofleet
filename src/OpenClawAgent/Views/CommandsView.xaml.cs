using System.Windows.Controls;
using OpenClawAgent.ViewModels;

namespace OpenClawAgent.Views;

public partial class CommandsView : UserControl
{
    public CommandsView()
    {
        InitializeComponent();
        DataContext = new CommandsViewModel();
    }
}
