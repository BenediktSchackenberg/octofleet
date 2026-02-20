# E20: SQL Server Monitoring & HA Management

## Vision

Octofleet als zentrales Dashboard für SQL Server Fleet Management - nicht nur "ist der Service an", sondern echte DBA-Insights:

- **Always On Availability Groups** Status & Health
- **Log Shipping** Job Monitoring
- **Backup** Status & Alerts
- **Performance** Metrics (Queries, Waits, Blocking)
- **Disk Space** für Datenbanken

---

## Feature Breakdown

### 1. SQL Server Discovery

Agent erkennt automatisch SQL Server Instanzen auf dem Node:
- Default Instance (MSSQLSERVER)
- Named Instances (MSSQLSERVER$NAME)
- Express, Standard, Enterprise Edition
- Version (2016, 2019, 2022)

```csharp
// Registry: HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL
// WMI: SELECT * FROM SqlServiceAdvancedProperty WHERE ServiceName LIKE 'MSSQL%'
```

### 2. Always On Availability Groups

**Dashboard zeigt:**
- AG Name & Cluster
- Primary/Secondary Replicas
- Synchronization State (SYNCHRONIZED, SYNCHRONIZING, NOT_SYNCHRONIZING)
- Database Health (HEALTHY, PARTIAL, CRITICAL)
- Failover Mode (Automatic, Manual)
- Latency (Redo Queue, Send Queue)

**DMVs:**
```sql
-- AG Status
SELECT ag.name, ar.replica_server_name, ars.role_desc, ars.synchronization_health_desc
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id = ars.replica_id;

-- Database Status
SELECT db.name, drs.synchronization_state_desc, drs.synchronization_health_desc,
       drs.log_send_queue_size, drs.redo_queue_size
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.databases db ON drs.database_id = db.database_id;
```

**Alerts:**
- 🔴 AG not synchronizing > 5 min
- 🟡 Redo queue > 100 MB
- 🔴 Automatic failover blocked
- 🟡 Secondary lagging > 30 sec

### 3. Log Shipping Monitoring

**Track:**
- Primary → Secondary relationships
- Last Backup / Copy / Restore times
- Backup Age (alert if > threshold)
- Copy Job Status
- Restore Job Status
- RPO (Recovery Point Objective) compliance

**Tables:**
```sql
-- msdb..log_shipping_monitor_primary
-- msdb..log_shipping_monitor_secondary
-- msdb..log_shipping_monitor_history_detail

SELECT p.primary_database, s.secondary_server, s.secondary_database,
       s.last_copied_date, s.last_restored_date,
       DATEDIFF(MINUTE, s.last_restored_date, GETDATE()) AS restore_lag_minutes
FROM msdb.dbo.log_shipping_monitor_primary p
JOIN msdb.dbo.log_shipping_monitor_secondary s 
  ON p.primary_id = s.primary_id;
```

**Alerts:**
- 🔴 Restore lag > 1 hour
- 🔴 Copy job failed
- 🟡 Backup age > 30 min

### 4. Backup Monitoring

**Track all databases:**
- Last Full Backup
- Last Differential
- Last Log Backup
- Backup Size / Duration
- Backup Location (local, UNC, Azure)

**Query:**
```sql
SELECT d.name, d.recovery_model_desc,
       MAX(CASE WHEN b.type = 'D' THEN b.backup_finish_date END) AS last_full,
       MAX(CASE WHEN b.type = 'I' THEN b.backup_finish_date END) AS last_diff,
       MAX(CASE WHEN b.type = 'L' THEN b.backup_finish_date END) AS last_log
FROM sys.databases d
LEFT JOIN msdb.dbo.backupset b ON d.name = b.database_name
WHERE d.database_id > 4  -- Skip system DBs
GROUP BY d.name, d.recovery_model_desc;
```

**Alerts:**
- 🔴 Full backup > 7 days old
- 🔴 Log backup > 1 hour (for FULL recovery)
- 🟡 No backup history

