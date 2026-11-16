using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;

namespace OctofleetAgent.Service;

/// <summary>
/// Access rules for C:\ProgramData\Octofleet: SYSTEM and Administrators only, for the folder and
/// everything in it. By default ProgramData lets every local user read the files there and create
/// new files and folders (including in "extract", where the service unpacks its .NET files). The
/// service applies the rules at every start and checks them every hour (ConfigProtectionWatcher).
/// The logs are in C:\Windows\Logs\Octofleet (AgentLogs), so nobody needs access here; the agent
/// key is also encrypted (AgentKeyProtection), so widened rules do not expose it.
/// </summary>
[SupportedOSPlatform("windows")]
public static class ConfigProtection
{
    private static readonly SecurityIdentifier System = new(WellKnownSidType.LocalSystemSid, null);
    private static readonly SecurityIdentifier Administrators = new(WellKnownSidType.BuiltinAdministratorsSid, null);
    private const InheritanceFlags All = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;

    /// <summary>The folder's rules: SYSTEM and Administrators, inherited by everything inside, nothing from ProgramData.</summary>
    public static DirectorySecurity FolderSecurity()
    {
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(new FileSystemAccessRule(System, FileSystemRights.FullControl, All, PropagationFlags.None, AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(Administrators, FileSystemRights.FullControl, All, PropagationFlags.None, AccessControlType.Allow));
        return security;
    }

    /// <summary>True if the folder's own rules are as set by Restrict: SYSTEM and Administrators only, nothing inherited.</summary>
    public static bool IsIntact(string folder)
    {
        var security = new DirectoryInfo(folder).GetAccessControl();
        if (!security.AreAccessRulesProtected) return false;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow) continue;
            var sid = (SecurityIdentifier)rule.IdentityReference;
            if (sid != System && sid != Administrators) return false;
        }
        return true;
    }

    /// <summary>
    /// Applies the folder rules, lets every file and folder inside inherit them (explicit rules
    /// removed, e.g. an account added by Explorer's "Continue"). Returns null on success, otherwise
    /// the reason; the service keeps running either way.
    /// </summary>
    public static string? Restrict(string folder)
    {
        try
        {
            var directory = new DirectoryInfo(folder);
            directory.Create();
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
