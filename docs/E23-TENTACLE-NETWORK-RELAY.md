# E23: Tentacle - Network Relay for Multi-Segment Deployments

## Overview

**Tentacle** extends Octofleet's reach into multiple network segments. A Tentacle is a lightweight relay that runs in each VLAN/subnet, providing local PXE boot services while being centrally managed from the Octofleet backend.

```
                      🐙
                   Backend
                      │
        ┌─────────────┼─────────────┐
        │             │             │
    [Tentacle]    [Tentacle]    [Tentacle]
     VLAN 10       VLAN 20       VLAN 30
        │             │             │
       VMs           VMs           VMs
```

## Problem Statement

- PXE/DHCP broadcasts don't cross routers/VLANs
- Enterprise networks have multiple segments
- Deploying a full Octofleet instance per segment is overkill
- Images need to be distributed efficiently (not re-downloaded per boot)

## Solution

A **Tentacle** is a single binary (or container) that combines **Agent + PXE Relay**:

1. **Agent Mode**: Full inventory collection, job execution, monitoring (like Windows/Linux agent)
2. **Relay Mode**: Local ProxyDHCP/TFTP/HTTP for PXE boot in the network segment
3. **Network Discovery**: ARP scan, port scan, DHCP snooping for segment visibility
4. **Image Cache**: OS images pulled on-demand, cached locally
5. **Upstream Connection**: WebSocket to Backend for real-time sync

### Key Insight: Tentacle = Node + Superpowers

A Tentacle IS a managed Node (appears in node list, collects inventory, runs jobs) but with additional PXE relay and network discovery capabilities. This means:

- The Tentacle host itself is managed (updates, monitoring, remote access)
- No separate "Tentacle" entity needed - it's a Node with `is_tentacle=true`
- Unified codebase: Linux Agent + Tentacle features

---

## Architecture

### Tentacle = Agent + Relay

```
┌────────────────────────────────────────────────────────────────┐
│                         Tentacle                                │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────┐    ┌─────────────────────────┐  │
│   │      Agent Mode         │    │      Relay Mode         │  │
│   │                         │    │                         │  │
│   │ • Hardware Inventory    │    │ • ProxyDHCP (dnsmasq)   │  │
│   │ • OS Info & Updates     │    │ • TFTP Server           │  │
│   │ • Service Monitoring    │    │ • HTTP (images, scripts)│  │
│   │ • Performance Metrics   │    │ • Boot Task Tracking    │  │
│   │ • Disk SMART            │    │ • Image Cache           │  │
│   │ • Event Logs            │    │                         │  │
│   │ • Job Execution         │    │                         │  │
│   │ • Remote Shell          │    │                         │  │
│   └─────────────────────────┘    └─────────────────────────┘  │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐ │
│   │              Network Discovery & Proxy                   │ │
│   │                                                          │ │
│   │ • ARP Scan (discover devices in segment)                │ │
│   │ • Port Scan (detect services)                           │ │
│   │ • DHCP Snooping (track IP assignments)                  │ │
│   │ • Wake-on-LAN Proxy (send WoL to remote segment)        │ │
│   │ • Network topology mapping                               │ │
│   └─────────────────────────────────────────────────────────┘ │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐ │
│   │              Upstream Connection (WebSocket)             │ │
│   │                                                          │ │
│   │ • Persistent connection to Octofleet Backend            │ │
│   │ • Real-time task sync                                    │ │
│   │ • Inventory & metrics reporting                          │ │
│   │ • Image pull requests                                    │ │
│   └─────────────────────────────────────────────────────────┘ │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Component Overview

```
┌─────────────────────────────────────────────────────┐
│                 Octofleet Backend                    │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Tentacle    │  │ Provisioning│  │ Image       │ │
│  │ Manager     │  │ Tasks       │  │ Repository  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │         │
└─────────┼────────────────┼────────────────┼─────────┘
          │                │                │
          ▼                ▼                ▼
    WebSocket API    Task Sync        Image Pull
          │                │                │
