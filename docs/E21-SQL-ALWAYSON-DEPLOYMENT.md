# E21: SQL Server Always On & Clustering

## Epic Overview

**Goal:** Erweiterung des bestehenden MSSQL Moduls um Windows Failover Clustering und Always On Availability Groups.

**Status:** 📋 Planning  
**Priority:** Medium  
**Dependencies:** Bestehendes MSSQL System (✅ vorhanden)

---

## Bereits vorhanden ✅

### ISO Depot
- `\\BALTASA\ISOs\` - SQL Server ISOs (2022, 2025)
- `\\BALTASA\iso\` - Weitere ISOs
- Package Sources API für SMB/HTTP/Local

### Disk Design (mssql_module.py → DiskConfig)
```python
class DiskConfig(BaseModel):
    purpose: str       # data, log, tempdb, backup
    driveLetter: str   # D, E, F, G
    volumeLabel: str   # SQL_Data, SQL_Log, etc.
    allocationUnitKb: int = 64
    folder: str        # Folder to create
```

### SQL Server Installation
- Silent Install via ConfigurationFile.ini
- Disk Preparation (Format, Mount)
- Features: SQLEngine, Replication, etc.

---

## Neue Konfigurationsoptionen

### Service Accounts

```python
class ServiceAccountConfig(BaseModel):
    account_type: str  # "local", "domain", "gmsa"
    
    # Für domain account:
    sql_service_account: str      # "DOMAIN\\sqlsvc"
    sql_service_password: str     # encrypted
    agent_service_account: str    # "DOMAIN\\sqlagent"
    agent_service_password: str   # encrypted
    
    # Für gMSA (Group Managed Service Account):
    sql_gmsa: str                 # "DOMAIN\\sqlsvc$"
    agent_gmsa: str               # "DOMAIN\\sqlagent$"
```

**UI Auswahl:**
```
Service Account Type:
○ Local System (NT Service\MSSQLSERVER)
○ Domain Account
   SQL Service:   [YOURDOM\sqlsvc    ] Password: [••••••••]
   SQL Agent:     [YOURDOM\sqlagent  ] Password: [••••••••]
● Group Managed Service Account (gMSA)
   SQL Service:   [YOURDOM\sqlsvc$   ]
   SQL Agent:     [YOURDOM\sqlagent$ ]
```

### Disk Design Presets

```
┌─────────────────────────────────────────────────────────────┐
│  Disk Layout                                                │
├─────────────────────────────────────────────────────────────┤
│  Preset: [Standard (4 Disks) ▼]                            │
│                                                             │
│  ○ Minimal (1 Disk)     - Alles auf C:\                    │
│  ○ Basic (2 Disks)      - Data+Log auf D:\                 │
│  ● Standard (4 Disks)   - Best Practice                    │
│  ○ Custom               - Manuelle Konfiguration           │
│                                                             │
│  Standard Layout:                                           │
│  ┌────────┬────────┬──────────┬─────────────────────────┐  │
│  │ Disk   │ Letter │ Label    │ Purpose                 │  │
│  ├────────┼────────┼──────────┼─────────────────────────┤  │
│  │ Disk 1 │ D:     │ SQL_Data │ User Databases (.mdf)   │  │
│  │ Disk 2 │ E:     │ SQL_Log  │ Transaction Logs (.ldf) │  │
│  │ Disk 3 │ F:     │ SQL_Temp │ TempDB                  │  │
│  │ Disk 4 │ G:     │ SQL_Bak  │ Backups                 │  │
│  └────────┴────────┴──────────┴─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Failover Cluster Feature (Auto-Install)

Wird automatisch auf allen Cluster-Nodes installiert:
```powershell
# Phase 1: Install Feature (parallel auf allen Nodes)
Install-WindowsFeature -Name Failover-Clustering -IncludeManagementTools
Install-WindowsFeature -Name RSAT-Clustering-PowerShell
```

### Quorum: File Share Witness

```python
class QuorumConfig(BaseModel):
    quorum_type: str = "file_share"  # "node_majority", "file_share", "cloud_witness"
    
    # File Share Witness
    file_share_path: str  # "\\\\FILESERVER\\ClusterQuorum"
```

