using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Management;
using Microsoft.Extensions.Logging;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects running process information for live monitoring.
/// </summary>
public class ProcessCollector
{
    private readonly ILogger _logger;
    private Dictionary<int, (DateTime StartTime, TimeSpan LastCpu)> _processCache = new();

    public ProcessCollector(ILogger logger)
    {
        _logger = logger;
    }

    public class ProcessInfo
    {
        public string Name { get; set; } = "";
        public int Pid { get; set; }
        public double CpuPercent { get; set; }
        public double MemoryMb { get; set; }
        public string? UserName { get; set; }
        public int ThreadCount { get; set; }
        public DateTime? StartTime { get; set; }
    }

    /// <summary>
    /// Gets top processes sorted by CPU usage.
    /// </summary>
    public List<ProcessInfo> GetTopProcesses(int count = 20)
    {
        var result = new List<ProcessInfo>();
        var newCache = new Dictionary<int, (DateTime, TimeSpan)>();

        try
        {
            var processes = Process.GetProcesses();
            var processInfos = new List<(Process Process, double Cpu, double Memory)>();

            foreach (var proc in processes)
            {
                try
                {
                    var pid = proc.Id;
                    var now = DateTime.UtcNow;
                    var currentCpu = proc.TotalProcessorTime;

                    double cpuPercent = 0;
                    if (_processCache.TryGetValue(pid, out var cached))
                    {
                        var elapsed = (now - cached.StartTime).TotalMilliseconds;
                        if (elapsed > 0)
                        {
                            var cpuUsed = (currentCpu - cached.LastCpu).TotalMilliseconds;
                            cpuPercent = (cpuUsed / elapsed) * 100 / Environment.ProcessorCount;
                        }
                    }

                    newCache[pid] = (now, currentCpu);

                    var memoryMb = proc.WorkingSet64 / (1024.0 * 1024.0);
                    processInfos.Add((proc, cpuPercent, memoryMb));
                }
                catch
                {
                    // Skip processes we can't access
                }
            }

            // Sort by CPU, take top N
            var topProcesses = processInfos
                .OrderByDescending(p => p.Cpu)
                .ThenByDescending(p => p.Memory)
                .Take(count)
                .ToList();

            foreach (var (proc, cpu, memory) in topProcesses)
            {
                try
                {
                    var info = new ProcessInfo
                    {
                        Name = proc.ProcessName,
                        Pid = proc.Id,
                        CpuPercent = Math.Round(cpu, 2),
                        MemoryMb = Math.Round(memory, 1),
                        ThreadCount = proc.Threads.Count
                    };

                    try
                    {
                        info.StartTime = proc.StartTime;
                    }
                    catch { }

                    // Get username via WMI (expensive, do only for top processes)
                    try
                    {
                        info.UserName = GetProcessOwner(proc.Id);
                    }
                    catch { }

                    result.Add(info);
                }
                catch
                {
                    // Skip
                }
            }

            // Update cache
            _processCache = newCache;

            // Cleanup disposed processes
            foreach (var proc in processes)
            {
                try { proc.Dispose(); } catch { }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error collecting process information");
        }

        return result;
    }

    private string? GetProcessOwner(int processId)
    {
        try
        {
            var query = $"SELECT * FROM Win32_Process WHERE ProcessId = {processId}";
            using var searcher = new ManagementObjectSearcher(query);
            foreach (ManagementObject obj in searcher.Get())
            {
                var outParams = new object[2];
                obj.InvokeMethod("GetOwner", outParams);
                var user = outParams[0]?.ToString();
                var domain = outParams[1]?.ToString();
                if (!string.IsNullOrEmpty(user))
                {
                    return string.IsNullOrEmpty(domain) ? user : $"{domain}\\{user}";
                }
            }
        }
        catch
        {
            // WMI access failed
        }
        return null;
    }

    /// <summary>
    /// Gets basic system metrics.
    /// </summary>
    public (double CpuPercent, double MemoryPercent, double DiskPercent) GetSystemMetrics()
    {
        double cpu = 0, memory = 0, disk = 0;

        try
        {
            // Memory via WMI
            var query = "SELECT * FROM Win32_OperatingSystem";
            using var searcher = new ManagementObjectSearcher(query);
            foreach (ManagementObject obj in searcher.Get())
            {
                var total = Convert.ToDouble(obj["TotalVisibleMemorySize"]);
                var free = Convert.ToDouble(obj["FreePhysicalMemory"]);
                memory = ((total - free) / total) * 100;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not get memory metrics");
        }

        try
        {
            // Disk (C:)
            var drive = new System.IO.DriveInfo("C");
            if (drive.IsReady)
            {
                disk = ((drive.TotalSize - drive.AvailableFreeSpace) / (double)drive.TotalSize) * 100;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not get disk metrics");
        }

        // CPU - calculate from total process CPU time (rough estimate)
        try
        {
            var processes = Process.GetProcesses();
            double totalCpu = 0;
            foreach (var proc in processes)
            {
                try
                {
                    // This is a rough approximation
                    if (_processCache.TryGetValue(proc.Id, out var cached))
                    {
                        var elapsed = (DateTime.UtcNow - cached.StartTime).TotalMilliseconds;
                        if (elapsed > 0)
                        {
                            var cpuUsed = (proc.TotalProcessorTime - cached.LastCpu).TotalMilliseconds;
                            totalCpu += (cpuUsed / elapsed) * 100;
                        }
                    }
                }
                catch { }
                finally { proc.Dispose(); }
            }
            cpu = totalCpu / Environment.ProcessorCount;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not get CPU metrics");
        }

        return (Math.Round(cpu, 1), Math.Round(memory, 1), Math.Round(disk, 1));
    }
}
