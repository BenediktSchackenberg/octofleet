# Epic E10: Zero-Touch / One-Click Installation

**Status:** 📋 Planned  
**Priority:** High  
**Estimated Effort:** 3-4 Sprints

---

## User Story

> Als Octofleet-Administrator möchte ich neue Endgeräte mit dem Octofleet Windows Agent maximal einfach onboarden (idealerweise 1 Klick oder 1 Kommando), damit der Agent aus einem zentralen Repository (HTTP Download) installiert wird und sofort mit einer vorkonfigurierten `service-config.json` startet, ohne manuelles Nacharbeiten am Client.

---

## Akzeptanzkriterien

### A) Installation per HTTP Repository
- [ ] HTTP-Endpoint (Repository) für Agent-Pakete existiert
- [ ] Agent kann über HTTP heruntergeladen und installiert werden (GUI oder CLI)
- [ ] Download ist integriert - keine manuellen Datei-Suchen

### B) Vorkonfigurierte Config wird automatisch geschrieben
- [ ] Gültige UTF-8 `C:\ProgramData\Octofleet\service-config.json` wird erstellt
- [ ] Enthält: GatewayUrl, GatewayToken, DisplayName, InventoryApiUrl
- [ ] Service wird nach Config-Schreiben neu gestartet
- [ ] Agent verbindet sich automatisch mit Gateway

### C) Standardisiertes Paketformat
- [ ] Manifest-Datei (Metadaten, Version, Hashes, Install-Anweisungen)
- [ ] Installer (MSI/EXE)
- [ ] Optional: Config-Template für dynamische Werte

### D) Sicherheit & Integrität
- [ ] SHA256-Hash-Prüfung des Installers
- [ ] Optional: Authenticode Code Signing
- [ ] Token-Schutz (HTTPS + Zugriffsschutz ODER kurzlebige Enroll-Tokens)

### E) Rollout-Varianten (mindestens eine)
- [ ] **Variante 1:** Bootstrapper - kleines Setup zieht Installer + Config
- [ ] **Variante 2:** MSI mit Parametern (`GATEWAY_URL=... TOKEN=...`)
- [ ] **Variante 3:** ZIP-Bundle mit Install-Skript

---

## Architektur

### Repository-Struktur
```
/repo/windows-agent/
├── latest/
│   ├── octofleet-agent.msi
│   ├── manifest.json
│   └── config-template.json (optional)
├── 1.3.0/
│   └── ...
└── 1.2.0/
    └── ...
```

### Manifest Format (`manifest.json`)
```json
{
  "name": "OctofleetNodeAgent",
  "version": "1.3.0",
  "releaseDate": "2026-02-10",
  "installer": {
    "type": "msi",
    "filename": "octofleet-agent.msi",
    "sha256": "abc123...",
    "size": 15728640,
    "silentArgs": "/qn /norestart"
  },
  "config": {
    "path": "C:\\ProgramData\\Octofleet\\service-config.json",
    "encoding": "utf8",
    "mode": "render-template"
  },
  "service": {
    "name": "OctofleetNodeAgent",
    "displayName": "Octofleet Node Agent",
    "restartAfterInstall": true
  }
}
```

### Config Template (`config-template.json`)
```json
{
  "GatewayUrl": "{{GatewayUrl}}",
  "GatewayToken": "{{GatewayToken}}",
  "DisplayName": "{{DisplayName}}",
  "InventoryApiUrl": "{{InventoryApiUrl}}"
}
```

### Bootstrapper PowerShell (One-Liner)
```powershell
irm https://repo.example.com/install.ps1 | iex -GatewayUrl "http://192.168.0.5:18789" -Token "abc123"
```

Oder mit Enrollment:
```powershell
irm https://repo.example.com/install.ps1 | iex -EnrollToken "ENROLL-ABC123"
```

---

## Token-Strategie (Empfehlung)

### Option A: Static Token (einfach, weniger sicher)
- Admin kopiert permanenten Token ins Paket
- Risiko: Wenn Paket leakt, Token kompromittiert

