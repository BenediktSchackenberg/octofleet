# VISION.md — Endpoint Management Platform

## Projektname: Octofleet Endpoint Manager

Eine zentrale, webbasierte Endpoint-Management-Plattform für Windows und Linux.

## Core Features

1. **Inventar & Telemetrie** — Hardware, Software, Patches, Security
2. **Job-System** — Software-Installation, Scripts, Aktionen
3. **Gruppen/Targets** — Statische + Dynamische Gruppen, Tags
4. **Paketmanagement** — Multi-Source (Share/Internet), Detection Rules
5. **Deployments** — Rollout-Steuerung, Maintenance Windows
6. **Web UI** — Dashboard, Geräte, Gruppen, Pakete, Audit

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Frontend (Next.js)                    │
├─────────────────────────────────────────────────────────────┤
│                    Backend API (FastAPI)                     │
├──────────────┬──────────────┬──────────────┬────────────────┤
│   Devices    │    Groups    │   Packages   │     Jobs       │
├──────────────┴──────────────┴──────────────┴────────────────┤
│              PostgreSQL + TimescaleDB                        │
└─────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
        │ HTTPS/WSS          │                    │
┌───────┴────────┐  ┌────────┴───────┐  ┌────────┴───────┐
│ Windows Agent  │  │  Linux Agent   │  │  Windows Agent │
│ (.NET Service) │  │   (systemd)    │  │  (.NET Service)│
└────────────────┘  └────────────────┘  └────────────────┘
```

## Phasen-Übersicht

| Phase | Focus | Duration |
|-------|-------|----------|
| **Phase 1** | Foundation | 2-3 Sprints |
| **Phase 2** | Job System | 2-3 Sprints |
| **Phase 3** | Package Management | 2-3 Sprints |
| **Phase 4** | Deployments | 2 Sprints |
| **Phase 5** | Advanced Features | 2+ Sprints |

---
*Created: 2026-02-07*
