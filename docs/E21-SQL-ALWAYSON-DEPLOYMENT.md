# E21: SQL Server Always On Deployment

## Epic Overview

**Goal:** Automated deployment of SQL Server Always On Availability Groups across Octofleet-managed nodes.

**Status:** 📋 Planning  
**Priority:** Medium  
**Dependencies:** E20 SQL Monitoring (for post-deployment health checks)

---

## User Story

> Als Administrator möchte ich über Octofleet eine komplette SQL Server Always On Umgebung auf ausgewählten Nodes deployen können, ohne manuell auf jeden Server zu müssen.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     Octofleet Backend                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  SQL Deployment Service                                   │  │
│  │  - Orchestrates multi-node deployment                    │  │
│  │  - Tracks deployment progress                            │  │
│  │  - Handles rollback on failure                           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬──────────────────────────────┘
                                  │ Jobs
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│  Node A       │       │  Node B       │       │  Node C       │
│  (Primary)    │       │  (Secondary)  │       │  (Secondary)  │
│               │       │               │       │               │
│ ┌───────────┐ │       │ ┌───────────┐ │       │ ┌───────────┐ │
│ │ SQL 2022  │ │◄─────►│ │ SQL 2022  │ │◄─────►│ │ SQL 2022  │ │
│ │ PRIMARY   │ │  AG   │ │ SECONDARY │ │  AG   │ │ SECONDARY │ │
│ └───────────┘ │       │ └───────────┘ │       │ └───────────┘ │
└───────────────┘       └───────────────┘       └───────────────┘
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                    Windows Failover Cluster
```

---

## Deployment Pipeline

### Phase 1: Prerequisites (parallel auf allen Nodes)

```powershell
# Job: sql-prereq-{nodeId}
- Install .NET Framework 4.8 (if missing)
- Install Windows Feature: Failover-Clustering
- Install Windows Feature: RSAT-Clustering-PowerShell
- Configure Firewall Rules:
  - TCP 1433 (SQL Server)
  - TCP 5022 (AG Endpoint)
  - TCP 5985 (WinRM)
  - UDP 3343 (Cluster)
- Verify network connectivity between nodes
- Verify DNS resolution
```

### Phase 2: SQL Server Installation (parallel)

```powershell
# Job: sql-install-{nodeId}
# Uses existing silent install pattern from Install-OctofleetAgent.ps1

$config = @"
[OPTIONS]
ACTION="Install"
FEATURES=SQLENGINE,REPLICATION
INSTANCENAME="MSSQLSERVER"
SQLSVCACCOUNT="NT Service\MSSQLSERVER"
SQLSYSADMINACCOUNTS="BUILTIN\Administrators"
SECURITYMODE="SQL"
SAPWD="<from-secure-config>"
TCPENABLED="1"
NPENABLED="0"
BROWSERSVCSTARTUPTYPE="Automatic"
SQLSVCSTARTUPTYPE="Automatic"
AGTSVCSTARTUPTYPE="Automatic"
IACCEPTSQLSERVERLICENSETERMS="True"
QUIET="True"
QUIETSIMPLE="False"
UpdateEnabled="False"
"@

# Download or use cached installer
# Execute: Setup.exe /ConfigurationFile=config.ini
```

### Phase 3: Cluster Creation (sequential)

```powershell
# Job: cluster-create (runs on Primary node only)

# 1. Validate cluster configuration
Test-Cluster -Node $AllNodes -Include "Inventory","Network","System Configuration"

# 2. Create cluster
New-Cluster -Name $ClusterName -Node $AllNodes -StaticAddress $ClusterIP -NoStorage

# 3. Configure quorum (Node Majority or Cloud Witness)
Set-ClusterQuorum -CloudWitness -AccountName $AzureStorageAccount -AccessKey $Key
# OR
Set-ClusterQuorum -NodeMajority
```

### Phase 4: Enable Always On (parallel)

```powershell
# Job: sql-enable-hadr-{nodeId}

# Enable HADR on SQL instance
Enable-SqlAlwaysOn -ServerInstance $env:COMPUTERNAME -Force

# Restart SQL Server
Restart-Service MSSQLSERVER -Force

