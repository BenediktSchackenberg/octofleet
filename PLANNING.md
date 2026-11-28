# Octofleet System - Planungsdokument

> ⚠️ **STATUS: PLANNING** - Dieses Dokument beschreibt das Zielbild für das Inventory-System.

## 🎯 Zielbild

Ein zentrales Inventar-System für **1000+ Windows Nodes** mit:
- **Automatischer täglicher Datensammlung** (Hardware, Software, Browser, System)
- **Historischer Verlauf** (Änderungen über Zeit tracken)
- **Modernes Web-Dashboard** (Apache-hosted)
- **Alerting** bei Änderungen (optional)

---

## 🏗️ Architektur (1000 Nodes Scale)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              NETZWERK                                       │
│                                                                             │
│   ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                                  │
│   │Win 1│ │Win 2│ │Win 3│ │.....│ │Win N│   1000 Windows Agents            │
│   └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘                                  │
│      │       │       │       │       │                                      │
│      └───────┴───────┴───┬───┴───────┘                                      │
│                          │ WebSocket (Port 18789)                           │
│                          ▼                                                  │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │                     LINUX SERVER (Gateway Host)                       │ │
│   │                                                                       │ │
│   │  ┌─────────────────┐                                                  │ │
│   │  │  Octofleet       │◄─── Du chattest hier (Discord/Telegram/etc)     │ │
│   │  │  Gateway        │                                                  │ │
│   │  │  :18789         │                                                  │ │
│   │  └────────┬────────┘                                                  │ │
│   │           │                                                           │ │
│   │           │ nodes invoke inventory.*                                  │ │
│   │           ▼                                                           │ │
│   │  ┌─────────────────┐     ┌─────────────────┐                         │ │
│   │  │  Inventory      │     │  PostgreSQL     │                         │ │
│   │  │  Collector      │────►│  + TimescaleDB  │                         │ │
│   │  │  (Python/Node)  │     │  :5432          │                         │ │
│   │  └─────────────────┘     └────────┬────────┘                         │ │
│   │                                   │                                   │ │
│   └───────────────────────────────────┼───────────────────────────────────┘ │
│                                       │                                      │
│   ┌───────────────────────────────────┼───────────────────────────────────┐ │
│   │                     WEBSERVER (kann gleicher oder separater Host)     │ │
│   │                                   │                                   │ │
│   │  ┌─────────────────┐     ┌────────┴────────┐                         │ │
│   │  │  Apache         │     │  Backend API    │                         │ │
│   │  │  :80/:443       │────►│  (Python        │                         │ │
│   │  │                 │     │   FastAPI)      │                         │ │
│   │  │  serves:        │     │  :3001          │                         │ │
│   │  │  - Frontend     │     └─────────────────┘                         │ │
│   │  │  - Reverse Proxy│                                                  │ │
│   │  └─────────────────┘                                                  │ │
│   │                                                                       │ │
│   │  Frontend: Vue 3 + Vite (Static Build)                               │ │
│   └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Datenmodell

### Zu sammelnde Daten pro Node

| Kategorie | Daten | Größe/Node | Frequenz |
|-----------|-------|------------|----------|
| **Hardware** | CPU, RAM, Disks, Mainboard, BIOS, GPU, NICs | ~5 KB | Täglich |
| **Software** | Installierte Apps, Versionen, Publisher | ~50-200 KB | Täglich |
| **Hotfixes** | Windows Updates, KB-Nummern | ~10 KB | Täglich |
| **Browser - Chrome** | Extensions, Cookies, History, Logins | ~100 KB - 5 MB | Täglich |
| **Browser - Firefox** | Extensions, Cookies, History, Logins | ~100 KB - 5 MB | Täglich |
| **Browser - Edge** | Extensions, Cookies, History, Logins | ~100 KB - 5 MB | Täglich |
| **System** | OS Version, Domain, Users, Services, Startup | ~20 KB | Täglich |
| **Network** | Offene Ports, Verbindungen, Firewall Rules | ~10 KB | Täglich |
| **Security** | AV Status, Encryption, Policies | ~5 KB | Täglich |

