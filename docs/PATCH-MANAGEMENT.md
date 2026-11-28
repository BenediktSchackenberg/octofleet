# 🩹 Patch Management

> Introduced in **v0.6.0** (Epic E30)

Octofleet's Patch & Update Orchestration system provides end-to-end Windows patch management - from discovery through deployment to compliance reporting.

## Overview

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Agent      │────►│  Patch       │────►│  Deployment  │────►│  Compliance  │
│ PatchScanner │     │  Catalog     │     │  Wizard      │     │  Tracking    │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

- **Patch Catalog** - Central registry of all known patches (KB articles), auto-populated by agent scans
- **Patch Rings** - Canary → Pilot → Broad rollout strategy
- **Deployment Wizard** - Create, schedule, pause, resume, and cancel patch deployments
- **Compliance Tracking** - Per-node and fleet-wide patch compliance dashboards
- **Agent Scanner** - `PatchScanner.cs` on the Windows agent scans for missing updates via the Windows Update API

---

## Concepts

### Patch Catalog

The catalog is populated in two ways:

1. **Agent scan results** - Agents run `PatchScanner.cs` to detect available Windows updates and POST results to `/api/v1/patches/scan-results`. The backend upserts patches into the catalog automatically.
2. **Manual creation** - Admins can add patches manually via the API or UI.

Each patch entry contains:
- KB ID, title, description
- Severity (Critical, Important, Moderate, Low)
- Category, OS targets
- Release date, supersedence info
- Approval/exclusion status

The catalog is for **Windows** updates only. Linux packages are searched and installed per node (Updates tab) and from *Patches → Fleet updates*.

#### Node entries and the patches page

Each node that was offered a catalog update gets an **entry** for it (`patch_catalog_nodes`), with a state:

| State | Meaning |
|---|---|
| `detected`, `approved`, `downloading`, `installing` | still needed – not installed (counted as *Not installed*) |
| `installed` | installed – by an Octofleet deployment, or seen in the node's update history |
| `failed` | an Octofleet deployment failed |
| `not_required` | a successful search no longer offers it: installed outside Octofleet, superseded or declined |
| `excluded` | the update is excluded in the catalog (left out of compliance) |

A successful search that no longer offers an update marks the entry `not_required` (before, the entry was deleted, so an installed update left no trace and the catalog showed it without any node). The node's update history (sent with the inventory) then marks it `installed` when it shows a successful install of the KB after the entry was detected – in either order: the Windows agent searches right after an installation and sends the history afterwards. A catalog KB the history shows installed on a node without an entry gets an `installed` one, but only for installs after Octofleet first saw the KB (the MSRT, KB890830, keeps its KB every month). An update offered again (next month's MSRT) waits again (`detected`).

The patches page (*Patches*, `/patches`) counts two things and names them apart:

| Card | Unit | Counts |
|---|---|---|
| *Updates in catalog* | updates (like the table) | all catalog updates; approved and excluded ones below |
| *Awaiting approval* | updates | needed on at least one node, neither approved nor excluded; below: needed in all |
| *Not installed* | node × update | entries still needed; failed ones below |
| *Compliance* | node × update | (installed + no longer needed) / all entries except excluded ones; MTTP = average time from detected to installed |

The table's *Approval* column is the catalog decision (approved / not approved / excluded) – not whether a node has the update; the *Nodes* column shows per update how many nodes still need it, have it installed, failed, or no longer need it.

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

- **Pause / Resume / Cancel** - Full lifecycle control
- **Ring-based progression** - Deploy to Canary first, observe, then advance
- **Status tracking** - Per-node installation status

### Agent-Side Scanner

The Windows agent includes `PatchScanner.cs`, which:

1. Queries the Windows Update Agent API for available updates (every 6 hours, or on a `patch_scan` job), with the client's configured source – on WSUS clients only the updates approved in WSUS. The search has a 20-minute limit.
2. Reports missing patches to the backend via `POST /api/v1/patches/scan-results`, together with the search's status: `scan: {status, result_code, error, source, server, duration_seconds}` – `status` is `succeeded`, `partial` (result code 3, searched with errors) or `failed` (e.g. WSUS not reachable: `0x8024401C`), `source` is `wsus` (with the WSUS URL as `server`) or `windows_update`.
3. Receives pending patches via `GET /api/v1/patches/pending/{node_id}`
4. Reports installation results via `POST /api/v1/patches/results`

