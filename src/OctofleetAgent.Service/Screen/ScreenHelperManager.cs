using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace OctofleetAgent.Service.Screen;

/// <summary>
/// Manages the OctofleetScreenHelper process - starts it in user session from Service Session 0.
/// </summary>
public class ScreenHelperManager
{
    private readonly ILogger _logger;
    private Process? _helperProcess;
    private readonly string _helperPath;
    
    public bool IsHelperRunning => _helperProcess != null && !_helperProcess.HasExited;
    
    public ScreenHelperManager(ILogger logger)
    {
        _logger = logger;
        
        // Helper should be in same directory as service
        var serviceDir = AppDomain.CurrentDomain.BaseDirectory;
        _helperPath = Path.Combine(serviceDir, "OctofleetScreenHelper.exe");
    }
    
    /// <summary>
    /// Ensure the screen helper is running in the active user session.
    /// </summary>
    public async Task<bool> EnsureHelperRunningAsync(CancellationToken cancellationToken = default)
    {
        // Check if already running (tracked by us)
        if (IsHelperRunning)
        {
            _logger.LogDebug("Screen helper already running (PID: {Pid})", _helperProcess?.Id);
            return true;
        }
        
        // Check if helper is already running externally (started by user or previous session)
        // This check comes FIRST so we can use a manually started helper during development
        var existingHelpers = Process.GetProcessesByName("OctofleetScreenHelper");
        if (existingHelpers.Length > 0)
        {
            _logger.LogInformation("Screen helper already running externally (PID: {Pid})", existingHelpers[0].Id);
            return true;
        }
        
        // Check if helper executable exists (only needed if we have to start it ourselves)
        if (!File.Exists(_helperPath))
        {
            _logger.LogWarning("Screen helper not found at: {Path}", _helperPath);
            return false;
        }
        
        // Get active user session
        var sessionId = GetActiveUserSessionId();
        if (sessionId == null)
        {
            _logger.LogWarning("No active user session found - cannot start screen helper");
            return false;
        }
        
        _logger.LogInformation("Starting screen helper in session {SessionId}", sessionId);
        
        try
        {
            // Try method 1: CreateProcessAsUser (requires duplication of user token)
            if (await TryStartWithCreateProcessAsUserAsync(sessionId.Value, cancellationToken))
            {
                return true;
            }
            
            // Try method 2: Scheduled task (fallback)
            if (await TryStartWithScheduledTaskAsync(cancellationToken))
            {
                return true;
            }
            
            _logger.LogError("Failed to start screen helper - all methods failed");
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error starting screen helper");
            return false;
        }
    }
    
    private async Task<bool> TryStartWithCreateProcessAsUserAsync(int sessionId, CancellationToken cancellationToken)
    {
        try
        {
            // Get token of the logged-in user
            if (!WTSQueryUserToken((uint)sessionId, out var userToken))
            {
                var error = Marshal.GetLastWin32Error();
                _logger.LogWarning("WTSQueryUserToken failed with error {Error}", error);
                return false;
            }
            
            try
            {
                // Duplicate token for CreateProcessAsUser
                if (!DuplicateTokenEx(
                    userToken,
                    0x10000000, // GENERIC_ALL
                    IntPtr.Zero,
                    2, // SecurityIdentification
                    1, // TokenPrimary
                    out var duplicatedToken))
                {
                    _logger.LogWarning("DuplicateTokenEx failed");
                    return false;
                }
                
                try
                {
                    // Set up process creation
                    var si = new STARTUPINFO();
                    si.cb = Marshal.SizeOf(si);
                    si.lpDesktop = "winsta0\\default";
                    
                    var pi = new PROCESS_INFORMATION();
                    
                    // Create environment block
                    if (!CreateEnvironmentBlock(out var envBlock, duplicatedToken, false))
                    {
                        _logger.LogWarning("CreateEnvironmentBlock failed");
                        envBlock = IntPtr.Zero;
                    }
                    
                    try
                    {
                        var flags = 0x00000010 | // CREATE_NEW_CONSOLE  
                                   0x00000400;  // CREATE_UNICODE_ENVIRONMENT
                        
                        if (!CreateProcessAsUser(
                            duplicatedToken,
                            _helperPath,
                            null,
                            IntPtr.Zero,
                            IntPtr.Zero,
                            false,
                            flags,
                            envBlock,
                            Path.GetDirectoryName(_helperPath),
                            ref si,
                            out pi))
                        {
                            var error = Marshal.GetLastWin32Error();
                            _logger.LogWarning("CreateProcessAsUser failed with error {Error}", error);
                            return false;
                        }
                        
                        _logger.LogInformation("Screen helper started with CreateProcessAsUser (PID: {Pid})", pi.dwProcessId);
                        
                        // Track the process
                        try
                        {
                            _helperProcess = Process.GetProcessById((int)pi.dwProcessId);
                        }
                        catch { }
                        
                        // Wait a bit for it to initialize
                        await Task.Delay(1000, cancellationToken);
                        
                        return true;
                    }
                    finally
                    {
                        if (envBlock != IntPtr.Zero)
                        {
                            DestroyEnvironmentBlock(envBlock);
                        }
                        if (pi.hProcess != IntPtr.Zero)
                        {
                            CloseHandle(pi.hProcess);
                        }
                        if (pi.hThread != IntPtr.Zero)
                        {
                            CloseHandle(pi.hThread);
                        }
                    }
                }
                finally
                {
                    CloseHandle(duplicatedToken);
                }
            }
            finally
            {
                CloseHandle(userToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "CreateProcessAsUser method failed");
            return false;
        }
    }
    
    private async Task<bool> TryStartWithScheduledTaskAsync(CancellationToken cancellationToken)
    {
        try
        {
            var taskName = "OctofleetScreenHelper";
            
            // Create scheduled task that runs immediately
            var createResult = await RunProcessAsync(
                "schtasks.exe",
                $"/Create /TN \"{taskName}\" /TR \"\\\"{_helperPath}\\\"\" /SC ONCE /ST 00:00 /F /RL HIGHEST",
                cancellationToken);
            
            if (createResult != 0)
            {
                _logger.LogWarning("Failed to create scheduled task");
                return false;
            }
            
            // Run the task
            var runResult = await RunProcessAsync(
                "schtasks.exe",
                $"/Run /TN \"{taskName}\"",
                cancellationToken);
            
            if (runResult != 0)
            {
                _logger.LogWarning("Failed to run scheduled task");
                return false;
            }
            
            _logger.LogInformation("Screen helper started via scheduled task");
            
            // Wait a bit and find the process
            await Task.Delay(2000, cancellationToken);
            
            var helpers = Process.GetProcessesByName("OctofleetScreenHelper");
            if (helpers.Length > 0)
            {
                _helperProcess = helpers[0];
                return true;
            }
            
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Scheduled task method failed");
            return false;
        }
    }
    
    private static async Task<int> RunProcessAsync(string fileName, string arguments, CancellationToken cancellationToken)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };
        
