using System.Management;
using System.Security.Principal;
using Microsoft.Win32;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects system information: Users, Services, Startup items, etc.
/// </summary>
public static class SystemCollector
{
    public static async Task<object> CollectAsync()
    {
        return await Task.Run(() =>
        {
            return new
            {
                os = GetOsInfo(),
                localUsers = GetLocalUsers(),
                services = GetServices(),
                startupItems = GetStartupItems(),
                scheduledTasks = GetScheduledTasks(),
                shares = GetShares(),
                printers = GetPrinters(),
                environmentVariables = GetEnvironmentVariables()
            };
        });
    }

    private static object GetOsInfo()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_OperatingSystem");
            foreach (ManagementObject obj in searcher.Get())
            {
                return new
                {
                    name = obj["Caption"]?.ToString()?.Trim(),
                    version = obj["Version"]?.ToString(),
                    buildNumber = obj["BuildNumber"]?.ToString(),
                    architecture = obj["OSArchitecture"]?.ToString(),
                    installDate = ParseWmiDate(obj["InstallDate"]?.ToString()),
                    lastBootTime = ParseWmiDate(obj["LastBootUpTime"]?.ToString()),
                    systemDrive = obj["SystemDrive"]?.ToString(),
                    windowsDirectory = obj["WindowsDirectory"]?.ToString(),
                    locale = obj["Locale"]?.ToString(),
                    serialNumber = obj["SerialNumber"]?.ToString(),
                    registeredUser = obj["RegisteredUser"]?.ToString(),
                    organization = obj["Organization"]?.ToString()
                };
            }
            return new { error = "No OS info found" };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetLocalUsers()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_UserAccount WHERE LocalAccount=True");
            var users = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                users.Add(new
                {
                    name = obj["Name"]?.ToString(),
                    fullName = obj["FullName"]?.ToString(),
                    description = obj["Description"]?.ToString(),
                    disabled = Convert.ToBoolean(obj["Disabled"]),
                    passwordRequired = Convert.ToBoolean(obj["PasswordRequired"]),
                    passwordExpires = Convert.ToBoolean(obj["PasswordExpires"]),
                    sid = obj["SID"]?.ToString(),
                    status = obj["Status"]?.ToString()
                });
            }

            return users;
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetServices()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Service");
            var services = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                services.Add(new
                {
                    name = obj["Name"]?.ToString(),
                    displayName = obj["DisplayName"]?.ToString(),
                    state = obj["State"]?.ToString(),
                    startMode = obj["StartMode"]?.ToString(),
                    pathName = obj["PathName"]?.ToString(),
                    startName = obj["StartName"]?.ToString(), // Account running the service
                    description = obj["Description"]?.ToString()
                });
            }

            return new
            {
                total = services.Count,
                running = services.Count(s => ((dynamic)s).state == "Running"),
                services = services.OrderBy(s => ((dynamic)s).displayName).ToList()
            };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetStartupItems()
    {
        var items = new List<object>();

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
                    items.Add(new
                    {
                        name = valueName,
                        command = value,
                        source = source,
                        type = "Registry"
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
                items.Add(new
                {
                    name = obj["Name"]?.ToString(),
                    command = obj["Command"]?.ToString(),
                    source = obj["Location"]?.ToString(),
                    user = obj["User"]?.ToString(),
                    type = "StartupCommand"
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
        // For now, just get basic info via WMI/schtasks
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
            // Fallback: just return count from schtasks
            return new { note = "Detailed task info requires elevated permissions" };
        }
    }

    private static object GetShares()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Share");
            var shares = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                shares.Add(new
                {
                    name = obj["Name"]?.ToString(),
                    path = obj["Path"]?.ToString(),
                    description = obj["Description"]?.ToString(),
                    type = GetShareType(obj["Type"])
                });
            }

            return shares;
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
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

    private static object GetPrinters()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Printer");
            var printers = new List<object>();

            foreach (ManagementObject obj in searcher.Get())
            {
                printers.Add(new
                {
                    name = obj["Name"]?.ToString(),
                    driverName = obj["DriverName"]?.ToString(),
                    portName = obj["PortName"]?.ToString(),
                    isDefault = Convert.ToBoolean(obj["Default"]),
                    isNetwork = Convert.ToBoolean(obj["Network"]),
                    status = obj["Status"]?.ToString()
                });
            }

            return printers;
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
        }
    }

    private static object GetEnvironmentVariables()
    {
        try
        {
            var systemVars = new Dictionary<string, string>();
            var userVars = new Dictionary<string, string>();

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
                            systemVars[name] = value;
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
                            userVars[name] = value;
                        }
                    }
                }
            }

            return new { system = systemVars, user = userVars };
        }
        catch (Exception ex)
        {
            return new { error = ex.Message };
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
