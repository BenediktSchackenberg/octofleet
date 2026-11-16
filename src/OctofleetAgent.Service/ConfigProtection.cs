using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;

namespace OctofleetAgent.Service;

/// <summary>
/// Restricts C:\ProgramData\Octofleet to SYSTEM and Administrators. The folder holds the agent key
/// (service-config.json), the logs and the .NET extraction directory of the service; by default
/// ProgramData lets every local user read files there and create new files and folders.
/// </summary>
[SupportedOSPlatform("windows")]
public static class ConfigProtection
{
    private static readonly SecurityIdentifier System = new(WellKnownSidType.LocalSystemSid, null);
    private static readonly SecurityIdentifier Administrators = new(WellKnownSidType.BuiltinAdministratorsSid, null);

    /// <summary>The folder's access rules: SYSTEM and Administrators, inherited by everything inside, nothing from ProgramData.</summary>
    public static DirectorySecurity FolderSecurity()
    {
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        foreach (var sid in new[] { System, Administrators })
        {
            security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Allow));
        }
        return security;
    }

    /// <summary>True if the rules allow anyone besides SYSTEM and Administrators.</summary>
    public static bool AllowsOthers(AuthorizationRuleCollection rules) =>
        rules.OfType<FileSystemAccessRule>().Any(rule => rule.AccessControlType == AccessControlType.Allow
            && rule.IdentityReference is SecurityIdentifier sid && sid != System && sid != Administrators);

    /// <summary>
    /// Applies the folder rules and lets every file and folder inside inherit them (explicit rules removed).
    /// Returns null on success, otherwise the reason; the service keeps running either way.
    /// </summary>
    public static string? Restrict(string folder)
    {
        try
        {
            var directory = new DirectoryInfo(folder);
            directory.Create();
            var current = directory.GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier));
            directory.SetAccessControl(FolderSecurity());
            foreach (var entry in directory.EnumerateFileSystemInfos("*", SearchOption.AllDirectories))
            {
                if (entry is DirectoryInfo sub)
                {
                    var inherit = new DirectorySecurity();
                    inherit.SetAccessRuleProtection(isProtected: false, preserveInheritance: false);
                    sub.SetAccessControl(inherit);
                }
                else if (entry is FileInfo file)
                {
                    var inherit = new FileSecurity();
                    inherit.SetAccessRuleProtection(isProtected: false, preserveInheritance: false);
                    file.SetAccessControl(inherit);
                }
            }
            return null;
        }
        catch (Exception ex)
        {
            return ex.Message;
        }
    }
}