┌─────────┼────────────────┼────────────────┼─────────┐
│         │         Tentacle                │         │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌─────┴───────┐ │
│  │ Upstream    │  │ Task        │  │ Image       │ │
│  │ Connection  │  │ Executor    │  │ Cache       │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │         │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌─────┴───────┐ │
│  │ ProxyDHCP   │  │ TFTP        │  │ HTTP        │ │
│  │ (dnsmasq)   │  │ Server      │  │ Server      │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                     │
│                  Local Network                      │
└─────────────────────────────────────────────────────┘
```

### Tentacle Modes

| Mode | Use Case | Components |
|------|----------|------------|
| **Full** | Isolated network, slow WAN | PXE + Image Cache |
| **Relay** | Fast LAN to backend | PXE only, images from backend |
| **Passive** | Monitoring only | No PXE, just reports network info |

---

## Features

### F1: Tentacle Registration & Management
- Tentacle registers with backend using enrollment token
- Backend tracks all tentacles (online/offline, version, network info)
- Remote configuration updates
- Health monitoring

### F2: Upstream Connection
- Persistent WebSocket connection to backend
- Auto-reconnect with exponential backoff
- Heartbeat/keepalive
- TLS with certificate pinning (optional)

### F3: Local PXE Services
- ProxyDHCP for registered MACs (coexists with existing DHCP)
- TFTP server for iPXE boot files
- HTTP server for boot scripts and images
- MAC whitelist synced from backend

### F4: Task Synchronization
- Receive provisioning tasks from backend
- Generate Autounattend.xml locally
- Report task status (waiting/booting/installing/complete)
- Detect boot via DHCP logs

### F5: Image Caching
- Pull images from backend on-demand
- Local cache with LRU eviction
- Configurable cache size
- Background pre-pull for scheduled deployments
- Checksum verification

### F6: Status Reporting
- Network discovery (what's in this segment?)
- DHCP lease snooping (optional)
- Boot attempt logging
- Bandwidth/latency to backend

### F7: Agent Mode (Full Node Capabilities)
The Tentacle host itself is a managed node:
- **Inventory Collection**: Hardware, OS, software, services
- **Performance Monitoring**: CPU, RAM, disk, network metrics
- **Job Execution**: Run scripts, install packages, manage services
- **Disk Health**: SMART monitoring for local disks
- **Event Logs**: Collect and forward system logs
- **Remote Access**: Shell access via backend (like other nodes)
- **Updates**: Self-update capability

### F8: Network Discovery & Proxy
Visibility into the local network segment:
- **ARP Scan**: Discover all devices in the segment
- **Port Scan**: Detect running services (optional, configurable)
- **DHCP Snooping**: Track which devices get which IPs
- **Wake-on-LAN Proxy**: Backend can wake devices in remote segments
- **Topology Mapping**: Build network map for the segment
- **Ping Monitoring**: Track device availability

---

## Data Model

### Design Decision: Tentacle IS a Node

Instead of a separate `tentacles` table, a Tentacle is a Node with extra capabilities:

```sql
-- Extend nodes table for Tentacle capabilities
ALTER TABLE nodes ADD COLUMN is_tentacle BOOLEAN DEFAULT false;
ALTER TABLE nodes ADD COLUMN tentacle_config JSONB;

-- tentacle_config example:
-- {
--   "pxe_enabled": true,
--   "cache_size_gb": 100,
--   "network_segment": "192.168.20.0/24",
--   "discovery_enabled": true,
--   "discovery_interval_min": 60
-- }

-- Provisioning tasks can be assigned to a Tentacle (which is a Node)
ALTER TABLE provisioning_tasks 
    ADD COLUMN tentacle_node_id INTEGER REFERENCES nodes(id);

-- Image cache status per tentacle
CREATE TABLE node_image_cache (
    node_id INTEGER REFERENCES nodes(id),
    image_id INTEGER REFERENCES provisioning_images(id),
    cached_at TIMESTAMPTZ,
    size_bytes BIGINT,
    PRIMARY KEY (node_id, image_id)
);

