namespace OctofleetAgent.Service.Inventory;

public class FullInventoryResult
{
    public string Timestamp { get; set; } = "";
    public string Hostname { get; set; } = "";
    public HardwareResult Hardware { get; set; } = new();
    public SoftwareResult Software { get; set; } = new();
    public HotfixResult Hotfixes { get; set; } = new();
    public SystemResult System { get; set; } = new();
    public SecurityResult Security { get; set; } = new();
    public BrowserCollector.BrowserResult Browser { get; set; } = new();
    public NetworkResult Network { get; set; } = new();
}

public class CategoryInventoryResult
{
    public string Timestamp { get; set; } = "";
    public string Hostname { get; set; } = "";
    public string Category { get; set; } = "";
    public object? Data { get; set; }
}

/// <summary>
/// Orchestrates all inventory collectors
/// </summary>
public static class InventoryCollector
{
    /// <summary>
    /// Collect all inventory data
    /// </summary>
    public static async Task<FullInventoryResult> CollectFullAsync()
    {
        var timestamp = DateTimeOffset.UtcNow;
        var result = new FullInventoryResult
        {
            Timestamp = timestamp.ToString("o"),
            Hostname = Environment.MachineName
        };

        // Run all collectors in parallel
        var tasks = new List<Task>
        {
            Task.Run(async () => result.Hardware = await HardwareCollector.CollectAsync()),
            Task.Run(async () => result.Software = await SoftwareCollector.CollectAsync()),
            Task.Run(async () => result.Hotfixes = await HotfixCollector.CollectAsync()),
            Task.Run(async () => result.System = await SystemCollector.CollectAsync()),
            Task.Run(async () => result.Security = await SecurityCollector.CollectAsync()),
            Task.Run(async () => result.Browser = await BrowserCollector.CollectAsync(null)),
            Task.Run(async () => result.Network = await NetworkCollector.CollectAsync())
        };

        await Task.WhenAll(tasks);

        return result;
    }

    /// <summary>
    /// Collect specific category
    /// </summary>
    public static async Task<CategoryInventoryResult> CollectAsync(string category)
    {
        var timestamp = DateTimeOffset.UtcNow;
        object? data;

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

        return new CategoryInventoryResult
        {
            Timestamp = timestamp.ToString("o"),
            Hostname = Environment.MachineName,
            Category = category,
            Data = data
        };
    }
}
