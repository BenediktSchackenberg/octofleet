using System.Net.Http.Json;
using System.Text.Json;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Pushes inventory data to the backend API
/// </summary>
public static class InventoryPusher
{
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
        
        Console.WriteLine($"[InventoryPusher] Using API URL: {config.InventoryApiUrl}");
        
        if (string.IsNullOrEmpty(config.InventoryApiUrl))
        {
            return new PushResult 
            { 
                Success = false, 
                Error = "Inventory API URL not configured" 
            };
        }

        try
        {
            var url = $"{config.InventoryApiUrl.TrimEnd('/')}/api/v1/inventory/{type}";
            Console.WriteLine($"[InventoryPusher] POST to: {url}");
            
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Add("X-API-Key", config.InventoryApiKey);
            request.Content = JsonContent.Create(data, options: JsonOptions);
            
            var response = await _httpClient.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            
            if (response.IsSuccessStatusCode)
            {
                return new PushResult 
                { 
                    Success = true, 
                    StatusCode = (int)response.StatusCode,
                    Response = responseBody
                };
            }
            else
            {
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
        config ??= ServiceConfig.Load();
        var results = new FullPushResult();
        
        // Collect full inventory
        var fullData = await InventoryCollector.CollectFullAsync();
        
        // Push to /full endpoint
        var pushResult = await PushAsync("full", fullData, config);
        results.FullPush = pushResult;
        
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
    public bool Success => FullPush?.Success ?? false;
    public string Summary => FullPush?.Success == true 
        ? $"Successfully pushed inventory (HTTP {FullPush.StatusCode})"
        : $"Push failed: {FullPush?.Error}";
}
