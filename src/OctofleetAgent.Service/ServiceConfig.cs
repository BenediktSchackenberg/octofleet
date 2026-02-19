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
    
    // Pending approval workflow
    public string? PendingId { get; set; }  // Set when registered, cleared when approved
    public string? DiscoveryUrl { get; set; } = "http://192.168.0.5:8080";  // Default discovery URL

    // Software Repository settings (Epic #57 Issue #62)
    public string? RepoUrl { get; set; }  // e.g., "http://192.168.0.5:8080/api/v1/repo"
    public bool PreferRepo { get; set; } = true;  // Check local repo before external URLs
    public bool FallbackToSource { get; set; } = true;  // Use source URL if not in repo

    private static readonly JsonSerializerOptions LoadOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static string GetConfigDir() => ConfigDir;
    public static string GetConfigPath() => ConfigPath;

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

    // Gateway is configured (optional - for Claude remote access)
    public bool IsGatewayConfigured => !string.IsNullOrEmpty(GatewayUrl) && !string.IsNullOrEmpty(GatewayToken);
    
    // Inventory backend is configured (required for basic functionality)
    public bool IsInventoryConfigured => 
        !string.IsNullOrEmpty(InventoryApiUrl) && 
        InventoryApiUrl != "http://localhost:8080" &&
        !string.IsNullOrEmpty(InventoryApiKey);
    
    // Legacy: keep for backwards compatibility
    public bool IsConfigured => IsGatewayConfigured;
    
    // Is waiting for admin approval?
    public bool IsPendingApproval => !string.IsNullOrEmpty(PendingId);

    /// <summary>
    /// Creates a RepoResolver instance from config settings.
    /// Returns null if repo is not configured.
    /// </summary>
    public RepoResolver? CreateRepoResolver(Microsoft.Extensions.Logging.ILogger<RepoResolver>? logger = null)
    {
        if (string.IsNullOrEmpty(RepoUrl))
        {
            // Default to inventory API URL + /api/v1/repo
            var defaultRepoUrl = InventoryApiUrl?.TrimEnd('/') + "/api/v1/repo";
            return new RepoResolver(defaultRepoUrl, logger, PreferRepo, FallbackToSource);
        }
        return new RepoResolver(RepoUrl, logger, PreferRepo, FallbackToSource);
    }
}
