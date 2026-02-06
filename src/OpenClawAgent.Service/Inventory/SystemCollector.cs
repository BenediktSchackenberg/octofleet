using System.Management;
using Microsoft.Win32;

namespace OpenClawAgent.Service.Inventory;

#region DTOs
public class OsInfo
{
    public string? Name { get; set; }
    public string? Version { get; set; }
    public string? BuildNumber { get; set; }
    public string? Architecture { get; set; }
    public string? InstallDate { get; set; }
    public string? LastBootTime { get; set; }
    public string? SystemDrive { get; set; }
    public string? WindowsDirectory { get; set; }
    public string? Locale { get; set; }
    public string? SerialNumber { get; set; }
    public string? RegisteredUser { get; set; }
    public string? Organization { get; set; }
    public string? Error { get; set; }
}

public class LocalUserInfo
{
    public string? Name { get; set; }
    public string? FullName { get; set; }
    public string? Description { get; set; }
    public bool Disabled { get; set; }
    public bool PasswordRequired { get; set; }
    public bool PasswordExpires { get; set; }
    public string? Sid { get; set; }
    public string? Status { get; set; }
}

public class ServiceInfo
{
    public string? Name { get; set; }
    public string? DisplayName { get; set; }
    public string? State { get; set; }
    public string? StartMode { get; set; }
    public string? PathName { get; set; }
    public string? StartName { get; set; }
    public string? Description { get; set; }
}

public class ServiceResult
{
    public int Total { get; set; }
    public int Running { get; set; }
    public List<ServiceInfo> Services { get; set; } = new();
}

public class StartupItem
{
    public string? Name { get; set; }
    public string? Command { get; set; }
    public string? Source { get; set; }
    public string? User { get; set; }
    public string? Type { get; set; }
}

public class ShareInfo
{
    public string? Name { get; set; }
    public string? Path { get; set; }
    public string? Description { get; set; }
    public string? Type { get; set; }
}

public class PrinterInfo
{
    public string? Name { get; set; }
    public string? DriverName { get; set; }
    public string? PortName { get; set; }
    public bool IsDefault { get; set; }
    public bool IsNetwork { get; set; }
    public string? Status { get; set; }
}

public class EnvironmentVars
{
    public Dictionary<string, string> System { get; set; } = new();
    public Dictionary<string, string> User { get; set; } = new();
}

public class SystemResult
{
    public OsInfo Os { get; set; } = new();
    public List<LocalUserInfo> LocalUsers { get; set; } = new();
    public ServiceResult Services { get; set; } = new();
    public List<StartupItem> StartupItems { get; set; } = new();
    public object? ScheduledTasks { get; set; }
    public List<ShareInfo> Shares { get; set; } = new();
    public List<PrinterInfo> Printers { get; set; } = new();
    public EnvironmentVars EnvironmentVariables { get; set; } = new();
}
#endregion

/// <summary>
/// Collects system information: Users, Services, Startup items, etc.
/// </summary>
public static class SystemCollector
{
    public static async Task<SystemResult> CollectAsync()
    {
        return await Task.Run(() =>
        {
            return new SystemResult
            {
                Os = GetOsInfo(),
                LocalUsers = GetLocalUsers(),
                Services = GetServices(),
                StartupItems = GetStartupItems(),
                ScheduledTasks = GetScheduledTasks(),
                Shares = GetShares(),
                Printers = GetPrinters(),
                EnvironmentVariables = GetEnvironmentVariables()
            };
        });
    }