### Geschätzte Datenmenge

- Pro Node/Tag: ~500 KB - 15 MB (je nach Browser-Daten)
- 1000 Nodes/Tag: ~500 MB - 15 GB
- Pro Monat: ~15-450 GB (mit Kompression ~5-50 GB)

---

## 🗄️ Datenbank-Schema

### PostgreSQL + TimescaleDB

```sql
-- ============ STAMMDATEN ============

-- Nodes (statische Infos)
CREATE TABLE nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id         VARCHAR(255) UNIQUE NOT NULL,  -- "node-host", "pc-accounting-01"
    hostname        VARCHAR(255) NOT NULL,
    domain          VARCHAR(255),
    os_name         VARCHAR(255),
    os_version      VARCHAR(100),
    os_build        VARCHAR(50),
    first_seen      TIMESTAMPTZ DEFAULT NOW(),
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    is_online       BOOLEAN DEFAULT FALSE,
    tags            JSONB DEFAULT '[]',            -- ["accounting", "floor-2"]
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============ LATEST SNAPSHOTS (Current State) ============

-- Hardware (aktuell)
CREATE TABLE hardware_current (
    node_id         UUID REFERENCES nodes(id) PRIMARY KEY,
    cpu             JSONB,      -- {"name": "i7-12700", "cores": 12, ...}
    ram             JSONB,      -- {"totalGB": 32, "modules": [...]}
    disks           JSONB,      -- [{"model": "Samsung 980", ...}]
    mainboard       JSONB,      -- {"manufacturer": "ASUS", ...}
    bios            JSONB,      -- {"vendor": "AMI", "version": "1.2"}
    gpu             JSONB,      -- [{"name": "RTX 4080", ...}]
    nics            JSONB,      -- [{"name": "Ethernet", "mac": "..."}]
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Software (aktuell)
CREATE TABLE software_current (
    node_id         UUID REFERENCES nodes(id),
    name            VARCHAR(500) NOT NULL,
    version         VARCHAR(100),
    publisher       VARCHAR(255),
    install_date    DATE,
    install_path    TEXT,
    size_mb         INTEGER,
    PRIMARY KEY (node_id, name, version)
);

-- Hotfixes (aktuell)
CREATE TABLE hotfixes_current (
    node_id         UUID REFERENCES nodes(id),
    kb_id           VARCHAR(20) NOT NULL,
    description     TEXT,
    installed_on    DATE,
    PRIMARY KEY (node_id, kb_id)
);

-- Browser Data (aktuell)
CREATE TABLE browser_current (
    node_id         UUID REFERENCES nodes(id),
    browser         VARCHAR(50) NOT NULL,  -- 'chrome', 'firefox', 'edge'
    profile         VARCHAR(255),
    extensions      JSONB,      -- [{"name": "uBlock", "version": "..."}]
    cookies_count   INTEGER,
    history_count   INTEGER,
    logins_count    INTEGER,
    bookmarks_count INTEGER,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (node_id, browser, profile)
);

-- Browser Cookies (aktuell) - Separate weil viele
CREATE TABLE browser_cookies_current (
    id              BIGSERIAL PRIMARY KEY,
    node_id         UUID REFERENCES nodes(id),
    browser         VARCHAR(50),
    domain          VARCHAR(500),
    name            VARCHAR(500),
    value           TEXT,           -- Encrypted at rest!
    expires         TIMESTAMPTZ,
    secure          BOOLEAN,
    http_only       BOOLEAN,
    same_site       VARCHAR(20),
    created_at      TIMESTAMPTZ
);
CREATE INDEX idx_cookies_node ON browser_cookies_current(node_id);
CREATE INDEX idx_cookies_domain ON browser_cookies_current(domain);

-- System Info (aktuell)
CREATE TABLE system_current (
    node_id         UUID REFERENCES nodes(id) PRIMARY KEY,
    local_users     JSONB,      -- [{"name": "Admin", "lastLogin": "..."}]
    domain_users    JSONB,      -- Domain-joined users
    services        JSONB,      -- Running services
    startup_items   JSONB,      -- Autostart entries
    scheduled_tasks JSONB,      -- Windows Task Scheduler
    shares          JSONB,      -- Network shares
    printers        JSONB,      -- Installed printers
    env_vars        JSONB,      -- Environment variables
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Security Info (aktuell)
CREATE TABLE security_current (
    node_id         UUID REFERENCES nodes(id) PRIMARY KEY,
    antivirus       JSONB,      -- {"name": "Defender", "enabled": true, ...}
    firewall        JSONB,      -- Firewall status
    bitlocker       JSONB,      -- Encryption status per drive
    uac_enabled     BOOLEAN,
    secure_boot     BOOLEAN,
    tpm_version     VARCHAR(20),
    last_scan       TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============ HISTORY (TimescaleDB Hypertables) ============

-- Full Snapshots (für Zeitreisen)
CREATE TABLE node_snapshots (
    time            TIMESTAMPTZ NOT NULL,
    node_id         UUID NOT NULL,
    snapshot_type   VARCHAR(50),    -- 'full', 'hardware', 'software', etc.
    data            JSONB NOT NULL, -- Full snapshot data
    data_hash       VARCHAR(64),    -- SHA256 to detect changes
    PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('node_snapshots', 'time');

-- Software Changes (Diff-basiert)
CREATE TABLE software_changes (
    time            TIMESTAMPTZ NOT NULL,
    node_id         UUID NOT NULL,
    change_type     VARCHAR(20),    -- 'installed', 'uninstalled', 'updated'
    software_name   VARCHAR(500),
    old_version     VARCHAR(100),
    new_version     VARCHAR(100),
    PRIMARY KEY (time, node_id, software_name)
);
SELECT create_hypertable('software_changes', 'time');

-- Hardware Changes
CREATE TABLE hardware_changes (
    time            TIMESTAMPTZ NOT NULL,
    node_id         UUID NOT NULL,
    change_type     VARCHAR(50),    -- 'disk_added', 'ram_changed', etc.
    component       VARCHAR(100),
    old_value       JSONB,
    new_value       JSONB,
    PRIMARY KEY (time, node_id, component)
);
SELECT create_hypertable('hardware_changes', 'time');

-- Metrics (für Dashboards)
CREATE TABLE node_metrics (
    time            TIMESTAMPTZ NOT NULL,
    node_id         UUID NOT NULL,
    cpu_percent     REAL,
    ram_percent     REAL,
    disk_percent    REAL,           -- Primary disk
    network_in_mb   REAL,
    network_out_mb  REAL,
    PRIMARY KEY (time, node_id)
);
SELECT create_hypertable('node_metrics', 'time');

-- ============ RETENTION POLICIES ============

-- Snapshots: 1 Jahr behalten
SELECT add_retention_policy('node_snapshots', INTERVAL '365 days');

-- Changes: 2 Jahre behalten  
SELECT add_retention_policy('software_changes', INTERVAL '730 days');
SELECT add_retention_policy('hardware_changes', INTERVAL '730 days');

-- Metrics: 90 Tage behalten (hochfrequent)
SELECT add_retention_policy('node_metrics', INTERVAL '90 days');

-- ============ COMPRESSION (Speicherplatz sparen) ============

SELECT add_compression_policy('node_snapshots', INTERVAL '7 days');
SELECT add_compression_policy('node_metrics', INTERVAL '1 day');
```