-- Discovered devices in network segment
CREATE TABLE network_discoveries (
    id SERIAL PRIMARY KEY,
    tentacle_node_id INTEGER REFERENCES nodes(id),
    mac_address MACADDR NOT NULL,
    ip_address INET,
    hostname TEXT,
    vendor TEXT,                    -- From MAC OUI lookup
    open_ports INTEGER[],
    first_seen TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ DEFAULT now(),
    is_managed BOOLEAN DEFAULT false,  -- Links to a Node?
    managed_node_id INTEGER REFERENCES nodes(id),
    UNIQUE(tentacle_node_id, mac_address)
);
```

### Benefits of "Node + Tentacle" Model

| Benefit | Description |
|---------|-------------|
| **Unified Management** | Tentacle appears in node list, same UI/API |
| **Full Inventory** | Hardware, OS, services of Tentacle host tracked |
| **Job Execution** | Run maintenance scripts on Tentacle itself |
| **Single Codebase** | Linux Agent + Tentacle = same binary with flags |
| **Existing Auth** | Uses node enrollment, no separate auth flow |

### Tentacle Local Storage

```
/var/lib/octofleet-tentacle/
├── config.yaml           # Local config
├── tentacle.key          # Identity key
├── cache/
│   ├── images/
│   │   ├── win2025.wim
│   │   └── win2022.wim
│   └── boot/
│       ├── ipxe.efi
│       └── boot.ipxe
├── tasks/
│   └── 52-54-00-65-d5-42.json
└── logs/
```

---

## API Endpoints

### Backend API (for Tentacles)

```
# Tentacle Management
POST   /api/v1/tentacles/enroll          # Register new tentacle
GET    /api/v1/tentacles                  # List all tentacles
GET    /api/v1/tentacles/:id              # Get tentacle details
PUT    /api/v1/tentacles/:id              # Update config
DELETE /api/v1/tentacles/:id              # Remove tentacle

# WebSocket
WS     /api/v1/tentacles/ws               # Persistent connection

# Image Distribution  
GET    /api/v1/tentacles/images/:id/pull  # Download image (chunked)
GET    /api/v1/tentacles/images/:id/meta  # Image metadata + checksum
```

### WebSocket Messages

```json
// Backend → Tentacle
{"type": "task.new", "task": {...}}
{"type": "task.cancel", "taskId": "..."}
{"type": "config.update", "config": {...}}
{"type": "image.prepull", "imageId": "..."}

// Tentacle → Backend  
{"type": "status", "online": true, "tasks": [...]}
{"type": "task.status", "taskId": "...", "status": "installing"}
{"type": "boot.detected", "mac": "52:54:00:..."}
{"type": "image.cached", "imageId": "...", "size": 4500000000}
```

---

## Deployment Options

### Option A: Single Binary (Recommended)

```bash
# Download
curl -L https://github.com/.../octofleet-tentacle -o /usr/local/bin/octofleet-tentacle
chmod +x /usr/local/bin/octofleet-tentacle

# Enroll
octofleet-tentacle enroll \
  --backend https://octofleet.corp.local \
  --token ENROLL_TOKEN_HERE \
  --name "Berlin Office"

# Run as service
systemctl enable --now octofleet-tentacle
```

### Option B: Docker Container

```yaml
# docker-compose.yml
services:
  tentacle:
    image: octofleet/tentacle:latest
    network_mode: host          # Required for DHCP/TFTP
    cap_add:
      - NET_ADMIN
    environment:
      - OCTOFLEET_BACKEND=https://octofleet.corp.local
      - TENTACLE_TOKEN=xxx
    volumes:
      - tentacle-cache:/var/lib/octofleet-tentacle
