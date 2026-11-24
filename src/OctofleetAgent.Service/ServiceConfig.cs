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
    public string InventoryApiUrl { get; set; } = "";
    public string InventoryApiKey { get; set; } = "";
    /// <summary>
    /// The agent key as stored by the service: DPAPI-encrypted for SYSTEM (AgentKeyProtection).
    /// Installers write InventoryApiKey in plain text; the service encrypts it on its next load
    /// and empties InventoryApiKey in the file. In memory, InventoryApiKey always holds the key.
    /// </summary>
    public string? InventoryApiKeyProtected { get; set; }
    public bool AutoPushInventory { get; set; } = true;
    
    // Scheduled Inventory Push settings
    public bool ScheduledPushEnabled { get; set; } = true;
    public int ScheduledPushIntervalMinutes { get; set; } = PushSchedule.DefaultIntervalMinutes;  // spread over the interval, see PushSchedule
    
    // Pending approval workflow
    public string? PendingId { get; set; }  // Set when registered, cleared when approved
    public string? DiscoveryUrl { get; set; } = null;  // Discovery URL - must be configured

    // Software Repository settings (Epic #57 Issue #62)
    public string? RepoUrl { get; set; }  // e.g., "http://192.168.0.5:8080/api/v1/repo"
    public bool PreferRepo { get; set; } = true;  // Check local repo before external URLs
    public bool FallbackToSource { get; set; } = true;  // Use source URL if not in repo

    // Agent updates
    public bool UpdateFromServer { get; set; } = true;  // Check InventoryApiUrl for agent releases first
    public bool UpdateFallbackToGitHub { get; set; } = true;  // Use GitHub if the server has no release

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
                    config.RevealKey();
                    return config;
                }
            }
        }
        catch (Exception ex)
        {
        }
        return new ServiceConfig();
    }

    private static readonly object MigrationLock = new();

    /// <summary>
    /// Fills InventoryApiKey from the encrypted value. A plain-text key in the file (new install,
    /// a support script, an older agent) wins and is encrypted right away when running as SYSTEM.
    /// </summary>
    private void RevealKey()
    {
        if (!string.IsNullOrEmpty(InventoryApiKey))
        {
            if (AgentKeyProtection.CanProtect)
            {
                lock (MigrationLock) { Save(); }
            }
            return;
        }
        InventoryApiKey = AgentKeyProtection.Unprotect(InventoryApiKeyProtected) ?? "";
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(ConfigDir);
            var toWrite = this;
            if (AgentKeyProtection.CanProtect && !string.IsNullOrEmpty(InventoryApiKey))
            {
                toWrite = (ServiceConfig)MemberwiseClone();
                toWrite.InventoryApiKeyProtected = AgentKeyProtection.Protect(InventoryApiKey);
                toWrite.InventoryApiKey = "";
            }
            var json = JsonSerializer.Serialize(toWrite, new JsonSerializerOptions { WriteIndented = true });
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
