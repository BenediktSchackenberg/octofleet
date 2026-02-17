# ROADMAP.md — Endpoint Management Platform Roadmap

## Epic Overview

| Epic | Name | Priority | Status |
|------|------|----------|--------|
| **E1** | Enhanced Inventory | High | ✅ Complete |
| **E2** | Device Grouping | High | ✅ Complete |
| **E3** | Job System Core | High | ✅ Complete |
| **E4** | Package Management | High | ✅ Complete |
| **E5** | Deployment Engine | Medium | ✅ Complete |
| **E6** | Linux Agent | Medium | ✅ Complete |
| **E7** | Alerting & Notifications | Medium | ✅ Complete |
| **E8** | Security & RBAC | Medium | ✅ Complete |
| **E9** | Rollout Strategies | Low | ✅ Complete |
| **E10** | Zero-Touch Installation | High | ✅ Complete |
| **E12** | Eventlog Collection | Medium | ✅ Complete |
| **E13** | Vulnerability Tracking | High | ✅ Complete |
| **E14** | Auto-Remediation | High | ✅ Complete |
| **E15** | Hardware Fleet Dashboard | Medium | ✅ Complete |
| **E16** | Live View (SSE) | Medium | ✅ Complete |
| **E17** | Screen Mirroring | Low | ✅ Complete |
| **E18** | Service Orchestration | High | ✅ Complete |

---

## User Story: Software Distribution to Inventoried Nodes

**As** an IT administrator / system operator  
**I want to** install, update, and uninstall software packages from a central software depot on inventoried PCs (nodes) — both targeted at individual nodes and defined node groups,  
**so that** I can distribute and manage software in a standardized, reproducible, and controlled way through a central interface, without manual intervention on individual systems.

**Dependent Epics:** E11, E12, E13, E14 + existing E3, E4, E5

---

## Phase 1: Foundation Enhancement (Sprint 2-3)

### Epic E1: Enhanced Inventory
*What we have: Basic HW/SW/Security collectors*
*What we need: Complete inventory with history*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E1-01 | Add BIOS/UEFI info to HardwareCollector | Medium | SerialNumber, UUID, BIOS Version |
| E1-02 | Add Virtualization detection | Medium | VMware/Hyper-V/VirtualBox/Physical |
| E1-03 | Add Domain/Workgroup info | High | Domain join status, OU |
| E1-04 | Add Uptime/Boot-Time to SystemCollector | Low | Already partial |
| E1-05 | Add MSI Product Codes to SoftwareCollector | High | For detection rules later |
| E1-06 | Add Performance Snapshots (CPU/RAM/Disk) | Medium | Live metrics |
| E1-07 | Add local Admins list to SecurityCollector | Medium | Who has admin rights |
| E1-08 | Add RDP/SSH enabled status | Low | Remote access audit |
| E1-09 | Delta Inventory mode | Low | Only send changes |
| E1-10 | Backend: Inventory History tables | High | Track changes over time |
| E1-11 | Frontend: Device Timeline view | Medium | Show inventory changes |

### Epic E2: Device Grouping ✅ COMPLETE
*Static + Dynamic Groups for Targeting*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E2-01 | DB Schema: groups, device_groups, tags | High | Core tables |
| E2-02 | API: CRUD for static groups | High | Create/Read/Update/Delete |
| E2-03 | API: Assign devices to groups | High | Bulk assignment |
| E2-04 | API: Tags for devices | High | Free-form tags |
| E2-05 | API: Custom fields/attributes | Medium | Key-value pairs |
| E2-06 | Dynamic Groups: Rule engine | High | JSON rule definitions |
| E2-07 | Dynamic Groups: Evaluation on inventory push | High | Auto-assign on data change |
| E2-08 | Frontend: Groups list view | High | Tree or flat list |
| E2-09 | Frontend: Group detail + members | High | Show devices in group |
| E2-10 | Frontend: Rule builder UI | Medium | Visual AND/OR builder |
| E2-11 | Frontend: Bulk tag assignment | Medium | Multi-select + apply tags |
| E2-12 | Predefined dynamic groups | Low | "Windows 11", "Offline >7d", etc. |

