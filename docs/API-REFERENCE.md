# API Reference

Octofleet exposes a comprehensive REST API (450+ endpoints) built with FastAPI. Interactive documentation is available at:

- **Swagger UI:** http://localhost:8080/docs
- **ReDoc:** http://localhost:8080/redoc
- **OpenAPI JSON:** http://localhost:8080/openapi.json

## Authentication

Most endpoints require authentication via one of two methods:

| Method | Header | Usage |
|--------|--------|-------|
| **API Key** | `X-API-Key: <key>` | Agent-to-backend communication, scripts |
| **JWT Bearer** | `Authorization: Bearer <token>` | Frontend/user sessions |

To obtain a JWT token, use the login endpoint. API keys are configured via environment variables or the API Keys management endpoints.

> The shared agent key (`API_KEY` / `INVENTORY_API_KEY`) is for agents. Protected fleet and vulnerability reads, settings, user and role management, API key management, and job creation require a user account. Use a login token or a personal API key with the required permission. The shared agent key gets `403 This action requires a user account` on these routes.
>
> Read routes check a permission too (`User: …`); the routes the agents read from (`Agent: jobs:poll`, `Agent: terminal:pending`) accept the shared agent key. Streams (`?token=`) take the session token as query parameter. Only the own account (`/auth/me`, `/auth/permissions`, `/auth/password-rules`) needs no permission.
>
> Write routes always check a permission. Routes the agents report to (`Agent: inventory:write`, `Agent: jobs:poll`) accept the shared agent key and users or personal API keys with that permission; all other write routes need a user account with the listed permission (`User: …`).

---

## Core Endpoints

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Basic health check |
| GET | `/api/v1/health` | No | API health check |
| GET | `/api/v1/dashboard/summary` | User: `nodes:read` | Fleet dashboard summary; the vulnerability counts come from the vulnerability cache (`vulnerabilities.as_of`, `vulnerabilities.pending_nodes`, `vulnerabilities.scan_completed_at`) |

### Auth & Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/login` | No | Login, returns JWT tokens |
| GET | `/api/v1/auth/me` | JWT | Get current user info |
| POST | `/api/v1/auth/setup` | No | Initial admin setup (first run only) |
| POST | `/api/v1/auth/me/password` | JWT | Change your own password (`current_password`, `new_password`); signs out all sessions |
| GET | `/api/v1/auth/password-rules` | JWT | The password rules for every signed-in user, also during a required password change: `min_length`, `max_bytes` (72), `require_uppercase`, `require_lowercase`, `require_digit`, `require_symbol`, `history_count` |
| GET, PUT | `/api/v1/security/password-policy` | JWT (`settings:write`) | Read or change the password policy |
| GET | `/api/v1/users` | JWT | List all users |
| POST | `/api/v1/users` | JWT | Create user |
| PUT | `/api/v1/users/{user_id}` | JWT | Update user |
| POST | `/api/v1/users/{user_id}/password` | JWT (`users:write`) | Reset a user's password (`new_password`, `must_change_password`); revokes the user's sessions |
| DELETE | `/api/v1/users/{user_id}` | JWT | Delete user |
| POST | `/api/v1/users/{user_id}/roles/{role_name}` | API Key | Assign role to user |
| DELETE | `/api/v1/users/{user_id}/roles/{role_name}` | API Key | Remove role from user |
| GET | `/api/v1/roles` | API Key | List roles |
| POST | `/api/v1/roles` | API Key | Create role |
| DELETE | `/api/v1/roles/{role_id}` | API Key | Delete role |
| GET | `/api/v1/api-keys` | API Key | List API keys |
| POST | `/api/v1/api-keys` | API Key | Create API key |
| DELETE | `/api/v1/api-keys/{key_id}` | API Key | Soft-delete API key |
| DELETE | `/api/v1/api-keys/{key_id}/permanent` | API Key | Permanently delete API key |

