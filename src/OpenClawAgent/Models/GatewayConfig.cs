namespace OpenClawAgent.Models;

/// <summary>
/// Gateway connection configuration
/// </summary>
public class GatewayConfig
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string Url { get; set; } = "";
    public string Token { get; set; } = "";
    public bool IsDefault { get; set; }
    public bool AutoConnect { get; set; }
    public DateTime? LastConnected { get; set; }
    public string? LastError { get; set; }
    
    // Runtime state (not persisted)
    public bool IsConnected { get; set; }
    public int Latency { get; set; }
    public string? Version { get; set; }
}