---

## Phase 2: Job System (Sprint 4-5)

### Epic E3: Job System Core ✅ COMPLETE
*Agent can poll and execute jobs*

| ID | Task | Priority | Status |
|----|------|----------|--------|
| E3-01 | DB Schema: jobs, job_results | High | ✅ Done |
| E3-02 | API: Create job (target: device/group) | High | ✅ Done |
| E3-03 | API: Job poll endpoint for agent | High | ✅ Done |
| E3-04 | API: Job result submission | High | ✅ Done |
| E3-05 | Agent: Job polling loop | High | ✅ Done |
| E3-06 | Agent: Job execution engine | High | ✅ Done |
| E3-07 | Agent: Job state machine | High | ✅ Done |
| E3-08 | Agent: Pre/Post script support | Medium | ✅ Done |
| E3-09 | Agent: Reboot handling | Medium | ✅ Done |
| E3-10 | Agent: Retry logic | Medium | ✅ Done |
| E3-11 | Frontend: Job queue view | High | ✅ Done |
| E3-12 | Frontend: Job detail + logs | High | ✅ Done |
| E3-13 | Frontend: Create job wizard | Medium | ✅ Done |
| E3-14 | Job types: script, command, reboot | High | ✅ Done |

---

## Phase 3: Package Management (Sprint 6-7)

### Epic E4: Package Management ✅ COMPLETE
*Define and provide packages*

| ID | Task | Priority | Status |
|----|------|----------|--------|
| E4-01 | DB Schema: packages, package_versions, sources | High | ✅ Done |
| E4-02 | API: CRUD packages | High | ✅ Done |
| E4-03 | API: Package versions | High | ✅ Done |
| E4-04 | API: Package sources (Share/URL) | High | ✅ Done |
| E4-05 | Package definition model | High | ✅ Done |
| E4-06 | Detection Rules: MSI product code | High | ✅ Done |
| E4-07 | Detection Rules: Registry key | High | ✅ Done |
| E4-08 | Detection Rules: File exists/version | Medium | ✅ Done |
| E4-09 | Detection Rules: Service exists | Medium | ✅ Done |
| E4-10 | Agent: Package download from Share (UNC) | High | ✅ Done |
| E4-11 | Agent: Package download from HTTP | High | ✅ Done |
| E4-12 | Agent: Download with hash verification | High | ✅ Done |
| E4-13 | Agent: Local package cache | Medium | ✅ Done |
| E4-14 | Agent: Fallback logic (Share→Internet) | Medium | ✅ Done |
| E4-15 | Agent: Run detection rules | High | ✅ Done |
| E4-16 | Agent: Execute install/uninstall | High | ✅ Done |
| E4-17 | Frontend: Package catalog view | High | Todo |
| E4-18 | Frontend: Package detail + versions | High | Todo |
| E4-19 | Frontend: Package editor | Medium | Todo |
| E4-20 | Frontend: Upload package to share | Low | Todo |

---

## Phase 4: Deployments (Sprint 8-9)

### Epic E5: Deployment Engine ✅ COMPLETE
*Roll out packages to groups*

| ID | Task | Priority | Status |
|----|------|----------|--------|
| E5-01 | DB Schema: deployments, deployment_status | High | ✅ Done |
| E5-02 | API: Create deployment | High | ✅ Done |
| E5-03 | API: Deployment status aggregation | High | ✅ Done |
| E5-04 | Deployment modes: Required/Available/Uninstall | High | ✅ Done |
| E5-05 | Deployment scheduling | Medium | ✅ Done |
| E5-06 | Maintenance Windows | Medium | Todo |
| E5-07 | Network policy per deployment | Medium | Todo |
| E5-08 | Agent: Check deployments on poll | High | ✅ Done |
| E5-09 | Agent: Report deployment status | High | ✅ Done |
| E5-10 | Frontend: Deployment list view | High | ✅ Done |
| E5-11 | Frontend: Deployment detail | High | ✅ Done |
| E5-12 | Frontend: Create deployment wizard | High | ✅ Done |
| E5-13 | Frontend: Deployment monitoring dashboard | Medium | ✅ Done |