```

### Option C: Raspberry Pi / Mini PC

Perfect for branch offices:
- Low power, always on
- Sits in the network closet
- Caches images locally for fast deploys

---

## UI Mockup

### Nodes List (Tentacles integrated)

Tentacles appear in the regular node list with a special badge:

```
┌─────────────────────────────────────────────────────────────────┐
│  Nodes                                         [+ Add Node]     │
├─────────────────────────────────────────────────────────────────┤
│  Filter: [All ▼]  [Online ▼]  [🔍 Search...]                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🖥️ SQL-SERVER-01        Windows Server 2025    🟢 Online      │
│     192.168.10.50        CPU: 23%  RAM: 64%                     │
│                                                                 │
│  🖥️ WEB-SERVER-02        Windows Server 2022    🟢 Online      │
│     192.168.10.51        CPU: 45%  RAM: 72%                     │
│                                                                 │
│  🐧 linux-worker-01      Ubuntu 22.04           🟢 Online      │
│     192.168.10.100       CPU: 12%  RAM: 38%                     │
│                                                                 │
│  ────────────────────────────────────────────────────────────  │
│                                                                 │
│  🦑 tentacle-berlin      Ubuntu 24.04           🟢 Online      │
│     192.168.20.5         VLAN 20 | PXE ✓ | 2 images cached     │
│     └─ 3 devices discovered, 1 task pending                    │
│                                                                 │
│  🦑 tentacle-munich      Raspberry Pi OS        🟢 Online      │
│     10.10.0.5            Datacenter | PXE ✓ | 5 images cached  │
│     └─ 47 devices discovered, 0 tasks pending                  │
│                                                                 │
│  🦑 tentacle-hamburg     Debian 12              🔴 Offline     │
│     172.16.5.10          Branch Office | Last seen: 2h ago     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Node Detail (Tentacle View)

When viewing a Tentacle node, extra tabs appear:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Nodes / tentacle-berlin                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🦑 tentacle-berlin                              🟢 Online      │
│  Ubuntu 24.04 LTS | 192.168.20.5 | Uptime: 14 days             │
│                                                                 │
│  [Overview] [Hardware] [Services] [Logs] [🦑 PXE] [🔍 Network] │
│  ──────────────────────────────────────────────────────────────│
│                                                                 │
│  ┌─ 🦑 PXE Relay ──────────────────────────────────────────┐   │
│  │                                                          │   │
│  │  Status:     🟢 Active                                  │   │
│  │  Network:    192.168.20.0/24 (VLAN 20)                  │   │
│  │  Mode:       Full (PXE + Cache)                         │   │
│  │                                                          │   │
│  │  Cached Images                          [Pre-pull ▼]    │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │ ✓ Windows Server 2025    4.2 GB   Cached 2d ago   │ │   │
│  │  │ ✓ Windows Server 2022    3.8 GB   Cached 5d ago   │ │   │
│  │  │ ○ Windows 11 Pro         4.5 GB   [Pull Now]      │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  │                                                          │   │
│  │  Provisioning Tasks                                      │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │ 52:54:00:65:d5:42  TEST-VM-01   ⏳ Waiting        │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ 🔍 Network Discovery ───────────────────────────────────┐  │
│  │                                                           │  │
│  │  Discovered: 12 devices | Last scan: 5 min ago  [Scan]   │  │
│  │                                                           │  │
│  │  ┌─────────────┬──────────────┬────────────┬──────────┐  │  │
│  │  │ IP          │ MAC          │ Hostname   │ Status   │  │  │
│  │  ├─────────────┼──────────────┼────────────┼──────────┤  │  │
│  │  │ 192.168.20.1│ 00:11:22:... │ router     │ 🟢       │  │  │
│  │  │ 192.168.20.10│52:54:00:... │ (new VM)   │ 🟡 New   │  │  │
│  │  │ 192.168.20.50│00:15:5D:... │ srv-db-01  │ 🔗 Managed│ │  │
│  │  │ 192.168.20.51│00:15:5D:... │ srv-web-01 │ 🔗 Managed│ │  │
│  │  └─────────────┴──────────────┴────────────┴──────────┘  │  │
│  │                                                           │  │
│  │  [Wake-on-LAN] [Add to Octofleet] [Export CSV]           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Story Points Estimate

