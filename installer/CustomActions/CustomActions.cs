using System;
using System.IO;
using System.Text;
using System.Text.Json;
using WixToolset.Dtf.WindowsInstaller;

namespace OpenClawAgent.Installer.CustomActions
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
                var configDir = customData.ContainsKey("CONFIGDIR") ? customData["CONFIGDIR"] : @"C:\ProgramData\OpenClaw";

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

                // Create config object
                var config = new
                {
                    GatewayUrl = gatewayUrl,
                    GatewayToken = gatewayToken,
                    DisplayName = displayName,
                    InventoryApiUrl = inventoryUrl,
                    AutoStart = true,
                    AutoPushInventory = true,
                    ScheduledPushEnabled = true,
                    ScheduledPushIntervalMinutes = 30
                };

                // Serialize to JSON
                var options = new JsonSerializerOptions
                {
                    WriteIndented = true
                };
                var json = JsonSerializer.Serialize(config, options);

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
    }
}
