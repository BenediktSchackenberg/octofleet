using System.Net.Http.Json;
using System.Text.Json;

namespace OctofleetAgent.Service.Inventory;

/// <summary>
/// Pushes inventory data to the backend API
/// </summary>
public static class InventoryPusher
{
    private static readonly Serilog.ILogger Log = Serilog.Log.ForContext(typeof(InventoryPusher));

    private static readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(30)
    };
    
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    /// <summary>
    /// Push inventory data to the backend API
    /// </summary>
    public static async Task<PushResult> PushAsync(string type, object data, ServiceConfig? config = null)
    {
        config ??= ServiceConfig.Load();
        
        
        if (string.IsNullOrEmpty(config.InventoryApiUrl))
        {
            Log.Warning("Inventory {Type} not pushed: InventoryApiUrl is not configured", type);
            return new PushResult 
            { 
                Success = false, 
                Error = "Inventory API URL not configured" 
            };
        }

        var watch = System.Diagnostics.Stopwatch.StartNew();
        var bytesSent = 0;
        try
        {
            var url = $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/inventory/{type}";
            
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Add("X-API-Key", config.InventoryApiKey);
            var jsonContent = JsonSerializer.Serialize(data, JsonOptions);
            request.Content = new StringContent(jsonContent, System.Text.Encoding.UTF8, "application/json");
            
            // Track bytes sent
            bytesSent = System.Text.Encoding.UTF8.GetByteCount(jsonContent);
            ConsoleUI.AddBytesSent(bytesSent);
            ConsoleUI.SetOperation($"Pushing {type} ({bytesSent / 1024}KB)...");
            
            var response = await _httpClient.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            
            // Track bytes received
            ConsoleUI.AddBytesReceived(System.Text.Encoding.UTF8.GetByteCount(responseBody));
            ConsoleUI.SetOperation(null);
            
            if (response.IsSuccessStatusCode)
            {
                ConsoleUI.LastInventoryPush = DateTime.Now;
                ConsoleUI.InventoryApiConnected = true;
                Log.Information("Inventory {Type} pushed: {KB} KB, HTTP {Status} in {Ms} ms",
                    type, bytesSent / 1024, (int)response.StatusCode, watch.ElapsedMilliseconds);
                return new PushResult 
                { 
                    Success = true, 
                    StatusCode = (int)response.StatusCode,
                    Response = responseBody
                };
            }
            else
            {
                ConsoleUI.AddError();
                // The server's answer says why (e.g. a validation error); cut, it can be long
                Log.Warning("Inventory {Type} rejected: {KB} KB, HTTP {Status} in {Ms} ms: {Response}",
                    type, bytesSent / 1024, (int)response.StatusCode, watch.ElapsedMilliseconds,
                    responseBody.Length > 500 ? responseBody[..500] + "..." : responseBody);
                return new PushResult 
                { 
                    Success = false, 
                    StatusCode = (int)response.StatusCode,
                    Error = $"HTTP {response.StatusCode}: {responseBody}"
                };
            }
        }
        catch (Exception ex)
        {
            ConsoleUI.AddError();
            ConsoleUI.SetOperation(null);
            ConsoleUI.InventoryApiConnected = false;
            Log.Warning("Inventory {Type} push failed after {Ms} ms ({KB} KB): {Error}",
                type, watch.ElapsedMilliseconds, bytesSent / 1024, ex.Message);
            return new PushResult 
            { 
                Success = false, 
                Error = ex.Message 
            };
        }
    }

    /// <summary>
    /// Collect all inventory and push to backend
    /// </summary>
    public static async Task<FullPushResult> CollectAndPushAllAsync(ServiceConfig? config = null)
    {
        // Always reload config to get latest values
        config = ServiceConfig.Load();
        var results = new FullPushResult();
        
        // Collect full inventory
        var fullData = await InventoryCollector.CollectFullAsync();
        
        // Push to /full endpoint
        var pushResult = await PushAsync("full", fullData, config);
        results.FullPush = pushResult;
        results.IncompleteSections = fullData.IncompleteSections;
        
        return results;
    }
}

public class PushResult
{
    public bool Success { get; set; }
    public int StatusCode { get; set; }
    public string? Response { get; set; }
    public string? Error { get; set; }
}

public class FullPushResult
{
    public PushResult? FullPush { get; set; }
    /// <summary>Sections left out because their collector timed out or failed (see FullInventoryResult).</summary>
    public List<string>? IncompleteSections { get; set; }
    public bool Success => FullPush?.Success ?? false;
    public string Summary => (FullPush?.Success == true
        ? $"Successfully pushed inventory (HTTP {FullPush.StatusCode})"
        : $"Push failed: {FullPush?.Error}")
        + (IncompleteSections is { Count: > 0 } ? $"; left out: {string.Join("; ", IncompleteSections)}" : "");
}
