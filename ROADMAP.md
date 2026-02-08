# ROADMAP.md — Endpoint Management Platform Roadmap

## Epic Overview

| Epic | Name | Priority | Est. Sprints |
|------|------|----------|--------------|
| **E1** | Enhanced Inventory | High | 1 |
| **E2** | Device Grouping | High | 1-2 |
| **E3** | Job System Core | High | 2 |
| **E4** | Package Management | High | 2 |
| **E5** | Deployment Engine | Medium | 2 |
| **E6** | Linux Agent | Medium | 2 |
| **E7** | Advanced UI | Medium | 2 |
| **E8** | Security & RBAC | Medium | 1 |
| **E9** | Rollout Strategies | Low | 1 |
| **E10** | Zero-Touch Installation | High | 3-4 |
| **E11** | Software Depot | High | 2 |
| **E12** | Software Zuweisung | High | 1-2 |
| **E13** | Installation & Deinstallation | High | 2 |
| **E14** | Installations-Status & Monitoring | High | 1-2 |

---

## User Story: Softwareverteilung auf inventarisierte Nodes

**Als** IT-Administrator / Systembetreiber  
**möchte ich** Softwarepakete aus einem zentralen Software-Depot auf inventarisierte PCs (Nodes) installieren, aktualisieren und deinstallieren können – sowohl gezielt auf einzelne Nodes als auch auf definierte Node-Gruppen,  
**damit** ich Software standardisiert, reproduzierbar und kontrolliert über eine zentrale Oberfläche verteilen und verwalten kann, ohne manuelle Eingriffe auf den einzelnen Systemen.

**Abhängige Epics:** E11, E12, E13, E14 + bestehende E3, E4, E5

---

## Phase 1: Foundation Enhancement (Sprint 2-3)

### Epic E1: Enhanced Inventory
*Was wir haben: Basic HW/SW/Security collectors*
*Was wir brauchen: Vollständige Inventory mit History*

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

### Epic E2: Device Grouping
*Statische + Dynamische Gruppen für Targeting*

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

### Epic E3: Job System Core
*Agent kann Jobs abholen und ausführen*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E3-01 | DB Schema: jobs, job_results | High | Job queue tables |
| E3-02 | API: Create job (target: device/group) | High | POST /jobs |
| E3-03 | API: Job poll endpoint for agent | High | GET /jobs/pending?nodeId=X |
| E3-04 | API: Job result submission | High | POST /jobs/{id}/result |
| E3-05 | Agent: Job polling loop | High | Check every X seconds |
| E3-06 | Agent: Job execution engine | High | Run commands, track state |
| E3-07 | Agent: Job state machine | High | Queued→Running→Success/Failed |
| E3-08 | Agent: Pre/Post script support | Medium | Run PS/Bash before/after |
| E3-09 | Agent: Reboot handling | Medium | Schedule reboot, resume after |
| E3-10 | Agent: Retry logic | Medium | Exponential backoff on failure |
| E3-11 | Frontend: Job queue view | High | Pending/Running/Completed |
| E3-12 | Frontend: Job detail + logs | High | Exit code, stdout, duration |
| E3-13 | Frontend: Create job wizard | Medium | Select target, command |
| E3-14 | Job types: script, command, reboot | High | Basic job types |

---

## Phase 3: Package Management (Sprint 6-7)

### Epic E4: Package Management
*Pakete definieren und bereitstellen*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E4-01 | DB Schema: packages, package_versions, sources | High | Package catalog |
| E4-02 | API: CRUD packages | High | Create/manage packages |
| E4-03 | API: Package versions | High | Multiple versions per package |
| E4-04 | API: Package sources (Share/URL) | High | Where to download from |
| E4-05 | Package definition model | High | Name, vendor, OS, commands |
| E4-06 | Detection Rules: MSI product code | High | Is package installed? |
| E4-07 | Detection Rules: Registry key | High | Check registry |
| E4-08 | Detection Rules: File exists/version | Medium | Check file |
| E4-09 | Detection Rules: Service exists | Medium | Check Windows service |
| E4-10 | Agent: Package download from Share (UNC) | High | SMB/CIFS support |
| E4-11 | Agent: Package download from HTTP | High | Web download |
| E4-12 | Agent: Download with hash verification | High | SHA-256 check |
| E4-13 | Agent: Local package cache | Medium | Don't re-download |
| E4-14 | Agent: Fallback logic (Share→Internet) | Medium | Policy-based |
| E4-15 | Agent: Run detection rules | High | Check if install needed |
| E4-16 | Agent: Execute install/uninstall | High | Run package commands |
| E4-17 | Frontend: Package catalog view | High | List all packages |
| E4-18 | Frontend: Package detail + versions | High | Show package info |
| E4-19 | Frontend: Package editor | Medium | Create/edit packages |
| E4-20 | Frontend: Upload package to share | Low | File upload |

---

## Phase 4: Deployments (Sprint 8-9)

### Epic E5: Deployment Engine
*Pakete an Gruppen ausrollen*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E5-01 | DB Schema: deployments, deployment_status | High | Deployment tracking |
| E5-02 | API: Create deployment | High | Package + Target + Mode |
| E5-03 | API: Deployment status aggregation | High | Success/Failed/Pending counts |
| E5-04 | Deployment modes: Required/Available/Uninstall | High | Install policy |
| E5-05 | Deployment scheduling | Medium | Start time, end time |
| E5-06 | Maintenance Windows | Medium | Only install during window |
| E5-07 | Network policy per deployment | Medium | Share-only, Internet-allowed |
| E5-08 | Agent: Check deployments on poll | High | What needs installing? |
| E5-09 | Agent: Report deployment status | High | Per-device status |
| E5-10 | Frontend: Deployment list view | High | All deployments |
| E5-11 | Frontend: Deployment detail | High | Status per device |
| E5-12 | Frontend: Create deployment wizard | High | Select package, target |
| E5-13 | Frontend: Deployment monitoring dashboard | Medium | Live progress |

