namespace OctofleetAgent.Service;

/// <summary>
/// Where the Windows agent writes its logs: C:\Windows\Logs\Octofleet. Windows' own rules there
/// let users read logs, so nobody needs to open C:\ProgramData\Octofleet (which holds the agent
/// key) to read them. Older agents wrote to C:\ProgramData\Octofleet\logs; those files are moved
/// once.
/// </summary>
public static class AgentLogs
{
    public static string Folder { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Logs", "Octofleet");

    public static string OldFolder { get; } = Path.Combine(ServiceConfig.GetConfigDir(), "logs");

    /// <summary>Moves the logs of older agents. Returns a note for the log, or null if there was nothing to do.</summary>
    public static string? MoveOldLogs()
    {
        if (!Directory.Exists(OldFolder)) return null;
        try
        {
            Directory.CreateDirectory(Folder);
            var moved = 0;
            foreach (var file in Directory.EnumerateFiles(OldFolder))
            {
                var target = Path.Combine(Folder, Path.GetFileName(file));
                if (File.Exists(target)) target = Path.Combine(Folder, Path.GetFileNameWithoutExtension(file) + "-old" + Path.GetExtension(file));
                File.Move(file, target, overwrite: true);
                moved++;
            }
            Directory.Delete(OldFolder, recursive: true);
            return $"Moved {moved} log file(s) from {OldFolder} to {Folder}";
        }
        catch (Exception ex)
        {
            return $"Could not move the logs from {OldFolder} to {Folder}: {ex.Message}";
        }
    }
}
