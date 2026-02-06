using System.Windows;
using System.Windows.Controls;
using OpenClawAgent.ViewModels;

namespace OpenClawAgent.Views;

public partial class GatewaysView : UserControl
{
    private readonly GatewaysViewModel _viewModel;

    public GatewaysView()
    {
        InitializeComponent();
        _viewModel = new GatewaysViewModel();
        DataContext = _viewModel;
    }

    // PasswordBox can't be bound directly in WPF (security restriction)
    // So we handle it in code-behind
    private void TokenBox_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox passwordBox)
        {
            _viewModel.NewGatewayToken = passwordBox.Password;
        }
    }
}
