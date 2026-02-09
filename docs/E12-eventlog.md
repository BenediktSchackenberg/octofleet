# E12: Windows Eventlog Collection

## Ziel
Sicherheits-, System- und Anwendungs-Logs von Windows Nodes sammeln und im Inventory speichern.

## Komponenten

### 1. Database (neue Tabellen)
- `eventlog_entries` - Hypertable für Events
  - node_id, log_name, event_id, level, source, message, timestamp, collected_at
- `eventlog_config` - Welche Logs/Events pro Node sammeln
  - node_id, log_name, min_level, event_ids (filter), enabled

### 2. Agent Command
- `collect-eventlog` - Neuer Collector
- Parameter: log_name (Security/System/Application), hours_back, max_events
- Output: JSON array mit Events

### 3. Backend API
- `POST /api/v1/nodes/{nodeId}/eventlog` - Events empfangen
- `GET /api/v1/nodes/{nodeId}/eventlog` - Events abrufen (mit Filter)
- `GET /api/v1/eventlog/summary` - Dashboard Summary (kritische Events)

### 4. Frontend
- Events Tab auf Node Detail Page
- Event Level Filter (Error, Warning, Info)
- Eventlog Dashboard (kritische Events aller Nodes)

## Event Levels
- 1 = Critical
- 2 = Error  
- 3 = Warning
- 4 = Information
- 5 = Verbose

## PowerShell Collector
```powershell
$logs = @("Security", "System", "Application")
$hoursBack = 24
$maxEvents = 100

foreach ($log in $logs) {
    Get-WinEvent -LogName $log -MaxEvents $maxEvents |
    Where-Object { $_.TimeCreated -gt (Get-Date).AddHours(-$hoursBack) } |
    Select-Object Id, LevelDisplayName, ProviderName, Message, TimeCreated |
    ConvertTo-Json
}
```

## Wichtige Security Events
- 4624 - Successful login
- 4625 - Failed login
- 4720 - User created
- 4726 - User deleted
- 4732 - User added to group
- 4672 - Special privileges assigned
- 7045 - Service installed