# Wait for SQL to be ready
while (!(Test-SqlConnection $env:COMPUTERNAME)) { Start-Sleep 5 }
```

### Phase 5: Create Availability Group (Primary only)

```powershell
# Job: ag-create (runs on Primary)

# 1. Create AG endpoint on Primary
New-SqlHadrEndpoint -Path "SQLSERVER:\SQL\$Primary\Default" `
    -Name "Hadr_endpoint" -Port 5022 -EncryptionAlgorithm Aes
Start-SqlHadrEndpoint -Path "SQLSERVER:\SQL\$Primary\Default\Endpoints\Hadr_endpoint"

# 2. Grant connect permissions
# (for each secondary)

# 3. Create the AG
$agParams = @{
    Name = $AGName
    Database = @()  # Empty initially
    Replica = @(
        New-SqlAvailabilityReplica -Name $Primary -EndpointUrl "TCP://${Primary}:5022" `
            -AvailabilityMode SynchronousCommit -FailoverMode Automatic -AsTemplate
        # Add secondary replicas...
    )
}
New-SqlAvailabilityGroup @agParams

# 4. Create Listener (optional)
New-SqlAvailabilityGroupListener -Name $ListenerName -StaticIp $ListenerIP -Port 1433
```

### Phase 6: Join Secondaries (sequential per secondary)

```powershell
# Job: ag-join-{nodeId} (runs on each Secondary)

# 1. Create endpoint
New-SqlHadrEndpoint -Path "SQLSERVER:\SQL\$Secondary\Default" `
    -Name "Hadr_endpoint" -Port 5022

# 2. Join to AG
Join-SqlAvailabilityGroup -Path "SQLSERVER:\SQL\$Secondary\Default" -Name $AGName
```

### Phase 7: Add Initial Database (Primary)

```powershell
# Job: ag-add-database

# 1. Create database on Primary
Invoke-Sqlcmd -Query "CREATE DATABASE [$DBName]" -ServerInstance $Primary

# 2. Full backup
Backup-SqlDatabase -ServerInstance $Primary -Database $DBName -BackupFile "\\share\$DBName.bak"

# 3. Restore on Secondaries (WITH NORECOVERY)
foreach ($secondary in $Secondaries) {
    Restore-SqlDatabase -ServerInstance $secondary -Database $DBName `
        -BackupFile "\\share\$DBName.bak" -NoRecovery
}

# 4. Add to AG
Add-SqlAvailabilityDatabase -Path "SQLSERVER:\SQL\$Primary\Default\AvailabilityGroups\$AGName" `
    -Database $DBName

# 5. Join databases on Secondaries
foreach ($secondary in $Secondaries) {
    Add-SqlAvailabilityDatabase -Path "SQLSERVER:\SQL\$secondary\Default\AvailabilityGroups\$AGName" `
        -Database $DBName
}
```

---

## Data Model

### Deployment Configuration

```sql
-- SQL deployment configurations
CREATE TABLE sql_deployment_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,              -- "PROD-AG-01"
    cluster_name VARCHAR(50),                 -- "YOURCLUSTER"
    ag_name VARCHAR(50),                      -- "AG-PROD-01"
    sql_version VARCHAR(20) NOT NULL,         -- "2022", "2019"
    sql_edition VARCHAR(20) NOT NULL,         -- "Developer", "Standard", "Enterprise"
    primary_node_id VARCHAR(50) REFERENCES nodes(id),
    listener_name VARCHAR(50),                -- Optional
    listener_ip VARCHAR(45),                  -- Optional
    sa_password_encrypted BYTEA,              -- Encrypted SA password
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(50)
);

-- Nodes in a deployment
CREATE TABLE sql_deployment_nodes (
    id SERIAL PRIMARY KEY,
    deployment_id INT REFERENCES sql_deployment_configs(id),
    node_id VARCHAR(50) REFERENCES nodes(id),
    role VARCHAR(20) NOT NULL,                -- 'primary', 'secondary'
    sync_mode VARCHAR(20) DEFAULT 'synchronous', -- 'synchronous', 'asynchronous'
    failover_mode VARCHAR(20) DEFAULT 'automatic' -- 'automatic', 'manual'
);

