using System.Diagnostics;
using System.Management;
using System.Text.Json;
using Microsoft.Win32;

namespace OpenClawAgent.Service.Inventory;

// DTOs for type-safe returns
public class CpuInfo
{
    public string? Name { get; set; }
    public string? Manufacturer { get; set; }
    public int Cores { get; set; }
    public int LogicalProcessors { get; set; }
    public int MaxClockSpeedMHz { get; set; }
    public string? Architecture { get; set; }
    public string? SocketDesignation { get; set; }
    public int L2CacheKB { get; set; }
    public int L3CacheKB { get; set; }
    public string? ProcessorId { get; set; }
}

public class RamModule
{
    public string? Manufacturer { get; set; }
    public string? PartNumber { get; set; }
    public string? SerialNumber { get; set; }
    public double CapacityGB { get; set; }
    public int SpeedMHz { get; set; }
    public string? FormFactor { get; set; }
    public string? MemoryType { get; set; }
    public string? BankLabel { get; set; }
    public string? DeviceLocator { get; set; }
}

public class RamInfo
{
    public double TotalGB { get; set; }
    public int ModuleCount { get; set; }
    public List<RamModule> Modules { get; set; } = new();
}

public class DiskInfo
{
    public string? Model { get; set; }
    public string? Manufacturer { get; set; }
    public string? SerialNumber { get; set; }
    public double SizeGB { get; set; }
    public string? InterfaceType { get; set; }
    public string? MediaType { get; set; }
    public int Partitions { get; set; }
    public string? DeviceId { get; set; }
}

public class VolumeInfo
{
    public string? DriveLetter { get; set; }
    public string? VolumeName { get; set; }
    public string? FileSystem { get; set; }
    public double SizeGB { get; set; }
    public double FreeGB { get; set; }
    public double UsedPercent { get; set; }
}

public class DiskResult
{
    public List<DiskInfo> Physical { get; set; } = new();
    public List<VolumeInfo> Volumes { get; set; } = new();
}

public class MainboardInfo
{
    public string? Manufacturer { get; set; }
    public string? Product { get; set; }
    public string? Version { get; set; }
    public string? SerialNumber { get; set; }
    public string? Error { get; set; }
}

public class BiosInfo
{
    public string? Manufacturer { get; set; }
    public string? Name { get; set; }
    public string? Version { get; set; }
    public string? SmbiosVersion { get; set; }
    public string? ReleaseDate { get; set; }
    public string? SerialNumber { get; set; }
    public string? Uuid { get; set; }
    public bool? IsUefi { get; set; }
    public string? SecureBootState { get; set; }
    public string? Error { get; set; }
}

public class VirtualizationInfo
{
    public bool IsVirtual { get; set; }
    public string? Hypervisor { get; set; }
    public string? Model { get; set; }
    public string? Manufacturer { get; set; }
    public string? Error { get; set; }
}

public class GpuInfo
{
    public string? Name { get; set; }
    public string? Manufacturer { get; set; }
    public string? DriverVersion { get; set; }
    public string? DriverDate { get; set; }
    public double? VideoMemoryGB { get; set; }
    public string? CurrentResolution { get; set; }
    public string? RefreshRate { get; set; }
}

public class NicInfo
{
    public string? Name { get; set; }
    public string? Manufacturer { get; set; }
    public string? MacAddress { get; set; }
    public long? SpeedMbps { get; set; }
    public string? ConnectionStatus { get; set; }
    public string? AdapterType { get; set; }
    public string? DeviceId { get; set; }
}

public class NicConfig
{
    public string[]? IpAddresses { get; set; }
    public string[]? Gateways { get; set; }
    public string[]? DnsServers { get; set; }
    public bool DhcpEnabled { get; set; }
}

public class NicResult
{
    public List<NicInfo> Adapters { get; set; } = new();
    public Dictionary<string, NicConfig> Configurations { get; set; } = new();
}

