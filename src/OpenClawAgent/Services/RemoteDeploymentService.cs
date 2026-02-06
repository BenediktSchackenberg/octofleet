using OpenClawAgent.Models;
using System.Management.Automation;
using System.Management.Automation.Runspaces;

namespace OpenClawAgent.Services;

/// <summary>
/// Service for remote deployment via WinRM/PowerShell Remoting
/// </summary>
public class RemoteDeploymentService
{
    private readonly string _agentInstallerPath;

    public RemoteDeploymentService(string agentInstallerPath)
    {
        _agentInstallerPath = agentInstallerPath;
    }

    public event EventHandler<DeploymentProgressEventArgs>? ProgressChanged;

    /// <summary>
    /// Test connection to remote host
    /// </summary>
    public async Task<bool> TestConnectionAsync(RemoteHost host, string? password = null)
    {
        return await Task.Run(() =>
        {
            try
            {
                using var runspace = CreateRemoteRunspace(host, password);
                runspace.Open();
                
                using var ps = PowerShell.Create();
                ps.Runspace = runspace;
                ps.AddCommand("Test-Connection")
                  .AddParameter("ComputerName", "localhost")
                  .AddParameter("Count", 1)
                  .AddParameter("Quiet");

                var results = ps.Invoke();
                return results.Count > 0 && (bool)results[0].BaseObject;
            }
            catch
            {
                return false;
            }
        });
    }