-- Deployment execution tracking
CREATE TABLE sql_deployments (
    id SERIAL PRIMARY KEY,
    config_id INT REFERENCES sql_deployment_configs(id),
    status VARCHAR(20) NOT NULL,              -- 'pending', 'running', 'completed', 'failed', 'rolled_back'
    current_phase INT DEFAULT 0,              -- 1-7
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    logs JSONB DEFAULT '[]'
);

-- Per-node deployment status
CREATE TABLE sql_deployment_node_status (
    id SERIAL PRIMARY KEY,
    deployment_id INT REFERENCES sql_deployments(id),
    node_id VARCHAR(50) REFERENCES nodes(id),
    phase INT NOT NULL,
    status VARCHAR(20) NOT NULL,              -- 'pending', 'running', 'completed', 'failed'
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    job_instance_id INT REFERENCES job_instances(id),
    output TEXT
);
```

---

## UI Mockups

### 1. Create Deployment Wizard

```
┌─────────────────────────────────────────────────────────────┐
│  🗄️ New SQL Server Deployment                    Step 1/4   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Deployment Name:  [PROD-SQL-CLUSTER    ]                  │
│                                                             │
│  SQL Server Version:                                        │
│  ○ SQL Server 2019                                         │
│  ● SQL Server 2022                                         │
│                                                             │
│  Edition:                                                   │
│  ○ Developer (Free, all features, non-production)          │
│  ● Standard (Up to 2 sync replicas)                        │
│  ○ Enterprise (Unlimited replicas)                         │
│                                                             │
│  SQL Installer Source:                                      │
│  ○ Download from Microsoft                                 │
│  ● Network Share: [\\fileserver\sql\     ]                 │
│  ○ Already installed on nodes                              │
│                                                             │
│                                    [Cancel]  [Next →]       │
└─────────────────────────────────────────────────────────────┘
```

### 2. Node Selection

```
┌─────────────────────────────────────────────────────────────┐
│  🗄️ New SQL Server Deployment                    Step 2/4   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Select Nodes for Availability Group:                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Node          │ OS              │ RAM   │ Role      │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ☑ CONTROLLER  │ Server 2022     │ 32GB  │ [Primary▼]│   │
│  │ ☑ BALTASA     │ Server 2019     │ 16GB  │ [Second.▼]│   │
│  │ ☐ DESKTOP-B4G │ Windows 11 Pro  │ 64GB  │ [-------] │   │
│  │ ☐ TESTU       │ Ubuntu 22.04    │ 4GB   │ N/A       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ⚠️ Minimum 2 nodes required for Always On                  │
│  ℹ️ Enterprise edition required for >2 sync replicas        │
│                                                             │
│                              [← Back]  [Cancel]  [Next →]   │
└─────────────────────────────────────────────────────────────┘
```

### 3. Cluster & AG Configuration

```
┌─────────────────────────────────────────────────────────────┐
│  🗄️ New SQL Server Deployment                    Step 3/4   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Windows Cluster:                                           │
│  Cluster Name:     [YOURCLUSTER      ]                     │
│  Cluster IP:       [192.168.1.200    ] (static)            │
│                                                             │
│  Quorum:                                                    │
│  ● Node Majority (odd number of nodes)                     │
│  ○ Cloud Witness (Azure Storage)                           │
│  ○ File Share Witness: [               ]                   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Availability Group:                                        │
│  AG Name:          [AG-PROD-01       ]                     │
│                                                             │
│  ☑ Create Listener                                         │
│    Listener DNS:   [sql-prod         ]                     │
│    Listener IP:    [192.168.1.201    ]                     │
│    Listener Port:  [1433             ]                     │
│                                                             │
│                              [← Back]  [Cancel]  [Next →]   │
└─────────────────────────────────────────────────────────────┘
```

### 4. Review & Deploy

```
┌─────────────────────────────────────────────────────────────┐
│  🗄️ New SQL Server Deployment                    Step 4/4   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Review Configuration:                                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SQL Server 2022 Standard                            │   │
│  │ Cluster: YOURCLUSTER (192.168.1.200)                │   │
│  │ AG: AG-PROD-01                                      │   │
│  │ Listener: sql-prod (192.168.1.201:1433)            │   │
│  │                                                      │   │
│  │ Nodes:                                              │   │
│  │   CONTROLLER - Primary (Sync, Auto-failover)        │   │
│  │   BALTASA - Secondary (Sync, Auto-failover)         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  SA Password:      [••••••••••••     ] [👁️]               │
│  Confirm:          [••••••••••••     ]                     │
│                                                             │
│  ⚠️ This will install SQL Server and configure clustering   │
│     on the selected nodes. This may take 30-60 minutes.    │
│                                                             │
│                              [← Back]  [Cancel]  [🚀 Deploy]│
└─────────────────────────────────────────────────────────────┘
```

### 5. Deployment Progress

```
┌─────────────────────────────────────────────────────────────┐
│  🗄️ Deployment: PROD-SQL-CLUSTER                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Status: 🔄 Running (Phase 3/7)                            │
│  Started: 15:30 | Elapsed: 12:45                           │
│                                                             │
│  Progress:                                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░░  65%       │
│                                                             │
│  Phases:                                                    │
│  ✅ 1. Prerequisites          (CONTROLLER, BALTASA)        │
│  ✅ 2. SQL Installation       (CONTROLLER, BALTASA)        │
│  🔄 3. Cluster Creation       (CONTROLLER)                 │
│  ⏳ 4. Enable Always On                                     │
│  ⏳ 5. Create AG                                            │
│  ⏳ 6. Join Secondaries                                     │
│  ⏳ 7. Initial Database                                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Live Log:                                           │   │
│  │ [15:42:31] Creating cluster YOURCLUSTER...          │   │
│  │ [15:42:35] Adding node CONTROLLER to cluster        │   │
│  │ [15:42:38] Adding node BALTASA to cluster           │   │
│  │ [15:42:45] Configuring quorum (Node Majority)       │   │
│  │ [15:42:50] Cluster creation completed ✓             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                                            [Cancel Deploy]  │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Tickets