**UI:**
```
┌─────────────────────────────────────────────────────────────┐
│  Cluster Quorum                                             │
├─────────────────────────────────────────────────────────────┤
│  Quorum Type:                                               │
│  ○ Node Majority (ungerade Anzahl Nodes empfohlen)         │
│  ● File Share Witness                                       │
│    Share Path: [\\BALTASA\ClusterQuorum  ] [Browse]        │
│  ○ Cloud Witness (Azure Storage)                           │
│    Account:    [                         ]                  │
│    Key:        [                         ]                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Bestehendes System (bereits implementiert ✅)

### API Endpoints (28 vorhanden):
- `/api/v1/mssql/editions` - SQL Server Editionen
- `/api/v1/mssql/downloads` - Download Links
- `/api/v1/mssql/configs` - Installation Konfigurationen (CRUD)
- `/api/v1/mssql/assignments` - Config → Group Zuweisungen
- `/api/v1/mssql/instances` - Laufende SQL Server Instanzen
- `/api/v1/mssql/install` - Silent Installation
- `/api/v1/mssql/cumulative-updates` - CU Management
- `/api/v1/mssql/cu-compliance` - Patch Compliance
- `/api/v1/mssql/deploy-cu` - CU Deployment
- `/api/v1/mssql/detect/{node}` - SQL Detection
- `/api/v1/mssql/verify` - Installation Verify
- `/api/v1/mssql/repair` - Repair

### Frontend:
- `/deployments/mssql` - SQL Server Assignments UI
- `/packages` - Software Katalog

---

## Neue Features (E21)

### Architektur-Erweiterung

```
┌─────────────────────────────────────────────────────────────┐
│                    Octofleet MSSQL Module                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Instances   │  │ Assignments │  │ CU Management       │  │
│  │ (existing)  │  │ (existing)  │  │ (existing)          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    🆕 E21 NEW                        │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────┐  │   │
│  │  │ Clusters      │  │ Avail. Groups │  │Listeners│  │   │
│  │  │ (WSFC)        │  │ (AG)          │  │         │  │   │
│  │  └───────────────┘  └───────────────┘  └─────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Neue API Endpoints

### Cluster Management
```
GET    /api/v1/mssql/clusters                    - List all clusters
POST   /api/v1/mssql/clusters                    - Create cluster config
GET    /api/v1/mssql/clusters/{id}               - Get cluster details
DELETE /api/v1/mssql/clusters/{id}               - Delete cluster config
POST   /api/v1/mssql/clusters/{id}/deploy        - Deploy/create cluster
POST   /api/v1/mssql/clusters/{id}/validate      - Run cluster validation
GET    /api/v1/mssql/clusters/{id}/status        - Get cluster health
POST   /api/v1/mssql/clusters/{id}/add-node      - Add node to cluster
POST   /api/v1/mssql/clusters/{id}/remove-node   - Remove node from cluster
```

### Availability Group Management
```
GET    /api/v1/mssql/availability-groups         - List all AGs
POST   /api/v1/mssql/availability-groups         - Create AG config
GET    /api/v1/mssql/availability-groups/{id}    - Get AG details
DELETE /api/v1/mssql/availability-groups/{id}    - Delete AG
POST   /api/v1/mssql/availability-groups/{id}/deploy      - Deploy AG
GET    /api/v1/mssql/availability-groups/{id}/status      - AG health/sync status
POST   /api/v1/mssql/availability-groups/{id}/add-replica - Add secondary
POST   /api/v1/mssql/availability-groups/{id}/remove-replica - Remove replica
POST   /api/v1/mssql/availability-groups/{id}/add-database   - Add DB to AG
POST   /api/v1/mssql/availability-groups/{id}/failover       - Manual failover
```

### Listener Management
```
GET    /api/v1/mssql/listeners                   - List all listeners
POST   /api/v1/mssql/listeners                   - Create listener
DELETE /api/v1/mssql/listeners/{id}              - Delete listener
```

---

## Database Schema (neue Tabellen)