---

## Phase 5: Advanced Features (Sprint 10+)

### Epic E6: Linux Agent
| ID | Task | Priority |
|----|------|----------|
| E6-01 | Linux agent skeleton (Python/Go) | High |
| E6-02 | Linux inventory collectors | High |
| E6-03 | Linux job execution | High |
| E6-04 | Linux package install (apt/yum) | High |
| E6-05 | systemd service integration | Medium |

### Epic E7: Advanced UI
| ID | Task | Priority |
|----|------|----------|
| E7-01 | Saved queries/filters | Medium |
| E7-02 | Compliance views | Medium |
| E7-03 | Dashboard widgets | Medium |
| E7-04 | Bulk actions | Medium |
| E7-05 | Export to CSV/PDF | Low |

### Epic E8: Security & RBAC
| ID | Task | Priority |
|----|------|----------|
| E8-01 | User authentication (OAuth/OIDC) | High |
| E8-02 | Role-based access control | High |
| E8-03 | Audit logging | High |
| E8-04 | API keys for agents | Medium |
| E8-05 | Certificate-based auth | Low |

### Epic E9: Rollout Strategies
| ID | Task | Priority |
|----|------|----------|
| E9-01 | Staged rollout (percentages) | Medium |
| E9-02 | Pilot groups | Medium |
| E9-03 | Auto-pause on failure threshold | Medium |
| E9-04 | Rollback support | Low |

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
*Zentrales Paket-Repository im lokalen Netzwerk*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E11-01 | Depot-Architektur definieren (SMB/HTTP/S3) | High | Entscheidung treffen |
| E11-02 | DB Schema für Depot-Quellen | High | sources table |
| E11-03 | API: Depot-Quellen CRUD | High | Verwaltung der Quellen |
| E11-04 | API: Paket-Upload Endpoint | Medium | multipart/form-data |
| E11-05 | Paket-Metadaten Parser | High | Name, Version, Plattform |
| E11-06 | Versionierung im Depot | High | Mehrere Versionen pro Paket |
| E11-07 | Frontend: Depot-Verwaltung Seite | High | Quellen-Übersicht |
| E11-08 | Frontend: Paket-Upload Dialog | Medium | Drag & Drop Upload |
| E11-09 | Offline-fähiges Depot | High | Lokales Netzwerk ohne Internet |

### Epic E12: Software Zuweisung
*Pakete zu Nodes und Gruppen zuweisen*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E12-01 | DB Schema für Zuweisungen | High | assignments table |
| E12-02 | API: Paket zu Node zuweisen | High | POST /assignments |
| E12-03 | API: Paket zu Gruppe zuweisen | High | Gruppen-Targeting |
| E12-04 | API: Mehrfach-Zuweisungen pro Node | Medium | Node kann n Pakete haben |
| E12-05 | API: Zuweisung entfernen | High | Triggers Deinstallation |
| E12-06 | Frontend: Zuweisung auf Node-Detail | High | Installierte Pakete anzeigen |
| E12-07 | Frontend: Zuweisung auf Gruppen-Seite | High | Gruppen-Pakete |
| E12-08 | Frontend: Bulk-Zuweisung Dialog | Medium | Multi-Select |

### Epic E13: Installation & Deinstallation
*Agent-seitige Ausführung der Installationen*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E13-01 | Agent: software.install Command | High | Neuer Command Handler |
| E13-02 | Agent: software.uninstall Command | High | Deinstallation |
| E13-03 | Agent: Paket aus Depot laden (SMB/HTTP) | High | Download-Logik |
| E13-04 | Agent: MSI/EXE/Script ausführen | High | Universelle Installer-Unterstützung |
| E13-05 | Agent: Deinstallationsbefehl ausführen | High | MsiExec /x oder custom |
| E13-06 | Agent: Exit-Code und Logs zurückmelden | High | Rückmeldung an Backend |
| E13-07 | Agent: Silent/Unattended Install | High | Keine User-Interaktion |
| E13-08 | Agent: Retry-Logik | Medium | Bei Fehlern wiederholen |
| E13-09 | Agent: Pre/Post Install Hooks | Low | Custom Scripts vor/nach Install |

### Epic E14: Installations-Status & Monitoring
*Zentrale Übersicht über alle Installationen*

| ID | Task | Priority | Notes |
|----|------|----------|-------|
| E14-01 | DB Schema: deployment_status | High | Status pro Node/Paket |
| E14-02 | Status-Werte definieren | High | geplant/in Ausführung/erfolgreich/fehlgeschlagen |
| E14-03 | API: Status-Update vom Agent | High | Webhook/Polling |
| E14-04 | API: Installations-Logs speichern | High | STDOUT/STDERR erfassen |
| E14-05 | API: Exit-Codes erfassen | High | Fehleranalyse |
| E14-06 | Frontend: Deployment-Status Dashboard | High | Übersicht aller Deployments |
| E14-07 | Frontend: Status-Badges auf Node-Seite | Medium | Visual Feedback |
| E14-08 | Frontend: Log-Viewer für Fehler | High | Debugging |
| E14-09 | API: Aggregierte Statistiken | Medium | Success Rate, Pending Count |

---
*Updated: 2026-02-08 — Software Distribution Epics added*
