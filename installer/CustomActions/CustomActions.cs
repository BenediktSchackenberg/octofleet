using System;
using System.IO;
using System.Text;
using WixToolset.Dtf.WindowsInstaller;

namespace OctofleetAgent.Installer.CustomActions
{
    public class CustomActions
    {
        /// <summary>
        /// Writes the service-config.json file with provided MSI properties.
        /// Called as a deferred custom action.
        /// </summary>
        [CustomAction]
        public static ActionResult WriteConfigFile(Session session)
        {
            try
            {
                // Parse CustomActionData (format: KEY=VALUE;KEY2=VALUE2;...)
                var customData = session.CustomActionData;
                
                var gatewayUrl = customData.ContainsKey("GATEWAY_URL") ? customData["GATEWAY_URL"] : "";
                var gatewayToken = customData.ContainsKey("GATEWAY_TOKEN") ? customData["GATEWAY_TOKEN"] : "";
                var inventoryUrl = customData.ContainsKey("INVENTORY_URL") ? customData["INVENTORY_URL"] : "";
                var displayName = customData.ContainsKey("DISPLAY_NAME") ? customData["DISPLAY_NAME"] : "";
                var configDir = customData.ContainsKey("CONFIGDIR") ? customData["CONFIGDIR"] : @"C:\ProgramData\Octofleet";

                // Skip if no gateway URL provided
                if (string.IsNullOrWhiteSpace(gatewayUrl))
                {
                    session.Log("WriteConfigFile: No GATEWAY_URL provided, skipping config creation.");
                    return ActionResult.Success;
                }

                // Use hostname as default display name
                if (string.IsNullOrWhiteSpace(displayName))
                {
                    displayName = Environment.MachineName;
                }

                // Use default inventory URL if not provided
                if (string.IsNullOrWhiteSpace(inventoryUrl))
                {
                    // Extract base from gateway URL and use port 8080
                    try
                    {
                        var uri = new Uri(gatewayUrl);
                        inventoryUrl = $"{uri.Scheme}://{uri.Host}:8080";
                    }
                    catch
                    {
                        inventoryUrl = "http://localhost:8080";
                    }
                }

                // Build JSON manually (no external dependencies)
                var json = BuildConfigJson(gatewayUrl, gatewayToken, displayName, inventoryUrl);

                // Ensure directory exists
                Directory.CreateDirectory(configDir);

                // Write config file (UTF-8 without BOM)
                var configPath = Path.Combine(configDir, "service-config.json");
                File.WriteAllText(configPath, json, new UTF8Encoding(false));

                session.Log($"WriteConfigFile: Successfully wrote config to {configPath}");
                session.Log($"WriteConfigFile: GatewayUrl={gatewayUrl}, DisplayName={displayName}");

                return ActionResult.Success;
            }
            catch (Exception ex)
            {
                session.Log($"WriteConfigFile ERROR: {ex.Message}");
                session.Log($"WriteConfigFile Stack: {ex.StackTrace}");
                
                // Don't fail the installation, just log the error
                return ActionResult.Success;
            }
        }

        /// <summary>
        /// Builds JSON config string manually to avoid System.Text.Json dependency
        /// </summary>
        private static string BuildConfigJson(string gatewayUrl, string gatewayToken, string displayName, string inventoryUrl)
        {
            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine($"  \"GatewayUrl\": \"{EscapeJson(gatewayUrl)}\",");
            sb.AppendLine($"  \"GatewayToken\": \"{EscapeJson(gatewayToken)}\",");
            sb.AppendLine($"  \"DisplayName\": \"{EscapeJson(displayName)}\",");
            sb.AppendLine($"  \"InventoryApiUrl\": \"{EscapeJson(inventoryUrl)}\",");
            sb.AppendLine("  \"AutoStart\": true,");
            sb.AppendLine("  \"AutoPushInventory\": true,");
            sb.AppendLine("  \"ScheduledPushEnabled\": true,");
            sb.AppendLine("  \"ScheduledPushIntervalMinutes\": 30");
            sb.AppendLine("}");
            return sb.ToString();
        }

        /// <summary>
        /// Escapes special characters for JSON strings
        /// </summary>
        private static string EscapeJson(string value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            
            return value
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\n", "\\n")
                .Replace("\r", "\\r")
                .Replace("\t", "\\t");
        }
    }
}
