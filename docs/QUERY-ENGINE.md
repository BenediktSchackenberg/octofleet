# 🔍 Query Engine

> Introduced in **v0.6.0** (Epic E34)

The Real-time Query Engine lets you ask questions about your fleet using a safe DSL (Domain-Specific Language) that gets translated to parameterized SQL. No direct SQL access — all queries go through a whitelist-based security layer.

## Overview

- **DSL-to-SQL builder** — Structured JSON queries translated to safe, parameterized SQL
- **22 queryable tables** — Fleet, software, security, metrics, events, jobs, and more
- **18 pre-built templates** — Common fleet questions ready to use
- **Live agent queries** — Query running processes, services, and open ports in real-time
- **CSV export** — Download query results for external analysis
- **Visual WHERE clause builder** — Frontend UI for building queries without writing code

---

## DSL Syntax

Queries are JSON objects with the following structure:

```json
{
  "from": "nodes",
  "select": ["hostname", "os_name", "last_seen"],
  "where": [
    {"field": "is_online", "op": "=", "value": true},
    {"field": "os_name", "op": "ilike", "value": "%Windows%"}
  ],
  "join": [
    {"table": "hardware_current", "on": "nodes.id = hardware_current.node_id"}
  ],
  "groupBy": ["os_name"],
  "orderBy": [{"field": "hostname", "direction": "asc"}],
  "limit": 100
}
```

### Supported Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equals | `{"field": "status", "op": "=", "value": "online"}` |
| `!=` | Not equals | `{"field": "status", "op": "!=", "value": "resolved"}` |
| `>`, `>=`, `<`, `<=` | Comparison | `{"field": "cvss_score", "op": ">=", "value": 9.0}` |
| `ilike` | Case-insensitive LIKE | `{"field": "os_name", "op": "ilike", "value": "%Server%"}` |
| `in` | IN list | `{"field": "severity", "op": "in", "value": ["critical","high"]}` |
| `is_null` | IS NULL | `{"field": "resolved_at", "op": "is_null"}` |
| `is_not_null` | IS NOT NULL | `{"field": "agent_version", "op": "is_not_null"}` |

---

## Available Tables

### Fleet
| Table | Key Columns |
|-------|------------|
| `nodes` | hostname, node_id, os_name, os_version, is_online, last_seen, agent_version |
| `hardware_current` | node_id, cpu, ram, gpu, mainboard, disks (JSONB) |
| `network_current` | node_id, adapters, dns_servers (JSONB) |
| `physical_disks` | node_id, disk_number, model, media_type, size_gb, health_status |

### Software
| Table | Key Columns |
|-------|------------|
| `software_current` | node_id, name, version, publisher, install_date |
| `hotfixes_current` | node_id, hotfix_id, description, installed_on |
| `software_changes` | node_id, change_type, name, version, detected_at |

### Security
| Table | Key Columns |
|-------|------------|
| `vulnerabilities` | cve_id, title, severity, cvss_score, published_date |
| `node_vulnerabilities` | node_id, vulnerability_id, status, detected_at |
| `findings` | node_id, finding_type, severity, title, status |
| `security_current` | node_id, antivirus, firewall, uac, bitlocker (JSONB) |

### System
| Table | Key Columns |
|-------|------------|
| `system_current` | node_id, os_name, domain, last_boot, uptime_hours |
| `services` | node_id, name, display_name, status, start_type |

### Metrics
| Table | Key Columns |
|-------|------------|
| `node_metrics` | node_id, cpu_percent, ram_percent, disk_percent, time |

### Events
| Table | Key Columns |
|-------|------------|
| `eventlog_entries` | node_id, log_name, event_id, level_name, source, message, event_time |

### Groups & Tags
| Table | Key Columns |
|-------|------------|
| `groups` | name, color, icon |
| `device_groups` | node_id, group_id |
| `tags` | name, color |
| `device_tags` | node_id, tag_id |

### Jobs
| Table | Key Columns |
|-------|------------|
| `jobs` | name, description, target_type, command_type, created_by |
| `job_instances` | job_id, node_id, status, exit_code, duration_ms |

### Deployments & Alerting
| Table | Key Columns |
|-------|------------|
| `deployments` | name, status, created_at |
| `deployment_status` | deployment_id, node_id, status |
| `alert_rules` | name, severity, enabled |
| `alert_history` | rule_id, node_id, severity, message |

---

## Pre-Built Templates (18)

| Template | Category | Description |
|----------|----------|-------------|
| Offline nodes (24h) | Fleet | Nodes that stopped reporting in the last 24 hours |
| All Windows Servers | Fleet | Nodes running Windows Server |
| Node count by OS | Fleet | Distribution of operating systems |
| Outdated agents | Fleet | Nodes not on the latest agent version |
| Disk usage > 90% | Metrics | Nodes with critically high disk usage |
| High CPU nodes | Metrics | Nodes with CPU > 80% |
| Recently installed software | Software | Software changes in the last 7 days |
| Software by install count | Software | Widely-deployed software |
| Specific software version | Software | Search for a particular software |
| Hotfixes per node | Software | All installed hotfixes/patches |
| Vulnerability by severity | Security | Vulnerability count by severity |
| Critical vulnerabilities | Security | CVEs with CVSS ≥ 9 |
| Unresolved vulns per node | Security | Open vulnerability findings |
| Open security findings | Security | Unresolved security findings |
| Failed jobs | Jobs | Job instances that failed |
| Critical event log entries | Events | Error/Critical eventlog entries |
| Stopped auto-start services | System | Services that should be running but aren't |
| Nodes by domain | System | Group nodes by domain membership |

---

## Live Queries

Live queries execute directly on agents in real-time, returning current process lists, service states, or open ports — data that isn't stored in the database.

```bash
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"node_ids": ["node-1", "node-2"], "query_type": "processes"}' \
  http://localhost:8080/api/v1/query/live
```

Supported live query types:
- `processes` — Running processes
- `services` — Service status
- `ports` — Open network ports

---

## Security Model

- **Table whitelist** — Only the 22 tables listed above can be queried
- **Column whitelist** — Only declared columns are accessible per table
- **Parameterized SQL** — All user values are bound as parameters (no SQL injection)
- **Join whitelist** — Only pre-defined foreign key relationships are allowed
- **Result limits** — Maximum row count enforced

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/query/execute` | Execute a DSL query |
| GET | `/api/v1/query/schema` | Get schema (tables, columns, types) by category |
| GET | `/api/v1/query/templates` | Get 18 pre-built query templates |
| POST | `/api/v1/query/live` | Execute live query on agents |
