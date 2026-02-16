using System.Windows.Controls;

namespace OctofleetAgent.Views;

public partial class ConnectorView : UserControl
{
    public ConnectorView()
    {
        InitializeComponent();
    }

    private void TokenBox_PasswordChanged(object sender, System.Windows.RoutedEventArgs e)
    {
        if (DataContext is ViewModels.ConnectorViewModel vm && sender is PasswordBox pb)
        {
            vm.NewGatewayToken = pb.Password;
        }
    }
}