public class HardwareResult
{
    public object? Cpu { get; set; }
    public RamInfo? Ram { get; set; }
    public DiskResult? Disks { get; set; }
    public MainboardInfo? Mainboard { get; set; }
    public BiosInfo? Bios { get; set; }
    public VirtualizationInfo? Virtualization { get; set; }
    public List<GpuInfo>? Gpu { get; set; }
    public NicResult? Nics { get; set; }
}

/// <summary>
/// Collects hardware information via WMI
/// </summary>
public static class HardwareCollector
{
    public static async Task<HardwareResult> CollectAsync()
    {
        return await Task.Run(() =>
        {
            return new HardwareResult
            {
                Cpu = GetCpuInfo(),
                Ram = GetRamInfo(),
                Disks = GetDiskInfo(),
                Mainboard = GetMainboardInfo(),
                Bios = GetBiosInfo(),
                Virtualization = GetVirtualizationInfo(),
                Gpu = GetGpuInfo(),
                Nics = GetNicInfo()
            };
        });
    }

    private static object GetCpuInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Processor");
            var cpus = new List<CpuInfo>();
            
            foreach (ManagementObject obj in searcher.Get())
            {
                cpus.Add(new CpuInfo
                {
                    Name = obj["Name"]?.ToString()?.Trim(),
                    Manufacturer = obj["Manufacturer"]?.ToString(),
                    Cores = Convert.ToInt32(obj["NumberOfCores"] ?? 0),
                    LogicalProcessors = Convert.ToInt32(obj["NumberOfLogicalProcessors"] ?? 0),
                    MaxClockSpeedMHz = Convert.ToInt32(obj["MaxClockSpeed"] ?? 0),
                    Architecture = GetArchitecture(obj["Architecture"]),
                    SocketDesignation = obj["SocketDesignation"]?.ToString(),
                    L2CacheKB = Convert.ToInt32(obj["L2CacheSize"] ?? 0),
                    L3CacheKB = Convert.ToInt32(obj["L3CacheSize"] ?? 0),
                    ProcessorId = obj["ProcessorId"]?.ToString()
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

    private static RamInfo GetRamInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_PhysicalMemory");
            var modules = new List<RamModule>();
            long totalBytes = 0;

            foreach (ManagementObject obj in searcher.Get())
            {
                var capacity = Convert.ToInt64(obj["Capacity"] ?? 0);
                totalBytes += capacity;
                
                modules.Add(new RamModule
                {
                    Manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                    PartNumber = obj["PartNumber"]?.ToString()?.Trim(),
                    SerialNumber = obj["SerialNumber"]?.ToString()?.Trim(),
                    CapacityGB = Math.Round(capacity / 1024.0 / 1024.0 / 1024.0, 2),
                    SpeedMHz = Convert.ToInt32(obj["Speed"] ?? 0),
                    FormFactor = GetFormFactor(obj["FormFactor"]),
                    MemoryType = GetMemoryType(obj["SMBIOSMemoryType"]),
                    BankLabel = obj["BankLabel"]?.ToString(),
                    DeviceLocator = obj["DeviceLocator"]?.ToString()
                });
            }

            return new RamInfo
            {
                TotalGB = Math.Round(totalBytes / 1024.0 / 1024.0 / 1024.0, 2),
                ModuleCount = modules.Count,
                Modules = modules
            };
        }
        catch
        {
            return new RamInfo();
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

    private static DiskResult GetDiskInfo()
    {
        var result = new DiskResult();

        try
        {
            // Physical disks
            using (var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_DiskDrive"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    var sizeBytes = Convert.ToInt64(obj["Size"] ?? 0);
                    
                    result.Physical.Add(new DiskInfo
                    {
                        Model = obj["Model"]?.ToString()?.Trim(),
                        Manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                        SerialNumber = obj["SerialNumber"]?.ToString()?.Trim(),
                        SizeGB = Math.Round(sizeBytes / 1024.0 / 1024.0 / 1024.0, 2),
                        InterfaceType = obj["InterfaceType"]?.ToString(),
                        MediaType = obj["MediaType"]?.ToString(),
                        Partitions = Convert.ToInt32(obj["Partitions"] ?? 0),
                        DeviceId = obj["DeviceID"]?.ToString()
                    });
                }
            }

            // Add logical disk info (free space)
            using (var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_LogicalDisk WHERE DriveType=3"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    var sizeBytes = Convert.ToInt64(obj["Size"] ?? 0);
                    var freeBytes = Convert.ToInt64(obj["FreeSpace"] ?? 0);
                    
                    result.Volumes.Add(new VolumeInfo
                    {
                        DriveLetter = obj["DeviceID"]?.ToString(),
                        VolumeName = obj["VolumeName"]?.ToString(),
                        FileSystem = obj["FileSystem"]?.ToString(),
                        SizeGB = Math.Round(sizeBytes / 1024.0 / 1024.0 / 1024.0, 2),
                        FreeGB = Math.Round(freeBytes / 1024.0 / 1024.0 / 1024.0, 2),
                        UsedPercent = sizeBytes > 0 
                            ? Math.Round((1 - (freeBytes / (double)sizeBytes)) * 100, 1) 
                            : 0
                    });
                }
            }

            return result;
        }
        catch
        {
            return result;
        }
    }

    private static MainboardInfo GetMainboardInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_BaseBoard");
            foreach (ManagementObject obj in searcher.Get())
            {
                return new MainboardInfo
                {
                    Manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                    Product = obj["Product"]?.ToString()?.Trim(),
                    Version = obj["Version"]?.ToString()?.Trim(),
                    SerialNumber = obj["SerialNumber"]?.ToString()?.Trim()
                };
            }
            return new MainboardInfo { Error = "No mainboard found" };
        }
        catch (Exception ex)
        {
            return new MainboardInfo { Error = ex.Message };
        }
    }

    private static BiosInfo GetBiosInfo()
    {
        try
        {
            var result = new BiosInfo();
            
            // Basic BIOS info
            using (var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_BIOS"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    result.Manufacturer = obj["Manufacturer"]?.ToString()?.Trim();
                    result.Name = obj["Name"]?.ToString()?.Trim();
                    result.Version = obj["Version"]?.ToString()?.Trim();
                    result.SmbiosVersion = obj["SMBIOSBIOSVersion"]?.ToString()?.Trim();
                    result.ReleaseDate = ParseWmiDate(obj["ReleaseDate"]?.ToString());
                    result.SerialNumber = obj["SerialNumber"]?.ToString()?.Trim();
                    break;
                }
            }
            
            // UUID from Win32_ComputerSystemProduct
            using (var searcher = new ManagementObjectSearcher("SELECT UUID FROM Win32_ComputerSystemProduct"))
            {
                foreach (ManagementObject obj in searcher.Get())
                {
                    result.Uuid = obj["UUID"]?.ToString()?.Trim();
                    break;
                }
            }
            
            // UEFI detection via registry
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\SecureBoot\State");
                if (key != null)
                {
                    result.IsUefi = true;
                    var secureBootEnabled = key.GetValue("UEFISecureBootEnabled");
                    result.SecureBootState = secureBootEnabled != null && Convert.ToInt32(secureBootEnabled) == 1 
                        ? "Enabled" 
                        : "Disabled";
                }
                else
                {
                    // Check for UEFI via firmware type
                    using var firmwareKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
                    if (firmwareKey != null)
                    {
                        var firmwareType = firmwareKey.GetValue("firmware_type")?.ToString();
                        result.IsUefi = firmwareType?.Equals("UEFI", StringComparison.OrdinalIgnoreCase) == true;
                    }
                }
            }
            catch
            {
                // Can't determine UEFI status
            }
            
            return result;
        }
        catch (Exception ex)
        {
            return new BiosInfo { Error = ex.Message };
        }
    }

    private static VirtualizationInfo GetVirtualizationInfo()
    {
        try
        {
            var result = new VirtualizationInfo();
            
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_ComputerSystem");
            foreach (ManagementObject obj in searcher.Get())
            {
                result.Model = obj["Model"]?.ToString()?.Trim();
                result.Manufacturer = obj["Manufacturer"]?.ToString()?.Trim();
                
                // Detect hypervisor from model/manufacturer
                var model = result.Model?.ToLowerInvariant() ?? "";
                var manufacturer = result.Manufacturer?.ToLowerInvariant() ?? "";
                
                if (model.Contains("virtual") || manufacturer.Contains("vmware"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "VMware";
                }
                else if (model.Contains("virtual machine") || manufacturer.Contains("microsoft corporation") && model.Contains("virtual"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "Hyper-V";
                }
                else if (model.Contains("virtualbox") || manufacturer.Contains("innotek"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "VirtualBox";
                }
                else if (model.Contains("kvm") || model.Contains("qemu"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "KVM/QEMU";
                }
                else if (model.Contains("xen"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "Xen";
                }
                else if (manufacturer.Contains("amazon") || model.Contains("hvm"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "AWS";
                }
                else if (manufacturer.Contains("google"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "GCP";
                }
                else if (model.Contains("azure") || manufacturer.Contains("microsoft") && !model.Contains("surface"))
                {
                    result.IsVirtual = true;
                    result.Hypervisor = "Azure";
                }
                else
                {
                    result.IsVirtual = false;
                    result.Hypervisor = "Physical";
                }
                
                break;
            }
            
            return result;
        }
        catch (Exception ex)
        {
            return new VirtualizationInfo { Error = ex.Message };
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

    private static List<GpuInfo> GetGpuInfo()
    {
        var gpus = new List<GpuInfo>();

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_VideoController");

            foreach (ManagementObject obj in searcher.Get())
            {
                var ramBytes = Convert.ToInt64(obj["AdapterRAM"] ?? 0);
                
                gpus.Add(new GpuInfo
                {
                    Name = obj["Name"]?.ToString()?.Trim(),
                    Manufacturer = obj["AdapterCompatibility"]?.ToString()?.Trim(),
                    DriverVersion = obj["DriverVersion"]?.ToString(),
                    DriverDate = ParseWmiDate(obj["DriverDate"]?.ToString()),
                    VideoMemoryGB = ramBytes > 0 ? Math.Round(ramBytes / 1024.0 / 1024.0 / 1024.0, 2) : null,
                    CurrentResolution = $"{obj["CurrentHorizontalResolution"]}x{obj["CurrentVerticalResolution"]}",
                    RefreshRate = obj["CurrentRefreshRate"]?.ToString()
                });
            }

            return gpus;
        }
        catch
        {
            return gpus;
        }
    }

    private static NicResult GetNicInfo()
    {
        var result = new NicResult();

        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT * FROM Win32_NetworkAdapter WHERE NetConnectionStatus IS NOT NULL");

            foreach (ManagementObject obj in searcher.Get())
            {
                var speedBps = Convert.ToInt64(obj["Speed"] ?? 0);
                
                result.Adapters.Add(new NicInfo
                {
                    Name = obj["Name"]?.ToString()?.Trim(),
                    Manufacturer = obj["Manufacturer"]?.ToString()?.Trim(),
                    MacAddress = obj["MACAddress"]?.ToString(),
                    SpeedMbps = speedBps > 0 ? speedBps / 1000000 : null,
                    ConnectionStatus = GetConnectionStatus(obj["NetConnectionStatus"]),
                    AdapterType = obj["AdapterType"]?.ToString(),
                    DeviceId = obj["DeviceID"]?.ToString()
                });
            }

            // Also get IP configuration
            using var configSearcher = new ManagementObjectSearcher(
                "SELECT * FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled=True");
            
            foreach (ManagementObject obj in configSearcher.Get())
            {
                var index = obj["Index"]?.ToString() ?? "";
                var ipAddresses = obj["IPAddress"] as string[];
                var gateways = obj["DefaultIPGateway"] as string[];
                var dnsServers = obj["DNSServerSearchOrder"] as string[];
                var dhcpEnabled = Convert.ToBoolean(obj["DHCPEnabled"]);
                
                result.Configurations[index] = new NicConfig
                {
                    IpAddresses = ipAddresses,
                    Gateways = gateways,
                    DnsServers = dnsServers,
                    DhcpEnabled = dhcpEnabled
                };
            }

            return result;
        }
        catch
        {
            return result;
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