```sql
-- Windows Failover Clusters
CREATE TABLE mssql_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,           -- Cluster Name (NetBIOS)
    cluster_ip VARCHAR(45),                      -- Static IP
    quorum_type VARCHAR(20) DEFAULT 'node_majority', -- node_majority, cloud_witness, file_share
    quorum_config JSONB,                         -- Cloud witness account, file share path
    status VARCHAR(20) DEFAULT 'configured',     -- configured, deploying, active, failed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(100),
    deployed_at TIMESTAMPTZ,
    last_health_check TIMESTAMPTZ
);

-- Nodes in cluster
CREATE TABLE mssql_cluster_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID REFERENCES mssql_clusters(id) ON DELETE CASCADE,
    node_id VARCHAR(50) REFERENCES nodes(id),
    role VARCHAR(20) DEFAULT 'member',           -- owner, member
    join_status VARCHAR(20) DEFAULT 'pending',   -- pending, joined, failed
    joined_at TIMESTAMPTZ,
    UNIQUE(cluster_id, node_id)
);

-- Availability Groups
CREATE TABLE mssql_availability_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    cluster_id UUID REFERENCES mssql_clusters(id),
    status VARCHAR(20) DEFAULT 'configured',     -- configured, deploying, active, failed
    automated_backup_preference VARCHAR(20) DEFAULT 'secondary', -- primary, secondary, secondary_only, none
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(100),
    deployed_at TIMESTAMPTZ
);

-- AG Replicas (links AG to SQL instances)
CREATE TABLE mssql_ag_replicas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ag_id UUID REFERENCES mssql_availability_groups(id) ON DELETE CASCADE,
    instance_id UUID REFERENCES mssql_instances(id),
    role VARCHAR(20) NOT NULL,                   -- primary, secondary
    availability_mode VARCHAR(20) DEFAULT 'synchronous_commit', -- synchronous_commit, asynchronous_commit
    failover_mode VARCHAR(20) DEFAULT 'automatic', -- automatic, manual
    endpoint_url VARCHAR(255),                   -- TCP://server:5022
    sync_state VARCHAR(30),                      -- SYNCHRONIZED, SYNCHRONIZING, NOT_SYNCHRONIZING
    sync_health VARCHAR(20),                     -- HEALTHY, PARTIALLY_HEALTHY, NOT_HEALTHY
    last_sync_check TIMESTAMPTZ,
    UNIQUE(ag_id, instance_id)
);

-- Databases in AG
CREATE TABLE mssql_ag_databases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ag_id UUID REFERENCES mssql_availability_groups(id) ON DELETE CASCADE,
    database_name VARCHAR(255) NOT NULL,
    primary_replica_id UUID REFERENCES mssql_ag_replicas(id),
    sync_state VARCHAR(30),                      -- Per-DB sync state
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ag_id, database_name)
);

-- AG Listeners
CREATE TABLE mssql_listeners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ag_id UUID REFERENCES mssql_availability_groups(id) ON DELETE CASCADE,
    dns_name VARCHAR(255) NOT NULL,
    port INT DEFAULT 1433,
    ip_addresses JSONB,                          -- Array of static IPs
    status VARCHAR(20) DEFAULT 'configured',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deployment jobs for cluster/AG operations
CREATE TABLE mssql_ha_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_type VARCHAR(20) NOT NULL,        -- cluster, ag, listener
    target_id UUID NOT NULL,                     -- cluster_id or ag_id
    status VARCHAR(20) DEFAULT 'pending',        -- pending, running, completed, failed
    phase INT DEFAULT 0,
    phases_total INT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    logs JSONB DEFAULT '[]'
);
```

---

## Deployment Flows

### 1. Cluster Creation Flow

```
User: "Create Cluster YOURCLUSTER with nodes A, B"
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 1: Prerequisites (parallel)       │
│ - Install-WindowsFeature Failover-      │
│   Clustering, RSAT-Clustering-PowerShell│
│ - Configure Firewall Rules (UDP 3343,   │
│   TCP 135, 445, 5985, dynamic RPC)      │
│ - Verify Network Connectivity           │
│ - Verify DNS Resolution                 │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 2: Cluster Validation             │
│ - Test-Cluster -Node $Nodes             │
│ - Report warnings/errors                │
│ - User must acknowledge before proceed  │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 3: Cluster Creation               │
│ - New-Cluster -Name $Name -Node $Nodes  │
│   -StaticAddress $ClusterIP -NoStorage  │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 4: Configure Quorum               │
│ - Set-ClusterQuorum -FileShareWitness   │
│   -Path "\\FILESERVER\ClusterQuorum"    │
└─────────────────────────────────────────┘
                    │
                    ▼
            ✅ Cluster Active
```