### Backend

| Ticket | Title | Story Points |
|--------|-------|--------------|
| E21-01 | SQL deployment config data model | 2 |
| E21-02 | Deployment orchestration service | 5 |
| E21-03 | Prerequisites check job type | 3 |
| E21-04 | SQL silent install job type | 3 |
| E21-05 | Cluster creation job type | 5 |
| E21-06 | HADR enable job type | 2 |
| E21-07 | AG creation job type | 5 |
| E21-08 | Secondary join job type | 3 |
| E21-09 | Database add job type | 3 |
| E21-10 | Deployment rollback logic | 5 |
| E21-11 | Deployment status API | 2 |

### Agent (PowerShell Modules)

| Ticket | Title | Story Points |
|--------|-------|--------------|
| E21-20 | Install-SqlServerSilent.ps1 | 3 |
| E21-21 | New-FailoverCluster.ps1 | 3 |
| E21-22 | Enable-SqlHadr.ps1 | 2 |
| E21-23 | New-AvailabilityGroup.ps1 | 5 |
| E21-24 | Join-AvailabilityGroup.ps1 | 2 |
| E21-25 | Add-DatabaseToAG.ps1 | 3 |

### Frontend

| Ticket | Title | Story Points |
|--------|-------|--------------|
| E21-30 | Deployment wizard UI | 5 |
| E21-31 | Node selection component | 2 |
| E21-32 | Deployment progress page | 3 |
| E21-33 | Deployment history list | 2 |

### Total: ~60 Story Points

---

## Prerequisites

- [ ] E19 Remote Shell (for debugging deployments)
- [ ] E20 SQL Monitoring (post-deployment validation)
- [ ] Network share for SQL installer / backups
- [ ] Service account with admin rights on target nodes
- [ ] Static IPs for Cluster & Listener

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SQL install fails on one node | Medium | Retry logic, detailed error logging |
| Cluster validation fails | High | Pre-check network/DNS before deploy |
| Firewall blocks AG sync | High | Automated firewall rule creation |
| Insufficient disk space | Medium | Pre-check disk space requirements |
| Node reboots during deploy | High | Resume capability, state tracking |

---

## Open Questions

1. **SQL Installer Source** - Download vs network share vs pre-staged?
2. **Service Accounts** - Local system vs domain accounts?
3. **Licensing** - How to handle license keys? (Dev edition = no key)
4. **Backup Share** - Required for AG database init - where?
5. **DNS** - Auto-create DNS records for listener?

---

*Epic Created: 2026-02-20*  
*Status: Planning*  
*Owner: TBD*