### 5. Performance Insights

**Light-weight metrics (low overhead):**
- Active Sessions / Blocked Sessions
- CPU % from SQL Server
- Buffer Cache Hit Ratio
- Page Life Expectancy
- Long Running Queries (> 30 sec)
- Top Wait Types

**Heavy metrics (on-demand only):**
- Query Store data
- Index fragmentation
- Missing indexes

---

## Data Model

### New Tables

```sql
-- SQL Server instances discovered on nodes
CREATE TABLE sql_instances (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(50) REFERENCES nodes(id),
    instance_name VARCHAR(100) NOT NULL,  -- 'MSSQLSERVER' or 'SQLEXPRESS'
    version VARCHAR(50),                   -- '16.0.1000.6'
    edition VARCHAR(50),                   -- 'Enterprise', 'Standard', 'Express'
    is_clustered BOOLEAN DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(node_id, instance_name)
);

-- Availability Groups
CREATE TABLE sql_availability_groups (
    id SERIAL PRIMARY KEY,
    instance_id INT REFERENCES sql_instances(id),
    ag_name VARCHAR(100) NOT NULL,
    cluster_name VARCHAR(100),
    is_primary BOOLEAN,
    sync_health VARCHAR(20),  -- 'HEALTHY', 'PARTIAL', 'NOT_HEALTHY'
    collected_at TIMESTAMPTZ DEFAULT NOW()
);

-- AG Databases
CREATE TABLE sql_ag_databases (
    id SERIAL PRIMARY KEY,
    ag_id INT REFERENCES sql_availability_groups(id),
    database_name VARCHAR(100) NOT NULL,
    sync_state VARCHAR(30),        -- 'SYNCHRONIZED', 'SYNCHRONIZING', etc.
    sync_health VARCHAR(20),
    log_send_queue_kb BIGINT,
    redo_queue_kb BIGINT,
    collected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Log Shipping pairs
CREATE TABLE sql_log_shipping (
    id SERIAL PRIMARY KEY,
    primary_instance_id INT REFERENCES sql_instances(id),
    secondary_instance_id INT REFERENCES sql_instances(id),
    primary_database VARCHAR(100),
    secondary_database VARCHAR(100),
    last_backup_at TIMESTAMPTZ,
    last_copy_at TIMESTAMPTZ,
    last_restore_at TIMESTAMPTZ,
    restore_lag_minutes INT,
    collected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backup history (summary per DB)
CREATE TABLE sql_backup_status (
    id SERIAL PRIMARY KEY,
    instance_id INT REFERENCES sql_instances(id),
    database_name VARCHAR(100) NOT NULL,
    recovery_model VARCHAR(20),
    last_full_backup TIMESTAMPTZ,
    last_diff_backup TIMESTAMPTZ,
    last_log_backup TIMESTAMPTZ,
    full_backup_size_mb BIGINT,
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(instance_id, database_name)
);

-- Performance snapshots (TimescaleDB hypertable)
CREATE TABLE sql_perf_metrics (
    time TIMESTAMPTZ NOT NULL,
    instance_id INT NOT NULL,
    active_sessions INT,
    blocked_sessions INT,
    cpu_percent FLOAT,
    buffer_cache_hit_ratio FLOAT,
    page_life_expectancy INT,
    batch_requests_sec FLOAT,
    FOREIGN KEY (instance_id) REFERENCES sql_instances(id)
);
SELECT create_hypertable('sql_perf_metrics', 'time');
```

---

## Agent Implementation

### SqlServerCollector.cs

```csharp
public class SqlServerCollector
{
    // Discover instances via Registry/WMI
    public List<SqlInstance> DiscoverInstances();
    
    // Connect and collect (requires SQL auth or Windows auth)
    public async Task CollectInstanceData(SqlInstance instance)
    {
        // 1. Basic info (version, edition)
        // 2. AG status (if Enterprise)
        // 3. Log shipping status
        // 4. Backup status
        // 5. Perf metrics
    }
}
```