---

## 🖥️ Agent Commands (Windows)

### Neue Inventory Commands

| Command | Beschreibung | Datenquelle |
|---------|--------------|-------------|
| `inventory.hardware` | CPU, RAM, Disks, Mainboard, BIOS, GPU, NICs | WMI |
| `inventory.software` | Installierte Programme | Registry |
| `inventory.hotfixes` | Windows Updates | WMI |
| `inventory.browser.chrome` | Chrome Profile, Extensions, Cookies, History | SQLite DBs |
| `inventory.browser.firefox` | Firefox Profile, Extensions, Cookies, History | SQLite DBs |
| `inventory.browser.edge` | Edge Profile, Extensions, Cookies, History | SQLite DBs |
| `inventory.system` | Users, Services, Startup, Tasks, Shares | WMI/Registry |
| `inventory.security` | AV, Firewall, BitLocker, TPM | WMI/PowerShell |
| `inventory.network` | Offene Ports, Verbindungen | netstat |
| `inventory.full` | Alles zusammen | Alle |

### Datenquellen auf Windows

```
┌─────────────────────────────────────────────────────────────────┐
│                     WINDOWS DATENQUELLEN                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  WMI (Windows Management Instrumentation)                        │
│  ├── Win32_Processor          → CPU Info                        │
│  ├── Win32_PhysicalMemory     → RAM Modules                     │
│  ├── Win32_DiskDrive          → Festplatten                     │
│  ├── Win32_BaseBoard          → Mainboard                       │
│  ├── Win32_BIOS               → BIOS                            │
│  ├── Win32_VideoController    → GPU                             │
│  ├── Win32_NetworkAdapter     → Netzwerkkarten                  │
│  ├── Win32_QuickFixEngineering→ Hotfixes                        │
│  ├── Win32_Service            → Dienste                         │
│  └── Win32_UserAccount        → Benutzer                        │
│                                                                  │
│  Registry                                                        │
│  ├── HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall   │
│  ├── HKLM\SOFTWARE\WOW6432Node\...\Uninstall                    │
│  ├── HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run         │
│  └── HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run         │
│                                                                  │
│  Browser SQLite Databases                                        │
│  ├── Chrome: %LOCALAPPDATA%\Google\Chrome\User Data\            │
│  │   ├── Default\Cookies                                        │
│  │   ├── Default\History                                        │
│  │   ├── Default\Login Data                                     │
│  │   └── Default\Extensions\                                    │
│  ├── Firefox: %APPDATA%\Mozilla\Firefox\Profiles\               │
│  │   ├── cookies.sqlite                                         │
│  │   ├── places.sqlite (History)                                │
│  │   └── logins.json                                            │
│  └── Edge: %LOCALAPPDATA%\Microsoft\Edge\User Data\             │
│      └── (same as Chrome)                                       │
│                                                                  │
│  PowerShell Commands                                             │
│  ├── Get-BitLockerVolume      → Encryption Status               │
│  ├── Get-MpComputerStatus     → Defender Status                 │
│  ├── Get-NetFirewallProfile   → Firewall Status                 │
│  ├── Get-Tpm                  → TPM Info                        │
│  └── Get-ScheduledTask        → Geplante Tasks                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🌐 Web Frontend

### Tech Stack

| Komponente | Technologie | Warum |
|------------|-------------|-------|
| **Webserver** | Apache | Stabil, SSL easy, bereits vorhanden |
| **Frontend** | Vue 3 + Vite | Schnell, modern, gute DX |
| **UI Framework** | Vuetify 3 oder PrimeVue | Material Design, Tables, Charts |
| **Charts** | Apache ECharts | Performant bei viel Daten |
| **Backend API** | Python FastAPI | Schnell, async, gute DB-Integration |
| **ORM** | SQLAlchemy | PostgreSQL + TimescaleDB Support |

### Seiten / Views

```
📊 Dashboard
├── Online/Offline Nodes (Pie Chart)
├── Software-Änderungen letzte 7 Tage
├── Top 10 installierte Software
├── Hardware-Übersicht (RAM/CPU Verteilung)
├── Alerts (neue Software, offline Nodes)
└── Quick Stats (Total Nodes, Total Software, etc.)