    /// <summary>
    /// Deploy agent to remote host
    /// </summary>
    public async Task DeployAsync(RemoteHost host, string password, GatewayConfig gateway)
    {
        await Task.Run(() =>
        {
            OnProgress(host, DeploymentStage.Connecting, "Connecting to remote host...");

            using var runspace = CreateRemoteRunspace(host, password);
            runspace.Open();

            using var ps = PowerShell.Create();
            ps.Runspace = runspace;

            // Step 1: Check if OpenClaw is already installed
            OnProgress(host, DeploymentStage.Checking, "Checking for existing installation...");
            ps.AddScript(@"
                $installed = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | 
                    Where-Object { $_.DisplayName -like '*OpenClaw*' }
                if ($installed) { $true } else { $false }
            ");
            
            var checkResult = ps.Invoke();
            var isInstalled = checkResult.Count > 0 && (bool)checkResult[0].BaseObject;
            ps.Commands.Clear();

            if (!isInstalled)
            {
                OnProgress(host, DeploymentStage.Installing, "Installing OpenClaw agent...");
                
                // Copy installer to remote host
                ps.AddScript($@"
                    $installerPath = 'C:\Temp\OpenClawAgent-Setup.msi'
                    # In production: Copy-Item from network share or download
                    # For now, assume installer is accessible
                    
                    if (Test-Path $installerPath) {{
                        Start-Process msiexec.exe -ArgumentList '/i', $installerPath, '/quiet', '/norestart' -Wait
                        $true
                    }} else {{
                        $false
                    }}
                ");

                var installResult = ps.Invoke();
                ps.Commands.Clear();
            }

            // Step 2: Configure agent
            OnProgress(host, DeploymentStage.Configuring, "Configuring agent...");
            ps.AddScript($@"
                $configPath = Join-Path $env:APPDATA 'OpenClaw\Agent\config.json'
                $configDir = Split-Path $configPath -Parent
                
                if (-not (Test-Path $configDir)) {{
                    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
                }}

                $config = @{{
                    gateway = @{{
                        url = '{gateway.Url}'
                        autoConnect = $true
                    }}
                }}

                $config | ConvertTo-Json | Set-Content $configPath
                $true
            ");

            ps.Invoke();
            ps.Commands.Clear();

            // Step 3: Start agent service
            OnProgress(host, DeploymentStage.Starting, "Starting agent service...");
            ps.AddScript(@"
                $serviceName = 'OpenClawAgent'
                $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
                
                if ($service) {
                    if ($service.Status -ne 'Running') {
                        Start-Service -Name $serviceName
                    }
                    $true
                } else {
                    # Run as application if no service
                    $agentPath = Join-Path $env:ProgramFiles 'OpenClaw\Agent\OpenClawAgent.exe'
                    if (Test-Path $agentPath) {
                        Start-Process $agentPath -WindowStyle Hidden
                        $true
                    } else {
                        $false
                    }
                }
            ");

            var startResult = ps.Invoke();
            ps.Commands.Clear();

            OnProgress(host, DeploymentStage.Complete, "Deployment complete!");
        });
    }

    /// <summary>
    /// Get agent status on remote host
    /// </summary>
    public async Task<RemoteAgentStatus> GetRemoteStatusAsync(RemoteHost host, string password)
    {
        return await Task.Run(() =>
        {
            try
            {
                using var runspace = CreateRemoteRunspace(host, password);
                runspace.Open();

                using var ps = PowerShell.Create();
                ps.Runspace = runspace;
                ps.AddScript(@"
                    @{
                        Hostname = $env:COMPUTERNAME
                        AgentRunning = (Get-Process -Name 'OpenClawAgent' -ErrorAction SilentlyContinue) -ne $null
                        ServiceStatus = (Get-Service -Name 'OpenClawAgent' -ErrorAction SilentlyContinue).Status
                        OSVersion = [System.Environment]::OSVersion.VersionString
                    }
                ");

                var results = ps.Invoke();
                if (results.Count > 0)
                {
                    var hashtable = results[0].BaseObject as System.Collections.Hashtable;
                    return new RemoteAgentStatus
                    {
                        Hostname = hashtable?["Hostname"]?.ToString() ?? host.Hostname,
                        IsRunning = (bool)(hashtable?["AgentRunning"] ?? false),
                        ServiceStatus = hashtable?["ServiceStatus"]?.ToString(),
                        OSVersion = hashtable?["OSVersion"]?.ToString()
                    };
                }
            }
            catch (Exception ex)
            {
                return new RemoteAgentStatus
                {
                    Hostname = host.Hostname,
                    Error = ex.Message
                };
            }

            return new RemoteAgentStatus { Hostname = host.Hostname };
        });
    }

    private Runspace CreateRemoteRunspace(RemoteHost host, string? password)
    {
        var connectionInfo = new WSManConnectionInfo(
            new Uri($"http://{host.Hostname}:5985/wsman"));

        if (!string.IsNullOrEmpty(host.Username) && !string.IsNullOrEmpty(password))
        {
            var securePassword = new System.Security.SecureString();
            foreach (var c in password)
            {
                securePassword.AppendChar(c);
            }

            connectionInfo.Credential = new PSCredential(host.Username, securePassword);
        }

        connectionInfo.AuthenticationMechanism = AuthenticationMechanism.Negotiate;

        return RunspaceFactory.CreateRunspace(connectionInfo);
    }

    private void OnProgress(RemoteHost host, DeploymentStage stage, string message)
    {
        ProgressChanged?.Invoke(this, new DeploymentProgressEventArgs(host, stage, message));
    }
}

public class DeploymentProgressEventArgs : EventArgs
{
    public RemoteHost Host { get; }
    public DeploymentStage Stage { get; }
    public string Message { get; }

    public DeploymentProgressEventArgs(RemoteHost host, DeploymentStage stage, string message)
    {
        Host = host;
        Stage = stage;
        Message = message;
    }
}

public enum DeploymentStage
{
    Connecting,
    Checking,
    Installing,
    Configuring,
    Starting,
    Complete,
    Failed
}

public class RemoteAgentStatus
{
    public string Hostname { get; set; } = "";
    public bool IsRunning { get; set; }
    public string? ServiceStatus { get; set; }
    public string? OSVersion { get; set; }
    public string? AgentVersion { get; set; }
    public string? Error { get; set; }
}