What the server does with a scan report:

| Status | Available updates (Patch Explorer) | Catalog entries of the node |
|---|---|---|
| `succeeded` | replaced by the report | entries still waiting (`detected`, `approved`) that are no longer offered become `not_required` – installed (by Octofleet, WSUS, Windows Update, Defender), superseded or declined; the update history then marks the installed ones `installed`. Offered entries that were `installed` or `not_required` wait again (`detected`). Entries of Octofleet's own deployments stay |
| `partial` | replaced | unchanged |
| `failed` | **kept** – the last successful search stays visible | unchanged |
| no `scan` block (older agents, catalog import) | replaced | unchanged |

The last search per node (time, status, source, error, number of updates) is shown at the top of the node's Updates tab and returned by `GET /api/v1/patches/scan-status/{node_id}`. On Windows nodes the tab lists the **Available updates** of the last successful search below it (`GET /api/v1/patches/available/{node_id}`), with **Search for updates** (`patch_scan`) and **Install updates** / **Install selected (n)** (`patch_install` with `kb_ids`, after a confirmation). The confirmation sets `reboot_policy` for updates that need a reboot: `no_reboot`, `schedule` with `reboot_schedule_time` (ISO 8601 with offset; at least one minute ahead) or `force` (in one minute). Afterwards the agent searches again and sends a fresh inventory, so the available and installed updates are current. The tab's number is the pending updates on both systems. The tab itself turns amber while updates are pending and red when the last search failed. Linux nodes count their package list. Windows nodes count the available updates without Microsoft Defender signature updates (KB2267602): Defender gets several of those a day and installs them itself. The last search's line counts the same way and shows Defender signature updates separately ("Pending updates: 0 + 1 Defender signatures").

### Linux Nodes

The Linux agent reports the available package updates with every inventory push (apt, dnf, yum, pacman), from the package lists already on the machine. Each update has the package name (on dnf/yum `name.arch`), the new version, the repository and a security flag: on apt from the security repository (`*-security`, e.g. `noble-security`, `trixie-security`), on dnf/yum from the distribution's security advisories (`dnf updateinfo list --security`), there also with the severity (Critical, Important, Moderate, Low). Distributions without security advisories in their repositories (e.g. CentOS Stream) list the updates without flags. pacman has no security data: with `arch-audit` installed on the node, updates of packages with a fixed Arch advisory (`arch-audit --upgradable --quiet`) are flagged and the inventory names `securitySource: "arch-audit"` – approximate on derivatives such as CachyOS, which build their own packages; without it there are no flags, the Updates tab says so, and security-only rules match nothing there. Each update also has the architecture and the installed version (apt: from the `apt list --upgradable` line; dnf/yum: one `rpm -q` for all packages, the highest of several installed kernels; pacman: from `pacman -Qu`, repository and architecture from one `pacman -Si`), and on dnf/yum the package name without `.arch` (`package`). The update list carries the distribution release from `/etc/os-release` (`release`: `id`, `versionId`, `idLike`, `name`).