    private static OsInfo GetOsInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_OperatingSystem");
            foreach (ManagementObject obj in searcher.Get())
            {
                return new OsInfo
                {
                    Name = obj["Caption"]?.ToString()?.Trim(),
                    Version = obj["Version"]?.ToString(),
                    BuildNumber = obj["BuildNumber"]?.ToString(),
                    Architecture = obj["OSArchitecture"]?.ToString(),
                    InstallDate = ParseWmiDate(obj["InstallDate"]?.ToString()),
                    LastBootTime = ParseWmiDate(obj["LastBootUpTime"]?.ToString()),
                    SystemDrive = obj["SystemDrive"]?.ToString(),
                    WindowsDirectory = obj["WindowsDirectory"]?.ToString(),
                    Locale = obj["Locale"]?.ToString(),
                    SerialNumber = obj["SerialNumber"]?.ToString(),
                    RegisteredUser = obj["RegisteredUser"]?.ToString(),
                    Organization = obj["Organization"]?.ToString()
                };
            }
            return new OsInfo { Error = "No OS info found" };
        }
        catch (Exception ex)
        {
            return new OsInfo { Error = ex.Message };
        }
    }

    private static List<LocalUserInfo> GetLocalUsers()
    {
        var users = new List<LocalUserInfo>();

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_UserAccount WHERE LocalAccount=True");

            foreach (ManagementObject obj in searcher.Get())
            {
                users.Add(new LocalUserInfo
                {
                    Name = obj["Name"]?.ToString(),
                    FullName = obj["FullName"]?.ToString(),
                    Description = obj["Description"]?.ToString(),
                    Disabled = Convert.ToBoolean(obj["Disabled"]),
                    PasswordRequired = Convert.ToBoolean(obj["PasswordRequired"]),
                    PasswordExpires = Convert.ToBoolean(obj["PasswordExpires"]),
                    Sid = obj["SID"]?.ToString(),
                    Status = obj["Status"]?.ToString()
                });
            }

            return users;
        }
        catch
        {
            return users;
        }
    }

    private static ServiceResult GetServices()
    {
        var result = new ServiceResult();

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Service");

            foreach (ManagementObject obj in searcher.Get())
            {
                result.Services.Add(new ServiceInfo
                {
                    Name = obj["Name"]?.ToString(),
                    DisplayName = obj["DisplayName"]?.ToString(),
                    State = obj["State"]?.ToString(),
                    StartMode = obj["StartMode"]?.ToString(),
                    PathName = obj["PathName"]?.ToString(),
                    StartName = obj["StartName"]?.ToString(),
                    Description = obj["Description"]?.ToString()
                });
            }

            result.Total = result.Services.Count;
            result.Running = result.Services.Count(s => s.State == "Running");
            result.Services = result.Services.OrderBy(s => s.DisplayName).ToList();

            return result;
        }
        catch
        {
            return result;
        }
    }

    private static List<StartupItem> GetStartupItems()
    {
        var items = new List<StartupItem>();

        // Registry Run keys
        var runKeys = new[]
        {
            (RegistryHive.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKLM"),
            (RegistryHive.LocalMachine, @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", "HKLM (WOW64)"),
            (RegistryHive.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKCU")
        };

        foreach (var (hive, path, source) in runKeys)
        {
            try
            {
                using var baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default);
                using var key = baseKey.OpenSubKey(path);
                
                if (key == null) continue;

                foreach (var valueName in key.GetValueNames())
                {
                    var value = key.GetValue(valueName)?.ToString();
                    items.Add(new StartupItem
                    {
                        Name = valueName,
                        Command = value,
                        Source = source,
                        Type = "Registry"
                    });
                }
            }
            catch
            {
                // Skip keys we can't access
            }
        }

        // WMI Startup items
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_StartupCommand");
            foreach (ManagementObject obj in searcher.Get())
            {
                items.Add(new StartupItem
                {
                    Name = obj["Name"]?.ToString(),
                    Command = obj["Command"]?.ToString(),
                    Source = obj["Location"]?.ToString(),
                    User = obj["User"]?.ToString(),
                    Type = "StartupCommand"
                });
            }
        }
        catch
        {
            // Ignore WMI errors
        }

        return items;
    }

    private static object GetScheduledTasks()
    {
        // For full task scheduler info, we'd need to use Task Scheduler COM
        // For now, just get basic info via WMI
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "root\\Microsoft\\Windows\\TaskScheduler",
                "SELECT * FROM MSFT_ScheduledTask WHERE State = 3"); // 3 = Ready
            
            var tasks = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                tasks.Add(new
                {
                    name = obj["TaskName"]?.ToString(),
                    path = obj["TaskPath"]?.ToString(),
                    state = obj["State"]?.ToString()
                });
            }

            return tasks;
        }
        catch
        {
            return new { note = "Detailed task info requires elevated permissions" };
        }
    }

    private static List<ShareInfo> GetShares()
    {
        var shares = new List<ShareInfo>();

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Share");

            foreach (ManagementObject obj in searcher.Get())
            {
                shares.Add(new ShareInfo
                {
                    Name = obj["Name"]?.ToString(),
                    Path = obj["Path"]?.ToString(),
                    Description = obj["Description"]?.ToString(),
                    Type = GetShareType(obj["Type"])
                });
            }

            return shares;
        }
        catch
        {
            return shares;
        }
    }

    private static string GetShareType(object? type)
    {
        if (type == null) return "Unknown";
        return Convert.ToUInt32(type) switch
        {
            0 => "Disk Drive",
            1 => "Print Queue",
            2 => "Device",
            3 => "IPC",
            2147483648 => "Admin Disk Drive",
            2147483649 => "Admin Print Queue",
            2147483650 => "Admin Device",
            2147483651 => "Admin IPC",
            _ => "Unknown"
        };
    }

    private static List<PrinterInfo> GetPrinters()
    {
        var printers = new List<PrinterInfo>();

        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Printer");

            foreach (ManagementObject obj in searcher.Get())
            {
                printers.Add(new PrinterInfo
                {
                    Name = obj["Name"]?.ToString(),
                    DriverName = obj["DriverName"]?.ToString(),
                    PortName = obj["PortName"]?.ToString(),
                    IsDefault = Convert.ToBoolean(obj["Default"]),
                    IsNetwork = Convert.ToBoolean(obj["Network"]),
                    Status = obj["Status"]?.ToString()
                });
            }

            return printers;
        }
        catch
        {
            return printers;
        }
    }

    private static EnvironmentVars GetEnvironmentVariables()
    {
        var result = new EnvironmentVars();

        try
        {
            // System environment variables
            using (var key = Registry.LocalMachine.OpenSubKey(
                @"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"))
            {
                if (key != null)
                {
                    foreach (var name in key.GetValueNames())
                    {
                        var value = key.GetValue(name)?.ToString();
                        if (value != null)
                        {
                            result.System[name] = value;
                        }
                    }
                }
            }

            // User environment variables (current user context)
            using (var key = Registry.CurrentUser.OpenSubKey(@"Environment"))
            {
                if (key != null)
                {
                    foreach (var name in key.GetValueNames())
                    {
                        var value = key.GetValue(name)?.ToString();
                        if (value != null)
                        {
                            result.User[name] = value;
                        }
                    }
                }
            }

            return result;
        }
        catch
        {
            return result;
        }
    }

    private static string? ParseWmiDate(string? wmiDate)
    {
        if (string.IsNullOrEmpty(wmiDate) || wmiDate.Length < 14) return null;
        try
        {
            // Format: 20240115123456.000000+060
            var year = wmiDate.Substring(0, 4);
            var month = wmiDate.Substring(4, 2);
            var day = wmiDate.Substring(6, 2);
            var hour = wmiDate.Substring(8, 2);
            var min = wmiDate.Substring(10, 2);
            var sec = wmiDate.Substring(12, 2);
            return $"{year}-{month}-{day}T{hour}:{min}:{sec}";
        }
        catch
        {
            return wmiDate;
        }
    }
}
