using System.Diagnostics;
using System.Management;
using System.Text.Json;
using Microsoft.Win32;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects hardware information via WMI
/// </summary>
public static class HardwareCollector
{
    public static async Task<object> CollectAsync()
    {
        return await Task.Run(() =>
        {
            var result = new
            {
                cpu = GetCpuInfo(),
                ram = GetRamInfo(),
                disks = GetDiskInfo(),
                mainboard = GetMainboardInfo(),
                bios = GetBiosInfo(),
                gpu = GetGpuInfo(),
                nics = GetNicInfo()
            };
            return result;
        });
    }

    private static object GetCpuInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Processor");
            var cpus = new List<object>();
            
            foreach (ManagementObject obj in searcher.Get())
            {
                cpus.Add(new
                {
                    name = obj["Name"]?.ToString()?.Trim(),
                    manufacturer = obj["Manufacturer"]?.ToString(),
                    cores = Convert.ToInt32(obj["NumberOfCores"] ?? 0),
                    logicalProcessors = Convert.ToInt32(obj["NumberOfLogicalProcessors"] ?? 0),
                    maxClockSpeedMHz = Convert.ToInt32(obj["MaxClockSpeed"] ?? 0),
                    architecture = GetArchitecture(obj["Architecture"]),
                    socketDesignation = obj["SocketDesignation"]?.ToString(),
                    l2CacheKB = Convert.ToInt32(obj["L2CacheSize"] ?? 0),
                    l3CacheKB = Convert.ToInt32(obj["L3CacheSize"] ?? 0),
                    processorId = obj["ProcessorId"]?.ToString()
                });
            }
            
            return cpus.Count == 1 ? cpus[0] : cpus;
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static string GetArchitecture(object? arch)
    {
        if (arch == null) return "Unknown";
        return Convert.ToInt32(arch) switch
        {
            0 => "x86",
            5 => "ARM",
            9 => "x64",
            12 => "ARM64",
            _ => "Unknown"
        };
    }

    private static object GetRamInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_PhysicalMemory");
            var modules = new List<object>();
            long totalBytes = 0;

            foreach (ManagementObject obj in searcher.Get())
            {
                var capacity = Convert.ToInt64(obj["Capacity"] ?? 0);
                totalBytes += capacity;
                
                modules.Add(new
                {
                    manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                    partNumber = obj["PartNumber"]?.ToString()?.Trim(),
                    serialNumber = obj["SerialNumber"]?.ToString()?.Trim(),
                    capacityGB = Math.Round(capacity / 1024.0 / 1024.0 / 1024.0, 2),
                    speedMHz = Convert.ToInt32(obj["Speed"] ?? 0),
                    formFactor = GetFormFactor(obj["FormFactor"]),
                    memoryType = GetMemoryType(obj["SMBIOSMemoryType"]),
                    bankLabel = obj["BankLabel"]?.ToString(),
                    deviceLocator = obj["DeviceLocator"]?.ToString()
                });
            }

