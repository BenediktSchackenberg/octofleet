# Troubleshooting Guide

## Service Fails to Start on Windows Server (Error 1053)

### Symptoms
- Service is registered but won't start
- Error 1053: "The service did not respond to the start or control request in a timely fashion"
- Running the EXE manually works fine
- Event Log shows: `DOTNET_BUNDLE_EXTRACT_BASE_DIR is not set`

### Cause
On Windows Server editions, the LocalSystem account does not have a proper TEMP directory. .NET single-file apps need a writable location to extract embedded files.

### Solution
Set the extraction directory for the service:

```powershell
# Create extraction directory
New-Item -ItemType Directory -Path "C:\ProgramData\Octofleet\extract" -Force

# Set environment variable for the service
reg add "HKLM\SYSTEM\CurrentControlSet\Services\OctofleetNodeAgent" /v Environment /t REG_MULTI_SZ /d "DOTNET_BUNDLE_EXTRACT_BASE_DIR=C:\ProgramData\Octofleet\extract" /f

# Start the service
sc.exe start OctofleetNodeAgent
```

### Affected Systems
- ✅ Windows Server 2022
- ✅ Windows Server 2019 (likely)
- ✅ Windows Server Core editions
- ❌ Windows 10/11 Desktop (usually not affected)

---

## Service Won't Start After Update

### Symptoms
- Update completed but service stays stopped
- Error 1053 or "Service cannot be started"

### Cause
Old service handle still held by Windows, or service binary path mismatch.

### Solution

**Option 1: Reboot**
```powershell
Restart-Computer -Force
```

**Option 2: Re-register service**
```powershell
# Stop and delete
Stop-Service OctofleetNodeAgent -Force -EA SilentlyContinue
sc.exe delete OctofleetNodeAgent

# Wait for handle release
Start-Sleep -Seconds 5

# Re-create
sc.exe create OctofleetNodeAgent binPath="C:\Program Files\Octofleet\OctofleetAgent.Service.exe" start=auto DisplayName="Octofleet Agent"
Start-Service OctofleetNodeAgent
```

---

## Service Path Mismatch

### Symptoms
- Service registered but points to wrong/old path
- Error: "The system cannot find the file specified"

### Solution
Use the Repair Script:
```powershell
irm https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/scripts/Repair-Service.ps1 | iex
```

Or manually fix:
```powershell
# Check current path
reg query "HKLM\SYSTEM\CurrentControlSet\Services\OctofleetNodeAgent" /v ImagePath

# Fix path
sc.exe config OctofleetNodeAgent binPath="C:\Program Files\Octofleet\OctofleetAgent.Service.exe"
```

---

## Clean Installation

If all else fails, perform a clean install:

```powershell
# 1. Remove old installation
Stop-Service OctofleetNodeAgent -Force -EA SilentlyContinue
sc.exe delete OctofleetNodeAgent
Remove-Item "C:\Program Files\Octofleet" -Recurse -Force -EA SilentlyContinue

# 2. Download latest release
$version = "0.4.57"  # Update to latest
$url = "https://github.com/BenediktSchackenberg/octofleet/releases/download/v$version/OctofleetAgent-v$version.zip"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\agent.zip"

# 3. Extract
New-Item -ItemType Directory -Path "C:\Program Files\Octofleet" -Force
Expand-Archive "$env:TEMP\agent.zip" -DestinationPath "C:\Program Files\Octofleet" -Force

# 4. Create extraction dir (for Windows Server)
New-Item -ItemType Directory -Path "C:\ProgramData\Octofleet\extract" -Force

# 5. Register service with env var
sc.exe create OctofleetNodeAgent binPath="C:\Program Files\Octofleet\OctofleetAgent.Service.exe" start=auto DisplayName="Octofleet Agent"
reg add "HKLM\SYSTEM\CurrentControlSet\Services\OctofleetNodeAgent" /v Environment /t REG_MULTI_SZ /d "DOTNET_BUNDLE_EXTRACT_BASE_DIR=C:\ProgramData\Octofleet\extract" /f

# 6. Start
Start-Service OctofleetNodeAgent
Get-Service OctofleetNodeAgent
```

