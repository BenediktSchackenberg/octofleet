using System.Windows;
using System.Windows.Controls;
using OctofleetAgent.ViewModels;

namespace OctofleetAgent.Views;

public partial class GatewaysView : UserControl
{
    public GatewaysView()
    {
        InitializeComponent();
        // DataContext is set by MainViewModel when navigating
    }

    // PasswordBox can't be bound directly in WPF (security restriction)
    // So we handle it in code-behind
    private void TokenBox_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox passwordBox && DataContext is GatewaysViewModel viewModel)
        {
            viewModel.NewGatewayToken = passwordBox.Password;
        }
    }
}
