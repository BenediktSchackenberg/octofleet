# 🩹 Patch Management

> Introduced in **v0.6.0** (Epic E30)

Octofleet's Patch & Update Orchestration system provides end-to-end Windows patch management — from discovery through deployment to compliance reporting.

## Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Agent      │────►│  Patch       │────►│  Deployment  │────►│  Compliance  │
│ PatchScanner │     │  Catalog     │     │  Wizard      │     │  Tracking    │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

- **Patch Catalog** — Central registry of all known patches (KB articles), auto-populated by agent scans
- **Patch Rings** — Canary → Pilot → Broad rollout strategy
- **Deployment Wizard** — Create, schedule, pause, resume, and cancel patch deployments
- **Compliance Tracking** — Per-node and fleet-wide patch compliance dashboards
- **Agent Scanner** — `PatchScanner.cs` on the Windows agent scans for missing updates via the Windows Update API

---

## Concepts

### Patch Catalog

The catalog is populated in two ways:

1. **Agent scan results** — Agents run `PatchScanner.cs` to detect available Windows updates and POST results to `/api/v1/patches/scan-results`. The backend upserts patches into the catalog automatically.
2. **Manual creation** — Admins can add patches manually via the API or UI.

Each patch entry contains:
- KB ID, title, description
- Severity (Critical, Important, Moderate, Low)
- Category, OS targets
- Release date, supersedence info
- Approval/exclusion status

### Patch Rings

Rings control the rollout pace:

| Ring | Purpose | Typical Size |
|------|---------|-------------|
| **Canary** | Early testing | 1–5 nodes |
| **Pilot** | Wider validation | 5–20 nodes |
| **Broad** | Full fleet deployment | All remaining nodes |

Rings are configured with a name, description, and optional node/group targeting. You can create custom rings beyond the defaults.

### Deployments

A patch deployment targets one or more patches to a set of rings/nodes. Deployments support:

- **Pause / Resume / Cancel** — Full lifecycle control
- **Ring-based progression** — Deploy to Canary first, observe, then advance
- **Status tracking** — Per-node installation status

### Agent-Side Scanner

The Windows agent includes `PatchScanner.cs`, which:

1. Queries the Windows Update Agent API for available updates (every 6 hours, or on a `patch_scan` job), with the client's configured source – on WSUS clients only the updates approved in WSUS. The search has a 20-minute limit.
2. Reports missing patches to the backend via `POST /api/v1/patches/scan-results`, together with the search's status: `scan: {status, result_code, error, source, server, duration_seconds}` – `status` is `succeeded`, `partial` (result code 3, searched with errors) or `failed` (e.g. WSUS not reachable: `0x8024401C`), `source` is `wsus` (with the WSUS URL as `server`) or `windows_update`.
3. Receives pending patches via `GET /api/v1/patches/pending/{node_id}`
4. Reports installation results via `POST /api/v1/patches/results`

What the server does with a scan report:

| Status | Available updates (Patch Explorer) | Catalog entries of the node |
|---|---|---|
| `succeeded` | replaced by the report | entries still waiting (`detected`, `approved`) that are no longer offered are removed – installed outside Octofleet (WSUS, Windows Update, Defender), superseded or declined; entries of Octofleet's own deployments stay |
| `partial` | replaced | unchanged |
| `failed` | **kept** – the last successful search stays visible | unchanged |
| no `scan` block (older agents, catalog import) | replaced | unchanged |

The last search per node (time, status, source, error, number of updates) is shown at the top of the node's Updates tab and returned by `GET /api/v1/patches/scan-status/{node_id}`. On Windows nodes the tab lists the **Available updates** of the last successful search below it (`GET /api/v1/patches/available/{node_id}`), with **Search for updates** (`patch_scan`) and **Install updates** / **Install selected (n)** (`patch_install` with `kb_ids`, after a confirmation). The confirmation sets `reboot_policy` for updates that need a reboot: `no_reboot`, `schedule` with `reboot_schedule_time` (ISO 8601 with offset; at least one minute ahead) or `force` (in one minute). Afterwards the agent searches again and sends a fresh inventory, so the available and installed updates are current. The tab's number is the pending updates on both systems. The tab itself turns amber while updates are pending and red when the last search failed. Linux nodes count their package list. Windows nodes count the available updates without Microsoft Defender signature updates (KB2267602): Defender gets several of those a day and installs them itself. The last search's line counts the same way and shows Defender signature updates separately ("Pending updates: 0 + 1 Defender signatures").

### Linux Nodes

