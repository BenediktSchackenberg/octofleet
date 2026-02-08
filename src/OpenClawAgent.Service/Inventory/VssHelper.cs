using System.Diagnostics;
using System.Runtime.InteropServices;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Helper to read locked files via Volume Shadow Copy Service (VSS)
/// Works even when Chrome/Edge have exclusive locks on their databases
/// </summary>
public static class VssHelper
{
    /// <summary>
    /// Copy a locked file using VSS shadow copy
    /// </summary>
    public static async Task<string?> CopyLockedFileAsync(string sourcePath, string? destPath = null)
    {
        if (!File.Exists(sourcePath))
            return null;

        destPath ??= Path.Combine(Path.GetTempPath(), $"vss_{Guid.NewGuid()}_{Path.GetFileName(sourcePath)}");

        // Method 1: Try direct copy first (fastest if file isn't locked)
        try
        {
            File.Copy(sourcePath, destPath, true);
            return destPath;
        }
        catch (IOException)
        {
            // File is locked, continue with fallbacks
        }

        // Method 2: Use esentutl FIRST (most reliable for SQLite)
        var esentResult = await CopyViaEsentutlAsync(sourcePath, destPath);
        if (esentResult != null)
            return esentResult;

        // Method 3: Try VSS as fallback
        var vssResult = await CopyViaVssAsync(sourcePath, destPath);
        if (vssResult != null)
            return vssResult;

        return null;
    }

    /// <summary>
    /// Copy using VSS snapshot via PowerShell
    /// </summary>
    private static async Task<string?> CopyViaVssAsync(string sourcePath, string destPath)
    {
        try
        {
            var driveLetter = Path.GetPathRoot(sourcePath)?.TrimEnd('\\') ?? "C:";
            var relativePath = sourcePath.Substring(3); // Remove "C:\" prefix
            
            Console.WriteLine($"[VssHelper] Creating VSS snapshot for {driveLetter}");
            
            // Create shadow copy via WMI
            var createScript = $@"
$vss = (Get-WmiObject -List Win32_ShadowCopy).Create('{driveLetter}\', 'ClientAccessible')
if ($vss.ReturnValue -ne 0) {{ throw 'VSS create failed' }}
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object {{ $_.ID -eq $vss.ShadowID }}
$shadow.DeviceObject
";
            var deviceObject = (await RunPowerShellAsync(createScript)).Trim();
            
            if (string.IsNullOrEmpty(deviceObject) || !deviceObject.Contains("HarddiskVolumeShadowCopy"))
            {
                Console.WriteLine($"[VssHelper] VSS create failed, no device object returned");
                return null;
            }
            
            Console.WriteLine($"[VssHelper] VSS device: {deviceObject}");
            
            // Use cmd.exe copy (PowerShell Copy-Item has issues with these paths)
            var vssSourcePath = $"{deviceObject}\\{relativePath}";
            var copyPsi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c copy \"{vssSourcePath}\" \"{destPath}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            
            using var copyProcess = Process.Start(copyPsi);
            if (copyProcess != null)
            {
                await copyProcess.WaitForExitAsync();
                Console.WriteLine($"[VssHelper] cmd copy exit code: {copyProcess.ExitCode}");
            }
            
            // Cleanup: delete the shadow copy
            var cleanupScript = $@"
$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object {{ $_.DeviceObject -eq '{deviceObject}' }}
if ($shadow) {{ $shadow.Delete() }}
";
            await RunPowerShellAsync(cleanupScript);
            
            if (File.Exists(destPath))
            {
                Console.WriteLine($"[VssHelper] VSS copy successful: {destPath}");
                return destPath;
            }

            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[VssHelper] VSS exception: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Copy using esentutl.exe (Windows built-in, can copy locked ESE/SQLite files)
    /// </summary>
    private static async Task<string?> CopyViaEsentutlAsync(string sourcePath, string destPath)
    {
        try
        {
            // esentutl /y copies the file using raw sector access, bypassing locks
            var psi = new ProcessStartInfo
            {
                FileName = "esentutl.exe",
                Arguments = $"/y \"{sourcePath}\" /d \"{destPath}\" /o",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            Console.WriteLine($"[VssHelper] Running esentutl for: {sourcePath}");
            
            using var process = Process.Start(psi);
            if (process == null)
            {
                Console.WriteLine("[VssHelper] Failed to start esentutl.exe");
                return null;
            }

            var stdout = await process.StandardOutput.ReadToEndAsync();
            var stderr = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();

            Console.WriteLine($"[VssHelper] esentutl exit code: {process.ExitCode}");
            if (!string.IsNullOrEmpty(stderr))
                Console.WriteLine($"[VssHelper] esentutl stderr: {stderr}");

            if (process.ExitCode == 0 && File.Exists(destPath))
            {
                Console.WriteLine($"[VssHelper] Successfully copied to: {destPath}");
                return destPath;
            }

            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[VssHelper] esentutl exception: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Run PowerShell script and return output
    /// </summary>
    private static async Task<string> RunPowerShellAsync(string script)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"{script.Replace("\"", "\\\"")}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null)
                return "ERROR: Could not start PowerShell";

            var output = await process.StandardOutput.ReadToEndAsync();
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();

            return string.IsNullOrEmpty(error) ? output : $"ERROR: {error}";
        }
        catch (Exception ex)
        {
            return $"ERROR: {ex.Message}";
        }
    }

    /// <summary>
    /// Copy multiple related files (e.g., SQLite DB + WAL + SHM)
    /// </summary>
    public static async Task<string?> CopySqliteDatabaseAsync(string dbPath)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), $"vss_db_{Guid.NewGuid()}");
        Directory.CreateDirectory(tempDir);

        var dbName = Path.GetFileName(dbPath);
        var destDb = Path.Combine(tempDir, dbName);

        // Copy main database file
        var copiedDb = await CopyLockedFileAsync(dbPath, destDb);
        if (copiedDb == null)
        {
            try { Directory.Delete(tempDir, true); } catch { }
            return null;
        }

        // Also copy WAL and SHM if they exist (for complete database state)
        var walPath = dbPath + "-wal";
        var shmPath = dbPath + "-shm";

        if (File.Exists(walPath))
            await CopyLockedFileAsync(walPath, destDb + "-wal");
        
        if (File.Exists(shmPath))
            await CopyLockedFileAsync(shmPath, destDb + "-shm");

        return destDb;
    }

    /// <summary>
    /// Cleanup temp directory after use
    /// </summary>
    public static void CleanupTempDatabase(string? dbPath)
    {
        if (string.IsNullOrEmpty(dbPath))
            return;

        try
        {
            var dir = Path.GetDirectoryName(dbPath);
            if (dir != null && dir.Contains("vss_db_"))
                Directory.Delete(dir, true);
            else if (File.Exists(dbPath))
                File.Delete(dbPath);
        }
        catch { }
    }
}
