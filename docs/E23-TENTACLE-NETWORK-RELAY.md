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

A **Tentacle** is a single binary (or container) that:
1. Connects upstream to Octofleet Backend via TCP/WebSocket
2. Provides local ProxyDHCP/TFTP/HTTP for PXE boot
3. Caches OS images locally (pulled on-demand)
4. Reports status and receives tasks from Backend

---

## Architecture

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

---

## Data Model

### Backend Tables

```sql
-- Tentacles
CREATE TABLE tentacles (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,          -- Enrollment token
    network_segment TEXT,                 -- "VLAN 20" or "192.168.20.0/24"
    location TEXT,                        -- "Berlin Office"
    
    -- Connection state
    status TEXT DEFAULT 'offline',        -- online/offline/degraded
    last_seen TIMESTAMPTZ,
    ip_address INET,
    version TEXT,
    
    -- Configuration
    mode TEXT DEFAULT 'full',             -- full/relay/passive
    cache_size_gb INTEGER DEFAULT 100,
    pxe_enabled BOOLEAN DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tentacle ↔ Provisioning Task assignment
ALTER TABLE provisioning_tasks 
    ADD COLUMN tentacle_id INTEGER REFERENCES tentacles(id);

-- Image cache status per tentacle
CREATE TABLE tentacle_image_cache (
    tentacle_id INTEGER REFERENCES tentacles(id),
    image_id INTEGER REFERENCES provisioning_images(id),
    cached_at TIMESTAMPTZ,
    size_bytes BIGINT,
    PRIMARY KEY (tentacle_id, image_id)
);
```

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

### Tentacles Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Tentacles                              [+ Add Tentacle]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🟢 Berlin Office                                     │   │
│  │    Network: 192.168.20.0/24 (VLAN 20)               │   │
│  │    Status: Online | 3 tasks pending | 2 images cached│   │
│  │    Last seen: 2 seconds ago                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🟢 München DC                                        │   │
│  │    Network: 10.10.0.0/16 (Datacenter)               │   │
│  │    Status: Online | 0 tasks pending | 5 images cached│   │
│  │    Last seen: 1 second ago                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔴 Hamburg Branch                                    │   │
│  │    Network: 172.16.5.0/24                           │   │
│  │    Status: Offline since 2h ago                      │   │
│  │    Last seen: 2 hours ago                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Tentacle Detail

```
┌─────────────────────────────────────────────────────────────┐
│  ← Tentacles / Berlin Office                    [Settings]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Status: 🟢 Online                    Version: 1.0.0        │
│  IP: 192.168.20.5                     Uptime: 14 days       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Configuration                                        │   │
│  │                                                      │   │
│  │ Mode:        [Full ▼]                               │   │
│  │ PXE Enabled: [✓]                                    │   │
│  │ Cache Size:  [100] GB                               │   │
│  │ Network:     192.168.20.0/24                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Cached Images                          [Pre-pull ▼] │   │
│  │                                                      │   │
│  │ ✓ Windows Server 2025    4.2 GB    Cached 2d ago   │   │
│  │ ✓ Windows Server 2022    3.8 GB    Cached 5d ago   │   │
│  │ ○ Windows 11 Pro         4.5 GB    Not cached      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Active Tasks                                         │   │
│  │                                                      │   │
│  │ 52:54:00:65:d5:42  SQL-SRV-01  ⏳ Waiting for boot  │   │
│  │ 00:15:5D:AA:BB:CC  WEB-SRV-02  🔄 Installing (45%)  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Story Points Estimate

| Feature | Story Points | Notes |
|---------|--------------|-------|
| **Backend** | | |
| Tentacle data model + API | 5 | CRUD + enrollment |
| WebSocket connection manager | 8 | Reconnect, auth, multiplexing |
| Task routing to tentacles | 5 | Assign task to correct tentacle |
| Image distribution endpoint | 5 | Chunked download, resume |
| UI: Tentacle list + detail | 8 | New pages |
| **Tentacle Binary** | | |
| Core runtime + config | 5 | CLI, config file, logging |
| Upstream WebSocket client | 8 | Connection, auth, reconnect |
| Embedded PXE server | 8 | dnsmasq or pure Go |
| HTTP server for boot/images | 3 | Simple file serving |
| Image cache manager | 5 | Download, verify, LRU |
| Task executor | 5 | Generate configs, track status |
| Packaging (binary + container) | 3 | Build pipeline |
| **Total** | **~68 SP** | |

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

### Phase 1: Foundation (MVP)
- Backend: Tentacle model + basic API
- Tentacle: Single binary with embedded PXE
- Manual image push (no auto-cache yet)
- ~30 SP

### Phase 2: Smart Distribution  
- Image caching with on-demand pull
- WebSocket for real-time updates
- UI integration
- ~25 SP

### Phase 3: Enterprise Features
- Multi-tentacle coordination
- Bandwidth throttling
- Pre-pull scheduling
- ~13 SP

---

## Open Questions

1. **Language for Tentacle binary?**
   - Go: Single binary, good networking, cross-platform
   - Rust: Same benefits, steeper learning curve
   - Python + PyInstaller: Faster dev, larger binary

2. **Embedded PXE or shell out to dnsmasq?**
   - Embedded: Cleaner, portable
   - dnsmasq: Proven, feature-rich

3. **Should Tentacle also run the Octofleet Agent?**
   - Could dual-purpose as both relay AND managed node

---

*Created: 2026-02-20*
*Status: Planning*
*Epic Owner: TBD*