---

## Phase 5: Advanced Features (Sprint 10+)

### Epic E6: Linux Agent ✅ COMPLETE
| ID | Task | Priority | Status |
|----|------|----------|--------|
| E6-01 | Linux agent skeleton (Bash) | High | ✅ Done |
| E6-02 | Linux inventory collectors | High | ✅ Done |
| E6-03 | Linux job execution | High | ✅ Done |
| E6-04 | Linux package detection (apt/dnf/pacman) | High | ✅ Done |
| E6-05 | systemd service integration | Medium | ✅ Done |
| E6-06 | One-line installer script | High | ✅ Done |

### Epic E7: Alerting & Notifications ✅ COMPLETE
| ID | Task | Priority | Status |
|----|------|----------|--------|
| E7-01 | DB Schema: alert_rules, notification_channels, alerts | High | ✅ Done |
| E7-02 | Alert types: node_offline, deployment_failed, disk_critical | High | ✅ Done |
| E7-03 | Discord webhook integration | High | ✅ Done |
| E7-04 | Slack webhook integration | High | ✅ Done |
| E7-05 | Microsoft Teams integration | High | ✅ Done |
| E7-06 | Generic webhook support | Medium | ✅ Done |
| E7-07 | Alert cooldowns (prevent spam) | Medium | ✅ Done |
| E7-08 | Node health tracking | High | ✅ Done |
| E7-09 | Frontend: Alerts page | High | ✅ Done |
| E7-10 | Frontend: Acknowledge/Resolve actions | High | ✅ Done |
| E7-11 | Frontend: Channel management | High | ✅ Done |
| E7-12 | Frontend: Rule-to-channel linking | Medium | ✅ Done |

### Epic E8: Security & RBAC
| ID | Task | Priority |
|----|------|----------|
| E8-01 | User authentication (OAuth/OIDC) | High |
| E8-02 | Role-based access control | High |
| E8-03 | Audit logging | High |
| E8-04 | API keys for agents | Medium |
| E8-05 | Certificate-based auth | Low |

### Epic E9: Rollout Strategies ✅ COMPLETE
| ID | Task | Priority | Status |
|----|------|----------|--------|
| E9-01 | Staged rollout (percentages) | Medium | ✅ Done |
| E9-02 | Pilot groups | Medium | ✅ Done |
| E9-03 | Auto-pause on failure threshold | Medium | ✅ Done |
| E9-04 | Rollback support | Low | ✅ Done |