### Connection Options

1. **Windows Auth** - Agent runs as service account with SQL access
2. **SQL Auth** - Credentials stored in Octofleet (encrypted)
3. **Read-Only User** - Minimal permissions:

```sql
CREATE LOGIN [OctofleetMonitor] WITH PASSWORD = '...';
CREATE USER [OctofleetMonitor] FOR LOGIN [OctofleetMonitor];
GRANT VIEW SERVER STATE TO [OctofleetMonitor];
GRANT VIEW ANY DEFINITION TO [OctofleetMonitor];
-- Per database:
EXEC sp_addrolemember 'db_datareader', 'OctofleetMonitor';
```

---

## UI Design

### SQL Overview Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  🗄️ SQL Server Fleet                           [Refresh]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  12          │  │  3           │  │  2           │      │
│  │  Instances   │  │  AGs         │  │  ⚠️ Alerts   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                             │
│  Availability Groups                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ AG-PROD-01   │ PRIMARY │ CONTROLLER │ ● HEALTHY    │   │
│  │              │ SECONDARY│ BALTASA   │ ● SYNCHRONIZED│   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ AG-REPORT    │ PRIMARY │ BALTASA    │ ⚠️ LAGGING   │   │
│  │              │ SECONDARY│ DESKTOP-B │ 150MB Queue  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Backup Status                          [Last 24h]         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Database     │ Last Full │ Last Log │ Status       │   │
│  │ ProdDB       │ 2h ago    │ 15m ago  │ ● OK         │   │
│  │ ReportDB     │ 8d ago    │ never    │ 🔴 OVERDUE   │   │
│  │ TestDB       │ 3h ago    │ 1h ago   │ ● OK         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Instance Detail Page

- Connection info
- Databases list with sizes
- AG membership
- Backup schedules
- Performance graphs
- Error log viewer

---

## Alerting Rules

| Condition | Severity | Default Threshold |
|-----------|----------|-------------------|
| AG not healthy | Critical | Immediate |
| Redo queue > X MB | Warning | 100 MB |
| Log shipping lag > X min | Warning | 60 min |
| Full backup age > X days | Critical | 7 days |
| Log backup age > X min | Warning | 60 min |
| Blocked sessions > X | Warning | 5 |
| Long running query > X min | Warning | 30 min |

---

## Implementation Phases

### Phase 1: Discovery & Basic Monitoring
- [ ] SQL instance discovery on nodes
- [ ] Basic connectivity test
- [ ] Database list with sizes
- [ ] UI: SQL instances per node

### Phase 2: Backup Monitoring
- [ ] Backup status collection
- [ ] Backup age alerts
- [ ] UI: Backup status dashboard

### Phase 3: HA Monitoring
- [ ] Always On AG status
- [ ] Log Shipping status
- [ ] Sync health alerts
- [ ] UI: AG dashboard with replica states

### Phase 4: Performance
- [ ] Basic perf metrics collection
- [ ] Performance timeline graphs
- [ ] Top queries (on-demand)
- [ ] Wait stats analysis

### Phase 5: Actions
- [ ] Trigger manual backup
- [ ] Initiate AG failover (with confirmation!)
- [ ] Kill blocking session

---

## Security Considerations

1. **Credentials** - Store SQL credentials encrypted (like DPAPI for nodes)
2. **Least Privilege** - Read-only monitoring user
3. **Audit** - Log all SQL connections/queries
4. **No write operations** without explicit user confirmation
5. **Failover** - Require 2FA/confirmation for AG failover

---

## Open Questions

1. **Credential Management** - Per-instance? Per-node? Central vault?
2. **Collection Frequency** - Perf metrics every 1 min? AG status every 30 sec?
3. **Historical Retention** - How long keep perf data? (TimescaleDB compression)
4. **Multi-Instance** - How to handle 10+ instances on one node?
5. **Azure SQL** - Support Azure SQL DB / Managed Instance too?

---

*Draft: 2026-02-20*