### Option B: Enrollment Token (skalierbar, sicherer) ⭐
1. Admin erzeugt im Gateway einen kurzlebigen Enrollment Token (z.B. 24h, 10 Uses)
2. Agent nutzt Enrollment Token beim ersten Start
3. Gateway tauscht gegen permanentes Device-Token/Zertifikat
4. Enrollment Token wird entwertet

**Vorteile:**
- Pakete können verteilt werden ohne permanente Secrets
- Bei Leak: Token läuft ab oder Usage-Limit erreicht
- Audit-Trail: Welches Gerät hat welchen Enroll-Token verwendet

---

## Implementierung

### Phase 1: MSI mit Parametern (Variante 2)
- MSI akzeptiert Custom Actions / Properties
- `msiexec /i agent.msi GATEWAY_URL=... GATEWAY_TOKEN=... /qn`
- MSI schreibt Config und startet Service

### Phase 2: HTTP Repository + Manifest
- Backend-Endpoint `/api/v1/repo/windows-agent/latest`
- Manifest + MSI zum Download
- Optional: Signed Manifests

### Phase 3: Bootstrapper Script
- PowerShell-Script (`install.ps1`)
- Lädt Manifest, prüft Hash, installiert MSI, schreibt Config
- Ein-Zeilen-Installation

### Phase 4: Enrollment Token System
- Gateway: `POST /api/v1/enrollment-tokens` → Generiert Token
- Agent: Enrollment-Flow beim ersten Start
- Gateway: Token → Device-Token Exchange

### Phase 5: Admin UI für Paket-Management
- Frontend: Enrollment Token erstellen/verwalten
- Frontend: Install-Kommando generieren (Copy-Paste ready)
- Frontend: Download-Links für Pakete

---

## Tasks

| ID | Task | Phase | Effort |
|----|------|-------|--------|
| E10-01 | MSI-Projekt erstellen (WiX Toolset) | 1 | L |
| E10-02 | MSI Custom Properties (GATEWAY_URL, TOKEN, etc.) | 1 | M |
| E10-03 | MSI Custom Action: Config schreiben + Service starten | 1 | M |
| E10-04 | Backend: Package Repository Endpoints | 2 | M |
| E10-05 | Backend: Manifest Generation bei Release | 2 | S |
| E10-06 | Backend: SHA256 Hash Berechnung | 2 | S |
| E10-07 | Bootstrapper PowerShell Script | 3 | M |
| E10-08 | Bootstrapper: Hash-Verifikation | 3 | S |
| E10-09 | Bootstrapper: Config Template Rendering | 3 | S |
| E10-10 | Backend: Enrollment Token API | 4 | L |
| E10-11 | Agent: Enrollment Flow | 4 | L |
| E10-12 | Backend: Token → Device-Token Exchange | 4 | M |
| E10-13 | Frontend: Enrollment Token Management UI | 5 | M |
| E10-14 | Frontend: Install Command Generator | 5 | S |
| E10-15 | Frontend: Package Download Page | 5 | S |
| E10-16 | Docs: Deployment Guide | 5 | S |

**Total:** 16 Tasks

---

## Meine Empfehlungen

### 1. Start mit Variante 2 (MSI + Parameter)
Das ist der schnellste Weg zu einer funktionierenden Lösung:
```powershell
msiexec /i \\server\share\octofleet-agent.msi GATEWAY_URL="http://192.168.0.5:18789" GATEWAY_TOKEN="abc123" /qn
```
- Funktioniert mit SCCM, Intune, GPO, PDQ Deploy
- Keine Web-Infrastruktur nötig

### 2. Bootstrapper als "Nice to Have"
Das PowerShell One-Liner ist cool für Ad-hoc-Installationen, aber Enterprise-Kunden nutzen meistens eh ihre Deployment-Tools.

### 3. Enrollment Tokens sind wichtig für Scale
Ab 50+ Geräten willst du keine statischen Tokens im Umlauf haben. Das Enrollment-System ist der richtige Weg.

### 4. WiX Toolset für MSI
- Open Source, Standard für .NET MSI-Projekte
- Gut dokumentiert
- Integriert in Visual Studio

---

*Created: 2026-02-07*