🖥️ Nodes
├── Liste aller Nodes (Tabelle mit Suche/Filter/Sort)
├── Status-Icons (Online/Offline)
├── Quick-Actions (Details, Refresh, Compare)
└── Bulk-Aktionen (Tag zuweisen, Export)

🖥️ Node Detail (/nodes/:id)
├── Header: Hostname, OS, Last Seen, Tags
├── Tabs:
│   ├── Overview (Hardware Summary)
│   ├── Hardware (CPU, RAM, Disks, etc.)
│   ├── Software (Installed Apps Table)
│   ├── Hotfixes (Windows Updates)
│   ├── Browser (Chrome/Firefox/Edge Tabs)
│   ├── System (Users, Services, Startup)
│   ├── Security (AV, Firewall, Encryption)
│   ├── Network (Ports, Connections)
│   └── History (Timeline of Changes)
└── Actions: Refresh Now, Export, Compare

📦 Software
├── Alle installierte Software (aggregiert)
├── Filter: Publisher, Name, Version
├── "Wo ist X installiert?" → Node-Liste
└── Version-Verteilung pro Software

📈 Reports
├── Software-Änderungen (Zeitraum wählen)
├── Hardware-Inventar Export (CSV/Excel)
├── Compliance Report (fehlende Updates)
└── Browser-Daten Report

