# Remediation (Auto-Fix)

Remediation turns vulnerability findings into fix jobs: it matches a vulnerable application to a **fix package** (how to update it), checks the **rules** (whether and when to fix it), creates a **remediation job** per node and CVE, and the Windows agent runs the fix command. Jobs can wait for an approval and for a maintenance window.

**Windows only for now.** Remediation uses the findings of the NVD/CPE match (`match_source = nvd_cpe`), i.e. installed Windows applications. Findings of Linux distribution packages (`osv_distro`) never create remediation jobs; Linux packages are updated with **Install updates** on the node's Updates tab instead (see [PATCH-MANAGEMENT.md](PATCH-MANAGEMENT.md)).

The page: **Secure → Auto-Fix** (`/remediation`), with the tabs *Dashboard*, *Packages*, *Rules* and *Jobs* (the tab is kept in the URL).

## Overview

```
vulnerability scan ──► finding (node, application, version, CVE, severity)
                          │
                          ▼
   fix package matches the application and the version is below "fixed in"?  ── no ──► nothing
                          │ yes
                          ▼
   a rule matches (severity, name pattern)?                                    ── no ──► "no rule"
                          │ yes
                          ▼
   a job for this node and CVE exists already (not failed / rolled back)?      ── yes ─► "skipped (existing)"
                          │ no
                          ▼
   remediation job: pending (rule requires approval) or approved
                          │  approve (jobs:execute)
                          ▼
   agent polls (every 60 s) ─ maintenance window open, if the rule needs one ─► running ─► success / failed / skipped
```

## Fix packages (*Packages* tab)

A fix package says how to update one application. Permission: `packages:write` (read: `packages:read`).

| Field | Meaning |
|---|---|
| Name | Unique name of the package. |
| Target software | Matched against the application's display name, case-insensitive; it matches when one contains the other (`7-Zip` matches `7-Zip 23.01 (x64)`). |
| Min. fixed version | Optional. Applications at this version or newer are not fixed. Versions are compared by their numbers (`23.01` < `24.08`). |
| Fix method | `winget`, `choco`, `script` or `package`. |
| Fix command | The command the agent runs. Empty: a default command (below). |
| Enabled | Disabled packages are ignored. |

If several enabled packages match, the first one by *target software*, then *name* wins.

**Default commands** when *Fix command* is empty:

| Method | Command |
|---|---|
| `winget` | `winget upgrade --name "<application name>" --silent --accept-source-agreements` |
| `choco` | `choco upgrade <application name> -y` |
| `script`, `package` | none – the agent only reports "No fix command"; enter a command |

The default winget command finds the application by its display name, which does not always match the winget package. A fix command with the package ID is more reliable, e.g. `winget upgrade --id 7zip.7zip --silent --accept-source-agreements`.

A package that jobs still refer to cannot be deleted (409); disable it instead, so the job history stays complete.

## Rules (*Rules* tab)

A rule decides which findings get a job and how it runs. Permission: `settings:write` (read: `settings:read`).

| Field | Meaning |
|---|---|
| Min. severity | `CRITICAL`, `HIGH`, `MEDIUM` or `LOW`: findings of this severity or higher. |
| Software pattern | Optional regular expression on the application name (case-insensitive). |
| Auto-remediate | The rule also applies to the automatic run after a vulnerability scan (below). |
| Require approval | Jobs start as *pending* and wait for an approval. Without it they start as *approved*. |
| Maintenance window only | The agent gets the job only while a maintenance window is open for the node. |
| Priority | 1–1000; the rule with the lowest number that matches wins. |
| Notify on … | Stored with the rule; no notifications are sent from it yet. |
| Enabled | Disabled rules are ignored. |

**Without a matching rule, no job is created** (the scan counts it as *no rule*). A rule that jobs refer to cannot be deleted (409); disable it instead.

## Maintenance windows

Maintenance windows have no page yet; they are managed through the API (`settings:write`):

```bash
curl -X POST "$API/api/v1/remediation/maintenance-windows" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Weeknights", "day_of_week": [1,2,3,4,5], "start_time": "22:00", "end_time": "04:00",
       "timezone": "Europe/Berlin", "applies_to_all": true}'
```

- `day_of_week`: 0 = Sunday … 6 = Saturday; empty = every day. A window across midnight belongs to the day it starts.
- `timezone`: the window's time zone (default UTC).
- `applies_to_all: false` with `group_ids`: only nodes in these groups.
- `GET /api/v1/remediation/maintenance-windows/active` says whether a window is open now.

Jobs of rules with *Maintenance window only* wait (status *approved*) until a window is open for their node. Jobs without a rule (one-click fix) do not wait.

## Creating jobs

**From the page** (*Dashboard*), for Critical and High findings:
- **Dry Run** shows what would happen and writes nothing: *Scanned*, *With fix*, *Would create*, *Skipped* (a job exists already).
- **Run Remediation** creates the jobs.