The Linux agent reports the available package updates with every inventory push (apt, dnf, yum, pacman), from the package lists already on the machine. Each update has the package name (on dnf/yum `name.arch`), the new version, the repository and a security flag: on apt from the security repository (`*-security`, e.g. `noble-security`, `trixie-security`), on dnf/yum from the distribution's security advisories (`dnf updateinfo list --security`), there also with the severity (Critical, Important, Moderate, Low). Distributions without security advisories in their repositories (e.g. CentOS Stream) list the updates without flags. The node's Updates tab has two buttons (with the `jobs:create` permission):

- **Search for updates** – a `patch_scan` job. The agent refreshes the package lists (`apt-get update`, `dnf makecache` or `yum makecache`) and sends the inventory with the update list and the search's result. The result appears as the node's last update search, like on Windows:
  - `succeeded`;
  - `partial`: single repositories failed, shown as `Err:` / `W: Failed to fetch` lines;
  - `failed`, with the error. The job fails as well.

  pacman is not supported: refreshing without upgrading leaves a partially updated system.
- **Install updates** / **Install selected (n)** – a `patch_install` job, after a confirmation. Without a selection the UI sends `{"all": true}` to install all available updates; with packages ticked in the list, it sends `{"packages": [...]}` to install only those (the package manager may also upgrade packages they depend on). Jobs without an explicit target are rejected:
  - apt: `apt-get --with-new-pkgs upgrade`, non-interactive, keeping changed configuration files;
  - dnf / yum: `upgrade`.

  The selection is sent as `{"packages": ["openssl", ...]}` in the job's payload (also through the API); the agent then upgrades only those packages: `apt-get install --only-upgrade` or `dnf upgrade <packages>`. The job's output ends with the package manager's last lines and `Reboot required: yes/no`. Afterwards the agent searches for updates again and sends the inventory with that search, so the list and the last update search are current.

Time limits: the payload's `timeout`, else the job's `timeoutSeconds`, else 10 minutes for the search and 60 minutes for the installation. The buttons use 15 and 60 minutes. Under systemd the package manager runs in a transient unit (`systemd-run --wait`, its output through a temporary file under `/var/log`), because the agent service itself runs with `ProtectSystem=strict` and cannot write `/usr`, `/etc` or `/var/lib` – dnf cannot even list updates without writing its lock file. The commands run with `LC_ALL=C`, since the agent reads their output. It runs with `NEEDRESTART_MODE=l`, so needrestart only lists services that use old libraries and does not restart them. The apt commands run with `-o DPkg::Lock::Timeout=120`, so they wait up to 2 minutes when another apt process (e.g. unattended-upgrades) holds the lock.

Before the installation the confirmation says whether a reboot is needed: Windows reports it per update in the search (`reboot_behavior`: never / always / can, from `InstallationBehavior.RebootBehavior`, shown as *Needs a reboot* / *May need a reboot*) and whether a reboot is already pending (`reboot_pending`, `Microsoft.Update.SystemInfo`); on Linux it is estimated from the package names (kernel: needed; libc, systemd, dbus, OpenSSL: may be) plus the inventory's `rebootRequired`. The reboot choice is offered only when a reboot is needed, possible or already pending; otherwise the dialog says *These updates do not need a reboot*. A reboot happens only when an installed update needs one and the job asks for it: the install confirmation (Windows and Linux) offers *no reboot* (default), *reboot at* a set time, or *reboot in one minute* (`reboot_policy` `no_reboot` / `schedule` with `reboot_schedule_time` / `force`). On Linux a transient systemd timer runs `systemctl reboot` after the job has reported its result and the update search (without systemd: `shutdown -r`); a time in the past means one minute. On Windows the agent calls `shutdown /r /t <seconds>`. "One minute" means one minute after the installation (and its update search), not after the click; "at" a time that has passed when the installation ends means one minute after it. A Windows installation that takes longer than the job's limit (30 minutes) is never stopped – stopping TrustedInstaller/TiWorker can corrupt the component store: the job reports it as still running, with the servicing processes and their runtime, and the installation, reboot and update search finish in the background.

**Installation result on Windows.** The job's output lists `installed` and `failed` KBs and, per KB, `details` with the Windows Update result code, the HRESULT (`0x…`), its `source` and a `hint` for known codes. After the installation the agent compares the result with the Windows Update history: the installer can report a KB as installed while the history records it as failed. Example: a cumulative update for which Windows first installs a newer servicing stack (`0x800F0823`, CBS_E_NEW_SERVICING_STACK_REQUIRED). The servicing stack needs a restart, and the cumulative update is offered again afterwards and has to be installed a second time. Such a KB counts as failed (`source: history`), the job fails with the code and the hint, and the reboot policy still applies, since the servicing stack needs the restart. See [Troubleshooting](TROUBLESHOOTING.md#windows-update-installation-failed-or-the-update-is-offered-again-after-the-restart) for what to do and how to check an installation on the node.