⚙️ Settings
├── Datensammlung Zeitplan
├── Retention Policies
├── API Keys
└── User Management
```

### UI Mockup

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🦀 Octofleet                          🔍 Search...    👤 Admin  ⚙️ │
├────────────┬─────────────────────────────────────────────────────────────────┤
│            │                                                                  │
│ 📊 Dashbo  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│ 🖥️ Nodes   │  │ 🟢 Online   │ │ 📦 Software │ │ 🔄 Changes  │ │ ⚠️ Alerts │ │
│ 📦 Softwar │  │    847      │ │   12,456    │ │    124      │ │    3      │ │
│ 🔐 Securit │  │   nodes     │ │   unique    │ │   today     │ │  pending  │ │
│ 📈 Reports │  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
│ ⚙️ Setting │                                                                  │
│            │  ┌─────────────────────────────┐ ┌─────────────────────────────┐│
│            │  │  Software Verteilung        │ │  Änderungen (7 Tage)        ││
│            │  │  ████████████░░ Chrome 847  │ │  ▂▅▇█▆▃▂                     ││
│            │  │  ██████████░░░░ Office 723  │ │  Mo Di Mi Do Fr Sa So       ││
│            │  │  ████████░░░░░░ 7-Zip  612  │ │                             ││
│            │  │  ██████░░░░░░░░ VLC    445  │ │  +89 installed              ││
│            │  │  ████░░░░░░░░░░ Python 312  │ │  -12 uninstalled            ││
│            │  └─────────────────────────────┘ └─────────────────────────────┘│
│            │                                                                  │
│            │  Recent Activity                                                 │
│            │  ┌──────────────────────────────────────────────────────────────┐│
│            │  │ 🟢 PC-ACC-01    Chrome updated 119→120         2 min ago    ││
│            │  │ 🔴 PC-SALES-05  Went offline                   15 min ago   ││
│            │  │ 🟢 PC-DEV-12    Visual Studio installed        1 hour ago   ││
│            │  │ 🟢 PC-HR-03     3 new cookies (linkedin.com)   2 hours ago  ││
│            │  └──────────────────────────────────────────────────────────────┘│
└────────────┴─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Datenfluss

### Tägliche Inventur (03:00 Uhr)

```
1. Octofleet Cron Job triggert
   │
2. Für jeden Online Node:
   │  ├── nodes invoke inventory.full
   │  └── Wartet auf Response (max 5 min)
   │
3. Collector Service empfängt Daten
   │  ├── Parse JSON
   │  ├── Berechne Diff zu vorherigem Snapshot
   │  └── Speichere:
   │       ├── node_snapshots (Vollständig)
   │       ├── *_current (Latest State)
   │       └── *_changes (Nur Diffs)
   │
4. Optional: Alerts generieren
   │  ├── Neue Software installiert
   │  ├── Security-Status geändert
   │  └── Node offline
   │