### Nodes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/nodes` | API Key | List all nodes (`unassigned=true`: without a group; `group_id`: of one group), ordered by hostname (case-insensitive), then node ID; each with `health_status` and `alert_count` from its fired critical/warning alerts, and `status` by last contact: `online` (within 5 minutes), `away` (within an hour), `offline` – the rule of the dashboard's node counts |
| GET | `/api/v1/nodes/tree` | API Key | Node tree view (hierarchical); `?view=summary`: counts per group → OS family → release with the node IDs per release, as used by Fleet → Nodes |
| GET | `/api/v1/nodes/search` | API Key | Search nodes |
| GET | `/api/v1/nodes/os-distribution` | API Key | OS distribution summary |
| GET | `/api/v1/nodes/{node_id}` | API Key | Get node details |
| GET | `/api/v1/nodes/{node_id}/history` | API Key | Node inventory history |
| POST | `/api/v1/nodes/reboot/preview` | User: `nodes:reboot` | `{"node_ids": [UUID, ...]}` (up to 500): per node `hostname`, `os_family`, `online`, `logged_on_users` (`user`, `session`, `since`; `null` when the agent does not report them), `running_jobs` / `running_job_count` (jobs not finished), `sessions` (`terminal`, `screen`, `shell`: open console sessions), `reboot` (a scheduled reboot) and `blocker` (`removal`, `unsupported_os`: no job would be created); `found: false` for unknown IDs |
| POST | `/api/v1/nodes/reboot` | User: `nodes:reboot` | `{"node_ids": [...], "when": "now" \| "in" \| "at", "minutes": 1-10080 (for `in`), "at": ISO 8601 with offset (for `at`, 1 minute to 7 days ahead), "message": text (one line, up to 200 characters)}`: one `reboot` job per node (payload `action`, `at` in UTC, `message`), audited as `node.reboot`; "now" means in one minute. `{"node_ids": [...], "action": "cancel"}` withdraws a scheduled reboot (`node.reboot_cancel`; nodes without one are skipped as `no_reboot_scheduled`). Returns `jobs` (`node`, `hostname`, `job_id`) and `skipped` (`node`, `reason`) |
| GET | `/api/v1/nodes/{node_id}/reboot` | User: `nodes:read` | The newest reboot until the node has reported after it: `reboot` = `{state: scheduled \| restarting \| failed, job_id, restart_at, error}` or `null`; `reported_at`, the node's last update report (Windows update search or Linux update list), and `last_boot_time` as in `GET /inventory/system` – the node page polls this route every 30 s and reloads its update data when either changes |
| POST | `/api/v1/nodes/register` | No | Agent self-registration: returns `pendingId` and a one-time `registrationSecret` (only the hash is stored). A second registration of the same machine while the first one waits gets no secret |
| GET | `/api/v1/pending-nodes/{pending_id}/config` | Registration secret (`X-Registration-Secret`) | Polled by the registered agent: `pending`, `rejected`, or once after approval `approved` with the configuration (`InventoryApiUrl` = the configured API server URL, else the request's host; the agent key). The secret is invalid afterwards; 403 without or with a wrong secret, also for registrations of older agents without secret |
| POST | `/api/v1/enroll` | No | Enroll node with token |
| GET | `/api/v1/pending-nodes` | User: `nodes:read` | List pending registrations |
| POST | `/api/v1/pending-nodes/{pending_id}/approve` | API Key | Approve pending node |
| DELETE | `/api/v1/pending-nodes/{pending_id}/reject` | API Key | Reject pending node |

### Enrollment Tokens

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/enrollment-tokens` | User: `settings:write` | Create enrollment token |
| GET | `/api/v1/enrollment-tokens` | User: `settings:read` | List enrollment tokens |
| DELETE | `/api/v1/enrollment-tokens/{token_id}` | User: `settings:write` | Delete enrollment token |

### Inventory

Agents push inventory data; the frontend reads it.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/inventory/hardware/{node_id}` | — | Hardware inventory for node |
| GET | `/api/v1/inventory/software/{node_id}` | — | Installed software |
| GET | `/api/v1/inventory/hotfixes/{node_id}` | — | Installed Windows updates (`hotfixes`, from `Win32_QuickFixEngineering`) and the Windows Update history (`updateHistory`: up to 2000 entries, of the Defender signature updates only the newest) |
| GET | `/api/v1/inventory/system/{node_id}` | — | System info (OS, hostname, etc.); `lastBootTime` without offset – the node's local time from Windows agents, UTC from Linux agents – with `uptimeHours` and `uptimeFormatted` as of the last inventory |
| GET | `/api/v1/inventory/security/{node_id}` | — | Security status (firewall, AV, TPM, BitLocker, UAC, local admins; `appControl`, `appLocker`, `vbs` – see below) |
| GET | `/api/v1/inventory/network/{node_id}` | — | Network interfaces & connections |
| GET | `/api/v1/inventory/linux/{node_id}` | — | Linux-specific inventory |
| GET | `/api/v1/inventory/browser/{node_id}` | — | Browser extensions |
| GET | `/api/v1/inventory/browser/{node_id}/cookies` | — | Browser cookies |
| GET | `/api/v1/inventory/browser/{node_id}/critical` | User: `inventory:read` | Critical browser findings |
| GET | `/api/v1/hardware/fleet` | User: `hardware:read` | Fleet-wide hardware summary |
| POST | `/api/v1/inventory/hardware` | API Key | Push hardware inventory (agent) |
| POST | `/api/v1/inventory/software` | API Key | Push software inventory |
| POST | `/api/v1/inventory/hotfixes` | API Key | Push hotfixes |
| POST | `/api/v1/inventory/system` | API Key | Push system info |
| POST | `/api/v1/inventory/security` | API Key | Push security status |
| POST | `/api/v1/inventory/network` | API Key | Push network data |
| POST | `/api/v1/inventory/browser` | API Key | Push browser data |
| POST | `/api/v1/inventory/full` | API Key | Push full inventory (all categories) |

The Windows agent's security section also sends `deviceGuard` (`Win32_DeviceGuard`), `appControl` (active App Control policies, vulnerable driver blocklist) and `appLocker` (effective policy per rule collection, `AppIDSvc` status). The server stores them normalised, and `GET /api/v1/inventory/security/{node_id}` returns (each `null` for agents that do not report them yet):

- `appControl`: `kernelMode`, `userMode` (`enforced` / `audit` / `off` / `unknown`), `vulnerableDriverBlocklist` (`on` / `off` / `unknown`), `policySource` (`citool`, or `files` with policy IDs only), `policies` (`policyId`, `basePolicyId`, `name`, `version`, `systemPolicy`, `signed`, `enforced`, `supplemental`; `null` when unknown), `error`
- `appLocker`: `collections` (`exe`, `msi`, `script`, `dll`, `appx`, each with `state` `enforced` / `audit` / `off` / `unknown`, `mode`, `ruleCount`), `appIdSvc` (`running` / `stopped` / `unknown`), `error`
- `vbs`: `status` and `services.credentialGuard`, `services.hvci`, `services.systemGuard` (`running` / `notRunning` = configured but not running / `off` / `unknown`), `error`

See [Agent setup](AGENT-SETUP.md#what-the-windows-agent-reports-about-security) for the sources.

### Groups & Tags

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/groups` | API Key | List groups |
| GET | `/api/v1/groups/{group_id}` | API Key | Get group details |
| POST | `/api/v1/groups` | User: `groups:write` | Create group |
| PUT | `/api/v1/groups/{group_id}` | User: `groups:write` | Update group |
| DELETE | `/api/v1/groups/{group_id}` | User: `groups:write` | Delete group |
| POST | `/api/v1/groups/preview-rule` | User: `groups:write` | Preview dynamic group rule |
| POST | `/api/v1/groups/{group_id}/evaluate` | User: `groups:write` | Evaluate group membership |
| POST | `/api/v1/groups/{group_id}/members` | User: `groups:write` | Add members to group |
| DELETE | `/api/v1/groups/{group_id}/members` | User: `groups:write` | Remove members from group |
| GET | `/api/v1/tags` | — | List tags |
| POST | `/api/v1/tags` | User: `groups:write` | Create tag |
| DELETE | `/api/v1/tags/{tag_id}` | User: `groups:write` | Delete tag |
| POST | `/api/v1/devices/{node_id}/tags` | User: `groups:write` | Assign tags to node |
| DELETE | `/api/v1/devices/{node_id}/tags` | User: `groups:write` | Remove tags from node |
| GET | `/api/v1/devices/{node_id}/groups` | — | Get node's groups |
| GET | `/api/v1/devices/{node_id}/tags` | — | Get node's tags |

### Jobs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/jobs` | User: `jobs:create` | Create a job (`targetType`: `device`/`group` with `targetId` = node or group UUID, `tag` with `targetTag` = tag name, or `all`); optional `priority` (lower runs first, default 5), `scheduledAt` / `expiresAt` (ISO 8601; agents get the job only in between) and `timeoutSeconds` (default 300); 400 for anything else |
| GET | `/api/v1/jobs` | User: `jobs:read` | List jobs, newest first, with `total`; `node` (node ID, UUID or hostname) returns only the jobs that run on that node (targeted at it, at its group or at all nodes); `status` = `failed` (a failed instance; newest failure first, with `last_failed_at` and `last_error`), `running`, `pending`, `success` (all instances succeeded) or `cancelled`; `since_hours` = created within that many hours (with `status=failed`: failed within them); `command_type`; `q` (part of the name); `limit`/`offset`. Also returns `counts` (`total`, `running`, `success`, `failed` for the same filters except `status`) and `command_types` |
| GET | `/api/v1/jobs/failures` | User: `jobs:read` | Failed job runs of the last `since_hours` (default 168), one entry per node and job type (and job name for `run`, `script` and package jobs), newest failure first: `failures` (count), `first_failed_at`, `last_failed_at`, the last failed `job_id`/`job_name`, `reason` (error message, else error output, else the last output lines), `hostname`, `node_id`. An entry is `resolved` (with `last_success_at`) when a later run of the same kind succeeded on that node; resolved entries only with `include_resolved=true`. `total` (open) and `resolved` count all entries; `limit` (≤ 1000)/`offset` |
| GET | `/api/v1/jobs/{job_id}` | User: `jobs:read` | Get job details with its instances; `command_data` is the JSON object the job was created with |
| DELETE | `/api/v1/jobs/{job_id}` | API Key | Delete job |
| GET | `/api/v1/jobs/pending/{node_id}` | API Key | Get pending jobs for a node (agent poll; newer Linux agents run it when `GET /api/v1/agent/wait/{node_id}` says so) |
| POST | `/api/v1/jobs/instances/{instance_id}/start` | Agent: `jobs:poll` | Mark job instance as started |
| POST | `/api/v1/jobs/instances/{instance_id}/result` | Agent: `jobs:poll` | Submit job result (`success` or `status`, `exitCode`, `stdout`/`stderr` – stored up to 50,000 characters each –, optional `errorMessage`, `durationMs`; else the duration since the start). Logged in `job_logs`; a failure sends the `job_failed` alert rules; results of patch deployments update the deployment's results. Not retried automatically. 404 for an unknown instance |
| POST | `/api/v1/jobs/result` | Agent: `jobs:poll` | Submit job result (alt) |
| POST | `/api/v1/jobs/instances/{instance_id}/retry` | User: `jobs:execute` | Retry failed job instance |
| GET | `/api/v1/smart-install/packages` | JWT (`packages:read`) | List available smart-install packages |
| POST | `/api/v1/smart-install` | User: `jobs:create` | Install a Chocolatey package (`package`: alias from `/smart-install/packages` or package name; 400 for other characters than letters, digits and `. _ + -`) on Windows nodes (`targets`: node IDs, UUIDs or hostnames), installing Chocolatey first where missing; one `run` job per node, unknown nodes listed as errors in `results` |

### Packages & Deployments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/packages` | User: `packages:read` | List packages (`displayName`, `versionCount`, `latestVersion`, …); `category`, `search` (name, display name or vendor), `active_only` (default true) |
| POST | `/api/v1/packages` | User: `packages:write` | Create package |
| GET | `/api/v1/packages/{package_id}` | User: `packages:read` | Get package |
| PUT | `/api/v1/packages/{package_id}` | User: `packages:write` | Update package |
| DELETE | `/api/v1/packages/{package_id}` | User: `packages:write` | Delete package |
| POST | `/api/v1/packages/{package_id}/versions` | User: `packages:write` | Add version, including `downloadUrl` |
| GET | `/api/v1/packages/{package_id}/versions/{version_id}` | User: `packages:read` | Get version |
| PUT | `/api/v1/packages/{package_id}/versions/{version_id}` | User: `packages:write` | Update version, including `downloadUrl` |
| DELETE | `/api/v1/packages/{package_id}/versions/{version_id}` | User: `packages:write` | Delete version |
| POST | `/api/v1/deployments` | User: `deployments:write` | Create deployment; 400 unless `targetType` is `node`/`group` (with `targetId`) or `all` and `mode` is `required`/`available`/`uninstall`, 404 for an unknown package version |
| GET | `/api/v1/deployments` | User: `deployments:read` | List deployments |
| GET | `/api/v1/deployments/{deployment_id}` | User: `deployments:read` | Get deployment |
| PATCH | `/api/v1/deployments/{deployment_id}` | User: `deployments:write` | Update deployment |
| DELETE | `/api/v1/deployments/{deployment_id}` | User: `deployments:write` | Delete deployment |
| POST | `/api/v1/deployments/{deployment_id}/rollout` | User: `deployments:write` | Start rollout |
| GET | `/api/v1/deployments/{deployment_id}/rollout` | User: `deployments:read` | Get rollout status |
| POST | `/api/v1/deployments/{deployment_id}/rollout/advance` | User: `deployments:write` | Advance rollout stage |

### Vulnerabilities & Remediation

Vulnerability numbers are kept per node (the vulnerability cache), because computing them over
all findings takes seconds with a few nodes and hours with 100,000: `node_vulnerability_cache`
(one row per node, update and CVE), `node_vulnerability_counts` (one row per node) and
`vulnerability_fleet_summary` (fleet counts, top 10 CVEs and updates, last scan). A node is
recalculated when its software inventory changes (only if it really changed), when a scan changes
the vulnerability data of one of its packages, when one of its findings is marked as fixed, when
its OS, OS build or kernel changes, when the MSRC sync changes the fixes of its Windows release,
when another node's change decides whether its findings count, and with
`POST /api/v1/vulnerabilities/summary/refresh`. The backend recalculates waiting nodes in the
background; there is no timer. The fleet counts follow every node; the top lists are refreshed
when no node is waiting (at most once a minute while many are) and checked against the cache at
backend start, after each scan and with the refresh button.
`backend/check_vulnerability_cache.py` compares the cache with the live queries.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/vulnerabilities/summary` | API Key | Fleet vulnerability summary from the vulnerability cache (`cache.refreshed_at`: as of when; `cache.pending_nodes`: nodes waiting to be recalculated); the running and last finished scan are live |
| GET | `/api/v1/vulnerabilities/by-node?limit=100&offset=0` | API Key | Nodes with findings, most first, one page (`limit` 1–1000, `total`); `severity=critical` / `high`: only nodes with CVEs of that severity, most of them first |
| GET | `/api/v1/vulnerabilities/summary/status` | JWT (`vulnerabilities:read`) | Vulnerability cache: `refreshed_at`, `pending_nodes`, `refreshing`, `retry_after` (seconds until a manual refresh is allowed) |
| POST | `/api/v1/vulnerabilities/summary/refresh` | JWT (`settings:write`) | Recalculate every node in the background (202); at most once a minute, else 429 with `Retry-After` |
| GET | `/api/v1/vulnerabilities/by-software` | API Key | The 20 updates with the most CVEs, from the vulnerability cache, with the number of affected nodes (`affected_nodes`) |
| GET | `/api/v1/vulnerabilities/by-software/cves?unit=linux&unit_version=6.8.0-150.150` | JWT (`vulnerabilities:read`) | The CVEs of one update across the fleet, one entry per CVE (severity, CVSS, packages, fixed version, exploited) with the number of nodes it affects (`affected_nodes`); the nodes: `by-software/nodes` or the CVE lookup |
| GET | `/api/v1/vulnerabilities/by-software/nodes?unit=…&unit_version=…&limit=100&offset=0` | JWT (`vulnerabilities:read`) | The nodes one update's CVEs affect: `total` and one page by hostname (`limit` 1–1000), each with `node_id`, `hostname`, `os_name`, `os_version` and how many of the update's CVEs it has (`cves`) |
| GET | `/api/v1/vulnerabilities` | API Key | List all vulnerabilities |
| GET | `/api/v1/vulnerabilities/node/{node_id}?limit=100&offset=0&severity=high&q=openssl` | JWT (`vulnerabilities:read`) | CVEs of a node (id or hostname), one per CVE, exploited and most severe first. `count`: all CVEs of the node (old, not running kernels left out); `severity_counts`: the same by worst severity (`CRITICAL` … `UNKNOWN`); `severity` and `q` (CVE ID, update or package, any case) filter, `matching` counts what they leave, `limit` (1–1000)/`offset` return one page of it. `unit` + `unit_version`: only the CVEs of one update from `/groups` (an old kernel's too) |
| GET | `/api/v1/vulnerabilities/node/{node_id}/groups` | JWT (`vulnerabilities:read`) | A node's CVEs by the update that fixes them (CVE count and counts per severity, fixable, exploited, running kernel or reboot pending), plus `count`, `severity_counts`, `old_kernels` (older kernels that are installed but not running: update, version, packages – not counted, no CVE counts), the scan status and, for Windows, whether the build could be checked (`windows_updates`) |
| GET | `/api/v1/vulnerabilities/cves/{cve_id}?limit=500&offset=0` | JWT (`vulnerabilities:read`) | Which nodes one CVE affects now (see below); 404 if the CVE is unknown to Octofleet, 400 if `cve_id` is no CVE ID |
| GET | `/api/v1/vulnerabilities/cves?q=CVE-2026-987&limit=10` | JWT (`vulnerabilities:read`) | Known CVE IDs starting with `q`, in ID order (`limit` 1–50), for suggestions: `{"items": [{"cve_id", "severity", "cvss_score"}]}`. `q` needs at least the year (`CVE-2026`; `2026-987` is read as `CVE-2026-987`), else 400 |
| POST | `/api/v1/vulnerabilities/scan` | JWT (`settings:write`) | Trigger vulnerability scan; `{"refresh_cache": true}` ignores the OSV cache for this scan |
| GET | `/api/v1/vulnerabilities/osv-cache` | JWT (`vulnerabilities:read`) | OSV cache status: entries, outdated, oldest/newest, size |
| DELETE | `/api/v1/vulnerabilities/osv-cache` | JWT (`settings:write`) | Clear the OSV cache (409 while a scan runs) |
| POST | `/api/v1/vulnerabilities/osv-cache/verify?sample=50` | JWT (`settings:write`) | Download a random sample (1–500) again, compare, correct differing entries |
| GET | `/api/v1/vulnerabilities/scans` | API Key | List past scans |
| GET | `/api/v1/vulnerabilities/msrc` | JWT (`vulnerabilities:read`) | Microsoft's Security Update Guide for Windows itself (see below): sync state, mapped releases, Windows nodes checked or not |
| POST | `/api/v1/vulnerabilities/msrc/documents` | JWT (`settings:write`) | Import one monthly CVRF document (body: the JSON from `api.msrc.microsoft.com/cvrf/v3.0/cvrf/<id>`); replaces an earlier version of the month; 400 if it is no monthly document |

**Windows itself (MSRC)**: findings from Microsoft's Security Update Guide have `match_source`
`msrc`; their *package* is the Windows release (e.g. `Windows 11 Version 24H2 for x64-based
Systems`) at the node's build, `fixed_version` the build with the fix, and the update
(`fix_unit` / `software_name` in the per-node lists) the release's newest cumulative update, e.g.
`KB5132061` / `10.0.26100.9974`. The per-node and per-update CVE lists have `exploited` (Microsoft
reports the CVE as exploited) and list exploited CVEs first; `/node/{node_id}/groups` has
`exploited_count` per update (groups with exploited CVEs first) and `windows_updates`:

```json
{"status": "checked", "reason": null, "os_build": "26100.9445",
 "product": "Windows 11 Version 24H2 for x64-based Systems",
 "latest_kb": "KB5132061", "latest_build": "10.0.26100.9974", "up_to_date": false}
```

`status` is `unknown` with `reason` `no_build` (no build with update revision reported),
`unsupported_release` (no mapped release for this build and edition) or `no_data` (nothing synced
for the release); `windows_updates` is `null` for other nodes. `GET /api/v1/vulnerabilities/msrc`:

```json
{"enabled": true, "history_months": 24, "checked_at": "…", "succeeded_at": "…", "error": null,
 "documents": 24, "fixes": 254000, "newest_document": "2026-11-10T08:00:00+00:00",
 "releases": [{"build": 26100, "server": false, "product_id": "12390",
               "product": "Windows 11 Version 24H2 for x64-based Systems"}, …],
 "windows_nodes": {"checked": 412, "unknown": {"no_build": 3, "unsupported_release": 1, "no_data": 0}}}
```

**CVE lookup** (`GET /api/v1/vulnerabilities/cves/{cve_id}`, any case) uses only what the scans
and the MSRC sync stored. A CVE is *known* when a scan matched it to an installed software version
at some point (legacy keyword hits do not count) or Microsoft lists a fix for a mapped Windows
release; an unknown CVE is `404 CVE unknown to Octofleet`. `exploited` is true when Microsoft
reports the CVE as exploited. A known CVE
that affects no node now (e.g. every affected version was updated) has `affected_nodes: 0` and an
empty `nodes` list. Affected nodes are counted like everywhere else: findings marked as fixed and
packages of older, not running kernels are left out.

```json
{
  "cve_id": "CVE-2026-1234", "severity": "HIGH", "cvss_score": 7.5, "cvss_vector": "CVSS:3.1/…",
  "published_date": "2026-10-01T00:00:00+00:00", "description": "…",
  "nvd_url": "https://nvd.nist.gov/vuln/detail/CVE-2026-1234",
  "affected_nodes": 1, "limit": 500, "offset": 0,
  "nodes": [{
    "id": "…", "hostname": "web-01", "os_name": "Ubuntu", "os_version": "26.04",
    "link": "/nodes/…?tab=vulnerabilities&view=cves&q=CVE-2026-1234",
    "packages": [{"name": "linux-image-7.0.0-38-generic", "version": "7.0.0-38.38",
                  "fix_unit": "linux", "fix_unit_version": "7.0.0-38.38",
                  "fixed_version": "7.0.0-40.40", "fix_status": "fixed",
                  "kernel_state": "running", "running_kernel": true}]
  }],
  "scan": {"running_scan": null, "last_completed_scan": {"completed_at": "…", "status": "completed", …}}
}
```

The details combine all stored matches of the CVE: worst severity, highest CVSS score with its
vector, earliest publication date, the NVD description before a distribution's summary. `nodes`
is one page by hostname (`limit` 1–5000). `fix_status`: `fixed` (a newer version fixes it),
`none` (distribution data, no fix yet), `unknown` (NVD names no fixed version). `kernel_state` /
`running_kernel`: `running` (the running kernel), `pending` (a newer installed kernel waiting for
a reboot), `null` (not a kernel package). `link` is the node page's vulnerability list filtered
to the CVE. `scan.last_completed_scan` is the last finished scan the answer is based on.
| POST | `/api/v1/vulnerabilities/{cve_id}/suppress` | API Key | Suppress a CVE |
| GET | `/api/v1/remediation/packages` | API Key | Remediation packages (fix packages; `winget_id`: winget package ID for the default winget command, see [REMEDIATION.md](REMEDIATION.md)) |
| POST | `/api/v1/remediation/scan` | JWT (`jobs:create`) | Create remediation jobs: one per node and update, with all CVEs it closes (`details[].cves`); `cves_added`: CVEs added to jobs that still wait |
| POST | `/api/v1/remediation/fix/{vulnerability_id}` | JWT (`jobs:execute`) | One-click fix: one approved job for the application version on the node, with all its CVEs |
| GET | `/api/v1/remediation/jobs` | API Key | List remediation jobs (`cve_ids`: the CVEs the update closes, `cve_id`: the most severe one; `architecture`: `x86` for 32-bit installations) |
| POST | `/api/v1/remediation/jobs/approve` | JWT (`jobs:execute`) | Approve remediation jobs |
| GET | `/api/v1/remediation/jobs/pending/{node_id}` | Agent key (`jobs:poll`) | Agent poll: approved jobs with `fixCommand`, `cveId` and `cveIds` |

### Security Center

See [SECURITY-CENTER.md](SECURITY-CENTER.md) for feature details.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/security/dashboard` | User: `eventlog:read` | Security dashboard overview |
| GET | `/api/v1/security/rules` | JWT (`settings:read`) | List behavior rules |
| POST | `/api/v1/security/rules` | User: `settings:write` | Create behavior rule |
| PUT | `/api/v1/security/rules/{rule_id}` | User: `settings:write` | Update rule |
| DELETE | `/api/v1/security/rules/{rule_id}` | User: `settings:write` | Delete rule |
| POST | `/api/v1/security/rules/evaluate` | User: `settings:write` | Evaluate rules against events |
| GET | `/api/v1/security/findings` | JWT (`alerts:read`) | List security findings |
| GET | `/api/v1/security/findings/summary` | JWT (`alerts:read`) | Findings summary |
| POST | `/api/v1/security/findings` | User: `alerts:write` | Create finding manually |
| PUT | `/api/v1/security/findings/{finding_id}` | User: `alerts:write` | Update finding status |
| GET | `/api/v1/security/policies` | User: `compliance:read` | List security policies |
| POST | `/api/v1/security/policies` | User: `settings:write` | Create policy |
| PUT | `/api/v1/security/policies/{policy_id}` | User: `settings:write` | Update policy |
| DELETE | `/api/v1/security/policies/{policy_id}` | User: `settings:write` | Delete policy |
| GET | `/api/v1/security/activity/files` | JWT (`eventlog:read`) | File activity log |
| GET | `/api/v1/security/activity/users` | JWT (`eventlog:read`) | User activity log |
| GET | `/api/v1/security/activity/export` | JWT (`eventlog:read`) | Export activity data |
| GET | `/api/v1/security/vulnerabilities/fleet` | JWT (`vulnerabilities:read`) | Fleet vulnerability overview |

### Monitoring Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/monitoring/profiles` | User: `compliance:read` | List monitoring profiles |
| GET | `/api/v1/monitoring/profiles/{profile_id}` | User: `compliance:read` | Get profile details |
| POST | `/api/v1/monitoring/profiles` | User: `settings:write` | Create profile |
| PUT | `/api/v1/monitoring/profiles/{profile_id}` | User: `settings:write` | Update profile |
| DELETE | `/api/v1/monitoring/profiles/{profile_id}` | User: `settings:write` | Delete profile |
| GET | `/api/v1/monitoring/assignments` | User: `compliance:read` | List profile assignments |
| POST | `/api/v1/monitoring/assignments` | User: `settings:write` | Assign profile to nodes |
| PUT | `/api/v1/monitoring/assignments/{assignment_id}` | User: `settings:write` | Update assignment |
| DELETE | `/api/v1/monitoring/assignments/{assignment_id}` | User: `settings:write` | Remove assignment |
| GET | `/api/v1/monitoring/nodes/{node_id}/effective-policy` | Agent: `jobs:poll`; User: `compliance:read` | The node's profile and the fleet-wide sensor defaults |
| GET | `/api/v1/monitoring/defaults` | User: `compliance:read` | Fleet-wide sensor defaults (`network_connections` off) |
| PUT | `/api/v1/monitoring/defaults` | `settings:write` | Change fleet-wide sensor defaults (see [Security Center](SECURITY-CENTER.md#sensors)) |

### Posture Snapshots

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/posture/snapshots` | Agent: `inventory:write` | Create posture snapshot |
| GET | `/api/v1/posture/snapshots/{node_id}` | JWT (`compliance:read`) | List snapshots for node |
| GET | `/api/v1/posture/snapshots/{node_id}/latest` | JWT (`compliance:read`) | Get latest snapshot |
| GET | `/api/v1/posture/diffs/{node_id}` | JWT (`compliance:read`) | Get posture diffs (changes over time) |
| GET | `/api/v1/posture/compare/{node_id}` | JWT (`compliance:read`) | Compare two snapshots |

### Events & Findings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/ingest/events` | Agent: `inventory:write` | Ingest raw events from agent |
| POST | `/api/v1/ingest/events/normalized` | Agent: `inventory:write` | Ingest normalized events |
| GET | `/api/v1/events` | User: `eventlog:read` | Query events. `node_id` is a node filter: part of the name or a pattern with `*` / `?`, not case-sensitive; a trailing `$` (Windows computer account `HOST$`) is ignored. It is matched against the registered nodes (node ID and hostname) plus the typed name. `total` counts up to 10,000 (`total_capped: true` above) |
| GET | `/api/v1/events/files` | User: `eventlog:read` | File-specific events (same `node_id` filter) |
| GET | `/api/v1/findings` | User: `alerts:read` | List findings |
| GET | `/api/v1/findings/{finding_id}` | User: `alerts:read` | Get finding details |
| PUT | `/api/v1/findings/{finding_id}` | User: `alerts:write` | Update finding |

### Evidence & Retention

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/evidence/exports` | User: `compliance:read` | List evidence exports |
| POST | `/api/v1/evidence/export` | User: `compliance:read` | Create evidence export |
| GET | `/api/v1/retention` | User: `compliance:read` | Retention settings per data type with the TimescaleDB jobs, stored size and oldest data |
| PUT | `/api/v1/retention/{category}` | `settings:write` | Change `keep_days`, `compress_after_days` (`null` = off), `legal_hold`; upgrades require explicit `management_enabled: true` before policies are applied (see [Security Center](SECURITY-CENTER.md#retention--legal-hold)) |

### Audit Log

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/audit` | `audit:read` | Audit log (`audit_log`), newest first. Filters: `action` (part of it, any case), `user` (user ID or name; `user_id` is accepted too), `resource_type` (one or several, comma-separated, e.g. `user,role`), `resource_id`, `date_from`/`date_to` (ISO 8601), `limit` (≤ 500)/`offset`. Each entry has `details` as a JSON object and `resource_name` (node hostname, user, job, group or role name; for deleted nodes and users the name the entry recorded). `total` follows the filters and is counted up to 10,000 (`total_capped: true` above) |
| GET | `/api/v1/audit-log` | `audit:read` | The same as `/api/v1/audit` (older path) |
| GET | `/api/v1/audit-log/stats` | `audit:read` | Entries per day (30 days), top users, resource types and actions |
| GET | `/api/v1/audit/ui-events` | User: `eventlog:read` | UI interaction audit log |

### Metrics & Performance

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/nodes/{node_id}/metrics` | Agent: `inventory:write` | Push node metrics (agent) |
| GET | `/api/v1/nodes/{node_id}/metrics` | User: `nodes:read` | Get node metrics |
| GET | `/api/v1/metrics/summary` | User: `nodes:read` | Fleet metrics summary |
| GET | `/api/v1/metrics/fleet` | User: `nodes:read` | Fleet-wide metrics |
| GET | `/api/v1/metrics/timeseries` | User: `nodes:read` | Time-series metric data |

### Alerts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/alerts` | User: `alerts:read` | List alerts |
| GET | `/api/v1/alerts/stats` | User: `alerts:read` | Alert statistics |
| GET | `/api/v1/alert-channels` | User: `alerts:read` | List alert channels (Discord, etc.) |
| POST | `/api/v1/alert-channels` | User: `alerts:write` | Create alert channel |
| DELETE | `/api/v1/alert-channels/{channel_id}` | User: `alerts:write` | Delete alert channel |
| POST | `/api/v1/alert-channels/{channel_id}/test` | User: `alerts:write` | Test alert channel |
| GET | `/api/v1/alert-rules` | User: `alerts:read` | List alert rules |
| POST | `/api/v1/alert-rules` | User: `alerts:write` | Create alert rule |
| DELETE | `/api/v1/alert-rules/{rule_id}` | User: `alerts:write` | Delete alert rule |
| GET | `/api/v1/alert-history` | User: `alerts:read` | Alert history |

### Remote Terminal

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/terminal/start/{node_id}` | API Key | Start terminal session |
| GET | `/api/v1/terminal/sessions` | API Key | List active sessions |
| DELETE | `/api/v1/terminal/session/{session_id}` | API Key | End session |
| POST | `/api/v1/terminal/session/{session_id}/input` | API Key | Send input to session |
| GET | `/api/v1/terminal/session/{session_id}/output` | API Key | Get session output |
| WS | `/api/v1/terminal/ws/{session_id}` | Session token (`?token=`) | WebSocket terminal stream; the token is checked like on HTTP requests (revoked by logout or password change, inactive user, pending password change: rejected) |
| GET | `/api/v1/terminal/pending/{node_id}` | Agent: `terminal:pending` | Agent: pending commands; `active` is true while a terminal page for the node is open (output asked for within 30 s) or commands came – the agent then polls fast, otherwise about every 5 s |
| POST | `/api/v1/terminal/output/{session_id}` | Agent key | Agent: command output |

### Event Log (Windows)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/nodes/{node_id}/eventlog` | Agent: `inventory:write` | Push event log entries |
| GET | `/api/v1/nodes/{node_id}/eventlog` | User: `eventlog:read` | Get event log entries |
| GET | `/api/v1/eventlog/summary` | JWT (`eventlog:read`) | Event log summary |
| GET | `/api/v1/eventlog/important-events` | JWT (`eventlog:read`) | Important events |
| GET | `/api/v1/eventlog/trends` | User: `eventlog:read` | Event log trends |

### SQL Server Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/mssql/editions` | User: `settings:read` | Available SQL Server editions |
| GET | `/api/v1/mssql/downloads` | User: `settings:read` | Download links |
| POST | `/api/v1/mssql/configs` | User: `settings:write` | Create install configuration |
| GET | `/api/v1/mssql/configs` | User: `settings:read` | List configurations |
| POST | `/api/v1/mssql/install` | User: `settings:write` | Trigger SQL Server installation |
| GET | `/api/v1/mssql/instances` | User: `settings:read` | List discovered instances |
| GET | `/api/v1/mssql/cumulative-updates` | User: `nodes:read` | List cumulative updates |
| POST | `/api/v1/mssql/deploy-cu` | API Key | Deploy cumulative update |
| GET | `/api/v1/mssql/cu-compliance` | API Key | CU compliance report |

### Provisioning

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/provisioning/images` | JWT (`settings:read`) | List OS images |
| POST | `/api/v1/provisioning/images` | User: `settings:write` | Add OS image |
| GET | `/api/v1/provisioning/tasks` | JWT (`nodes:read`) | List provisioning tasks |
| POST | `/api/v1/provisioning/tasks` | User: `nodes:write` | Create provisioning task |
| DELETE | `/api/v1/provisioning/tasks/{task_id}` | User: `nodes:write` | Delete task |
| GET | `/api/v1/pxe/{mac}` | No | PXE boot script for MAC address |
| GET | `/api/v1/provisioning/iso/scan` | JWT (`settings:read`) | Scan for ISOs |
| POST | `/api/v1/provisioning/iso/mount` | User: `settings:write` | Mount ISO |
| POST | `/api/v1/provisioning/vm/create` | User: `nodes:write` | Create VM |
| GET | `/api/v1/discovered-systems` | JWT (`nodes:read`) | List discovered systems |
| POST | `/api/v1/discovered-systems/{system_id}/provision` | User: `nodes:write` | Provision discovered system |

### Exports & Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/export/nodes` | User: `nodes:read` | Export nodes (JSON) |
| GET | `/api/v1/export/nodes/excel` | User: `nodes:read` | Export nodes (Excel) |
| GET | `/api/v1/export/software/excel` | User: `inventory:read` | Export software (Excel) |
| GET | `/api/v1/export/vulnerabilities/excel` | User: `vulnerabilities:read` | Export vulnerabilities (Excel) |
| GET | `/api/v1/export/jobs/excel` | User: `jobs:read` | Export jobs (Excel) |
| GET | `/api/v1/reports/fleet/pdf` | User: `reports:read` | Fleet summary PDF |
| GET | `/api/v1/reports/security/pdf` | User: `reports:read` | Security report PDF |
| GET | `/api/v1/reports/inventory/pdf` | User: `reports:read` | Inventory report PDF |
| POST | `/api/v1/reports/execute` | User: `reports:read` | Run a report from the catalog |
| POST, PUT, DELETE | `/api/v1/reports/schedules` (`/{schedule_id}`, `/{schedule_id}/run-now`) | User: `reports:write` | Create, change, delete or run report schedules |

### Settings & Maintenance

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/settings` | API Key | List all settings |
| GET | `/api/v1/settings/logging` | User: `settings:read` | Backend log level and access log as applied now: `level` (`error`/`warning`/`info`/`debug`), `components` (components with their own level, e.g. `{"Jobs": "debug"}`), `access_log` (`all`/`errors_slow`/`off`), `slow_ms`, `defaults`, `component_names` |
| PUT | `/api/v1/settings/logging` | User: `settings:write` | Change them (same fields; missing ones take the defaults info / no component levels / all / 1000); applies at once, audited as `settings.logging`. Not through the generic `/settings/{key}` routes |
| GET | `/api/v1/settings/{key}` | API Key | Get setting value |
| PUT | `/api/v1/settings/{key}` | API Key | Update setting |
| DELETE | `/api/v1/settings/{key}` | API Key | Delete setting |
| GET | `/api/v1/maintenance-windows` | User: `settings:read` | List maintenance windows |
| POST | `/api/v1/maintenance-windows` | API Key | Create maintenance window |
| PUT | `/api/v1/maintenance-windows/{window_id}` | API Key | Update window |
| DELETE | `/api/v1/maintenance-windows/{window_id}` | API Key | Delete window |
| GET | `/api/v1/maintenance-windows/check/{node_id}` | User: `settings:read` | Check if node is in maintenance |
| GET | `/api/v1/onboarding/config` | API Key | Get onboarding configuration |
| PUT | `/api/v1/onboarding/config` | API Key | Update onboarding configuration |

### Agent Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/agent/version` | — | Get latest agent version |
| GET | `/api/v1/agent/wait/{node_id}` | Agent key (`jobs:poll`) | Agent long-poll ([#283](https://github.com/BenediktSchackenberg/octofleet/issues/283)): held until there is work for the node, then `{"wake": [...]}` with the polls to run now – `jobs` (a pending job, as `jobs/pending` would return it), `remediation` (an approved remediation job not bound to a maintenance window), `terminal` (a queued command, or a terminal page just opened), `screen` / `shell` (a session just started); `{"wake": []}` after the hold time. `kinds` (comma-separated, default all) limits it to what the agent handles; `timeout` (seconds) shortens the hold, at most `AGENT_WAIT_SECONDS` (default 55, minus up to 10 % jitter). A wake-up while the agent is between two requests is kept for 2 minutes. The wake-up runs inside the (single) backend process |
| POST | `/api/v1/agents/{node_id}/capabilities` | Agent: `inventory:write` | Report agent capabilities |
| GET | `/api/v1/agents/{node_id}/capabilities` | User: `nodes:read` | Get agent capabilities |
| GET | `/api/v1/agents/capabilities` | User: `nodes:read` | Fleet-wide capabilities |
| POST | `/api/v1/agents/{node_id}/health` | API Key | Report agent health |
| GET | `/api/v1/agents/{node_id}/health/history` | User: `nodes:read` | Agent health history |

### File Repository

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/repo/upload` | User: `packages:write` | Upload file |
| GET | `/api/v1/repo/files` | User: `packages:read` | List files |
| GET | `/api/v1/repo/download/{file_id}` | No (agents download without a key) | Download file |
| DELETE | `/api/v1/repo/files/{file_id}` | User: `packages:write` | Delete file |
| GET | `/api/v1/repo/stats` | User: `packages:read` | Repository statistics |

---

### Patch Management

See [PATCH-MANAGEMENT.md](PATCH-MANAGEMENT.md) for detailed documentation.

"User" routes need a login token or a personal API key whose owner has the listed permission; the shared agent key gets 403. "Agent key" routes are for agents. The Patch Explorer routes (`/api/v1/patches/explorer/*`) follow the same rules: views `packages:read`, deploy/scan/verify `packages:deploy`, `agent-updates` agent key.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/patches/catalog` | User: `packages:read` | List patches (with search, pagination; `node` = node ID or UUID: only patches still open on that node); each with `nodes`: on how many nodes it is `required` (not installed), `installed`, `failed`, `not_required` |
| POST | `/api/v1/patches/catalog` | User: `packages:write` | Create patch manually |
| POST | `/api/v1/patches/catalog/import` | User: `packages:write` | Import patches from agent scan |
| GET | `/api/v1/patches/catalog/{patch_id}` | User: `packages:read` | Get patch details with affected nodes |
| PATCH | `/api/v1/patches/catalog/{patch_id}/approve` | User: `packages:write` | Approve patch for deployment |
| PATCH | `/api/v1/patches/catalog/{patch_id}/exclude` | User: `packages:write` | Exclude patch from deployment |
| GET | `/api/v1/patches/fleet` | User: `packages:read` | Every node with its update state: `pending`, `security`, `definitions` (Windows Defender signatures, not counted as pending), `reboot_updates` (the updates behind a needed or possible reboot, at most 20), `reboot` (`pending` / `needed` / `maybe` / `unknown` / `none`), `last_search` (`at`, `status`, `source`, `server`, `error`), `approved` / `approved_definitions` (Windows: pending updates approved in the catalog; Linux: approved by the Linux approval rules, from the cache), `linux` (Linux nodes: `approval` `ok` / `no_rules` / `agent_too_old`, `evaluating`, `waiting`, `excluded`, `release`, `package_manager`, `security_data`; Windows: null), `last_job` (the newest `patch_scan` / `patch_install`: `id`, `type`, `status`, `at`), `running` (its type while not finished), `installation` (while the newest installation has not finished on the node: `state` `installing` / `restarting` / `awaiting_restart`, `job_id`, `restart_at`), `reboot_job` (a reboot from the console until the node has reported after it, as in `GET /api/v1/nodes/{node_id}/reboot`), `online`. Filters: `os` (`windows`/`linux`), `pending`, `security`, `reboot` (pending or needed), `failed`, `stale_days`, `offline`, `q` (hostname); `sort` (`hostname`, `pending`, `security`, `reboot`, `last_search`, `os`), `dir`, `limit`, `offset`. Returns `nodes`, `total` and `counts` (over all nodes) |
| GET | `/api/v1/patches/fleet/summary` | User: `packages:read` | The dashboard's Updates card: the `counts` of `GET /api/v1/patches/fleet` (`nodes`, `pending`, `security`, `reboot`, `failed`, `stale` (7 days), `offline`) plus `current` (up to date: nothing pending, the last search did not fail and is at most 7 days old) and `by_os` (`windows`, `linux`: the same counts). Kept in memory: `as_of` says when it was computed; a value older than 2 minutes is returned with `refreshing: true` and recomputed in the background, so the request never waits for all nodes |
| POST | `/api/v1/patches/fleet/search` | User: `packages:deploy` | `{"node_ids": [UUID, ...]}` (up to 500): one `patch_scan` job per node. Returns `jobs` (`node`, `job_id`) and `skipped` (`node`, `reason`) |
| POST | `/api/v1/patches/fleet/install` | User: `packages:deploy` | `{"node_ids": [...], "reboot_policy": "no_reboot" \| "schedule" \| "force", "reboot_schedule_time": ISO 8601 with offset (for `schedule`), "include_definitions": false}`: one `patch_install` job per node; the server builds the payload. Windows: `kb_ids` of the last search that are approved (and not excluded) in the patch catalog, without Defender signature updates unless `include_definitions`, and the time limit (30 minutes). Linux: the versions the Linux approval rules approve, recomputed at this moment, as `packages` with exact versions (`{"name", "version"}`), time limit 60 minutes; skipped `agent_too_old` (no release reported) and `unsupported` (pacman). Nodes without approved updates are skipped (`not_approved`). Nodes whose newest installation runs (`busy`), restarts (`restarting`) or waits for a restart (`awaiting_restart`) are skipped; `"retry": true` installs again on the last two. Returns `jobs` and `skipped` |
| GET | `/api/v1/patches/compliance` | User: `compliance:read` | Fleet-wide patch compliance summary; `node_id` (node ID or UUID) limits counts, compliance and MTTP to that node. Updates (catalog KBs): `total_patches`, `approved`, `excluded`, `required_patches` (needed on a node), `awaiting_approval` (needed, neither approved nor excluded). Node entries (node × update): `pending` (still needed), `installed`, `failed`, `not_required`; `compliance_percent` = (installed + not_required) / entries except excluded |
| GET | `/api/v1/patches/compliance/nodes` | User: `compliance:read` | Per-node compliance breakdown |
| GET | `/api/v1/patches/available/{node_id}` | User: `packages:read` | The updates the node's last successful update search found (Windows): KB, title, severity, category, source, reboot flag, found on; `definition` marks Microsoft Defender signature updates |
| GET | `/api/v1/patches/scan-status/{node_id}` | User: `packages:read` | The node's last update search (time, status, source, error, update count): Windows Update / WSUS, or on Linux the package lists (`source` `apt`, `dnf`, `yum`) from a `patch_scan` job, sent as `updates.scan` with `POST /api/v1/inventory/full` |
| GET | `/api/v1/patches/rings` | User: `packages:read` | List patch rings |
| POST | `/api/v1/patches/rings` | User: `packages:write` | Create ring |
| PUT | `/api/v1/patches/rings/{ring_id}` | User: `packages:write` | Update ring |
| DELETE | `/api/v1/patches/rings/{ring_id}` | User: `packages:write` | Delete ring |
| POST | `/api/v1/patches/rings/{ring_id}/pause`, `/resume` | User: `packages:write` | Pause or resume the ring for Linux approval rules (no approvals through a paused ring; exclusions still apply) |
| GET | `/api/v1/patches/linux-rules` | User: `packages:read` | Linux approval rules, `totals` (`nodes`, `approved`, `waiting`, `excluded`, `evaluating`) and `releases` (`release`, `package_manager`, `security_data`, `nodes`) |
| POST | `/api/v1/patches/linux-rules` | User: `packages:write` | Create a rule: `{"name", "description", "enabled": false, "action": "approve" | "exclude", "ring_ids": [UUID], "group_id": UUID, "releases": [pattern], "security_only": false, "min_severity": "Low" | "Moderate" | "Important" | "Critical" (with security_only), "repositories": [pattern], "packages": [pattern], "min_age_hours": 0, "expedite": false}` (patterns with `*` and `?`; an exclusion needs packages or repositories). Unknown rings or group: 400 |
| PUT | `/api/v1/patches/linux-rules/{rule_id}` | User: `packages:write` | Change a rule; fields left out keep their value |
| DELETE | `/api/v1/patches/linux-rules/{rule_id}` | User: `packages:write` | Delete a rule |
| POST | `/api/v1/patches/linux-rules/preview` | User: `packages:read` | An unsaved rule (same fields) on its own: `nodes` in scope, pending versions `approved` / `waiting` / `excluded`, `nodes_without_security_data` (security-only rule) |
| GET | `/api/v1/patches/linux-approved/{node_uuid}` | User: `packages:read` | The node's pending Linux updates: `name` (as installed), `package`, `arch`, `version`, `installed_version`, `repository`, `security`, `severity`, `first_seen_at`, `state` (`approved` / `waiting` / `excluded` / `not_approved`, or `phased`: apt holds it back on the node for now, not evaluated by the rules), `approved_at`, `rules`; plus `release`, `package_manager`, `security_data` |
| GET | `/api/v1/patches/deployments` | User: `packages:read` | List patch deployments |
| POST | `/api/v1/patches/deployments` | User: `packages:deploy` | Create patch deployment |
| GET | `/api/v1/patches/deployments/{id}` | User: `packages:read` | Get deployment details |
| POST | `/api/v1/patches/deployments/{id}/pause` | User: `packages:deploy` | Pause deployment |
| POST | `/api/v1/patches/deployments/{id}/resume` | User: `packages:deploy` | Resume deployment |
| POST | `/api/v1/patches/deployments/{id}/cancel` | User: `packages:deploy` | Cancel deployment |
| POST | `/api/v1/patches/scan-results` | Agent key | Agent submits scan results, with the search's status (`scan`); a failed search keeps the node's lists. Returns `imported`, `total`, `resolved` (entries no longer offered, now `not_required`; was `removed`) |
| GET | `/api/v1/patches/pending/{node_id}` | Agent key | Get pending patches for node |
| POST | `/api/v1/patches/results` | Agent key | Agent submits installation results |

### Configuration Baselines

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/baselines` | User: `compliance:read` | List baselines |
| POST | `/api/v1/baselines` | User: `settings:write` | Create baseline |
| GET | `/api/v1/baselines/{baseline_id}` | User: `compliance:read` | Get baseline details |
| GET | `/api/v1/baselines/templates` | User: `compliance:read` | List CIS benchmark templates |
| POST | `/api/v1/baselines/templates/{template_id}/import` | User: `settings:write` | Import CIS template as baseline |
| GET | `/api/v1/baselines/evaluations/{eval_id}` | User: `compliance:read` | Get evaluation results |
| GET | `/api/v1/baselines/compliance/{node_id}` | User: `compliance:read` | Node compliance details |
| GET | `/api/v1/baselines/compliance/trends` | User: `compliance:read` | Compliance trend data |
| GET | `/api/v1/compliance/summary` | User: `compliance:read` | Defender, real-time protection, firewall and BitLocker per node (`nodes`: true/false/null each) and counted over all nodes (`defender`, `realTimeProtection`, `firewall`: enabled/disabled/unknown; `bitlocker`: encrypted/unencrypted/unknown), from the agents' security inventory; `GET /api/v1/export/compliance` exports the node list |
| GET | `/api/v1/baselines/drift` | User: `compliance:read` | List drift events |
| GET | `/api/v1/baselines/drift/summary` | User: `compliance:read` | Drift summary by category |
| POST | `/api/v1/baselines/drift/{drift_id}/acknowledge` | User: `alerts:write` | Acknowledge drift |
| POST | `/api/v1/baselines/drift/{drift_id}/waive` | User: `alerts:write` | Waive drift (accept deviation) |
| POST | `/api/v1/baselines/drift/{drift_id}/remediate` | User: `jobs:create` | Auto-remediate single drift |
| POST | `/api/v1/baselines/{baseline_id}/remediate-all` | User: `jobs:create` | Auto-remediate all drifts for baseline |

### Content Lifecycle

See [CONTENT-LIFECYCLE.md](CONTENT-LIFECYCLE.md) for detailed documentation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/content/repositories` | User: `settings:read` | List repositories |
| POST | `/api/v1/content/repositories` | User: `settings:write` | Create repository |
| GET | `/api/v1/content/repositories/{repo_id}` | User: `settings:read` | Get repository details |
| PUT | `/api/v1/content/repositories/{repo_id}` | User: `settings:write` | Update repository |
| DELETE | `/api/v1/content/repositories/{repo_id}` | User: `settings:write` | Delete repository |
| POST | `/api/v1/content/repositories/{repo_id}/sync` | User: `settings:write` | Trigger repository sync |
| GET | `/api/v1/content/repositories/{repo_id}/items` | User: `settings:read` | List items in repository |
| POST | `/api/v1/content/repositories/{repo_id}/items` | User: `settings:write` | Add item to repository |
| GET | `/api/v1/content/items/{item_id}` | User: `settings:read` | Get item details |
| DELETE | `/api/v1/content/items/{item_id}` | User: `settings:write` | Delete item |
| GET | `/api/v1/content/snapshots` | User: `settings:read` | List snapshots |
| POST | `/api/v1/content/repositories/{repo_id}/snapshots` | User: `settings:write` | Create snapshot |
| GET | `/api/v1/content/snapshots/{snap_id}` | User: `settings:read` | Get snapshot details |
| DELETE | `/api/v1/content/snapshots/{snap_id}` | User: `settings:write` | Delete snapshot |
| GET | `/api/v1/content/snapshots/{snap_id}/diff/{other_id}` | User: `settings:read` | Compare two snapshots |
| GET | `/api/v1/content/environments` | User: `settings:read` | List environments |
| PUT | `/api/v1/content/environments/{env_id}` | User: `settings:write` | Update environment |
| POST | `/api/v1/content/environments/{env_id}/promote` | User: `settings:write` | Promote snapshot to environment |
| GET | `/api/v1/content/environments/{env_id}/history` | User: `settings:read` | Promotion/rollback history |
| POST | `/api/v1/content/environments/{env_id}/rollback` | User: `settings:write` | Rollback environment |
| GET | `/api/v1/content/dashboard` | User: `settings:read` | Content lifecycle dashboard |

### Query Engine

See [QUERY-ENGINE.md](QUERY-ENGINE.md) for DSL syntax and table reference. Every route under `/api/v1/query` – also saved queries, history, schedules and dashboards – needs a user with `query:execute` (roles admin and operator).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/query/execute` | User: `query:execute` | Execute a DSL query |
| GET | `/api/v1/query/schema` | User: `query:execute` | Get schema (tables, columns, types) |
| GET | `/api/v1/query/templates` | User: `query:execute` | Get 18 pre-built query templates |
| POST | `/api/v1/query/live` | User: `query:execute` | Execute live query on agents |

### Software Metering

See [SOFTWARE-METERING.md](SOFTWARE-METERING.md) for detailed documentation.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/metering/catalog` | User: `nodes:read` | List software catalog |
| POST | `/api/v1/metering/catalog` | User: `packages:write` | Create catalog entry |
| PUT | `/api/v1/metering/catalog/{id}` | User: `packages:write` | Update catalog entry |
| DELETE | `/api/v1/metering/catalog/{id}` | User: `packages:write` | Delete catalog entry |
| POST | `/api/v1/metering/catalog/auto-discover` | User: `packages:write` | Auto-discover from fleet |
| GET | `/api/v1/metering/rules` | User: `nodes:read` | List normalization rules |
| POST | `/api/v1/metering/rules` | User: `packages:write` | Create normalization rule |
| DELETE | `/api/v1/metering/rules/{id}` | User: `packages:write` | Delete rule |
| POST | `/api/v1/metering/rules/test` | User: `packages:write` | Test pattern against fleet |
| GET | `/api/v1/metering/licenses` | User: `nodes:read` | List licenses |
| POST | `/api/v1/metering/licenses` | User: `packages:write` | Create license |
| PUT | `/api/v1/metering/licenses/{id}` | User: `packages:write` | Update license |
| DELETE | `/api/v1/metering/licenses/{id}` | User: `packages:write` | Delete license |
| GET | `/api/v1/metering/compliance` | User: `nodes:read` | Fleet-wide compliance |
| GET | `/api/v1/metering/compliance/{catalog_id}` | User: `nodes:read` | Per-software compliance |
| GET | `/api/v1/metering/dashboard` | User: `nodes:read` | Metering dashboard |
| GET | `/api/v1/metering/usage` | User: `nodes:read` | Usage data |
| POST | `/api/v1/metering/usage/submit` | Agent: `inventory:write` | Submit usage data |
| GET | `/api/v1/metering/usage/reclaim` | User: `nodes:read` | Reclamation candidates |
| GET | `/api/v1/metering/reports/true-up` | User: `nodes:read` | True-up report |

### Hardware Fleet

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/hardware/fleet` | User: `hardware:read` | Fleet-wide hardware summary |
| GET | `/api/v1/hardware/export` | — | Export hardware data |

`/hardware/fleet` counts each disk and volume once: zram, loop and RAM devices are not disks, and a Linux device mounted several times (btrfs subvolumes, bind mounts) is one volume. Each disk has `deviceId` and `health` (`healthy`, `warning`, `unhealthy`, `virtual` – a VM disk without health data, no SMART – or `unknown`); `physicalDiskHealth` counts them per state.

---

## Error Responses

All endpoints return standard HTTP status codes:

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (missing/invalid auth) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 422 | Unprocessable entity (Pydantic validation) |
| 500 | Internal server error |

Error responses include a JSON body:

```json
{
  "detail": "Description of the error"
}
```

## Rate Limiting

There is currently no built-in rate limiting. For production deployments, consider placing a reverse proxy (nginx, Caddy) in front of the backend.