### Epic E14: Auto-Remediation 🆕
*Automatically fix vulnerabilities through deployments*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| **E14-01** | DB Schema: remediation_packages | High | Map CVE → Fix Package |
| **E14-02** | DB Schema: remediation_rules | High | Severity-based auto-fix rules |
| **E14-03** | DB Schema: remediation_history | High | Track what was auto-fixed |
| **E14-04** | API: Link package to CVE/software | High | "7zip-update fixes CVE-2024-11477" |
| **E14-05** | API: Remediation rules CRUD | High | Define when to auto-fix |
| **E14-06** | API: Trigger remediation scan | High | Check vulns → create jobs |
| **E14-07** | API: Remediation status endpoint | High | What's pending/fixed |
| **E14-08** | Remediation Engine: Severity filter | High | Only CRITICAL/HIGH auto-fix |
| **E14-09** | Remediation Engine: Package Matcher | High | Find fix-package for vuln |
| **E14-10** | Remediation Engine: Job Creator | High | Create deployment jobs |
| **E14-11** | Remediation Engine: Maintenance Window | Medium | Only deploy in safe windows |
| **E14-12** | Remediation Engine: Health Check | Medium | Verify fix worked |
| **E14-13** | Remediation Engine: Rollback on Failure | Medium | Auto-revert if broken |
| **E14-14** | winget/choco Detection | Medium | Auto-detect package manager |
| **E14-15** | winget Upgrade Support | Medium | `winget upgrade` as fix method |
| **E14-16** | choco Upgrade Support | Medium | `choco upgrade` as fix method |
| **E14-17** | Frontend: Remediation Dashboard | High | Overview of auto-fixes |
| **E14-18** | Frontend: Fix-Package Editor | High | Map packages to CVEs |
| **E14-19** | Frontend: One-Click Fix Button | High | Manual trigger per CVE |
| **E14-20** | Frontend: Remediation Rules Config | Medium | Configure auto-fix rules |
| **E14-21** | Frontend: Remediation History | Medium | What was fixed when |
| **E14-22** | Alert: Remediation Failed | Medium | Notify on failed auto-fix |
| **E14-23** | Alert: New Critical CVE | Medium | Notify when new CRITICAL found |

---

## Sprint 2 Proposal (Next Week)

**Theme: Groups & Enhanced Inventory**

| ID | Task | From Epic |
|----|------|-----------|
| E1-01 | BIOS/UEFI info | E1 |
| E1-02 | Virtualization detection | E1 |
| E1-03 | Domain/Workgroup info | E1 |
| E1-05 | MSI Product Codes | E1 |
| E2-01 | DB Schema: groups, tags | E2 |
| E2-02 | API: CRUD groups | E2 |
| E2-03 | API: Assign devices to groups | E2 |
| E2-04 | API: Tags for devices | E2 |
| E2-08 | Frontend: Groups list | E2 |

**Estimated: 8-10 Tasks**

---
*Created: 2026-02-07*

---

## Phase 6: Software Distribution (Sprint 11-14)

### Epic E11: Software Depot
*Central package repository in local network*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E11-01 | Define depot architecture (SMB/HTTP/S3) | High | Make decision |
| E11-02 | DB Schema for depot sources | High | sources table |
| E11-03 | API: Depot sources CRUD | High | Source management |
| E11-04 | API: Package upload endpoint | Medium | multipart/form-data |
| E11-05 | Package metadata parser | High | Name, Version, Platform |
| E11-06 | Versioning in depot | High | Multiple versions per package |
| E11-07 | Frontend: Depot management page | High | Sources overview |
| E11-08 | Frontend: Package upload dialog | Medium | Drag & drop upload |
| E11-09 | Offline-capable depot | High | Local network without internet |

### Epic E12: Software Assignment
*Assign packages to nodes and groups*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E12-01 | DB Schema for assignments | High | assignments table |
| E12-02 | API: Assign package to node | High | POST /assignments |
| E12-03 | API: Assign package to group | High | Group targeting |
| E12-04 | API: Multiple assignments per node | Medium | Node can have n packages |
| E12-05 | API: Remove assignment | High | Triggers uninstallation |
| E12-06 | Frontend: Assignment on node detail | High | Show installed packages |
| E12-07 | Frontend: Assignment on group page | High | Group packages |
| E12-08 | Frontend: Bulk assignment dialog | Medium | Multi-select |

### Epic E13: Installation & Uninstallation
*Agent-side execution of installations*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E13-01 | Agent: software.install command | High | New command handler |
| E13-02 | Agent: software.uninstall command | High | Uninstallation |
| E13-03 | Agent: Load package from depot (SMB/HTTP) | High | Download logic |
| E13-04 | Agent: Execute MSI/EXE/Script | High | Universal installer support |
| E13-05 | Agent: Execute uninstall command | High | MsiExec /x or custom |
| E13-06 | Agent: Report exit code and logs | High | Feedback to backend |
| E13-07 | Agent: Silent/Unattended install | High | No user interaction |
| E13-08 | Agent: Retry logic | Medium | Retry on failures |
| E13-09 | Agent: Pre/Post install hooks | Low | Custom scripts before/after install |

