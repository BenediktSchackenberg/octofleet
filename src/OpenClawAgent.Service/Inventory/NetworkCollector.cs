using System.Net.NetworkInformation;
using System.Net;
using System.Diagnostics;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects network information: Open ports, connections, etc.
/// </summary>
public static class NetworkCollector
{
    public static async Task<object> CollectAsync()
    {
        return await Task.Run(() =>
        {
            return new
            {
                openPorts = GetOpenPorts(),
                connections = GetActiveConnections(),
                networkInterfaces = GetNetworkInterfaces()
            };
        });
    }

    private static object GetOpenPorts()
    {
        try
        {
            var listeners = new List<object>();
            var properties = IPGlobalProperties.GetIPGlobalProperties();

            // TCP listeners
            foreach (var ep in properties.GetActiveTcpListeners())
            {
                listeners.Add(new
                {
                    protocol = "TCP",
                    address = ep.Address.ToString(),
                    port = ep.Port
                });
            }

            // UDP listeners
            foreach (var ep in properties.GetActiveUdpListeners())
            {
                listeners.Add(new
                {
                    protocol = "UDP",
                    address = ep.Address.ToString(),
                    port = ep.Port
                });
            }

            return listeners.OrderBy(l => ((dynamic)l).port).ToList();
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetActiveConnections()
    {
        try
        {
            var connections = new List<object>();
            var properties = IPGlobalProperties.GetIPGlobalProperties();

            foreach (var conn in properties.GetActiveTcpConnections())
            {
                connections.Add(new
                {
                    localAddress = conn.LocalEndPoint.Address.ToString(),
                    localPort = conn.LocalEndPoint.Port,
                    remoteAddress = conn.RemoteEndPoint.Address.ToString(),
                    remotePort = conn.RemoteEndPoint.Port,
                    state = conn.State.ToString()
                });
            }

            // Group by state for summary
            var summary = connections
                .GroupBy(c => ((dynamic)c).state)
                .Select(g => new { state = g.Key, count = g.Count() })
                .ToList();

            return new
            {
                total = connections.Count,
                summary = summary,
                connections = connections.Take(100).ToList() // Limit to prevent huge payloads
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetNetworkInterfaces()
    {
        try
        {
            var interfaces = new List<object>();

            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                var ipProps = ni.GetIPProperties();
                var ipv4Addresses = ipProps.UnicastAddresses
                    .Where(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    .Select(a => new
                    {
                        address = a.Address.ToString(),
                        prefixLength = a.PrefixLength
                    })
                    .ToList();

                var ipv6Addresses = ipProps.UnicastAddresses
                    .Where(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
                    .Select(a => a.Address.ToString())
                    .ToList();

                var gateways = ipProps.GatewayAddresses
                    .Select(g => g.Address.ToString())
                    .ToList();

                var dnsServers = ipProps.DnsAddresses
                    .Select(d => d.ToString())
                    .ToList();

                var stats = ni.OperationalStatus == OperationalStatus.Up 
                    ? ni.GetIPv4Statistics() 
                    : null;

                interfaces.Add(new
                {
                    name = ni.Name,
                    description = ni.Description,
                    type = ni.NetworkInterfaceType.ToString(),
                    status = ni.OperationalStatus.ToString(),
                    macAddress = ni.GetPhysicalAddress().ToString(),
                    speedMbps = ni.Speed > 0 ? ni.Speed / 1_000_000 : null,
                    ipv4Addresses = ipv4Addresses,
                    ipv6Addresses = ipv6Addresses,
                    gateways = gateways,
                    dnsServers = dnsServers,
                    dhcpEnabled = ipProps.GetIPv4Properties()?.IsDhcpEnabled,
                    statistics = stats != null ? new
                    {
                        bytesReceived = stats.BytesReceived,
                        bytesSent = stats.BytesSent,
                        packetsReceived = stats.UnicastPacketsReceived,
                        packetsSent = stats.UnicastPacketsSent
                    } : null
                });
            }

            return interfaces;
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }
}
