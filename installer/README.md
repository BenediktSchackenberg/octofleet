# Octofleet Agent – Windows installer (MSI)

`OctofleetAgent-v<version>.msi` installs the Windows agent like `Install-OctofleetAgent.ps1` does, but as a Windows Installer package: listed under *Programs and Features*, silent install with the server URL and agent key as properties, major upgrade, repair, uninstall and standard return codes – deployable with GPO, Intune and ConfigMgr without a wrapper. Each release attaches the MSI next to the ZIP, with its SHA256 in `OctofleetAgent-v<version>.msi.sha256.txt`. The MSI is not signed yet ([#332](https://github.com/BenediktSchackenberg/octofleet/issues/332)).

For a single machine the one-liner from *Add Device* in the console (`Install-OctofleetAgent.ps1`) is still the quickest way; see [docs/AGENT-SETUP.md](../docs/AGENT-SETUP.md).

## Silent install

Run as Administrator (or from a deployment tool, which runs as SYSTEM):

```powershell
msiexec /i OctofleetAgent-v0.8.2.msi SERVER_URL=https://octofleet.example.com API_KEY=<agent key> /qn /l*v C:\Windows\Temp\octofleet-install.log
```

| Property | Required | Description |
|---|---|---|
| `SERVER_URL` | on the first install | Octofleet server URL as in *Add Device* (e.g. `https://octofleet.example.com` or `http://192.168.0.5:8080`) → `InventoryApiUrl` |
| `API_KEY` | on the first install | Agent key from *Add Device* → `InventoryApiKey`. Hidden: `/l*v` logs `**********` instead of the key |
| `DISPLAY_NAME` | no | Node name shown in the console (default: computer name) |
| `PUSH_INTERVAL` | no | Minutes between scheduled inventory pushes (default: 60, spread over the interval) |
| `SCREEN_HELPER` | no | `1` installs the screen helper (remote screen view and control). Off by default |

All properties are *secure*, so managed installs (GPO, Intune, ConfigMgr) pass them to the installation. Values must not contain `;`. An invalid `SERVER_URL` (not `http://` or `https://`) or `PUSH_INTERVAL` fails the installation (1603) instead of leaving an unconfigured agent.

What the MSI does:

- Installs `OctofleetAgent.Service.exe` to `C:\Program Files\Octofleet\` – the same folder as the install script – and registers the service `OctofleetNodeAgent` (*Octofleet Agent*, automatic start, LocalSystem; on failure restarted after 10 seconds, three times, counter reset after a day), then starts it.
- Writes the passed properties into `C:\ProgramData\Octofleet\service-config.json` and restricts that folder to SYSTEM and Administrators. The key is written in plain text there, as the install script does; the service encrypts it for SYSTEM when it starts (see [AGENT-SETUP.md](../docs/AGENT-SETUP.md#configuration-files)).
- Writes `HKLM\SOFTWARE\Octofleet\Agent` (`InstallSource=msi`, `ProductCode`, `Version`).

## Upgrade, repair, uninstall

- **Upgrade**: install the new MSI (same `UpgradeCode`, a new product code per version). The old version is removed and the new one installed; *Programs and Features* keeps one entry. Older versions refuse to install over newer ones (1603).
- **Configuration is kept**: the config is not part of the package. Upgrade and repair leave it as it is; properties passed to `msiexec` replace only their own values (e.g. a new `API_KEY` keeps server URL, node name and all other settings). The node stays the same node with its history.
- **Self-update is off** for MSI installs: the agent logs *"Self-update is off: the agent was installed by the Octofleet Agent MSI"* and leaves its files to Windows Installer, so the version in *Programs and Features* and the detection rules of your deployment tool stay right. Deploy the new MSI to upgrade. Script installs keep updating themselves.
- **Over a script install**: the MSI takes over the existing service (`OctofleetNodeAgent`, or `Octofleet Agent` of older scripts) and the program folder, and keeps the config – no re-enrolment.
- **Repair**: `msiexec /fa OctofleetAgent-v0.8.2.msi /qn`.
- **Uninstall**: `msiexec /x OctofleetAgent-v0.8.2.msi /qn` (or the product code, or *Programs and Features*). Removes the service, the program files and the registry key; `C:\ProgramData\Octofleet` (config, encrypted key, device identity) and the logs in `C:\Windows\Logs\Octofleet` stay, so a reinstall is the same node. **Remove node** in the console (`uninstall-agent` job) and `scripts/Uninstall-OctofleetAgent.ps1` uninstall the MSI and then remove those too.

Return codes are Windows Installer's: `0` success, `3010` success – reboot required, `1641` success – reboot started, `1603` failure (see the `/l*v` log), `1618` another installation is running.

## Deployment

The product code changes with every version; read it from the MSI for detection rules:

```powershell
$wi = New-Object -ComObject WindowsInstaller.Installer
$db = $wi.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $wi, @("$PWD\OctofleetAgent-v0.8.2.msi", 0))
$view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT Value FROM Property WHERE Property='ProductCode'"))
$view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null)
$record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
$record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, 1)
```

On an installed machine: `HKLM\SOFTWARE\Octofleet\Agent\ProductCode`.

### Intune

- **Line-of-business app (MSI)**: upload the MSI, command-line arguments `SERVER_URL=https://octofleet.example.com API_KEY=<agent key>`, install context *Device*. Intune detects the app by its product code.
- **Win32 app** (`.intunewin` made with the Win32 Content Prep Tool):
  - Install: `msiexec /i OctofleetAgent-v0.8.2.msi SERVER_URL=https://octofleet.example.com API_KEY=<agent key> /qn`
  - Uninstall: `msiexec /x {product code} /qn`
  - Install behavior: *System*; return codes: Intune's defaults (0, 1707, 3010, 1641, 1618)
  - Detection rule: *MSI*, the product code, optionally *MSI product version check* ≥ the version
  - For an upgrade, add the new version as a new app that **supersedes** the old one (without "uninstall previous version": the MSI upgrades itself and keeps the config).