---

## Inventory Incomplete or "Collect inventory" Times Out (Windows)

### Symptoms
- **Collect inventory** on the node page reports a failed job: `Inventory collection did not finish within 300 s (a WMI query or PowerShell call may hang on this machine)`
- Some sections of the node (e.g. hardware or security) are not updated, and the agent log names them: `Scheduled inventory push #12 completed: Successfully pushed inventory (HTTP 200); left out: security: timed out after 180 s`

### Cause
A WMI provider or a helper process (PowerShell, `net`, `netsh`) does not answer, for example because of a damaged WMI repository or a stuck provider host. The agent limits the time it waits:

| What | Limit |
|---|---|
| WMI connect and query | 30 s |
| Helper process | 60 s |
| One collector (hardware, software, hotfixes, system, security, browser, network) | 3 min |
| `inventory` job | the job's timeout (300 s by default) |

A collector that times out or fails is left out of the push, and the other sections are still pushed. A timed-out collection cannot be cancelled. It ends in the background, and the agent keeps running its other jobs.

### Solution
1. Find the section in the agent log (see [Checking Logs](#checking-logs)) or in the job's output.
2. Check WMI on the machine:

   ```powershell
   Get-CimInstance Win32_ComputerSystem
   winmgmt /verifyrepository
   ```

   If the repository is inconsistent, `winmgmt /salvagerepository` repairs it. Restarting the `Winmgmt` service ends a stuck provider host.
3. Restart the agent with a `restart-agent` job, or with `Restart-Service OctofleetNodeAgent`, and run **Collect inventory** again.

---

## Disks Without SSD/HDD Type or Health Status

Virtual disks (Hyper-V, VMware, ...) report their media type as *unspecified*. The Hardware tab then shows no SSD/HDD type. This is expected, not an error.

The health status, bus type, temperature and wear come from `MSFT_PhysicalDisk` and `MSFT_StorageReliabilityCounter`, matched to the disk by its disk number. If a disk still has no health status, check that the Storage Management provider answers:

```powershell
Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, HealthStatus
```

---

## Windows Update Installation Failed, or the Update Is Offered Again After the Restart

### Symptoms
- An **Install updates** job fails with `0x800F0823`, e.g. `KB5136489: 0x800F0823 – Windows installed a newer servicing stack first; restart the node and install this update again`.
- After the restart, the node's update search lists the same cumulative update again.
- The node's **Update history** shows the update twice: *Failed* and, after a second installation, *Succeeded*. The installed updates show the newest result.

### Cause
`0x800F0823` is `CBS_E_NEW_SERVICING_STACK_REQUIRED`. Some cumulative updates (e.g. on Windows Server 2025 and Windows 11 24H2) need a newer servicing stack. In the first run Windows installs that servicing stack (its own KB), which needs a restart, and the cumulative update itself fails. After the restart it is offered again.

The Windows Update API can report such an update as installed while the update history records the failure. The agent therefore checks its result against the history after every installation, and reports the KB as failed with the code and a hint.

### Solution
1. Restart the node, unless the job did: with *Reboot when the installation is done* or *Reboot at*, it restarts when the installation needs it.
2. Run **Search for updates**, then **Install updates** again. The second installation installs the cumulative update.
3. Check the result on the node's Updates tab, or on the node itself (see [Diagnosing an installation on the node](#diagnosing-an-installation-on-the-node)).

### Where installations show up
The agent installs through the Windows Update API (`Microsoft.Update.Session`), like other management tools. Its installations appear:
- in the API's update history (the node's **Update history** in Octofleet);
- in `Get-HotFix` / *Installed Updates*;
- in `dism /online /get-packages`.

They do **not** appear in *Settings → Windows Update → Update history*: that page only lists what Windows' own update client installed.

### Diagnosing an installation on the node
Run these in an elevated PowerShell:

```powershell
# Windows Update history: result 2 = succeeded, 3 = with errors, 4 = failed, 5 = aborted
$searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
$searcher.QueryHistory(0, 10) |
    Select-Object Date, Operation, ResultCode, @{n='HResult'; e={'0x{0:X8}' -f $_.HResult}}, Title

# Servicing events: ID 2 = package installed, 4 = a restart is needed first
Get-WinEvent -LogName Setup -MaxEvents 20 | Format-Table TimeCreated, Id, Message -Wrap

# Cumulative updates and servicing stacks in the component store
dism /english /online /get-packages /format:table | Select-String 'RollupFix|ServicingStack'

# A restart is pending
Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'

# Errors of the servicing stack and the Windows Update client
Select-String -Path C:\Windows\Logs\CBS\CBS.log -Pattern 'error|failed' | Select-Object -Last 30
Get-WindowsUpdateLog -LogPath "$env:TEMP\WindowsUpdate.log"
```

An installation that runs for a long time keeps `TrustedInstaller`, `TiWorker`, `dism` or `dismhost` busy:

```powershell
Get-Process TrustedInstaller, TiWorker, dism, dismhost -ErrorAction SilentlyContinue |
    Select-Object Name, Id, StartTime
```

**Never stop these processes.** Stopping them during servicing can corrupt the component store. The agent does not stop them either: an installation that takes longer than the job's limit (30 minutes) is reported as still running, with these processes, and finishes in the background.

---

## Component Store Grows After Many Cumulative Updates (Windows)

### Symptoms
- `C:\Windows\WinSxS` keeps growing; free space on `C:` shrinks month by month.
- `dism /english /online /get-packages /format:table` lists several `Package_for_RollupFix` (and `Package_for_DotNetRollup`) entries as **Superseded**.

### Cause
Each cumulative update keeps the components it replaced, so it can be uninstalled. Windows removes superseded components with the scheduled task `\Microsoft\Windows\Servicing\StartComponentCleanup`, but only during automatic maintenance when the machine is idle. Servers are rarely idle, so it often never runs there. This affects older servers (e.g. Windows Server 2016) most, but newer ones too.

### Solution
Check whether a cleanup is recommended:

```powershell
dism /online /cleanup-image /analyzecomponentstore
# "Component Store Cleanup Recommended : Yes" and the reclaimable size
```

Then start the cleanup, in a maintenance window. It can take a long time and must not be interrupted:

```powershell
# the same as the scheduled task, without its time limit
dism /online /cleanup-image /startcomponentcleanup

# or start the scheduled task itself
Start-ScheduledTask -TaskPath '\Microsoft\Windows\Servicing\' -TaskName 'StartComponentCleanup'
```

Superseded updates can no longer be uninstalled afterwards. `/ResetBase` removes all superseded versions at once and makes every installed update permanent. Use it only deliberately, not as a routine.

---

## Checking Logs

### Windows

```powershell
# Application logs
Get-Content "C:\Windows\Logs\Octofleet\*.log" -Tail 100

# Windows Event Log - Application errors
Get-WinEvent -FilterHashtable @{LogName='Application'; Level=2; StartTime=(Get-Date).AddHours(-1)} -MaxEvents 20 | 
    Where-Object { $_.Message -like "*Octofleet*" -or $_.Message -like "*.NET*" } | 
    Format-List TimeCreated, Message

# Service Control Manager events
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'; StartTime=(Get-Date).AddHours(-1)} -MaxEvents 10 |
    Format-List TimeCreated, Message
```

### Linux

```bash
# Agent log
sudo tail -n 100 /var/log/octofleet-agent.log

# The same lines in the journal, also from before a restart
sudo journalctl -u octofleet-agent -n 100 --no-pager

# Package manager logs (update searches and installations)
sudo tail -n 50 /var/log/apt/history.log /var/log/apt/term.log   # Debian, Ubuntu
sudo tail -n 50 /var/log/dnf.log                                   # Fedora, RHEL and derivatives
```
