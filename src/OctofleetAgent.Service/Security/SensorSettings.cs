using System.Text.Json;

namespace OctofleetAgent.Service.Security;

/// <summary>
/// Sensor switches from GET /api/v1/monitoring/nodes/{node}/effective-policy: the node's
/// monitoring profile first, then the fleet-wide defaults (servers that send them), else null,
/// which the collectors treat as on (older servers).
/// </summary>
public static class SensorSettings
{
    public static bool? Resolve(JsonElement root, string sensor)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        if (root.TryGetProperty("policy", out var policy) && policy.ValueKind == JsonValueKind.Object
            && policy.TryGetProperty("sensors", out var sensors))
        {
            var fromProfile = ReadBool(sensors, sensor);
            if (fromProfile is not null) return fromProfile;
        }
        if (root.TryGetProperty("defaults", out var defaults))
            return ReadBool(defaults, sensor);
        return null;
    }

    public static bool? Resolve(string json, string sensor)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return Resolve(doc.RootElement, sensor);
        }
        catch (JsonException) { return null; }
    }

    private static bool? ReadBool(JsonElement element, string sensor)
    {
        if (element.ValueKind == JsonValueKind.String)
            return Resolve($"{{\"defaults\":{element.GetString()}}}", sensor);
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(sensor, out var value))
            return null;
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }
}
