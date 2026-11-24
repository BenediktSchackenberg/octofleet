using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace OctofleetAgent.Service;

/// <summary>
/// Encrypts the agent key in service-config.json with DPAPI in the SYSTEM account's user scope:
/// only processes running as SYSTEM can decrypt it, whatever the file permissions are (an admin
/// who opens the folder to read the logs does not expose the key). The machine scope would not
/// help: every local user can decrypt that.
/// </summary>
[SupportedOSPlatform("windows")]
public static class AgentKeyProtection
{
    public const string Prefix = "dpapi:";
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Octofleet agent key v1");

    /// <summary>Only the service (running as SYSTEM) encrypts, so that it can decrypt again.</summary>
    public static bool CanProtect
    {
        get
        {
            try { using var identity = WindowsIdentity.GetCurrent(); return identity.IsSystem; }
            catch { return false; }
        }
    }

    public static string Protect(string key) =>
        Prefix + Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.CurrentUser));

    /// <summary>The key, or null if the value is not ours or cannot be decrypted by this account.</summary>
    public static string? Unprotect(string? value)
    {
        if (string.IsNullOrEmpty(value) || !value.StartsWith(Prefix, StringComparison.Ordinal)) return null;
        try
        {
            var data = ProtectedData.Unprotect(Convert.FromBase64String(value[Prefix.Length..]), Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(data);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return null;
        }
    }
}