### Configuration Manager (ConfigMgr / SCCM)

- Create an **Application** with a *Windows Installer (\*.msi file)* deployment type; ConfigMgr reads the product code and creates the detection method.
- Installation program: `msiexec /i "OctofleetAgent-v0.8.2.msi" SERVER_URL=https://octofleet.example.com API_KEY=<agent key> /qn /l*v "%windir%\Temp\octofleet-install.log"`
- Uninstall program: `msiexec /x {product code} /qn`; installation behavior *Install for system*.
- New versions: a new application that supersedes the previous one (not uninstalling it).

### Group Policy (assigned software)

1. Copy the MSI to a share that the computer accounts can read (`Domain Computers`: read).
2. GPO → *Computer Configuration → Policies → Software Settings → Software installation → New → Package*, the UNC path, *Advanced*.
3. GPO software installation cannot pass properties on a command line: on the *Modifications* tab add a **transform** (`.mst`) that sets `SERVER_URL` and `API_KEY` in the Property table. Create it with Orca (Windows SDK: open the MSI, *Transform → New Transform*, add the two properties, *Transform → Generate Transform*) or any MSI editor. The transform holds the agent key: keep it on a share only computers and admins can read.
4. For an upgrade, add the new MSI as a package in the same GPO, *Upgrades* tab → *Add* the old package, "Package can upgrade over the existing package". The config is kept, so the new package needs the transform only for new machines.

## Building the MSI

Built in CI by `.github/workflows/release.yml` (Windows runner, WiX v5 SDK from NuGet). Locally, with the .NET 8 SDK:

```powershell
# Publishes the agent and the screen helper, checks them, builds ZIP and MSI
.\scripts\Build-Release.ps1 -Version 0.8.2 -OutputPath .\release -Msi
```

or, with an existing publish folder:

```powershell
dotnet build installer\OctofleetAgent.Installer.wixproj -c Release -p:Version=0.8.2 -p:AgentPublishDir=<publish folder> -o .\release\msi
```

The version comes from the release tag; the files carry the same file version, so Windows Installer replaces them on upgrade. `UpgradeCode` `{E8F9D4A2-7B3C-4E5F-9A1D-2C6B8F0E3D7A}` must never change. Stay on WiX v5: v6 and later add the Open Source Maintenance Fee. The custom action that writes the config (`CustomActions/`) is tested by `dotnet run --project tests/OctofleetAgent.Installer.Tests`.

## Migration from Legacy Agent

Run the migration script to cleanly remove old "OpenClaw" agents:

```powershell
# Just uninstall old agent
.\Uninstall-LegacyAgent.ps1

# Uninstall and install new Octofleet agent
.\Uninstall-LegacyAgent.ps1 -InstallNew
```

## Troubleshooting

- **Installation fails (1603)**: search the `/l*v` log for `WriteConfigFile` (invalid property) and `Return value 3` (the failing action).
- **Service not starting**: `Get-Content "C:\Windows\Logs\Octofleet\Agent.log" -Tail 50` (one log per component, see [AGENT-SETUP.md](../docs/AGENT-SETUP.md#logs)).
- **Node does not appear**: check `SERVER_URL` and the key in *Add Device*; the server must be reachable from the machine (`Invoke-WebRequest https://octofleet.example.com/health`).
