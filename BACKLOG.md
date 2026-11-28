# BACKLOG.md - Feature Backlog

Ideen und Features die noch nicht in einem Sprint geplant sind.

## 🎯 High Priority (Next Sprint Candidates)

### Agent/Service
- [ ] **Auto-Reconnect** - Service reconnected automatisch bei Gateway-Neustart
- [ ] **Health Endpoint** - Lokaler HTTP-Endpoint für Service-Status
- [ ] **Logging to File** - Service schreibt Logs nach `C:\ProgramData\Octofleet\logs\`
- [ ] **Config Hot-Reload** - Service lädt Config neu ohne Neustart

### Inventory System
- [ ] **Scheduled Push** - Automatischer Push alle X Minuten (konfigurierbar)
- [ ] **Delta Updates** - Nur Änderungen pushen statt Full Inventory
- [ ] **Disk Space Alerts** - Warnung bei <10% freiem Speicher
- [ ] **Software Change Detection** - Notification bei neu installierter Software

### UI/UX
- [ ] **System Tray Icon** - Minimize to tray, Rechtsklick-Menü
- [ ] **Dark/Light Theme Toggle** - Theme-Wechsel in Settings
- [ ] **Notification Toasts** - Windows-Benachrichtigungen bei Events
- [ ] **First-Run Wizard** - Setup-Assistent für neue User

### Frontend (Web Dashboard)
- [ ] **Real-time Updates** - WebSocket statt Polling
- [ ] **Node Comparison** - Zwei Nodes nebeneinander vergleichen
- [ ] **Export to CSV/PDF** - Inventory-Daten exportieren
- [ ] **Alert Rules** - Konfigurierbare Alerts (CPU >90%, Disk <10GB, etc.)
- [ ] **Historical Charts** - CPU/RAM/Disk Trends über Zeit

## 🔧 Medium Priority

### Agent
- [ ] **PowerShell Remoting** - Commands auf Remote-Nodes ausführen
- [ ] **File Transfer** - Dateien zu/von Nodes kopieren
- [ ] **Screenshot Capture** - Remote Screenshot (mit User-Consent)

### Security
- [ ] **Certificate Pinning** - TLS Certificate Validation
- [ ] **Audit Log** - Wer hat wann welchen Command ausgeführt
- [ ] **Role-Based Access** - Admin vs Read-Only Users

### Integration
- [ ] **Prometheus Exporter** - Metrics für Grafana
- [ ] **Webhook Notifications** - Discord/Slack/Teams Alerts
- [ ] **REST API Auth** - API Keys für externe Tools

## 💡 Nice to Have (Future)

- [ ] **Mobile App** - iOS/Android Status-App
- [ ] **Multi-Gateway** - Ein Agent, mehrere Gateways
- [ ] **Plugin System** - Custom Collectors
- [ ] **Remote Desktop** - VNC/RDP Integration
- [ ] **Ansible Integration** - Playbooks über Octofleet ausführen

## ❌ Won't Do (Out of Scope)

- Full MDM replacement (use Intune for that)
- Antivirus functionality
- Network monitoring (use dedicated tools)

---
*Last updated: 2026-02-07*