### 2. Availability Group Creation Flow

```
User: "Create AG on Cluster YOURCLUSTER"
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Prerequisite: SQL Server installed      │
│ on all cluster nodes (via existing      │
│ mssql/install system) with:             │
│ - Service Accounts (Domain/gMSA)        │
│ - Disk Layout (Data/Log/TempDB/Backup)  │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 1: Enable HADR (parallel)         │
│ - Enable-SqlAlwaysOn on each instance   │
│ - Restart SQL Services                  │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 2: Create Endpoints (parallel)    │
│ - New-SqlHadrEndpoint (TCP:5022)        │
│ - Grant CONNECT permissions             │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 3: Create AG (on Primary)         │
│ - New-SqlAvailabilityGroup              │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 4: Join Secondaries               │
│ - Join-SqlAvailabilityGroup             │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│ Phase 5: Create Listener (optional)     │
│ - New-SqlAvailabilityGroupListener      │
└─────────────────────────────────────────┘
                    │
                    ▼
            ✅ AG Active
```

---

## UI Design

### Tab-Erweiterung in `/deployments/mssql`

```
┌─────────────────────────────────────────────────────────────┐
│  🗄️ SQL Server Management                                   │
├─────────────────────────────────────────────────────────────┤
│  [Instances] [Assignments] [Updates] [Clusters] [Avail.Grps]│
│                                       ▲          ▲          │
│                                       └── NEU ───┘          │
└─────────────────────────────────────────────────────────────┘
```

### Clusters Tab

```
┌─────────────────────────────────────────────────────────────┐
│  Clusters                                    [+ New Cluster]│
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Cluster        │ Nodes │ Quorum     │ Status       │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ YOURCLUSTER    │ 2     │ Node Maj.  │ ● Active     │   │
│  │ TEST-CLUSTER   │ 3     │ Cloud Wit. │ ○ Configured │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Cluster Details: YOURCLUSTER                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Node          │ Role   │ Status  │ Last Heartbeat  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ CONTROLLER    │ Owner  │ Up      │ 2 sec ago       │   │
│  │ BALTASA       │ Member │ Up      │ 3 sec ago       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Validate] [Add Node] [Remove Node]                        │
└─────────────────────────────────────────────────────────────┘
```

### Availability Groups Tab

