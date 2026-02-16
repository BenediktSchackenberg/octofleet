using System.Windows.Controls;

namespace OctofleetAgent.Views;

public partial class DashboardView : UserControl
{
    public DashboardView()
    {
        InitializeComponent();
        
        // Auto-scroll to bottom when new logs are added
        if (DataContext is ViewModels.DashboardViewModel vm)
        {
            vm.Logs.CollectionChanged += (s, e) =>
            {
                if (vm.AutoScroll && LogsListBox.Items.Count > 0)
                {
                    LogsListBox.ScrollIntoView(LogsListBox.Items[^1]);
                }
            };
        }
        
        // Also handle when DataContext changes
        DataContextChanged += (s, e) =>
        {
            if (e.NewValue is ViewModels.DashboardViewModel newVm)
            {
                newVm.Logs.CollectionChanged += (_, _) =>
                {
                    if (newVm.AutoScroll && LogsListBox.Items.Count > 0)
                    {
                        LogsListBox.ScrollIntoView(LogsListBox.Items[^1]);
                    }
                };
            }
        };
    }
}