5. Dashboard aktualisiert automatisch (WebSocket/Polling)
```

### On-Demand Refresh

```
User klickt "Refresh" im Dashboard
   │
   └── API: POST /api/nodes/:id/refresh
            │
            └── nodes invoke inventory.full --node=xyz
                     │
                     └── Update DB + Return fresh data
```

---

## 🔐 Security Considerations

### Sensible Daten

| Daten | Risiko | Maßnahme |
|-------|--------|----------|
| Browser Cookies | Session Hijacking | Encryption at rest, Access Control |
| Browser Logins | Credential Theft | Encrypt, Hash, oder nicht speichern |
| WiFi Passwords | Network Access | Optional, verschlüsselt |
| BitLocker Keys | Disk Decryption | Nicht speichern oder HSM |

### Empfehlungen

1. **Datenbank verschlüsseln** (PostgreSQL TDE oder Disk Encryption)
2. **API Auth** (JWT/API Keys mit Rollen)
3. **HTTPS only** (Apache mit Let's Encrypt)
4. **Audit Log** (Wer hat was wann abgefragt)
5. **Browser-Passwörter: NICHT speichern** (nur Existenz zählen)

---

## 📅 Projektphasen

### Phase 0: Setup (1 Tag)
- [ ] PostgreSQL + TimescaleDB installieren
- [ ] Schema erstellen
- [ ] Apache vorbereiten

### Phase 1: Agent Commands (3-5 Tage)
- [ ] `inventory.hardware` (WMI)
- [ ] `inventory.software` (Registry)
- [ ] `inventory.hotfixes` (WMI)
- [ ] `inventory.system` (Users, Services, Startup)
- [ ] `inventory.security` (AV, Firewall, BitLocker)
- [ ] `inventory.browser.*` (Chrome, Firefox, Edge)
- [ ] `inventory.full` (Kombiniert alles)

### Phase 2: Collector Backend (2-3 Tage)
- [ ] Python FastAPI Setup
- [ ] DB Models (SQLAlchemy)
- [ ] Collector Logic (Parse + Store + Diff)
- [ ] REST API Endpoints
- [ ] Octofleet Integration (Cron Job)

### Phase 3: Frontend MVP (5-7 Tage)
- [ ] Vue 3 + Vite Setup
- [ ] Dashboard View
- [ ] Nodes List + Detail
- [ ] Software Overview
- [ ] Basic Charts

### Phase 4: Polish (3-5 Tage)
- [ ] History/Timeline View
- [ ] Search/Filter
- [ ] Export (CSV/Excel)
- [ ] Alerts
- [ ] User Management

### Phase 5: Scale Testing (2-3 Tage)
- [ ] 100 Nodes Test
- [ ] 1000 Nodes Test
- [ ] Performance Tuning
- [ ] Dokumentation

---

## 💾 Hardware Requirements (Server)

Für 1000 Nodes:

| Komponente | Minimum | Empfohlen |
|------------|---------|-----------|
| CPU | 4 Cores | 8+ Cores |
| RAM | 8 GB | 16-32 GB |
| Disk | 100 GB SSD | 500 GB NVMe |
| Network | 100 Mbit | 1 Gbit |

PostgreSQL + TimescaleDB sind relativ effizient, aber bei 1000 Nodes mit Browser-Daten wird's schon ordentlich.

---

## ❓ Offene Entscheidungen

1. **Browser-Passwörter:** Speichern (verschlüsselt) oder nur zählen?
2. **Realtime Metrics:** CPU/RAM live oder reicht täglich?
3. **Multi-User:** Verschiedene User-Rollen im Dashboard?
4. **Retention:** Wie lange sollen historische Daten aufbewahrt werden?
5. **Alerting:** Wohin? (Email, Discord, Dashboard-only?)

---

## 📝 Changelog

| Datum | Änderung |
|-------|----------|
| 2026-02-06 | Initiales Planungsdokument erstellt |

---

*Teil des [Octofleet](https://octofleet.dev) Ecosystems* 🦀
