# GitHub Project Board Setup — Anleitung

## 1. Project erstellen (30 Sekunden)

1. Geh zu: https://github.com/BenediktSchackenberg/octofleet-windows-agent
2. Klick **Projects** Tab
3. Klick **Link a project** → **New project**
4. Template: **Board** wählen
5. Name: `Octofleet Windows Agent`
6. Klick **Create project**

## 2. Spalten einrichten (30 Sekunden)

Das Board hat default Spalten. Umbenennen zu:
- `Backlog` (erste Spalte)
- `Sprint 1` (zweite Spalte) 
- `In Progress` (dritte Spalte)
- `Done` (vierte Spalte)

Klick auf Spalten-Header → **Edit column**

## 3. Sprint 1 Tasks hinzufügen (1 Minute)

Klick **+ Add item** in der `Sprint 1` Spalte und füge diese hinzu:

```
S1-01: System Tray Icon + Minimize to Tray
S1-02: Service auto-reconnect on disconnect  
S1-03: Scheduled inventory.push (configurable interval)
S1-04: Service logging to file
S1-05: Test full workflow on clean Windows install
S1-06: Version bump to 0.3.0
```

## 4. Backlog Items hinzufügen (optional)

Aus BACKLOG.md die High Priority Items:

```
Auto-Reconnect Service
Health Endpoint
Config Hot-Reload
Delta Updates
Disk Space Alerts
System Tray Icon
Dark/Light Theme Toggle
```

## 5. Labels erstellen (optional)

Geh zu **Settings** → **Labels** im Repo:
- `priority:high` (rot)
- `priority:medium` (gelb)  
- `priority:low` (grün)
- `area:agent` (blau)
- `area:service` (lila)
- `area:inventory` (cyan)
- `area:backend` (orange)
- `area:frontend` (pink)

---

**Fertig!** Das Board ist ready für Sprint 1.

URL: https://github.com/users/BenediktSchackenberg/projects/1
