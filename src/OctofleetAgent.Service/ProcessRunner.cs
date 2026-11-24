using System.Diagnostics;

namespace OctofleetAgent.Service;

/// <summary>
/// Runs a short-lived helper process (PowerShell, net, netsh) for the collectors with a time limit.
/// Reading stdout to the end before waiting made the old timeouts ineffective: ReadToEnd blocks
/// until the process exits, so a hanging cmdlet blocked the collector - and the whole inventory -
/// for good. Reading stdout and stderr one after the other could also deadlock when stderr filled
/// its pipe. Both streams are read concurrently here, and the process tree is killed after the limit.
/// </summary>
public static class ProcessRunner
{
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(60);

    public sealed record Result(int ExitCode, string Stdout, string Stderr);

    /// <summary>
    /// Runs the process and returns its output, or null if it could not be started.
    /// Set <c>RedirectStandardInput</c> on <paramref name="psi"/> to start it with a closed stdin.
    /// Throws <see cref="TimeoutException"/> after the time limit (the process tree is killed).
    /// </summary>
    public static Result? Run(ProcessStartInfo psi, TimeSpan? timeout = null)
    {
        var limit = timeout ?? DefaultTimeout;
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.CreateNoWindow = true;

        using var process = Process.Start(psi);
        if (process == null) return null;
        // With RedirectStandardInput the caller asks for a closed stdin: a tool that waits for input
        // (e.g. CiTool) gets end-of-file instead of hanging until the time limit.
        if (psi.RedirectStandardInput) process.StandardInput.Close();

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit((int)limit.TotalMilliseconds))
        {
            try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
            throw new TimeoutException($"{psi.FileName} did not finish within {limit.TotalSeconds:0} s");
        }
        process.WaitForExit(); // let the output readers finish
        return new Result(process.ExitCode, stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
    }
}
