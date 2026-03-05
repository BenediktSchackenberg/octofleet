# Security Center

The Security Center is Octofleet's comprehensive security monitoring and compliance suite. It provides real-time file auditing, behavioral threat detection, configuration drift monitoring, patch management, configuration baselines, and forensic evidence capabilities — all from a single dashboard.

## Overview

The Security Center spans 20+ dedicated pages in the frontend and covers:

- **Security Dashboard** — At-a-glance risk overview
- **Monitoring Profiles** — Define what to monitor and how
- **Behavior Rules** — Detect suspicious patterns automatically
- **File Audit** — Real-time file change monitoring
- **Posture Snapshots** — Configuration baseline tracking
- **Findings** — Auto-generated security findings with risk scoring
- **Activity Dashboards** — File and user activity visualization
- **Evidence Export** — Forensic evidence packaging
- **Retention & Legal Hold** — Data lifecycle management
- **Patch Management** — Patch catalog, rings, deployments, compliance *(new in v0.6.0)*
- **Configuration Baselines** — CIS benchmarks, drift detection, auto-remediation *(new in v0.6.0)*
- **Content Lifecycle** — Repository management with environment pipelines *(new in v0.6.0)*

---

## Security Dashboard

**Endpoint:** `GET /api/v1/security/dashboard`

The dashboard provides a consolidated view of your fleet's security posture:

- Total findings by severity (Critical, High, Medium, Low, Info)
- Active behavior rules and their hit count
- Recent file audit events
- Nodes with open findings
- Risk score trends over time

---

## Monitoring Profiles

Monitoring profiles define **what** gets monitored on each node. You create profiles and assign them to individual nodes or groups.

### How Profiles Work

