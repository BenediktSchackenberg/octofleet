# SPRINTS.md — Sprint Planning & History

## Current Sprint

### Sprint 1 — 2026-02-07 → 2026-02-14
**Theme: Polish & Stability**

#### Goals
- [ ] Fix remaining UI bugs
- [ ] System Tray integration
- [ ] Auto-reconnect in Service
- [ ] Scheduled inventory push

#### Tasks
| ID | Task | Priority | Status | Notes |
|----|------|----------|--------|-------|
| S1-01 | System Tray Icon + Minimize to Tray | High | 🔲 Todo | Use Hardcodet.NotifyIcon.Wpf |
| S1-02 | Service auto-reconnect on disconnect | High | 🔲 Todo | Exponential backoff |
| S1-03 | Scheduled inventory.push (configurable interval) | High | 🔲 Todo | Default: 30 min |
| S1-04 | Service logging to file | Medium | 🔲 Todo | `C:\ProgramData\Octofleet\logs\` |
| S1-05 | Test full workflow on clean Windows install | Medium | 🔲 Todo | Document any missing deps |
| S1-06 | Version bump to 0.3.0 | Low | 🔲 Todo | After sprint complete |

#### Sprint Review (2026-02-14)
*To be filled after sprint*

---

## Sprint Template

```markdown
### Sprint X — YYYY-MM-DD → YYYY-MM-DD
**Theme: [One-liner description]**

#### Goals
- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

#### Tasks
| ID | Task | Priority | Status | Notes |
|----|------|----------|--------|-------|
| SX-01 | Task description | High/Med/Low | 🔲/🔄/✅ | Notes |

#### Sprint Review
- **Completed**: X/Y tasks
- **Carried over**: [list]
- **Learnings**: [what went well/badly]
```

---

## Sprint History

### Sprint 0 — 2026-02-05 → 2026-02-07 (Pre-Planning Phase)
**Theme: Foundation & Inventory System**

#### Completed Tasks

| ID | Task | Category | Status | Commit |
|----|------|----------|--------|--------|
| S0-01 | WPF App Grundstruktur (.NET 8, MVVM) | Agent | ✅ Done | Initial |
| S0-02 | Gateway WebSocket Verbindung | Agent | ✅ Done | Initial |
| S0-03 | Views: Dashboard, Gateways, Hosts, Commands, Logs | Agent | ✅ Done | Initial |
| S0-04 | DPAPI Credential Storage | Agent | ✅ Done | Initial |
| S0-05 | Node Registration + Pairing Flow | Agent | ✅ Done | Initial |
| S0-06 | Commands: system.run, system.which, node.ping | Agent | ✅ Done | Initial |
| S0-07 | Windows Service Projekt erstellt | Service | ✅ Done | v0.2.0 |
| S0-08 | Service läuft als SYSTEM, 24/7 Node-Connection | Service | ✅ Done | v0.2.0 |
| S0-09 | GUI Service Controls (Install/Start/Stop/Uninstall) | Agent | ✅ Done | v0.2.0 |
| S0-10 | UAC Elevation via sc.exe | Agent | ✅ Done | v0.2.0 |
| S0-11 | Background mode für system.run (GUI apps) | Service | ✅ Done | `8295cab` |
| S0-12 | HardwareCollector (CPU, RAM, GPU, Disks, Mainboard) | Inventory | ✅ Done | `e3b6625` |
| S0-13 | SoftwareCollector (Installed Programs) | Inventory | ✅ Done | `e3b6625` |
| S0-14 | HotfixCollector (WMI + Windows Update History) | Inventory | ✅ Done | `ed4022f` |
| S0-15 | SystemCollector (OS, Services, Startup, Env) | Inventory | ✅ Done | `e3b6625` |
| S0-16 | SecurityCollector (AV, Firewall, BitLocker, TPM, UAC) | Inventory | ✅ Done | `e3b6625` |
| S0-17 | NetworkCollector (Adapters, Connections, Open Ports) | Inventory | ✅ Done | `e3b6625` |
| S0-18 | BrowserCollector (Chrome, Edge, Firefox Profiles) | Inventory | ✅ Done | `e3b6625` |
| S0-19 | inventory.push Command (POST to Backend) | Inventory | ✅ Done | `99b6406` |
| S0-20 | PostgreSQL + TimescaleDB Docker Setup | Backend | ✅ Done | `8d058c3` |
| S0-21 | FastAPI Backend (Port 8080) | Backend | ✅ Done | `99b6406` |
| S0-22 | Alle GET/POST Endpoints für Inventory | Backend | ✅ Done | `99b6406` |
| S0-23 | update_history Table für Windows Updates | Backend | ✅ Done | `ed4022f` |
| S0-24 | Next.js Frontend (Port 3000) | Frontend | ✅ Done | `99b6406` |
| S0-25 | Dashboard mit Node-Übersicht | Frontend | ✅ Done | `99b6406` |
| S0-26 | Node Detail Page (7 Tabs) | Frontend | ✅ Done | `99b6406` |
| S0-27 | systemd Services (Backend + Frontend) | Infra | ✅ Done | `99b6406` |
| S0-28 | Segoe Fluent Icons UI Overhaul | Agent | ✅ Done | `52fdaa8` |
| S0-29 | App Icon (octofleet.ico) | Agent | ✅ Done | `52fdaa8` |
| S0-30 | Anonymous Types → DTOs Fix | Service | ✅ Done | `9533ea9` |
| S0-31 | Gateway allowCommands Config für inventory.* | Config | ✅ Done | Config |
| S0-32 | Backend nested format handling (submit_full) | Backend | ✅ Done | `b4d1193` |

#### Summary
- **32 Tasks completed** in ~3 Tage
- **~15.000+ Lines of Code** added
- **Releases**: v0.1.0, v0.2.0
- **Key Milestones**: 
  - Erster erfolgreicher inventory.push: 2026-02-07 00:03 UTC
  - Node DESKTOP-B4GCTCV erscheint im Dashboard

#### Learnings
- Gateway allowCommands muss explizit gesetzt werden (glob funktioniert nicht)
- system.run braucht Array-Format `{"command": ["hostname"]}`
- Service als SYSTEM kann keine User-Profile-Pfade lesen (Browser-Daten leer)
- paramsJSON vom Gateway ist doppelt-encoded (JSON-String in JSON)

---

## Labels Reference

| Label | Meaning |
|-------|---------|
| 🔲 Todo | Not started |
| 🔄 In Progress | Currently working on |
| ✅ Done | Completed |
| ⏸️ Blocked | Waiting on something |
| ❌ Cancelled | Won't do |

## Priority Levels

- **High**: Must complete this sprint
- **Medium**: Should complete if time allows
- **Low**: Nice to have, can slip

---
*Updated: 2026-02-07*