**Where installations show up.** The agent installs through the Windows Update API (`Microsoft.Update.Session`), like other management tools. Such installations appear in the API's update history (the node's *Update history* in Octofleet), in `Get-HotFix` / *Installed Updates* and in `dism /online /get-packages`, but **not** in *Settings → Windows Update → Update history*, which only lists what Windows' own update client installed. The history keeps the newest entry per update and result: an update installed a second time (as above) has a failed and a successful entry, and the installed updates show the newest; repeated successful installations of the same update (Store apps update almost daily) stay one entry.

**Windows restarts by its own policy, too.** *No reboot* only means that Octofleet does not restart the node. After an installation Windows has a pending restart, and the Windows Update policy decides whether Windows restarts by itself – e.g. with automatic installation and a scheduled restart (`AUOptions` 4 under `HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU`), outside the active hours or after a deadline (Windows 10/11 and newer servers). With *notify to restart* (`AUOptions` 7, the usual server setting) it waits for an administrator. Check the policy of your nodes before choosing *no reboot* on Windows; the dialog says so as well. Linux nodes are not restarted by anything else (unattended-upgrades only with `Automatic-Reboot "true"`).

The inventory reports `rebootRequired`:
- Debian/Ubuntu: `/var/run/reboot-required`, with the packages from `reboot-required.pkgs`;
- dnf/yum: `needs-restarting -r` (yum-utils) or, on minimal installs without it, `dnf needs-restarting -r` (dnf-plugins-core); without either, the value stays unknown.

The Updates tab then shows **Reboot required**.

### Installed Updates

Below the last search, the Updates tab lists the node's **Installed updates** from `Win32_QuickFixEngineering` (KB, installed on), together with the Windows Update history:

- Each KB shows the title and result (Succeeded, Failed, ...) of its history entry. A KB without a history entry, e.g. installed offline or as part of another update, shows "Installed".
- The type comes from the title, or else from the description: cumulative update, servicing stack, .NET, security update or update.
- The agent reads the history newest first, up to 2000 entries. Of the Microsoft Defender signature updates, which come several times a day, it keeps only the newest, so the monthly cumulative updates stay in the history.
- The full history is listed under **Update history**.

### Fleet Updates

**Patches → Fleet updates** (`/patches/updates`, `packages:read`) lists every node, Windows and Linux, with its update state – which nodes need updating, which are stuck, which wait for a reboot:

| Column | Windows | Linux |
|---|---|---|
| Pending updates, security updates | the last search's available updates; Defender signature updates are counted separately (*+ n Defender signatures*), not as pending | the inventory's `totalUpdates` / `securityUpdates` |
| Reboot | *Reboot pending* (`reboot_pending`), *Will need a reboot* / *May need a reboot* from the pending updates' `reboot_behavior`, *Unknown* when an update did not report it | *Reboot pending* (`rebootRequired`), else estimated from the package names like on the node page |
| Last update search | time, status (with errors / failed), source; the error as tooltip | same, from `patch_scan` jobs |
| Status | a running search or installation, offline | same |

The node name leads to the node's Updates tab. The cards count over all nodes and switch filters on and off: with pending updates, with security updates (Windows: category security, or severity critical or important), reboot pending or needed, last search failed, no search for 7 days, offline. A name search and the operating system narrow the list further; the columns sort on click (default: most pending updates first). Filters and sorting are kept in the URL, and each change is a browser history entry, so *Back* returns to the previous filters. The list reloads every 15 seconds, every 5 seconds while a search or installation runs.

**Several nodes at once** (`packages:deploy`): tick nodes (the header box ticks the nodes shown; the selection stays when the filters change), then
- **Search for updates (n)** – one `patch_scan` job per node, like the node page's button;
- **Install updates…** – Windows nodes install their pending updates that are **approved in the catalog** (*Patches → Catalog*, not excluded); the list shows *n approved* per Windows node. **Linux nodes are not installed in bulk** – Linux packages have no approval path yet – and are installed from their node page. A confirmation lists each node with its number of approved updates and reboot outlook; nodes without approved updates link to the catalog, Linux nodes to their Updates tab, and both are skipped. Defender signature updates are left out unless *Include Defender signature updates* is ticked (Defender usually updates itself). The reboot choice is the node page's (no reboot / at a day and time / one minute after the installation), offered when one of the nodes can need a reboot or has one pending, and applies to every node; on Windows the agent reboots only if an installed update needs it, on Linux only if `/var/run/reboot-required` exists afterwards.

