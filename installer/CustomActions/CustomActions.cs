using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using WixToolset.Dtf.WindowsInstaller;

namespace OctofleetAgent.Installer.CustomActions
{
    public class CustomActions
    {
        /// <summary>
        /// Deferred, as SYSTEM, before the service starts: restricts C:\ProgramData\Octofleet to
        /// SYSTEM and Administrators (as the install script and the service do) and writes the
        /// passed properties into service-config.json. Without properties the config stays as it
        /// is (upgrade, repair). The agent key is never logged.
        /// </summary>
        [CustomAction]
        public static ActionResult WriteConfigFile(Session session)
        {
            try
            {
                var data = session.CustomActionData;
                Func<string, string> get = key => data.ContainsKey(key) ? data[key] : "";

                var configDir = get("CONFIGDIR");
                if (string.IsNullOrWhiteSpace(configDir))
                    configDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Octofleet");

                Directory.CreateDirectory(configDir);
                Directory.SetAccessControl(configDir, FolderSecurity());

                var passed = new List<string>();
                foreach (var name in new[] { "SERVER_URL", "API_KEY", "DISPLAY_NAME", "PUSH_INTERVAL" })
                    if (!string.IsNullOrWhiteSpace(get(name))) passed.Add(name);

                var configPath = Path.Combine(configDir, ConfigFile.FileName);
                if (passed.Count == 0)
                {
                    session.Log("WriteConfigFile: no SERVER_URL, API_KEY, DISPLAY_NAME or PUSH_INTERVAL passed; " +
                                (File.Exists(configPath) ? "keeping " + configPath : "no config written"));
                    return ActionResult.Success;
                }

                var existing = File.Exists(configPath) ? File.ReadAllText(configPath) : null;
                bool replacedInvalid;
                var json = ConfigFile.Merge(existing, get("SERVER_URL"), get("API_KEY"), get("DISPLAY_NAME"),
                    get("PUSH_INTERVAL"), out replacedInvalid);
                if (replacedInvalid)
                    session.Log("WriteConfigFile: " + configPath + " was not valid JSON and is replaced");

                File.WriteAllText(configPath, json, new UTF8Encoding(false));
                // Rules from the folder only (a file from an older install may have its own)
                var inherit = new FileSecurity();
                inherit.SetAccessRuleProtection(false, false);
                File.SetAccessControl(configPath, inherit);

                session.Log("WriteConfigFile: " + (existing == null ? "created " : "updated ") + configPath +
                            " with " + string.Join(", ", passed));
                return ActionResult.Success;
            }
            catch (ArgumentException ex)
            {
                // Invalid property value: fail the installation (1603) instead of an unconfigured agent
                session.Log("WriteConfigFile ERROR: " + ex.Message);
                return ActionResult.Failure;
            }
            catch (Exception ex)
            {
                session.Log("WriteConfigFile ERROR: " + ex);
                return ActionResult.Failure;
            }
        }

        /// <summary>Same rules as ConfigProtection.FolderSecurity in the service.</summary>
        private static DirectorySecurity FolderSecurity()
        {
            const InheritanceFlags all = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            foreach (var sid in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid })
                security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid, null),
                    FileSystemRights.FullControl, all, PropagationFlags.None, AccessControlType.Allow));
            return security;
        }
    }
}
