using System.Text.Json.Serialization;

namespace OctofleetAgent.Service.Inventory;

/// <summary>
/// The full inventory. A section whose collector timed out or failed is null and left out of the
/// JSON: the server then keeps that section's last data. (Sent as null or empty it would fail the
/// push or - for the browser section - clear the stored data.)
/// </summary>
public class FullInventoryResult
{
    public string Timestamp { get; set; } = "";
    public string Hostname { get; set; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public HardwareResult? Hardware { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public SoftwareResult? Software { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public HotfixResult? Hotfixes { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public SystemResult? System { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public SecurityResult? Security { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public BrowserCollector.BrowserResult? Browser { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public NetworkResult? Network { get; set; }
    /// <summary>Sections left out of this push, with the reason (e.g. "security: timed out after 180 s").</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public List<string>? IncompleteSections { get; set; }
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

        // Run all collectors in parallel, each with a time limit: one that hangs or fails must not
        // hold back (or lose) the others
        var incomplete = new List<string>();
        var hardware = Limited("hardware", HardwareCollector.CollectAsync, incomplete);
        var software = Limited("software", SoftwareCollector.CollectAsync, incomplete);
        var hotfixes = Limited("hotfixes", HotfixCollector.CollectAsync, incomplete);
        var system = Limited("system", SystemCollector.CollectAsync, incomplete);
        var security = Limited("security", SecurityCollector.CollectAsync, incomplete);
        var browser = Limited("browser", () => BrowserCollector.CollectAsync(null), incomplete);
        var network = Limited("network", NetworkCollector.CollectAsync, incomplete);
        await Task.WhenAll(hardware, software, hotfixes, system, security, browser, network);

        result.Hardware = hardware.Result;
        result.Software = software.Result;
        result.Hotfixes = hotfixes.Result;
        result.System = system.Result;
        result.Security = security.Result;
        result.Browser = browser.Result;
        result.Network = network.Result;
        if (incomplete.Count > 0) result.IncompleteSections = incomplete;
        return result;
    }

    /// <summary>Time limit per collector (WMI queries and helper processes have their own, shorter ones).</summary>
    public static readonly TimeSpan CollectorTimeout = TimeSpan.FromMinutes(3);

    /// <summary>
    /// Runs a collector with <see cref="CollectorTimeout"/>. Returns null (and notes the section in
    /// <paramref name="incomplete"/>) when it times out or throws; a timed-out collector cannot be
    /// cancelled and ends in the background.
    /// </summary>
    private static async Task<T?> Limited<T>(string section, Func<Task<T>> collect, List<string> incomplete) where T : class
    {
        var task = Task.Run(collect);
        if (await Task.WhenAny(task, Task.Delay(CollectorTimeout)) != task)
        {
            _ = task.ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
            lock (incomplete) incomplete.Add($"{section}: timed out after {CollectorTimeout.TotalSeconds:0} s");
            return null;
        }
        try
        {
            return await task;
        }
        catch (Exception ex)
        {
            lock (incomplete) incomplete.Add($"{section}: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
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
