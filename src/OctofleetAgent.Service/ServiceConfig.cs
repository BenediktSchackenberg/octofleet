using System.Text.Json;

namespace OctofleetAgent.Service;

/// <summary>
/// Service configuration - loaded from config file
/// </summary>
public class ServiceConfig
{
    private static readonly string ConfigDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "Octofleet");
    
    private static readonly string ConfigPath = Path.Combine(ConfigDir, "service-config.json");

    public string? GatewayUrl { get; set; }
    public string? GatewayToken { get; set; }
    public string DisplayName { get; set; } = Environment.MachineName;
    public bool AutoStart { get; set; } = true;
    
    // Inventory Backend settings
    public string InventoryApiUrl { get; set; } = "http://localhost:8080";
    public string InventoryApiKey { get; set; } = "octofleet-inventory-dev-key";
    public bool AutoPushInventory { get; set; } = true;
    
    // Scheduled Inventory Push settings
    public bool ScheduledPushEnabled { get; set; } = true;
    public int ScheduledPushIntervalMinutes { get; set; } = 30;  // Default: every 30 minutes

    private static readonly JsonSerializerOptions LoadOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static ServiceConfig Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var json = File.ReadAllText(ConfigPath);
                var config = JsonSerializer.Deserialize<ServiceConfig>(json, LoadOptions);
                if (config != null)
                {
                    return config;
                }
            }
        }
        catch (Exception ex)
        {
        }
        return new ServiceConfig();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(ConfigDir);
            var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(ConfigPath, json);
        }
        catch (Exception ex)
        {
        }
    }

    public bool IsConfigured => !string.IsNullOrEmpty(GatewayUrl) && !string.IsNullOrEmpty(GatewayToken);
}