```
┌─────────────────────────────────────────────────────────────┐
│  Availability Groups                              [+ New AG]│
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ AG Name      │ Cluster     │ Replicas │ Health     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ AG-PROD-01   │ YOURCLUSTER │ 2        │ ● Healthy  │   │
│  │ AG-REPORT    │ YOURCLUSTER │ 2        │ ⚠️ Lagging │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  AG Details: AG-PROD-01                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Replica     │ Role     │ Mode   │ Sync State       │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ CONTROLLER  │ PRIMARY  │ Sync   │ ● SYNCHRONIZED   │   │
│  │ BALTASA     │ SECONDARY│ Sync   │ ● SYNCHRONIZED   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Databases in AG:                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Database    │ Primary Data │ Redo Queue │ Status   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ProdDB      │ 15.2 GB      │ 0 KB       │ ● Sync   │   │
│  │ ReportDB    │ 8.7 GB       │ 128 KB     │ ● Sync   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Listener: sql-prod.domain.local:1433                       │
│                                                             │
│  [Failover] [Add Database] [Add Replica]                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Tickets

### Backend (Python/FastAPI)

| Ticket | Title | SP |
|--------|-------|-----|
| E21-01 | Cluster tables + migrations | 2 |
| E21-02 | AG tables + migrations | 2 |
| E21-03 | GET/POST /clusters endpoints | 3 |
| E21-04 | Cluster deploy orchestration | 5 |
| E21-05 | Cluster health status collector | 3 |
| E21-06 | GET/POST /availability-groups endpoints | 3 |
| E21-07 | AG deploy orchestration | 5 |
| E21-08 | AG sync status collector | 3 |
| E21-09 | Listener endpoints | 2 |
| E21-10 | Failover endpoint | 3 |
| E21-11 | Add database to AG endpoint | 3 |

### Agent Jobs (PowerShell)

| Ticket | Title | SP |
|--------|-------|-----|
| E21-20 | Install-FailoverClusteringFeature.ps1 | 2 |
| E21-21 | New-FailoverCluster.ps1 | 3 |
| E21-22 | Test-ClusterValidation.ps1 | 2 |
| E21-23 | Enable-SqlHadr.ps1 | 2 |
| E21-24 | New-AvailabilityGroup.ps1 | 3 |
| E21-25 | Join-AvailabilityGroup.ps1 | 2 |
| E21-26 | Add-DatabaseToAG.ps1 | 2 |
| E21-27 | Get-ClusterHealth.ps1 | 2 |
| E21-28 | Get-AGSyncStatus.ps1 | 2 |

### Frontend (React/Next.js)

| Ticket | Title | SP |
|--------|-------|-----|
| E21-30 | Clusters Tab UI | 3 |
| E21-31 | Create Cluster Dialog | 3 |
| E21-32 | Cluster Detail View | 2 |
| E21-33 | Availability Groups Tab UI | 3 |
| E21-34 | Create AG Dialog | 3 |
| E21-35 | AG Detail View + Sync Status | 3 |
| E21-36 | Failover Confirmation Dialog | 2 |
| E21-37 | Add Database Dialog | 2 |

### Total: ~70 Story Points

---

## Integration mit bestehendem System

### Abhängigkeiten
```
┌─────────────────┐
│ mssql_configs   │ ← Bestehend: SQL Installation Config
└────────┬────────┘
         │ verwendet für
         ▼
┌─────────────────┐
│ mssql_instances │ ← Bestehend: Installierte SQL Server
└────────┬────────┘
         │ gruppiert in
         ▼
┌─────────────────┐
│ mssql_clusters  │ ← NEU: Windows Failover Cluster
└────────┬────────┘
         │ hostet
         ▼
┌─────────────────┐
│ mssql_ag        │ ← NEU: Availability Groups
└────────┬────────┘
         │ enthält
         ▼
┌─────────────────┐
│ mssql_ag_dbs    │ ← NEU: Datenbanken in AG
└─────────────────┘
```

### Workflow
1. **Existierend:** SQL Server auf Nodes installieren (via `/mssql/install`)
2. **NEU:** Cluster aus diesen Nodes erstellen (via `/mssql/clusters`)
3. **NEU:** AG auf Cluster erstellen (via `/mssql/availability-groups`)
4. **NEU:** Datenbanken zu AG hinzufügen

---

## Health Monitoring (nutzt E20)

Nach Deployment übernimmt E20 (SQL Monitoring) das Health Tracking:
- AG Sync Status alle 30 Sekunden
- Cluster Heartbeat
- Redo Queue Monitoring
- Alerting bei Problemen

---

## Risiken & Mitigations

| Risiko | Impact | Mitigation |
|--------|--------|------------|
| Cluster-Validation schlägt fehl | Hoch | Detaillierte Fehlerausgabe, Retry |
| AG Sync bricht ab | Mittel | Auto-Resume, Alert |
| Failover schlägt fehl | Hoch | Pre-Flight Checks, Confirmation |
| Netzwerk zwischen Nodes | Hoch | Prereq-Check vor Deployment |

---

## Offene Fragen

1. **Quorum:** Cloud Witness (Azure Storage) oder File Share?
2. **Backup Share:** Für Initial DB Sync - wo?
3. **DNS:** Listener DNS automatisch erstellen?
4. **Seeding:** Automatic Seeding (2016+) vs. Manual Backup/Restore?

---

*Epic Updated: 2026-02-20*  
*Status: Planning*  
*Builds on: Existing MSSQL Module*
