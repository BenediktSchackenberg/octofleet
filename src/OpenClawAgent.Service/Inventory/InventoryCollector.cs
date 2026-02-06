namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Orchestrates all inventory collectors
/// </summary>
public static class InventoryCollector
{
    /// <summary>
    /// Collect all inventory data
    /// </summary>
    public static async Task<object> CollectFullAsync()
    {
        var timestamp = DateTimeOffset.UtcNow;
        
        // Run all collectors in parallel
        var hardwareTask = SafeCollect("hardware", HardwareCollector.CollectAsync);
        var softwareTask = SafeCollect("software", SoftwareCollector.CollectAsync);
        var hotfixTask = SafeCollect("hotfixes", HotfixCollector.CollectAsync);
        var systemTask = SafeCollect("system", SystemCollector.CollectAsync);
        var securityTask = SafeCollect("security", SecurityCollector.CollectAsync);
        var browserTask = SafeCollect("browser", () => BrowserCollector.CollectAsync(null));
        var networkTask = SafeCollect("network", NetworkCollector.CollectAsync);

        await Task.WhenAll(hardwareTask, softwareTask, hotfixTask, systemTask, 
                          securityTask, browserTask, networkTask);

        return new
        {
            timestamp = timestamp.ToString("o"),
            hostname = Environment.MachineName,
            hardware = await hardwareTask,
            software = await softwareTask,
            hotfixes = await hotfixTask,
            system = await systemTask,
            security = await securityTask,
            browser = await browserTask,
            network = await networkTask
        };
    }

    /// <summary>
    /// Collect specific category
    /// </summary>
    public static async Task<object> CollectAsync(string category)
    {
        var timestamp = DateTimeOffset.UtcNow;
        object data;

        switch (category.ToLowerInvariant())
        {
            case "hardware":
                data = await HardwareCollector.CollectAsync();
                break;
            case "software":
                data = await SoftwareCollector.CollectAsync();
                break;
            case "hotfixes":
                data = await HotfixCollector.CollectAsync();
                break;
            case "system":
                data = await SystemCollector.CollectAsync();
                break;
            case "security":
                data = await SecurityCollector.CollectAsync();
                break;
            case "browser":
            case "browser.all":
                data = await BrowserCollector.CollectAsync(null);
                break;
            case "browser.chrome":
                data = await BrowserCollector.CollectAsync("chrome");
                break;
            case "browser.firefox":
                data = await BrowserCollector.CollectAsync("firefox");
                break;
            case "browser.edge":
                data = await BrowserCollector.CollectAsync("edge");
                break;
            case "network":
                data = await NetworkCollector.CollectAsync();
                break;
            default:
                throw new ArgumentException($"Unknown inventory category: {category}");
        }

        return new
        {
            timestamp = timestamp.ToString("o"),
            hostname = Environment.MachineName,
            category = category,
            data = data
        };
    }

    private static async Task<object> SafeCollect(string name, Func<Task<object>> collector)
    {
        try
        {
            return await collector();
        }
        catch (Exception ex)
        {
            return new
            {
                error = ex.Message,
                type = ex.GetType().Name
            };
        }
    }
}