            return new
            {
                totalGB = Math.Round(totalBytes / 1024.0 / 1024.0 / 1024.0, 2),
                moduleCount = modules.Count,
                modules = modules
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static string GetFormFactor(object? ff)
    {
        if (ff == null) return "Unknown";
        return Convert.ToInt32(ff) switch
        {
            8 => "DIMM",
            12 => "SODIMM",
            _ => "Unknown"
        };
    }

    private static string GetMemoryType(object? mt)
    {
        if (mt == null) return "Unknown";
        return Convert.ToInt32(mt) switch
        {
            20 => "DDR",
            21 => "DDR2",
            24 => "DDR3",
            26 => "DDR4",
            34 => "DDR5",
            _ => "Unknown"
        };
    }

    private static object GetDiskInfo()
    {
        try
        {
            var disks = new List<object>();
            
            // Physical disks
            using (var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_DiskDrive"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    var sizeBytes = Convert.ToInt64(obj["Size"] ?? 0);
                    
                    disks.Add(new
                    {
                        model = obj["Model"]?.ToString()?.Trim(),
                        manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                        serialNumber = obj["SerialNumber"]?.ToString()?.Trim(),
                        sizeGB = Math.Round(sizeBytes / 1024.0 / 1024.0 / 1024.0, 2),
                        interfaceType = obj["InterfaceType"]?.ToString(),
                        mediaType = obj["MediaType"]?.ToString(),
                        partitions = Convert.ToInt32(obj["Partitions"] ?? 0),
                        deviceId = obj["DeviceID"]?.ToString()
                    });
                }
            }

            // Add logical disk info (free space)
            var volumes = new List<object>();
            using (var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_LogicalDisk WHERE DriveType=3"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    var sizeBytes = Convert.ToInt64(obj["Size"] ?? 0);
                    var freeBytes = Convert.ToInt64(obj["FreeSpace"] ?? 0);
                    
                    volumes.Add(new
                    {
                        driveLetter = obj["DeviceID"]?.ToString(),
                        volumeName = obj["VolumeName"]?.ToString(),
                        fileSystem = obj["FileSystem"]?.ToString(),
                        sizeGB = Math.Round(sizeBytes / 1024.0 / 1024.0 / 1024.0, 2),
                        freeGB = Math.Round(freeBytes / 1024.0 / 1024.0 / 1024.0, 2),
                        usedPercent = sizeBytes > 0 
                            ? Math.Round((1 - (freeBytes / (double)sizeBytes)) * 100, 1) 
                            : 0
                    });
                }
            }

            return new { physical = disks, volumes = volumes };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetMainboardInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_BaseBoard");
            foreach (ManagementObject obj in searcher.Get())
            {
                return new
                {
                    manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                    product = obj["Product"]?.ToString()?.Trim(),
                    version = obj["Version"]?.ToString()?.Trim(),
                    serialNumber = obj["SerialNumber"]?.ToString()?.Trim()
                };
            }
            return new { error = "No mainboard found" };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetBiosInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_BIOS");
            foreach (ManagementObject obj in searcher.Get())
            {
                return new
                {
                    manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                    name = obj["Name"]?.ToString()?.Trim(),
                    version = obj["Version"]?.ToString()?.Trim(),
                    smbiosVersion = obj["SMBIOSBIOSVersion"]?.ToString()?.Trim(),
                    releaseDate = ParseWmiDate(obj["ReleaseDate"]?.ToString()),
                    serialNumber = obj["SerialNumber"]?.ToString()?.Trim()
                };
            }
            return new { error = "No BIOS found" };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static string? ParseWmiDate(string? wmiDate)
    {
        if (string.IsNullOrEmpty(wmiDate) || wmiDate.Length < 8) return null;
        try
        {
            var year = wmiDate.Substring(0, 4);
            var month = wmiDate.Substring(4, 2);
            var day = wmiDate.Substring(6, 2);
            return $"{year}-{month}-{day}";
        }
        catch
        {
            return wmiDate;
        }
    }

    private static object GetGpuInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_VideoController");
            var gpus = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                var ramBytes = Convert.ToInt64(obj["AdapterRAM"] ?? 0);
                
                gpus.Add(new
                {
                    name = obj["Name"]?.ToString()?.Trim(),
                    manufacturer = obj["AdapterCompatibility"]?.ToString()?.Trim(),
                    driverVersion = obj["DriverVersion"]?.ToString(),
                    driverDate = ParseWmiDate(obj["DriverDate"]?.ToString()),
                    videoMemoryGB = ramBytes > 0 ? Math.Round(ramBytes / 1024.0 / 1024.0 / 1024.0, 2) : null,
                    currentResolution = $"{obj["CurrentHorizontalResolution"]}x{obj["CurrentVerticalResolution"]}",
                    refreshRate = obj["CurrentRefreshRate"]?.ToString()
                });
            }

            return gpus;
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetNicInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT * FROM Win32_NetworkAdapter WHERE NetConnectionStatus IS NOT NULL");
            var nics = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                var speedBps = Convert.ToInt64(obj["Speed"] ?? 0);
                
                nics.Add(new
                {
                    name = obj["Name"]?.ToString()?.Trim(),
                    manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                    macAddress = obj["MACAddress"]?.ToString(),
                    speedMbps = speedBps > 0 ? speedBps / 1000000 : null,
                    connectionStatus = GetConnectionStatus(obj["NetConnectionStatus"]),
                    adapterType = obj["AdapterType"]?.ToString(),
                    deviceId = obj["DeviceID"]?.ToString()
                });
            }

            // Also get IP configuration
            using var configSearcher = new ManagementObjectSearcher(
                "SELECT * FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=True");
            var configs = new Dictionary<string, object>();
            
            foreach (ManagementObject obj in configSearcher.Get())
            {
                var index = obj["Index"]?.ToString() ?? "";
                var ipAddresses = obj["IPAddress"] as string[];
                var gateways = obj["DefaultIPGateway"] as string[];
                var dnsServers = obj["DNSServerSearchOrder"] as string[];
                var dhcpEnabled = Convert.ToBoolean(obj["DHCPEnabled"]);
                
                configs[index] = new
                {
                    ipAddresses = ipAddresses,
                    gateways = gateways,
                    dnsServers = dnsServers,
                    dhcpEnabled = dhcpEnabled
                };
            }

            return new { adapters = nics, configurations = configs };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static string GetConnectionStatus(object? status)
    {
        if (status == null) return "Unknown";
        return Convert.ToInt32(status) switch
        {
            0 => "Disconnected",
            1 => "Connecting",
            2 => "Connected",
            3 => "Disconnecting",
            4 => "Hardware not present",
            5 => "Hardware disabled",
            6 => "Hardware malfunction",
            7 => "Media disconnected",
            8 => "Authenticating",
            9 => "Authentication succeeded",
            10 => "Authentication failed",
            11 => "Invalid address",
            12 => "Credentials required",
            _ => "Unknown"
        };
    }
}
