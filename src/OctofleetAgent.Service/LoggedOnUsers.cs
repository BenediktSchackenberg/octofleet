using System.Runtime.InteropServices;

namespace OctofleetAgent.Service;

/// <summary>
/// The users logged on to this machine (console and Remote Desktop sessions, also disconnected
/// ones), for the console's reboot dialog. Read through the Terminal Services API at most every
/// 30 seconds; the live data push asks every few seconds. Null when Windows does not answer.
/// </summary>
public static class LoggedOnUsers
{
    public sealed record Entry(string user, string? session, string? since);

    private static readonly TimeSpan MaxAge = TimeSpan.FromSeconds(30);
    private static readonly object Gate = new();
    private static DateTime _readAt = DateTime.MinValue;
    private static List<Entry>? _cached;

    public static List<Entry>? Get()
    {
        lock (Gate)
        {
            if (DateTime.UtcNow - _readAt < MaxAge)
                return _cached;
            try
            {
                _cached = ReadNow();
            }
            catch
            {
                _cached = null;
            }
            _readAt = DateTime.UtcNow;
            return _cached;
        }
    }

    private static List<Entry> ReadNow()
    {
        var result = new List<Entry>();
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out var sessions, out var count))
            throw new InvalidOperationException($"WTSEnumerateSessions failed ({Marshal.GetLastWin32Error()})");
        try
        {
            var size = Marshal.SizeOf<WTS_SESSION_INFO>();
            for (var i = 0; i < count; i++)
            {
                var info = Marshal.PtrToStructure<WTS_SESSION_INFO>(sessions + i * size);
                // Session 0 holds the services; only Active and Disconnected sessions have a user
                if (info.SessionId == 0 || (info.State != WtsActive && info.State != WtsDisconnected))
                    continue;
                var user = Query(info.SessionId, WtsUserName);
                if (string.IsNullOrWhiteSpace(user))
                    continue;
                var domain = Query(info.SessionId, WtsDomainName);
                var station = Marshal.PtrToStringUni(info.pWinStationName);
                var session = info.State == WtsDisconnected
                    ? $"{(string.IsNullOrEmpty(station) ? "session " + info.SessionId : station)} (disconnected)"
                    : (string.IsNullOrEmpty(station) ? "session " + info.SessionId : station);
                result.Add(new Entry(string.IsNullOrEmpty(domain) ? user : $"{domain}\\{user}", session, null));
            }
        }
        finally
        {
            WTSFreeMemory(sessions);
        }
        return result;
    }

    private static string? Query(int sessionId, int infoClass)
    {
        if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, infoClass, out var buffer, out _))
            return null;
        try
        {
            return Marshal.PtrToStringUni(buffer);
        }
        finally
        {
            WTSFreeMemory(buffer);
        }
    }

    private const int WtsActive = 0;
    private const int WtsDisconnected = 4;
    private const int WtsUserName = 5;
    private const int WtsDomainName = 7;

    [StructLayout(LayoutKind.Sequential)]
    private struct WTS_SESSION_INFO
    {
        public int SessionId;
        public IntPtr pWinStationName;
        public int State;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr sessions, out int count);

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "WTSQuerySessionInformationW")]
    private static extern bool WTSQuerySessionInformation(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr memory);
}