### Epic E14: Installation Status & Monitoring
*Central overview of all installations*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E14-01 | DB Schema: deployment_status | High | Status per node/package |
| E14-02 | Define status values | High | planned/running/success/failed |
| E14-03 | API: Status update from agent | High | Webhook/Polling |
| E14-04 | API: Store installation logs | High | Capture STDOUT/STDERR |
| E14-05 | API: Capture exit codes | High | Error analysis |
| E14-06 | Frontend: Deployment status dashboard | High | Overview of all deployments |
| E14-07 | Frontend: Status badges on node page | Medium | Visual feedback |
| E14-08 | Frontend: Log viewer for errors | High | Debugging |
| E14-09 | API: Aggregated statistics | Medium | Success rate, pending count |

---

## Phase 6: Service Orchestration (Sprint 12-15)

### Epic E18: Service-Klassen & Desired State Orchestrierung 🆕
*Define services, enforce desired state, auto-heal*

**Complexity: XL (3-4 Sprints) | Priority: High**

**Goal:** Define Service Classes (e.g., nginx-webservice, postgresql-cluster), assign nodes to services with roles, and let agents autonomously enforce the desired state with drift detection and auto-remediation.

#### E18-01: Service-Class Management

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-01a | DB Schema: service_classes, services, service_node_assignments | High | Core data model |
| E18-01b | API: CRUD for ServiceClass | High | Templates for services |
| E18-01c | ServiceClass parameters: Min/Max nodes, Roles, Packages | High | Cluster requirements |
| E18-01d | ServiceClass: Config templates (Jinja2-style) | High | postgresql.conf, nginx.conf |
| E18-01e | ServiceClass: Health check definitions | High | Port, HTTP, DB query checks |
| E18-01f | ServiceClass: Update/Rollout strategy | Medium | rolling, one-by-one |
| E18-01g | ServiceClass: Drift policy (strict/tolerant) | Medium | Auto-fix vs. alert-only |
| E18-01h | Frontend: ServiceClass CRUD UI | High | Create/edit service templates |

#### E18-02: Service Instances & Node Assignment

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-02a | API: CRUD for Service instances | High | Instantiate a ServiceClass |
| E18-02b | API: Assign nodes to service | High | Manual selection |
| E18-02c | API: Rule-based node assignment | Medium | Tags, OS, location, resources |
| E18-02d | API: Role assignment per node | High | Primary/Replica, Web-Node |
| E18-02e | Frontend: Service instance wizard | High | Create service from class |
| E18-02f | Frontend: Node assignment UI | High | Drag & drop or checkboxes |

#### E18-03: Agent Reconciliation Loop (Desired State)

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-03a | Agent: Receive ServiceDefinition + NodeRole | High | From Gateway |
| E18-03b | Agent: Install required packages | High | MSI/apt/yum/zip |
| E18-03c | Agent: Apply config templates | High | Variable substitution |
| E18-03d | Agent: Start/Enable services (systemd/Windows Services) | High | Service lifecycle |
| E18-03e | Agent: Execute health checks | High | Verify deployment |
| E18-03f | Agent: Drift detection loop | High | Compare actual vs. desired |
| E18-03g | Agent: Auto-remediation on drift | Medium | Per drift policy |
| E18-03h | Agent: Idempotent operations | High | Safe re-runs |
| E18-03i | Agent: Report reconciliation status | High | Success/Failed/Degraded |