| Feature | Story Points | Notes |
|---------|--------------|-------|
| **Backend** | | |
| Node model extension (is_tentacle) | 3 | Add columns + API changes |
| WebSocket connection manager | 8 | Reconnect, auth, multiplexing |
| Task routing to tentacles | 5 | Assign task to correct tentacle |
| Image distribution endpoint | 5 | Chunked download, resume |
| Network discovery storage | 3 | New table + API |
| UI: Tentacle tabs in node detail | 5 | PXE + Network Discovery tabs |
| UI: Node list tentacle badges | 2 | Visual distinction |
| **Tentacle Binary** | | |
| Core runtime + config | 5 | CLI, config file, logging |
| Upstream WebSocket client | 8 | Connection, auth, reconnect |
| **Agent Mode** | | |
| Hardware inventory collector | 5 | Reuse Linux agent code |
| Service monitoring | 3 | |
| Job execution engine | 5 | Run scripts, report results |
| Performance metrics | 3 | CPU, RAM, disk, network |
| **Relay Mode** | | |
| Embedded PXE server | 8 | dnsmasq wrapper or pure Go |
| HTTP server for boot/images | 3 | Simple file serving |
| Image cache manager | 5 | Download, verify, LRU |
| Task executor | 5 | Generate configs, track status |
| **Network Discovery** | | |
| ARP scanner | 3 | Discover devices |
| Port scanner (optional) | 3 | Detect services |
| DHCP snooping | 5 | Track IP assignments |
| Wake-on-LAN proxy | 2 | Forward WoL packets |
| **Packaging** | | |
| Binary build (Linux) | 2 | |
| Docker container | 2 | |
| Systemd service file | 1 | |
| **Total** | **~90 SP** | |

*Note: Some features can be reused from existing Linux agent code.*

---

## Dependencies

- **E22 (Universal Provisioning)**: Tentacle uses the same PXE/iPXE infrastructure
- **Existing**: Node enrollment flow (similar pattern for Tentacle enrollment)

## Risks

| Risk | Mitigation |
|------|------------|
| Network complexity | Start with single-binary, test in lab |
| Image sync bandwidth | Compression, delta updates, scheduling |
| Tentacle goes offline during deploy | Local task state, auto-resume |

---

## Phases

### Phase 1: Foundation - Agent Mode (MVP)
- Backend: Node model extension (is_tentacle flag)
- Tentacle: Single binary with agent capabilities
- Inventory collection, job execution
- Basic WebSocket connection to backend
- **~30 SP**

### Phase 2: PXE Relay
- Embedded PXE server (ProxyDHCP, TFTP, HTTP)
- Image caching with on-demand pull
- Provisioning task execution
- Boot tracking and status reporting
- **~25 SP**

### Phase 3: Network Discovery
- ARP/Port scanning
- DHCP snooping
- Wake-on-LAN proxy
- UI integration (Network tab)
- **~20 SP**

### Phase 4: Enterprise Features
- Multi-tentacle coordination
- Bandwidth throttling for image sync
- Pre-pull scheduling
- Network topology visualization
- **~15 SP**

---

## Open Questions

1. **Language for Tentacle binary?**
   - Go: Single binary, good networking, cross-platform ⭐ Recommended
   - Rust: Same benefits, steeper learning curve
   - Python + PyInstaller: Faster dev, larger binary

2. **Embedded PXE or shell out to dnsmasq?**
   - Embedded (pure Go): Cleaner, portable, no dependencies
   - dnsmasq wrapper: Proven, feature-rich, easier to debug

~~3. **Should Tentacle also run the Octofleet Agent?**~~
   - ✅ **DECIDED: Yes!** Tentacle = Node + PXE + Network Discovery
   - Same binary, unified management, appears in node list

---

*Created: 2026-02-20*
*Status: Planning*
*Epic Owner: TBD*