1. **Create a profile** with monitoring settings:
   - File paths to audit (e.g., `C:\Windows\System32\`, `/etc/`)
   - Event types to collect (file changes, process execution, logins)
   - Collection intervals
   - Sensitivity levels

2. **Assign the profile** to nodes or groups

3. **Agents pick up** the effective policy and start reporting matching events

### Effective Policy

When multiple profiles apply to a node (e.g., via group membership), they are merged into an **effective policy**. Use the endpoint:

```
GET /api/v1/monitoring/nodes/{node_id}/effective-policy
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/monitoring/profiles` | List all profiles |
| POST | `/api/v1/monitoring/profiles` | Create profile |
| PUT | `/api/v1/monitoring/profiles/{id}` | Update profile |
| DELETE | `/api/v1/monitoring/profiles/{id}` | Delete profile |
| GET | `/api/v1/monitoring/assignments` | List assignments |
| POST | `/api/v1/monitoring/assignments` | Create assignment |
| PUT | `/api/v1/monitoring/assignments/{id}` | Update assignment |
| DELETE | `/api/v1/monitoring/assignments/{id}` | Remove assignment |

---

## Behavior Rules

Behavior rules automatically detect suspicious activity by evaluating incoming events against configurable conditions. There are three types:

### Rule Types

| Type | Description | Example |
|------|-------------|---------|
| **Threshold** | Triggers when event count exceeds N within a time window | "More than 50 file changes in 5 minutes" |
| **Pattern** | Triggers on matching event content/paths | "Any change to `/etc/shadow`" |
| **Time-based** | Triggers on events outside allowed hours | "Login events after 22:00" |

### Creating a Rule

```json
{
  "name": "Suspicious after-hours login",
  "type": "time",
  "severity": "high",
  "conditions": {
    "event_type": "login",
    "after_hours": { "start": "22:00", "end": "06:00" }
  },
  "enabled": true
}
```

### Rule Evaluation

Rules are evaluated when:
- New events are ingested (`POST /api/v1/ingest/events`)
- Manually triggered (`POST /api/v1/security/rules/evaluate`)

When a rule matches, a **finding** is automatically created.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/security/rules` | List all rules |
| POST | `/api/v1/security/rules` | Create rule |
| PUT | `/api/v1/security/rules/{id}` | Update rule |
| DELETE | `/api/v1/security/rules/{id}` | Delete rule |
| POST | `/api/v1/security/rules/evaluate` | Manually evaluate rules |

---

## File Audit

File audit provides real-time monitoring of file system changes across your fleet.

### How It Works

- **Windows:** The agent uses NTFS Change Journal and ReadDirectoryChanges API to detect file operations (create, modify, delete, rename)
- **Linux:** The agent monitors configured paths for changes using inotify-style mechanisms

### Viewing File Activity

- **Event stream:** `GET /api/v1/events/files` — Raw file events with timestamps, paths, and operation types
- **Activity dashboard:** `GET /api/v1/security/activity/files` — Aggregated file activity with charts
- **Node-level:** File events are visible on each node's detail page

### Key Data Points

Each file event includes:
- Node ID and hostname
- File path
- Operation type (create, modify, delete, rename)
- Timestamp
- User context (when available)
- File hash (for critical paths)

---

## Posture Snapshots

Posture snapshots capture the configuration state of a node at a point in time, enabling **baseline drift detection**.

### What Gets Captured

- Installed software and versions
- Running services and their state
- Security settings (firewall, AV status)
- Open ports
- System configuration parameters

### Comparing Snapshots

You can compare any two snapshots to see what changed:

```
GET /api/v1/posture/compare/{node_id}?from=<snapshot_id>&to=<snapshot_id>
```

The diff view highlights:
- ✅ Added items (new software, new services)
- ❌ Removed items
- 🔄 Changed items (version changes, state changes)

### Automatic Drift Detection

Use `GET /api/v1/posture/diffs/{node_id}` to get a timeline of all detected changes between consecutive snapshots.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/posture/snapshots` | Create snapshot |
| GET | `/api/v1/posture/snapshots/{node_id}` | List snapshots for node |
| GET | `/api/v1/posture/snapshots/{node_id}/latest` | Get latest snapshot |
| GET | `/api/v1/posture/diffs/{node_id}` | Get diffs between snapshots |
| GET | `/api/v1/posture/compare/{node_id}` | Compare two specific snapshots |

---

## Findings

Findings are security issues detected by the system. They can be auto-generated (from behavior rules) or manually created.

### Finding Properties

| Field | Description |
|-------|-------------|
| **Severity** | Critical, High, Medium, Low, Info |
| **Status** | Open, Acknowledged, In Progress, Resolved, False Positive |
| **Source** | Which rule or method generated the finding |
| **Node** | Affected endpoint |
| **Evidence** | Related events and data |
| **Risk Score** | Severity-weighted numerical score |

### Risk Scoring

Findings are scored based on severity, recurrence, and the number of affected nodes. The fleet-wide risk score aggregates all open findings.

### Workflow

1. **Detection** → Rule matches incoming events
2. **Finding created** → Appears in Security Center
3. **Triage** → Admin reviews and acknowledges
4. **Remediation** → Fix the issue on the endpoint
5. **Resolution** → Mark as resolved or false positive

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/security/findings` | List findings |
| GET | `/api/v1/security/findings/summary` | Summary by severity/status |
| POST | `/api/v1/security/findings` | Create finding manually |
| PUT | `/api/v1/security/findings/{id}` | Update status/severity |
| GET | `/api/v1/findings` | Alternative findings endpoint |
| GET | `/api/v1/findings/{id}` | Get finding details |
| PUT | `/api/v1/findings/{id}` | Update finding |

---

## Activity Dashboards

### File Activity

`GET /api/v1/security/activity/files`

Visualizes file operations across the fleet:
- Top modified paths
- Activity timeline (events per hour/day)
- Nodes with most file activity
- Unusual activity spikes

### User Activity

`GET /api/v1/security/activity/users`

Tracks user-level activity:
- Login events and patterns
- After-hours activity alerts
- Failed login attempts
- Privilege escalation events

### Export

`GET /api/v1/security/activity/export`

Export activity data in various formats for external analysis.

---

## Evidence Export

Evidence export packages security data for forensic investigation, compliance audits, or legal proceedings.

### Creating an Export

```
POST /api/v1/evidence/export
```

An export can include:
- Security findings (filtered by date range, severity, node)
- Related events and file audit logs
- Posture snapshots
- Activity data

### Listing Exports

```
GET /api/v1/evidence/exports
```

Returns all created exports with download links and metadata.

---

## Retention & Legal Hold

Retention policies control how long different categories of security data are kept.

### Configuration

```
GET /api/v1/retention          # View current policies
PUT /api/v1/retention/{category}  # Update a category
```

### Categories

| Category | Default | Description |
|----------|---------|-------------|
| Events | 90 days | Raw security events |
| Findings | 365 days | Security findings |
| Posture | 180 days | Configuration snapshots |
| Audit | 365 days | Audit log entries |
| Metrics | 90 days | Performance metrics |

### Legal Hold

When legal hold is enabled for a category, data is **never automatically deleted**, regardless of the retention setting. This is essential for compliance and legal discovery scenarios.

---

## Security Policies

Security policies define organizational security standards and baselines.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/security/policies` | List policies |
| POST | `/api/v1/security/policies` | Create policy |
| PUT | `/api/v1/security/policies/{id}` | Update policy |
| DELETE | `/api/v1/security/policies/{id}` | Delete policy |

---

## Audit Logging

All administrative actions are logged for compliance:

- **Backend audit:** `GET /api/v1/audit` — API-level actions (who did what, when)
- **UI audit:** `GET /api/v1/audit/ui-events` — Frontend interactions (page views, button clicks)

Both endpoints support filtering by user, action type, and date range.

---

## Getting Started with Security Center

1. **Create a monitoring profile** with the file paths and event types you want to monitor
2. **Assign it** to your nodes or a group
3. **Create behavior rules** for the patterns you want to detect (start with the built-in templates)
4. **Review the dashboard** as events flow in and findings are generated
5. **Set up alerts** (Settings → Alert Channels) to get notified on Discord or other channels
6. **Configure retention** based on your compliance requirements

---

## Patch Management (E30) — NEW in v0.6.0

Octofleet now includes full Windows patch management. See [PATCH-MANAGEMENT.md](PATCH-MANAGEMENT.md) for the complete guide.

### Quick Overview

- **Patch Catalog** — Central registry of all patches, auto-populated by agent scans
- **Patch Rings** — Canary → Pilot → Broad rollout strategy for controlled deployment
- **Deployments** — Full lifecycle (create, schedule, pause, resume, cancel)
- **Compliance** — Per-node and fleet-wide compliance dashboards
- **Agent Scanner** — `PatchScanner.cs` discovers missing Windows updates automatically

### Getting Started

1. Agents automatically scan and report available patches
2. Review the patch catalog and approve/exclude patches
3. Create patch rings for your rollout strategy
4. Deploy patches through rings
5. Monitor compliance

---

## Configuration Baselines (E31) — NEW in v0.6.0

Configuration baselines let you define and enforce configuration standards based on CIS benchmarks.

### CIS Benchmark Templates

Pre-built templates available for:
- Windows Server 2022
- Windows Server 2025
- Windows 11

Import a template to create a baseline with pre-configured rules for registry keys, service states, and security policies.

### Drift Detection & Remediation

- **Automatic evaluation** — Nodes are evaluated against assigned baselines
- **Drift events** — Created when a node deviates from its baseline
- **Actions** — Acknowledge, waive, or auto-remediate drifts
- **Trend charts** — Compliance trends over time

### API Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/baselines` | List baselines |
| POST | `/api/v1/baselines` | Create baseline |
| GET | `/api/v1/baselines/templates` | List CIS templates |
| POST | `/api/v1/baselines/templates/{id}/import` | Import template |
| GET | `/api/v1/baselines/drift` | List drift events |
| POST | `/api/v1/baselines/drift/{id}/remediate` | Auto-remediate |
| GET | `/api/v1/baselines/compliance/trends` | Compliance trends |

See [API-REFERENCE.md](API-REFERENCE.md#configuration-baselines) for the full endpoint list.
