namespace OpenClawAgent.Models;

/// <summary>
/// Remote host for agent deployment
/// </summary>
public class RemoteHost
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Hostname { get; set; } = "";
    public string? IpAddress { get; set; }
    public string Username { get; set; } = "";
    public ConnectionType ConnectionType { get; set; } = ConnectionType.WinRM;
    public HostStatus Status { get; set; } = HostStatus.Unknown;
    public string? AgentVersion { get; set; }
    public DateTime? LastSeen { get; set; }
    public string? LastError { get; set; }
}

public enum ConnectionType
{
    WinRM,
    SMB,
    SSH
}

public enum HostStatus
{
    Unknown,
    Testing,
    Online,
    Offline,
    Deployed,
    Error
}