        process.Start();
        await process.WaitForExitAsync(cancellationToken);
        return process.ExitCode;
    }
    
    /// <summary>
    /// Stop the screen helper process.
    /// </summary>
    public void StopHelper()
    {
        try
        {
            if (_helperProcess != null && !_helperProcess.HasExited)
            {
                _helperProcess.Kill();
                _helperProcess.Dispose();
                _helperProcess = null;
                _logger.LogInformation("Screen helper stopped");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error stopping screen helper");
        }
    }
    
    /// <summary>
    /// Get the session ID of the active user (console or RDP).
    /// </summary>
    private static int? GetActiveUserSessionId()
    {
        var sessionId = WTSGetActiveConsoleSessionId();
        if (sessionId != 0xFFFFFFFF)
        {
            return (int)sessionId;
        }
        
        // No console session, try to find an active RDP session
        if (WTSEnumerateSessions(IntPtr.Zero, 0, 1, out var sessionInfo, out var count))
        {
            try
            {
                var dataSize = Marshal.SizeOf<WTS_SESSION_INFO>();
                for (int i = 0; i < count; i++)
                {
                    var info = Marshal.PtrToStructure<WTS_SESSION_INFO>(sessionInfo + (i * dataSize));
                    if (info.State == WTS_CONNECTSTATE_CLASS.WTSActive)
                    {
                        return info.SessionId;
                    }
                }
            }
            finally
            {
                WTSFreeMemory(sessionInfo);
            }
        }
        
        return null;
    }
    
    #region Native Interop
    
    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();
    
    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);
    
    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSEnumerateSessions(
        IntPtr hServer,
        int reserved,
        int version,
        out IntPtr ppSessionInfo,
        out int pCount);
    
    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr memory);
    
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(
        IntPtr hExistingToken,
        uint dwDesiredAccess,
        IntPtr lpTokenAttributes,
        int impersonationLevel,
        int tokenType,
        out IntPtr phNewToken);
    
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
        IntPtr hToken,
        string lpApplicationName,
        string? lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        int dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);
    
    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);
    
    [DllImport("userenv.dll")]
    private static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);
    
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    
    [StructLayout(LayoutKind.Sequential)]
    private struct WTS_SESSION_INFO
    {
        public int SessionId;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pWinStationName;
        public WTS_CONNECTSTATE_CLASS State;
    }
    
    private enum WTS_CONNECTSTATE_CLASS
    {
        WTSActive,
        WTSConnected,
        WTSConnectQuery,
        WTSShadow,
        WTSDisconnected,
        WTSIdle,
        WTSListen,
        WTSReset,
        WTSDown,
        WTSInit
    }
    
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }
    
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }
    
    #endregion
}
