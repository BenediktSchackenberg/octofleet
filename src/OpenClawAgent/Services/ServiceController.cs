using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading.Tasks;

namespace OpenClawAgent.Services;

/// <summary>
/// Manages the OpenClaw Node Windows Service
/// </summary>
public class ServiceController
{
    public const string ServiceName = "OpenClawNodeAgent";
    public const string DisplayName = "OpenClaw Node Agent";
    public const string Description = "OpenClaw Node Agent - Connects this PC to an OpenClaw Gateway for remote command execution.";

    private static string ServiceExePath
    {
        get
        {
            // First check same directory as GUI
            var sameDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "OpenClawAgent.Service.exe");
            if (File.Exists(sameDir)) return sameDir;

            // Check sibling project output (during development)
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var devPath = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", 
                "OpenClawAgent.Service", "bin", "Debug", "net8.0-windows", "win-x64", "OpenClawAgent.Service.exe"));
            if (File.Exists(devPath)) return devPath;

            // Try without win-x64
            var devPath2 = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", 
                "OpenClawAgent.Service", "bin", "Debug", "net8.0-windows", "OpenClawAgent.Service.exe"));
            if (File.Exists(devPath2)) return devPath2;

            // Fallback to same directory
            return sameDir;
        }
    }

    /// <summary>
    /// Check if the service is installed
    /// </summary>
    public static bool IsInstalled
    {
        get
        {
            try
            {
                using var sc = new System.ServiceProcess.ServiceController(ServiceName);
                var status = sc.Status; // This will throw if not installed
                return true;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// Get current service status
    /// </summary>
    public static ServiceControllerStatus? Status
    {
        get
        {
            try
            {
                using var sc = new System.ServiceProcess.ServiceController(ServiceName);
                return sc.Status;
            }
            catch
            {
                return null;
            }
        }
    }

    /// <summary>
    /// Check if service is running
    /// </summary>
    public static bool IsRunning => Status == ServiceControllerStatus.Running;

    /// <summary>
    /// Install the Windows Service (requires admin)
    /// </summary>
    public static async Task<(bool success, string message)> InstallAsync()
    {
        if (IsInstalled)
            return (true, "Service is already installed.");

        if (!File.Exists(ServiceExePath))
            return (false, $"Service executable not found: {ServiceExePath}");

        try
        {
            var result = await RunScAsync($"create {ServiceName} binPath= \"{ServiceExePath}\" DisplayName= \"{DisplayName}\" start= auto");
            if (!result.success)
                return result;

            // Set description
            await RunScAsync($"description {ServiceName} \"{Description}\"");

            return (true, "Service installed successfully.");
        }
        catch (Exception ex)
        {
            return (false, $"Failed to install service: {ex.Message}");
        }
    }

    /// <summary>
    /// Uninstall the Windows Service (requires admin)
    /// </summary>
    public static async Task<(bool success, string message)> UninstallAsync()
    {
        if (!IsInstalled)
            return (true, "Service is not installed.");

        try
        {
            // Stop first if running
            if (IsRunning)
            {
                var stopResult = await StopAsync();
                if (!stopResult.success)
                    return stopResult;
            }

            var result = await RunScAsync($"delete {ServiceName}");
            return result;
        }
        catch (Exception ex)
        {
            return (false, $"Failed to uninstall service: {ex.Message}");
        }
    }

    /// <summary>
    /// Start the service (requires admin - triggers UAC)
    /// </summary>
    public static async Task<(bool success, string message)> StartAsync()
    {
        if (!IsInstalled)
            return (false, "Service is not installed.");

        if (IsRunning)
            return (true, "Service is already running.");

        try
        {
            var result = await RunScAsync($"start {ServiceName}");
            if (!result.success)
                return result;

            // Wait a bit for the service to start
            await Task.Delay(2000);
            
            if (IsRunning)
                return (true, "Service started successfully.");
            else
                return (false, "Service did not start. Check Event Logs for details.");
        }
        catch (Exception ex)
        {
            return (false, $"Failed to start service: {ex.Message}");
        }
    }

    /// <summary>
    /// Stop the service (requires admin - triggers UAC)
    /// </summary>
    public static async Task<(bool success, string message)> StopAsync()
    {
        if (!IsInstalled)
            return (false, "Service is not installed.");

        if (Status != ServiceControllerStatus.Running)
            return (true, "Service is not running.");

        try
        {
            var result = await RunScAsync($"stop {ServiceName}");
            if (!result.success)
                return result;

            // Wait a bit for the service to stop
            await Task.Delay(2000);
            
            if (!IsRunning)
                return (true, "Service stopped successfully.");
            else
                return (false, "Service did not stop.");
        }
        catch (Exception ex)
        {
            return (false, $"Failed to stop service: {ex.Message}");
        }
    }

    /// <summary>
    /// Restart the service
    /// </summary>
    public static async Task<(bool success, string message)> RestartAsync()
    {
        var stopResult = await StopAsync();
        if (!stopResult.success && Status != ServiceControllerStatus.Stopped)
            return stopResult;

        return await StartAsync();
    }

    private static async Task<(bool success, string message)> RunScAsync(string arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "sc.exe",
            Arguments = arguments,
            UseShellExecute = true,
            Verb = "runas", // Run as admin
            CreateNoWindow = true
        };

        try
        {
            using var process = Process.Start(psi);
            if (process == null)
                return (false, "Failed to start sc.exe");

            await process.WaitForExitAsync();
            
            if (process.ExitCode == 0)
                return (true, "Command completed successfully.");
            else
                return (false, $"sc.exe exited with code {process.ExitCode}");
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            // User cancelled UAC prompt
            return (false, "Administrator access denied.");
        }
    }
}
