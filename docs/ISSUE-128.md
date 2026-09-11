# Issue #128: VSS activity and legacy release files

Fix version: v0.7.1. The published v0.4.47 asset is preserved unchanged.

## Findings

The reported PowerShell command matches `CopyViaVssAsync` in
[`VssHelper.cs` at v0.4.47](https://github.com/BenediktSchackenberg/octofleet/blob/v0.4.47/src/OctofleetAgent.Service/Inventory/VssHelper.cs).
The old Chromium cookie metadata collector tried ordinary file copying, then
`esentutl`, then VSS when a database could not be read. It created a shadow copy,
copied the database from that snapshot, and attempted to delete the snapshot by
its exact `DeviceObject`. The command was intended to clean up that temporary
snapshot, not to delete every restore point or backup. Cleanup was not protected
by `finally`, so failures could also leave snapshots behind.

The installer starts `OctofleetAgent.Service.exe`. The inventory scheduler waits
30 seconds after service startup before checking whether a full inventory is due.
That full inventory includes browser metadata. This explains how the activity
could occur soon after installation; the issue does not include a full process
trace proving the precise trigger on the reporter's machine.

The downloaded v0.4.47 ZIP was inspected without running its executables:

| Entry | Uncompressed bytes |
| --- | ---: |
| `OctofleetAgent.Service.exe` | 173602623 |
| `OctofleetAgent.Service.pdb` | 125400 |
| `OpenClawAgent.Service.exe` | 3864050 |
| `OpenClawAgent.Service.pdb` | 55932 |

Archive SHA256:
`60F0F679310187F51C355124137388A60D6F1E983C5EAD0DE52D86C22643F066`

The two OpenClaw files are byte-for-byte identical to the legacy files tracked in
[`publish/` at v0.4.47](https://github.com/BenediktSchackenberg/octofleet/tree/v0.4.47/publish):

- EXE SHA256: `9D59DFF9684953DFE83294E46A1026B9C1051B7E79014EB1C7DC62EA22AD295B`
- PDB SHA256: `1BD2282D531E5BA4F8E8B9F24F02820892AB79519712B5A91326D8C146C86B81`

Both release workflows published into that existing directory and archived all
of its contents. Publishing did not remove unrelated old binaries. The installer
selects the Octofleet executable; shipping the extra OpenClaw executable was a
packaging defect, not a required component of the current agent.

## Changes

- Removed the VSS/`esentutl` helper and its browser collection path. Browser
  inventory now uses ordinary file access and reports locked databases as
  unavailable. This means cookie metadata from exclusively locked databases is
  unavailable until the browser releases the lock.
- Treat successful empty cookie queries as zero cookies instead of a failed read.
- Removed the tracked OpenClaw EXE, PDB and legacy service ZIP; ignore release
  output directories.
- Route the release workflow and the installer builder through one builder
  with a fresh staging directory for each run. Validate required files, reject
  OpenClaw artifacts and unexpected executables, and abort on build failure.
- Include the repository-root installer in the ZIP and attach it to releases
  created by the main builder/workflows.
- Remove the duplicate release-created workflow to preserve manually built
  packages. Local builds can sign and verify executables before packaging.

## Verification

```powershell
dotnet build src/OctofleetAgent.Service/OctofleetAgent.Service.csproj -c Release
dotnet run --project tests/OctofleetAgent.Inventory.Tests -c Release
./tests/windows/Release-Package.Tests.ps1
./scripts/Build-Release.ps1 -Version 0.7.1 -OutputPath ./release/issue-128-validation
```

Verified locally: service build, 5 synthetic browser database checks, 13 offline
packaging checks, and an actual service/helper ZIP build. The tests do not start
the service, inspect real browser profiles, or perform VSS operations. The build
still reports existing nullable/unused-variable warnings and NuGet advisories
for the existing `System.Text.Json` 8.0.0 dependency.

## Suggested issue reply

Thanks for reporting both observations. The VSS command came from our browser
inventory fallback: it created a temporary snapshot to read a locked browser
database and then deleted that specific snapshot. It was not intended to delete
existing backups or all shadow copies. The first inventory run after service
startup can explain why it was observed shortly after installation. Nevertheless,
VSS creation/deletion is an unnecessary side effect for routine inventory, so the
prepared fix removes that fallback and reports locked databases as unavailable.

The OpenClaw executable should not have been included. I verified that the EXE
and PDB in the v0.4.47 ZIP exactly match old files tracked in our `publish/`
directory. The release workflow built into that directory and inadvertently
included those files. The installer selects `OctofleetAgent.Service.exe`.
The fix removes the old artifacts, uses fresh staging directories, and rejects
legacy or unexpected executables before packaging.

The fix has passed local build and regression checks and is included in v0.7.1.
The published v0.4.47 download is preserved unchanged.