The server builds each node's job from what it stores – the KB IDs of the node's last search that are approved in the catalog – with the node page's time limit (30 minutes). Staged installations (a pilot ring first) are planned with the existing deployment rings. The rows show *Searching…* / *Installing…* until the agent answers; a failed search or installation shows as a red badge linking to the job.

**An installation is finished when the node reports after its restart.** Windows lists a cumulative update until the restart, so the list would offer it again. While the newest installation has not finished, the row says so and the node is skipped by *Install updates* (and by *Search for updates* while it restarts):
- *Installing…* – the job runs;
- *Restarting to finish the installation* – a reboot was required and ordered (one minute after, or at a time); until the node searches for updates after its restart (the agent does after starting), at most two hours after the restart time;
- *Installed – restart pending* – a reboot was required but not ordered, and the node still reports a pending reboot.

*Install again on nodes whose last installation has not finished* overrides the last two, never a running job. The API reports this as `installation` (`state`, `job_id`, `restart_at`); `POST …/fleet/install` skips such nodes (`busy`, `restarting`, `awaiting_restart`) unless `retry: true`.

---

## API Reference

### Permissions

| What | Permission |
|---|---|
| Read the catalog, rings, deployments, the Patch Explorer and the fleet updates | `packages:read` |
| Compliance views | `compliance:read` |
| Create, import, approve or exclude patches; manage rings | `packages:write` |
| Start, pause, resume or cancel deployments; Patch Explorer deploy, scan and verify; search and install on several nodes from the fleet updates | `packages:deploy` |
| Agent routes (`scan-results`, `pending/{node_id}`, `results`, `explorer/agent-updates`) | agent key |

The built-in `viewer` role can read; `operator` and `admin` can also change and deploy. The shared agent key cannot use the user routes.

### Catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/catalog` | List patches (with search, pagination; `node`: only patches still open on that node) |
| POST | `/api/v1/patches/catalog` | Create patch manually |
| POST | `/api/v1/patches/catalog/import` | Import patches from agent scan |
| GET | `/api/v1/patches/catalog/{patch_id}` | Get patch details with affected nodes |
| PATCH | `/api/v1/patches/catalog/{patch_id}/approve` | Approve patch for deployment |
| PATCH | `/api/v1/patches/catalog/{patch_id}/exclude` | Exclude patch from deployment |

### Compliance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/compliance` | Fleet-wide patch compliance summary (`node_id`: only that node) |
| GET | `/api/v1/patches/compliance/nodes` | Per-node compliance breakdown |
| GET | `/api/v1/patches/scan-status/{node_id}` | The node's last Windows Update search: time, status, source (WSUS/Windows Update), error, update count |

### Rings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/rings` | List patch rings |
| POST | `/api/v1/patches/rings` | Create ring |
| PUT | `/api/v1/patches/rings/{ring_id}` | Update ring |
| DELETE | `/api/v1/patches/rings/{ring_id}` | Delete ring |

### Deployments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/deployments` | List deployments |
| POST | `/api/v1/patches/deployments` | Create deployment |
| GET | `/api/v1/patches/deployments/{id}` | Get deployment details |
| POST | `/api/v1/patches/deployments/{id}/pause` | Pause deployment |
| POST | `/api/v1/patches/deployments/{id}/resume` | Resume deployment |
| POST | `/api/v1/patches/deployments/{id}/cancel` | Cancel deployment |

### Agent Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/patches/scan-results` | Agent submits scan results |
| GET | `/api/v1/patches/pending/{node_id}` | Get pending patches for node |
| POST | `/api/v1/patches/results` | Agent submits installation results |

---

## Workflow Example

```bash
# 1. Agent scans and reports available patches automatically

# 2. Review the catalog
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/patches/catalog

# 3. Approve a patch
curl -X PATCH -H "X-API-Key: $KEY" \
  http://localhost:8080/api/v1/patches/catalog/{patch_id}/approve

# 4. Create a deployment
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name": "March Patches", "patch_ids": ["..."], "ring_id": "..."}' \
  http://localhost:8080/api/v1/patches/deployments

# 5. Monitor compliance
curl -H "X-API-Key: $KEY" http://localhost:8080/api/v1/patches/compliance
```