**Automatically** after a complete vulnerability scan (*Scan* on the Vulnerabilities page): for Critical and High findings, with **auto-remediate** rules only.

**Through the API**, `POST /api/v1/remediation/scan` (`jobs:create`), with optional filters:

```json
{"severity_filter": ["CRITICAL", "HIGH"], "software_filter": "7-Zip", "node_ids": ["<node uuid>"], "dry_run": true}
```

The answer lists each job (`details`) with node, application, version, CVE, package, rule and whether it needs an approval; `jobs_created` or, for a dry run, `would_create`; `jobs_skipped_existing` and `jobs_skipped_no_rule`. One scan looks at up to 500 findings, highest CVSS first.

**One job per node and CVE:** a scan creates no second job while one exists that has not failed or been rolled back. An application with many CVEs gets one job per CVE; once one of them has updated the application, winget usually has nothing left to do for the others, and they end as *skipped*.

**One-click fix**, `POST /api/v1/remediation/fix/{vulnerability_id}?node_id=<node uuid>` (`jobs:execute`): one job for one finding on one node, approved at once, without a rule.

## Approval

*Pending* jobs show **Approve** in the job list; tick several and use **Approve selected**. Approving needs `jobs:execute`; the server records who approved and when (`approved_by`, `approved_at`, from the signed-in user). API: `POST /api/v1/remediation/jobs/approve` with `{"job_ids": [1, 2]}`.

An agent never receives a pending job.

## On the node

The Windows agent asks for jobs every 60 seconds and takes up to 5 per poll; a job taken by one poll is not handed out again. It runs the fix command with PowerShell (10 minutes at most) and reports the exit code and output.

If a winget command finds no installed package, the agent tries the same update with Chocolatey; when Chocolatey is missing, it installs it first from `community.chocolatey.org`. Keep that in mind on nodes without internet access or where Chocolatey is not wanted, and use a fix command that does not need it.

## Job states

| Status | Meaning |
|---|---|
| `pending` | Waits for an approval. |
| `approved` | Approved (or no approval needed); waits for the agent and, if the rule needs one, a maintenance window. |
| `running` | The agent has taken the job. |
| `success` | Exit code 0. The node's findings for this application are marked fixed (`fixed_by = remediation`); the next inventory and scan confirm it. |
| `failed` | Any other exit code; the output and error are kept with the job. A scan may create a new job for the same CVE. |
| `skipped` | winget had nothing to upgrade (exit code 1 with "No applicable upgrade found", English or German output): neither fixed nor failed. The findings stay; the next inventory and scan show whether the application is still affected. |
| `rolled_back` | Set by hand only; there is no automatic rollback. |

A status can be set by hand (`running`, `success`, `failed`, `skipped`, `rolled_back`) with `PATCH /api/v1/remediation/jobs/{id}/status?status=…` (`jobs:execute`); approving always goes through the approve endpoint.

The *Dashboard* shows the counts (fixed, pending, failed), the running jobs and the job list with a status filter; it updates live.

## Permissions

| Action | Permission |
|---|---|
| View packages | `packages:read` |
| Create, change, delete packages | `packages:write` |
| View rules, maintenance windows | `settings:read` |
| Create, change, delete rules and maintenance windows | `settings:write` |
| View jobs | `jobs:read` |
| Scan / create jobs | `jobs:create` |
| Approve, one-click fix, set a status | `jobs:execute` |

## Limits

- Windows applications only (see above).
- One job per CVE, not per application and node: an application with 20 CVEs gets 20 jobs.
- The default winget command uses the display name, not the winget package ID, and does not choose the architecture (32-bit installations).
- No automatic rollback; *Notify on …* in rules sends nothing yet.
- Maintenance windows have no page yet.

## API

| Method | Path | Permission |
|---|---|---|
| GET, POST | `/api/v1/remediation/packages` | `packages:read`, `packages:write` |
| GET, PATCH, DELETE | `/api/v1/remediation/packages/{id}` | `packages:read`, `packages:write` |
| GET, POST | `/api/v1/remediation/rules` | `settings:read`, `settings:write` |
| GET, PATCH, DELETE | `/api/v1/remediation/rules/{id}` | `settings:read`, `settings:write` |
| GET, POST | `/api/v1/remediation/maintenance-windows` | `settings:read`, `settings:write` |
| GET | `/api/v1/remediation/maintenance-windows/active` | `settings:read` |
| POST | `/api/v1/remediation/scan` | `jobs:create` |
| POST | `/api/v1/remediation/fix/{vulnerability_id}?node_id=` | `jobs:execute` |
| GET | `/api/v1/remediation/jobs?status=&node_id=&limit=` | `jobs:read` |
| GET | `/api/v1/remediation/jobs/{id}` | `jobs:read` |
| POST | `/api/v1/remediation/jobs/approve` | `jobs:execute` |
| PATCH | `/api/v1/remediation/jobs/{id}/status` | `jobs:execute` |
| GET | `/api/v1/remediation/summary` | API key or sign-in |