**Package versions and first seen ([#271](https://github.com/BenediktSchackenberg/octofleet/issues/271)).** The server stores each reported update as a package version, keyed by distribution release, package name, architecture, version and repository (`linux_package_versions`), with the time Octofleet **first saw** it on any node. That time is set once and is the same for every node; Linux approval rules will count their minimum age from it. The release key is the full release `id:versionId` (`ubuntu:24.04`, `debian:13`, `rocky:9.8`), and only `id` on rolling releases without a version (`cachyos`). A point release counts as a release of its own: its first-seen times start with the first node on it. An apt version listed in several suites is keyed by its security suite if it has one, else by the first suite, so a suite added later does not make it a new version. The security flag only turns on and a severity is only added, so a node whose advisory search failed does not clear them. Each node's pending updates are kept as rows per package version (`linux_node_updates`, with the installed version and the name the agent installs it by). A push whose update list did not change costs one indexed read; a changed list is two statements. Agents that do not report the release (older versions) get no rows, so nothing can be approved for them from stale data; they get them with their first inventory after the agent update.

**Phased updates (apt).** Ubuntu releases some updates to a share of machines at a time and apt holds them back on the others ("deferred due to phasing"). The agent finds them with a dry run (`apt-get -s upgrade`, reads the local package lists, no download or lock, about 0.6 s) and marks them in the update list: `phased: true` and `phasedPercent` (the share already getting it, from `apt-cache policy`, or null), plus `phasedUpdates` in the totals – they stay in `totalUpdates`. The Updates tab shows them with a *Phased (10 %)* badge and a note, does not count them as pending (tab badge and *Install updates*), and leaves them out of *Select all* and the selection – installing one does nothing until the node's turn comes, and the next installation after that includes it. *Patches → Fleet updates* does not count them either (`pending` and `security` without them, `phased` per node, shown as *1 phased (not counted)*). The **Linux approval rules** leave them out too: the server stores per node whether apt holds an update back, so a phased update is neither approved nor waiting, is not in a bulk installation, and shows as `phased` in `GET /api/v1/patches/linux-approved/{node_uuid}` – until the node reports it as installable.

The node's Updates tab has two buttons (with the `jobs:create` permission):

- **Search for updates** – a `patch_scan` job. The agent refreshes the package lists (`apt-get update`, `dnf makecache`, `yum makecache`, or on pacman `checkupdates`) and sends the inventory with the update list and the search's result. The result appears as the node's last update search, like on Windows:
  - `succeeded`;
  - `partial`: single repositories failed, shown as `Err:` / `W: Failed to fetch` lines;
  - `failed`, with the error. The job fails as well.

  pacman: `checkupdates` from **pacman-contrib** refreshes a copy of the sync databases (`/opt/octofleet-agent/pacman-sync`, setting `PACMAN_CHECK_DB`) and leaves the live ones alone – `pacman -Sy` without the upgrade would leave a partially upgraded system. The inventory then reads the pending updates from that copy (`pacman -Qu` / `-Si --dbpath`); without it (no search yet) from the live databases, which only change with `pacman -Syu`. Without pacman-contrib the search fails with *install pacman-contrib on the node: sudo pacman -S pacman-contrib*.
- **Install updates** / **Install selected (n)** – a `patch_install` job, after a confirmation. Without a selection the UI sends `{"all": true}` to install all available updates; with packages ticked in the list, it sends `{"packages": [...]}` to install only those (the package manager may also upgrade packages they depend on). Jobs without an explicit target are rejected:
  - apt: `apt-get --with-new-pkgs upgrade`, non-interactive, keeping changed configuration files;
  - dnf / yum: `upgrade`;
  - pacman: `pacman -Syu --noconfirm`, always the whole system – Arch supports no partial upgrades, so the Updates tab of pacman nodes has no package checkboxes and a job with `packages` is rejected. A conflict or a question pacman cannot answer with its default fails the job with pacman's message. Afterwards a reboot is required when the running kernel's modules are gone (`/usr/lib/modules/$(uname -r)`, replaced by a kernel update); the reboot estimate before the installation counts `linux`, `linux-lts`, `linux-zen`, `linux-cachyos`… as kernel packages.

  The selection is sent as `{"packages": ["openssl", ...]}` in the job's payload (also through the API); the agent then upgrades only those packages: `apt-get install --only-upgrade` or `dnf upgrade <packages>`. A package can also be `{"name": ..., "version": ...}` with the version from the update list: then exactly that version is installed (`apt-get install --only-upgrade name=version`, `dnf upgrade name-[epoch:]version-release.arch`), never a newer one that appeared since; if the repository no longer has it, the job fails. Names and versions with characters other than letters, digits and `+ . _ : ~ @ -` are rejected. The job's output ends with the package manager's last lines and `Reboot required: yes/no`. Afterwards the agent searches for updates again and sends the inventory with that search, so the list and the last update search are current.

  The output then says what the installation really changed, from the pending updates before it and after that search (apt: `apt list --upgradable`; dnf/yum: `check-update`, a name without `.arch` stands for all its architectures):
  - `Installed updates: N of M (names)` – of the updates asked for (all, or the selected ones) that were pending;
  - `Not installed: K (names)` for the ones still pending, with apt's reason when it gives one: *held back by apt: phased updates* (Ubuntu rolls some updates out to a share of machines at a time, and `apt-get upgrade` exits 0 without them) or *kept back by apt*;
  - `Installed updates: 0 of 0 (none of them was pending)` when none of the packages had an update.

  The job still succeeds when the package manager exits 0. The Updates tab's message follows the count: *n updates installed*, *n of m updates installed* or *No update installed – m still pending* (a warning, with the packages left and the reason), *None of these updates was pending*; the reboot and update-search lines are shown one per line. Older agents send no count; the tab then shows *Updates installed* as before.

Time limits: the payload's `timeout`, else the job's `timeoutSeconds`, else 10 minutes for the search and 60 minutes for the installation. The buttons use 15 and 60 minutes. Under systemd the package manager runs in a transient unit (`systemd-run --wait`, its output through a temporary file under `/var/log`), because the agent service itself runs with `ProtectSystem=strict` and cannot write `/usr`, `/etc` or `/var/lib` – dnf cannot even list updates without writing its lock file. The commands run with `LC_ALL=C`, since the agent reads their output. It runs with `NEEDRESTART_MODE=l`, so needrestart only lists services that use old libraries and does not restart them. The apt commands run with `-o DPkg::Lock::Timeout=120`, so they wait up to 2 minutes when another apt process (e.g. unattended-upgrades) holds the lock.

Before the installation the confirmation says whether a reboot is needed: Windows reports it per update in the search (`reboot_behavior`: never / always / can, from `InstallationBehavior.RebootBehavior`, shown as *Needs a reboot* / *May need a reboot*) and whether a reboot is already pending (`reboot_pending`, `Microsoft.Update.SystemInfo`); on Linux the server estimates it per package from the name (the kernel itself – `linux-image-*`, `linux-modules-*`, `kernel`, `kernel-core`, `kernel-modules*`, Ubuntu's `linux-generic`/`linux-virtual` metapackages, Arch's `linux`, `linux-lts`, `linux-cachyos`…: needed; headers, tools and `linux-libc-dev` not; libc, systemd, dbus, OpenSSL: may be) plus the inventory's `rebootRequired`. That one estimate (`reboot_behavior` per update in `GET /api/v1/inventory/linux/{node_id}`) is shown as *Needs a reboot* / *May need a reboot* next to each update in the node's list – like Windows updates –, in the install confirmation and, per node, in the fleet view (its tooltip names the updates behind it). The reboot choice is offered only when a reboot is needed, possible or already pending; otherwise the dialog says *These updates do not need a reboot*. A reboot happens only when an installed update needs one and the job asks for it: the install confirmation (Windows and Linux) offers *no reboot* (default), *reboot at* a set time, or *reboot in one minute* (`reboot_policy` `no_reboot` / `schedule` with `reboot_schedule_time` / `force`). On Linux a transient systemd timer runs `systemctl reboot` after the job has reported its result and the update search (without systemd: `shutdown -r`); a time in the past means one minute. On Windows the agent calls `shutdown /r /t <seconds>`. "One minute" means one minute after the installation (and its update search), not after the click; "at" a time that has passed when the installation ends means one minute after it. A Windows installation that takes longer than the job's limit (30 minutes) is never stopped – stopping TrustedInstaller/TiWorker can corrupt the component store: the job reports it as still running, with the servicing processes and their runtime, and the installation, reboot and update search finish in the background.

**Installation result on Windows.** The job's output lists `installed` and `failed` KBs and, per KB, `details` with the Windows Update result code, the HRESULT (`0x…`), its `source` and a `hint` for known codes. After the installation the agent compares the result with the Windows Update history: the installer can report a KB as installed while the history records it as failed. Example: a cumulative update for which Windows first installs a newer servicing stack (`0x800F0823`, CBS_E_NEW_SERVICING_STACK_REQUIRED). The servicing stack needs a restart, and the cumulative update is offered again afterwards and has to be installed a second time. Such a KB counts as failed (`source: history`), the job fails with the code and the hint, and the reboot policy still applies, since the servicing stack needs the restart. See [Troubleshooting](TROUBLESHOOTING.md#windows-update-installation-failed-or-the-update-is-offered-again-after-the-restart) for what to do and how to check an installation on the node.

**Where installations show up.** The agent installs through the Windows Update API (`Microsoft.Update.Session`), like other management tools. Such installations appear in the API's update history (the node's *Update history* in Octofleet), in `Get-HotFix` / *Installed Updates* and in `dism /online /get-packages`, but **not** in *Settings → Windows Update → Update history*, which only lists what Windows' own update client installed. The history keeps the newest entry per update and result: an update installed a second time (as above) has a failed and a successful entry, and the installed updates show the newest; repeated successful installations of the same update (Store apps update almost daily) stay one entry.

**Windows restarts by its own policy, too.** *No reboot* only means that Octofleet does not restart the node. After an installation Windows has a pending restart, and the Windows Update policy decides whether Windows restarts by itself – e.g. with automatic installation and a scheduled restart (`AUOptions` 4 under `HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU`), outside the active hours or after a deadline (Windows 10/11 and newer servers). With *notify to restart* (`AUOptions` 7, the usual server setting) it waits for an administrator. Check the policy of your nodes before choosing *no reboot* on Windows; the dialog says so as well. Linux nodes are not restarted by anything else (unattended-upgrades only with `Automatic-Reboot "true"`).

The inventory reports `rebootRequired`:
- Debian/Ubuntu: `/var/run/reboot-required`, with the packages from `reboot-required.pkgs`;
- dnf/yum: `needs-restarting -r` (yum-utils) or, on minimal installs without it, `dnf needs-restarting -r` (dnf-plugins-core); without either, the value stays unknown.

The Updates tab then shows **Reboot required** (Windows: when the last update search reports a pending reboot), with a **Reboot** button next to it – see [Rebooting nodes](#rebooting-nodes).

### Linux Approval Rules

Linux nodes have hundreds of packages and new versions several times a week, so they are not approved per version like Windows updates in the catalog, but by **rules** (**Patches → Linux approval rules**, `/patches/linux-rules`; `packages:read` to see them, `packages:write` to change them; API below). A rule:

- **approves** or **excludes** package versions;
- applies to **all Linux nodes**, or to the nodes of chosen **deployment rings** (*Patch Rings* above: a ring's group, a ring without a group = all nodes), optionally narrowed to one **group**, and optionally to distribution **releases** (`ubuntu:24.04`, `rocky:*` – the release key from the agent, see *Linux Nodes*);
- matches **security updates only** (with a **minimum severity** where the distribution has one – dnf/yum; apt security updates have no severity and are matched by the flag alone), and/or **package** and **repository** patterns with `*` and `?` (`linux-image-*`, `*-security`, `baseos`);
- has a **minimum age** in hours (approval rules): a version is approved once Octofleet **first saw** it at least that long ago, **plus the delay of the node's ring** (the smallest of the rule's rings the node is in). **Expedite** skips the ring delay, e.g. for an urgent OpenSSL fix.

A version is approved for a node when an enabled approval rule covers the node and matches the version, and **no enabled exclusion rule for the node matches it – an exclusion wins**, also over another rule's approval. **Nothing is approved without a rule.** A **phased** update (apt holds it back on the node, see *Phased updates* above) is not evaluated until the node reports it as installable. A fresh installation has one example rule, *Security updates (example)*, which is **disabled** and approves nothing until it is enabled.

**Staged rollout with rings**, like update rings elsewhere: a *Pilot* ring (group of test nodes, delay 0 h) and a *Broad* ring (no group, delay 168 h) and one rule *all updates, rings Pilot + Broad, minimum age 24 h*: the pilot nodes get a version a day after it appeared, all others a week later. **Pausing a ring** (`POST /patches/rings/{id}/pause`, `…/resume`) stops all approvals through it – nodes in another of the rule's rings still get theirs from that ring; exclusions keep applying. Ring changes affect only Linux rules here; Windows catalog approvals and deployments are unchanged.

A deleted ring or group never widens an approval: an approval rule no longer covers those nodes, while an exclusion rule then covers all Linux nodes, until the rule is edited.

**CentOS Stream and other distributions without security advisories:** their repositories carry no security data (`dnf updateinfo` lists nothing), so a security-only rule matches nothing on them. The fleet list (`linux.security_data`), the rules list (`releases`) and the preview (`nodes_without_security_data`) say so; use a rule for all updates or by repository there. pacman (Arch, CachyOS) has no security data either, and bulk installation is not supported there yet.

**Bulk installation** (*Fleet Updates* below, `POST /patches/fleet/install`): for each Linux node the server recomputes the approved versions when it creates the job – it never uses a list from the browser – and sends them with their exact version (`{"packages": [{"name", "version"}]}`), so a newer, not yet approved version is not installed. If the repository no longer has an approved version, the job fails and the next search lists the newer one. The package manager may still upgrade packages the approved ones depend on. Skipped nodes: `not_approved`, `agent_too_old` (the agent does not report its release yet; update it), `unsupported` (pacman). The node page's own buttons (`jobs:create`) stay as they are and install any update.

**Speed.** The rules are evaluated in SQL, set-based: rules against the distinct pending versions, then joined with the nodes' pending updates and the rule scopes. One node takes a few milliseconds (node page `GET /patches/linux-approved/{node}`, the recheck of a bulk installation: about 0.6 s for 500 nodes at 150 updates each). For the fleet list the result is kept per node (approval state per pending update, counts, and when the next version becomes old enough): a background worker re-evaluates the nodes whose update list changed, and all Linux nodes after a rule or a used ring changes, or those whose membership in a used group changed; counts whose next approval time has passed are recounted from the stored rows. With 10,000 nodes x 150 updates and 20 rules the fleet list reads them in about 20 ms; re-evaluating all nodes after a rule change takes about 16 s in the background, during which the rows say *updating* (`linux.evaluating`).

**The page** (*Patches → Linux approval rules*) lists the rules with what they cover and match, enables and disables them with a click, and shows what the enabled rules approve now over all Linux nodes (approved, waiting for their minimum age, excluded, nodes with approved updates). The editor (*New rule* / *Edit*) has the scope (rings with their group and delay, group, releases), the updates (security only with a minimum severity, package and repository patterns), the minimum age in days or hours, *expedite* and *enabled*; a **preview** shows, while typing, how many nodes the rule covers and how many pending versions it would approve now, leave waiting, or exclude – and how many of its nodes have no security data. Invalid patterns are reported there by the server. Below, the deployment rings with their nodes and delay can be **paused and resumed** (rings are created on *Patches → Rings*), and the releases the agents report are listed with their package manager, marked when they have no security data (e.g. CentOS Stream, pacman). The disabled example rule is pointed out until it is enabled or deleted.

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

**At 10,000 nodes** the list takes about 1 s per request, independent of how much job history is kept: each node's newest search, installation and reboot is one index lookup (`job_instances.run_kind`), and the inventory push stores the part of a Linux node's update list the list uses (totals, phased updates, packages that may need a reboot), so a request does not read every node's whole package list.

**Several nodes at once** (`packages:deploy`): tick nodes (the header box ticks the nodes shown; the selection stays when the filters change), then
- **Search for updates (n)** – one `patch_scan` job per node, like the node page's button;
- **Install updates…** – Windows nodes install their pending updates that are **approved in the catalog** (*Patches → Catalog*, not excluded); the list shows *n approved* per Windows node. Linux nodes install the versions their **Linux approval rules** approve (*Linux Approval Rules* above), each with its exact version; the list shows *n approved · m waiting* for them (*updating…* for a moment after a rule changed). Skipped in the dialog, with a link to the node page: Linux agents that do not report their release yet (*agent too old for approval rules*) and package managers without bulk installation (pacman). Linux nodes without approved updates link to the rules. A confirmation lists each node with its number of approved updates and reboot outlook; Windows nodes without approved updates link to the catalog and are skipped. Defender signature updates are left out unless *Include Defender signature updates* is ticked (Defender usually updates itself). The reboot choice is the node page's (no reboot / at a day and time / one minute after the installation), offered when one of the nodes can need a reboot or has one pending, and applies to every node; on Windows the agent reboots only if an installed update needs it, on Linux only if `/var/run/reboot-required` exists afterwards.

The server builds each node's job from what it stores – the KB IDs of the node's last search that are approved in the catalog – with the node page's time limit (30 minutes). Staged installations (a pilot ring first) are planned with the existing deployment rings. The rows show *Searching…* / *Installing…* until the agent answers; a failed search or installation shows as a red badge linking to the job.

**An installation is finished when the node reports after its restart.** Windows lists a cumulative update until the restart, so the list would offer it again. While the newest installation has not finished, the row says so and the node is skipped by *Install updates* (and by *Search for updates* while it restarts):
- *Installing…* – the job runs;
- *Restarting to finish the installation* – a reboot was required and ordered (one minute after, or at a time); until the node searches for updates after its restart (the agent does after starting), at most two hours after the restart time;
- *Installed – restart pending* – a reboot was required but not ordered, and the node still reports a pending reboot.

*Install again on nodes whose last installation has not finished* overrides the last two, never a running job. The API reports this as `installation` (`state`, `job_id`, `restart_at`); `POST …/fleet/install` skips such nodes (`busy`, `restarting`, `awaiting_restart`) unless `retry: true`.

### Rebooting nodes

A node that waits for a reboot can be restarted from the console, Windows and Linux alike: **Reboot** next to *Reboot required* on the node's Updates tab, in the node's header (always), and in **Patches → Fleet updates** – per row for nodes whose reboot is pending or needed, and for the ticked nodes (*Reboot: n*). It needs the `nodes:reboot` permission (built-in roles `operator` and `admin`).

The dialog names each node and shows what a reboot interrupts, so nobody restarts the wrong machine by accident:
- **logged-on users** – both agents report them with their live data (Windows: console and Remote Desktop sessions, also disconnected ones; Linux: logind sessions, else `who`); *unknown* for agents that do not send them yet or have not reported in the last two minutes;
- **jobs that have not finished** on the node (with links);
- **open terminal, screen and shell sessions** from the console;
- a reboot that is **already scheduled** (the new one replaces it).

It offers **now** (in about a minute, so the agent can report the job first), **in** 5–120 minutes or **at** a day and time (at most 7 days ahead), and an optional **message** for logged-on users (one line, at most 200 characters). Any of the warnings above must be acknowledged with a checkbox; several nodes are confirmed by typing their number.

The server creates one `reboot` job per node and writes `node.reboot` to the audit log (who, node, time, message). The agents restart with the system's own tool, so the restart does not depend on the agent and users are warned: Windows `shutdown /r /t <seconds> /d p:0:0 /c <message>` (a reboot that is already scheduled – e.g. after an update installation – is replaced), Linux `shutdown -r +<minutes> <message>` through a transient systemd unit (logind warns logged-on users and blocks new logins in the last minutes). The job's output names the logged-on users and the reboot time. **Cancel reboot** (shown while a reboot is scheduled) sends a cancel job: `shutdown /a` on Windows; `shutdown -c` on Linux, which also stops reboot timers an update installation scheduled. Linux systems without a D-Bus system bus (minimal images without the `dbus` package) have no way to reach logind, so `shutdown -r` fails there: the agent schedules a transient systemd timer that runs `systemctl reboot` at the same time instead, and says in the job output that logged-on users are not warned; cancel stops that timer.

**"Reboot required" disappears only when the node reports after the reboot**, never when the button is pressed: Windows searches for updates after every agent start, Linux pushes its update list right after the start. Until then the node shows *Reboot requested* (the agent has not taken the job yet) or *Reboot at <time>*; after two hours past the reboot time a node that has not reported shows as offline instead. A reboot the agent could not schedule shows *Reboot failed* (with the job's output) until the node reports again. An open node page notices the report by itself – also after an installation that rebooted the node – and reloads the update data, so *Reboot required* disappears without reloading the page (within about 30 s, with the reboot state it checks anyway); the node's *Last boot* (System info) shows the new boot time.

---

## API Reference

### Permissions

| What | Permission |
|---|---|
| Read the catalog, rings, deployments, the Patch Explorer and the fleet updates | `packages:read` |
| Compliance views | `compliance:read` |
| Create, import, approve or exclude patches; manage rings | `packages:write` |
| Start, pause, resume or cancel deployments; Patch Explorer deploy, scan and verify; search and install on several nodes from the fleet updates | `packages:deploy` |
| Reboot nodes or cancel a scheduled reboot (node page, fleet updates; `POST /api/v1/nodes/reboot`, `/reboot/preview`) | `nodes:reboot` |
| Agent routes (`scan-results`, `pending/{node_id}`, `results`, `explorer/agent-updates`) | agent key |

The built-in `viewer` role can read; `operator` and `admin` can also change, deploy and reboot. The shared agent key cannot use the user routes. Custom roles get `nodes:reboot` only when an administrator adds it.

### Catalog

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/catalog` | List patches (with search, pagination; `node`: only patches still open on that node); each with `nodes`: `required`, `installed`, `failed`, `not_required` |
| POST | `/api/v1/patches/catalog` | Create patch manually |
| POST | `/api/v1/patches/catalog/import` | Import patches from agent scan |
| GET | `/api/v1/patches/catalog/{patch_id}` | Get patch details with affected nodes |
| PATCH | `/api/v1/patches/catalog/{patch_id}/approve` | Approve patch for deployment |
| PATCH | `/api/v1/patches/catalog/{patch_id}/exclude` | Exclude patch from deployment |

### Compliance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/compliance` | Fleet-wide patch compliance summary (`node_id`: only that node). Updates: `total_patches`, `approved`, `excluded`, `required_patches`, `awaiting_approval`; node entries: `pending` (still needed), `installed`, `failed`, `not_required`, `compliance_percent`, `mttp_hours` |
| GET | `/api/v1/patches/compliance/nodes` | Per-node compliance breakdown |
| GET | `/api/v1/patches/scan-status/{node_id}` | The node's last Windows Update search: time, status, source (WSUS/Windows Update), error, update count |

### Rings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/rings` | List patch rings |
| POST | `/api/v1/patches/rings` | Create ring |
| PUT | `/api/v1/patches/rings/{ring_id}` | Update ring |
| DELETE | `/api/v1/patches/rings/{ring_id}` | Delete ring |
| POST | `/api/v1/patches/rings/{ring_id}/pause` | Pause the ring for Linux approval rules (`paused`) |
| POST | `/api/v1/patches/rings/{ring_id}/resume` | Resume it |

### Linux Approval Rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/patches/linux-rules` | Rules, `totals` (approved / waiting / excluded / evaluating), `releases` with `security_data` |
| POST | `/api/v1/patches/linux-rules` | Create a rule |
| PUT | `/api/v1/patches/linux-rules/{rule_id}` | Change a rule (left-out fields keep their value) |
| DELETE | `/api/v1/patches/linux-rules/{rule_id}` | Delete a rule |
| POST | `/api/v1/patches/linux-rules/preview` | What an unsaved rule covers on its own: `nodes`, `approved`, `waiting`, `excluded`, `nodes_without_security_data` |
| GET | `/api/v1/patches/linux-approved/{node_uuid}` | The node's pending Linux updates with `state` (approved / waiting / excluded / not_approved), `approved_at`, `rules` |

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
