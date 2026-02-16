using System.Net.Http.Json;
using System.Text.Json;

namespace OctofleetAgent.Service.Inventory;

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
            
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Add("X-API-Key", config.InventoryApiKey);
            var jsonContent = JsonSerializer.Serialize(data, JsonOptions);
            request.Content = new StringContent(jsonContent, System.Text.Encoding.UTF8, "application/json");
            
            // Track bytes sent
            var bytesSent = System.Text.Encoding.UTF8.GetByteCount(jsonContent);
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
