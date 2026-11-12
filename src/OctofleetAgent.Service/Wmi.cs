using System.Management;

namespace OctofleetAgent.Service;

/// <summary>
/// WMI queries with a time limit. ManagementObjectSearcher waits forever by default: a WMI provider
/// that hangs (corrupt repository, stuck provider host) blocked the collector, the inventory push and
/// - for the inventory job - the job loop. With these options a stuck connect or query fails with a
/// ManagementException (WBEM_E_TIMED_OUT), which the collectors' try/catch blocks already handle.
/// </summary>
public static class Wmi
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    public static ManagementObjectSearcher Searcher(string query) =>
        WithTimeout(new ManagementObjectSearcher(query));

    public static ManagementObjectSearcher Searcher(string scope, string query) =>
        WithTimeout(new ManagementObjectSearcher(Scope(scope), new ObjectQuery(query)));

    public static ManagementObjectSearcher Searcher(ManagementScope scope, ObjectQuery query) =>
        WithTimeout(new ManagementObjectSearcher(scope, query));

    /// <summary>A WMI namespace whose connect gives up after <see cref="Timeout"/>.</summary>
    public static ManagementScope Scope(string path) =>
        new(path, new ConnectionOptions { Timeout = Timeout });

    private static ManagementObjectSearcher WithTimeout(ManagementObjectSearcher searcher)
    {
        // Semisynchronous enumeration (ReturnImmediately) - the timeout applies to every object read
        searcher.Options.ReturnImmediately = true;
        searcher.Options.Timeout = Timeout;
        return searcher;
    }
}
