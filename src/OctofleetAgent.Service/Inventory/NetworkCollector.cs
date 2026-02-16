using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace OctofleetAgent.Service.Inventory;

public class PortInfo
{
    public string Protocol { get; set; } = "";
    public string Address { get; set; } = "";
    public int Port { get; set; }
}

public class ConnectionInfo
{
    public string LocalAddress { get; set; } = "";
    public int LocalPort { get; set; }
    public string RemoteAddress { get; set; } = "";
    public int RemotePort { get; set; }
    public string State { get; set; } = "";
}

public class ConnectionSummary
{
    public string State { get; set; } = "";
    public int Count { get; set; }
}

public class ConnectionResult
{
    public int Total { get; set; }
    public List<ConnectionSummary> Summary { get; set; } = new();
    public List<ConnectionInfo> Connections { get; set; } = new();
}

public class InterfaceAddressInfo
{
    public string Address { get; set; } = "";
    public int PrefixLength { get; set; }
}

public class InterfaceStatistics
{
    public long BytesReceived { get; set; }
    public long BytesSent { get; set; }
    public long PacketsReceived { get; set; }
    public long PacketsSent { get; set; }
}

public class NetworkInterfaceInfo
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Type { get; set; } = "";
    public string Status { get; set; } = "";
    public string MacAddress { get; set; } = "";
    public long? SpeedMbps { get; set; }
    public List<InterfaceAddressInfo> Ipv4Addresses { get; set; } = new();
    public List<string> Ipv6Addresses { get; set; } = new();
    public List<string> Gateways { get; set; } = new();
    public List<string> DnsServers { get; set; } = new();
    public bool? DhcpEnabled { get; set; }
    public InterfaceStatistics? Statistics { get; set; }
}

public class NetworkResult
{
    public List<PortInfo> OpenPorts { get; set; } = new();
    public ConnectionResult Connections { get; set; } = new();
    public List<NetworkInterfaceInfo> NetworkInterfaces { get; set; } = new();
}

/// <summary>
/// Collects network information: Open ports, connections, etc.
/// </summary>
public static class NetworkCollector
{
    public static async Task<NetworkResult> CollectAsync()
    {
        return await Task.Run(() =>
        {
            return new NetworkResult
            {
                OpenPorts = GetOpenPorts(),
                Connections = GetActiveConnections(),
                NetworkInterfaces = GetNetworkInterfaces()
            };
        });
    }

    private static List<PortInfo> GetOpenPorts()
    {
        var listeners = new List<PortInfo>();

        try
        {
            var properties = IPGlobalProperties.GetIPGlobalProperties();

            // TCP listeners
            foreach (var ep in properties.GetActiveTcpListeners())
            {
                listeners.Add(new PortInfo
                {
                    Protocol = "TCP",
                    Address = ep.Address.ToString(),
                    Port = ep.Port
                });
            }

            // UDP listeners
            foreach (var ep in properties.GetActiveUdpListeners())
            {
                listeners.Add(new PortInfo
                {
                    Protocol = "UDP",
                    Address = ep.Address.ToString(),
                    Port = ep.Port
                });
            }

            return listeners.OrderBy(l => l.Port).ToList();
        }
        catch
        {
            return listeners;
        }
    }

    private static ConnectionResult GetActiveConnections()
    {
        var result = new ConnectionResult();

        try
        {
            var properties = IPGlobalProperties.GetIPGlobalProperties();
            var connections = new List<ConnectionInfo>();

            foreach (var conn in properties.GetActiveTcpConnections())
            {
                connections.Add(new ConnectionInfo
                {
                    LocalAddress = conn.LocalEndPoint.Address.ToString(),
                    LocalPort = conn.LocalEndPoint.Port,
                    RemoteAddress = conn.RemoteEndPoint.Address.ToString(),
                    RemotePort = conn.RemoteEndPoint.Port,
                    State = conn.State.ToString()
                });
            }

            // Group by state for summary
            result.Summary = connections
                .GroupBy(c => c.State)
                .Select(g => new ConnectionSummary { State = g.Key, Count = g.Count() })
                .ToList();

            result.Total = connections.Count;
            result.Connections = connections.Take(100).ToList(); // Limit to prevent huge payloads

            return result;
        }
        catch
        {
            return result;
        }
    }

    private static List<NetworkInterfaceInfo> GetNetworkInterfaces()
    {
        var interfaces = new List<NetworkInterfaceInfo>();

        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                var ipProps = ni.GetIPProperties();
                
                var niInfo = new NetworkInterfaceInfo
                {
                    Name = ni.Name,
                    Description = ni.Description,
                    Type = ni.NetworkInterfaceType.ToString(),
                    Status = ni.OperationalStatus.ToString(),
                    MacAddress = ni.GetPhysicalAddress().ToString(),
                    SpeedMbps = ni.Speed > 0 ? ni.Speed / 1_000_000 : null
                };

                niInfo.Ipv4Addresses = ipProps.UnicastAddresses
                    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
                    .Select(a => new InterfaceAddressInfo
                    {
                        Address = a.Address.ToString(),
                        PrefixLength = a.PrefixLength
                    })
                    .ToList();

                niInfo.Ipv6Addresses = ipProps.UnicastAddresses
                    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetworkV6)
                    .Select(a => a.Address.ToString())
                    .ToList();

                niInfo.Gateways = ipProps.GatewayAddresses
                    .Select(g => g.Address.ToString())
                    .ToList();

                niInfo.DnsServers = ipProps.DnsAddresses
                    .Select(d => d.ToString())
                    .ToList();

                try
                {
                    niInfo.DhcpEnabled = ipProps.GetIPv4Properties()?.IsDhcpEnabled;
                }
                catch { }

                if (ni.OperationalStatus == OperationalStatus.Up)
                {
                    try
                    {
                        var stats = ni.GetIPv4Statistics();
                        niInfo.Statistics = new InterfaceStatistics
                        {
                            BytesReceived = stats.BytesReceived,
                            BytesSent = stats.BytesSent,
                            PacketsReceived = stats.UnicastPacketsReceived,
                            PacketsSent = stats.UnicastPacketsSent
                        };
                    }
                    catch { }
                }

                interfaces.Add(niInfo);
            }

            return interfaces;
        }
        catch
        {
            return interfaces;
        }
    }
}
