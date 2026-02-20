using System;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;

namespace OctofleetScreenHelper;

internal static class Program
{
    private static Mutex? _mutex;
    private const string MutexName = "Global\\OctofleetScreenHelper";
    
    [STAThread]
    static void Main(string[] args)
    {
        // Single instance check
        bool createdNew;
        _mutex = new Mutex(true, MutexName, out createdNew);
        
        if (!createdNew)
        {
            // Already running - just exit silently
            return;
        }
        
        try
        {
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            
            // Run in tray mode
            using var helper = new ScreenHelperApp();
            Application.Run(helper);
        }
        finally
        {
            _mutex?.ReleaseMutex();
            _mutex?.Dispose();
        }
    }
}