#### E18-04: Reference Service: nginx-webservice

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-04a | ServiceClass template: nginx-webservice | High | 1..N web nodes |
| E18-04b | Nginx installation (apt/yum/chocolatey) | High | Cross-platform |
| E18-04c | Nginx config template (nginx.conf, vhost) | High | Variable-based |
| E18-04d | Health endpoint setup (/healthz) | High | HTTP 200 check |
| E18-04e | Optional: Deploy static content artifact | Medium | tar/zip deployment |
| E18-04f | E2E test: Create nginx service, verify health | High | Acceptance test |

#### E18-05: Reference Service: postgresql (Single & Cluster)

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-05a | ServiceClass template: postgresql-single | High | Single node DB |
| E18-05b | ServiceClass template: postgresql-cluster | High | Primary + Replicas |
| E18-05c | PostgreSQL installation (apt/yum/chocolatey) | High | Cross-platform |
| E18-05d | Config templates: postgresql.conf, pg_hba.conf | High | Streaming replication |
| E18-05e | Primary initialization workflow | High | initdb, create roles |
| E18-05f | Replica binding workflow | High | pg_basebackup, recovery.conf |
| E18-05g | Health checks: Port, replication lag, query | High | Multi-level checks |
| E18-05h | Scaling action: Add replica node | High | Scale 2→3 nodes |
| E18-05i | E2E test: Create cluster, verify replication | High | Acceptance test |

#### E18-06: Service Dashboard & Health

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-06a | Frontend: Services overview page | High | List all services |
| E18-06b | Service cards: Status, Availability, Node count | High | At-a-glance health |
| E18-06c | Service detail: Node list with roles | High | Drilldown view |
| E18-06d | Service detail: Desired vs. Actual state | High | Drift visualization |
| E18-06e | Service detail: Reconciliation history | High | Recent runs/actions |
| E18-06f | Availability calculation | Medium | SLA-style metrics |
| E18-06g | Service alerts integration | Medium | Alert on degraded state |

#### E18-07: Service Actions & Requests

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-07a | API: Scale service (add/remove nodes) | High | Horizontal scaling |
| E18-07b | API: Upgrade service version | Medium | Rolling upgrade |
| E18-07c | API: Restart service | Medium | Controlled restart |
| E18-07d | API: Deploy artifact | Medium | Push new content |
| E18-07e | Action creates Job with audit trail | High | Full traceability |
| E18-07f | Frontend: Action buttons on service page | High | One-click operations |

#### E18-08: Security & Config Management

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E18-08a | Secrets management: DB passwords, TLS keys | High | Encrypted storage |
| E18-08b | Secret injection to agents (short-lived tokens) | High | Secure delivery |
| E18-08c | Config versioning | Medium | Track config changes |
| E18-08d | Preflight checks: OS, ports, resources | Medium | Guardrails |
| E18-08e | Rollback on failure | Medium | Degraded state handling |
| E18-08f | Service-level locking (no concurrent changes) | Medium | Prevent conflicts |

**Definition of Done:**
- [ ] ServiceClass + Service CRUD in frontend
- [ ] Agent can provision Nginx & PostgreSQL (Single + Cluster) to desired state
- [ ] Dashboard shows service availability + drilldown
- [ ] Scaling: PostgreSQL Cluster 2→3 nodes via UI action
- [ ] Full audit trail (who/what/when) + agent logs per run visible

---
*Updated: 2026-02-15 — E18 Service Orchestration Epic added*

---
## Reference Services (E18-04, E18-05) ✅

Created 2026-02-17:

### nginx-webserver
- Type: cluster (1-10 nodes)
- Roles: web, loadbalancer
- Packages: nginx
- Health: HTTP /healthz on port 80
- Config: nginx.conf template with worker_processes, server_name, document_root

### postgresql-single
- Type: single (1 node)
- Roles: primary
- Packages: postgresql-16, postgresql-contrib-16
- Health: TCP port 5432
- Config: postgresql.conf template

### postgresql-cluster
- Type: cluster (2-5 nodes)
- Roles: primary, replica
- Packages: postgresql-16, postgresql-contrib-16
- Health: TCP port 5432
- Strategy: rolling updates
