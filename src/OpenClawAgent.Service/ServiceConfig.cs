using System.Text.Json;

namespace OpenClawAgent.Service;

/// <summary>
/// Service configuration - loaded from config file
/// </summary>
public class ServiceConfig
{
    private static readonly string ConfigDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "OpenClaw");
    
    private static readonly string ConfigPath = Path.Combine(ConfigDir, "service-config.json");

    public string? GatewayUrl { get; set; }
    public string? GatewayToken { get; set; }
    public string DisplayName { get; set; } = Environment.MachineName;
    public bool AutoStart { get; set; } = true;
    
    // Inventory Backend settings
    public string InventoryApiUrl { get; set; } = "http://localhost:8080";
    public string InventoryApiKey { get; set; } = "openclaw-inventory-dev-key";
    public bool AutoPushInventory { get; set; } = true;

    public static ServiceConfig Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var json = File.ReadAllText(ConfigPath);
                return JsonSerializer.Deserialize<ServiceConfig>(json) ?? new ServiceConfig();
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Failed to load config: {ex.Message}");
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
            Console.WriteLine($"Failed to save config: {ex.Message}");
        }
    }

    public bool IsConfigured => !string.IsNullOrEmpty(GatewayUrl) && !string.IsNullOrEmpty(GatewayToken);
}
