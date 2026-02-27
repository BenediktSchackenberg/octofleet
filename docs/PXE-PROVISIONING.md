# PXE Zero-Touch Provisioning Setup Guide

## Quick Start (Automated)

Run the setup script on your provisioning server — it handles everything:

```bash
# One-liner (downloads and runs)
curl -sSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/provisioning/setup-pxe.sh | sudo bash

# Or clone first
git clone https://github.com/BenediktSchackenberg/octofleet.git
cd octofleet
sudo ./provisioning/setup-pxe.sh
```

### What the script does automatically:

1. ✅ Installs all dependencies (NFS, Docker, etc.)
2. ✅ Mounts your ISO storage (NAS/NFS)
3. ✅ Finds and extracts Ubuntu ISOs for PXE boot
4. ✅ Configures NFS exports with correct options (`insecure` flag!)
5. ✅ Creates the PXE Docker container with TFTP + HTTP
6. ✅ Generates iPXE boot menu with auto-discovery
7. ✅ Registers OS images and templates in the Octofleet API
8. ✅ Creates a systemd service for auto-start on boot

### Environment variables (skip the prompts):

```bash
export OCTOFLEET_API_URL=http://192.168.0.49:8080
export OCTOFLEET_API_KEY=your-api-key
export NFS_ISO_SOURCE=192.168.0.24:/mnt/user/isos
export PXE_INTERFACE=br0
sudo -E ./provisioning/setup-pxe.sh
```

### The only manual step: DHCP config

You still need to tell your DHCP server (router) where to find the PXE server. On your router, set:

| Setting | Value |
|---------|-------|
| Next Server / TFTP Server | Your PXE server IP |
| BIOS Boot File | `undionly.kpxe` |
| UEFI Boot File | `ipxe-x86_64.efi` |

**pfSense**: Services → DHCP → Network Booting  
**OPNsense**: Services → DHCPv4 → [Interface] → Network Booting  
**ISC DHCP**: See config below

---

## Architecture Overview

```
PXE Client (BIOS/UEFI)
    │
    ├── DHCP → points to TFTP server (iPXE boot)
    │
    ├── TFTP → serves iPXE bootloader
    │
    ├── HTTP → serves iPXE scripts + boot menu
    │   └── Queries Octofleet API for MAC → template assignment
    │
    └── NFS → serves Ubuntu live filesystem (casper requires NFS)
```

### How it works end-to-end:

1. **New machine boots** → DHCP tells it where the PXE server is
2. **iPXE loads** via TFTP → shows boot menu
3. **Auto-provision mode**: iPXE queries Octofleet API by MAC address
4. If a **provisioning task** exists for that MAC → boots the assigned template
5. If no task → shows manual menu (select OS interactively)
6. **Octofleet tracks** progress via provisioning events API

### Port Summary

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| TFTP    | 69   | UDP      | iPXE bootloader delivery |
| HTTP    | 9080 | TCP      | iPXE scripts, boot menu, API proxy |
| NFS     | 2049 | TCP      | Ubuntu live filesystem (casper) |

## Manual Setup (Step by Step)

<details>
<summary>Click to expand manual instructions</summary>

### 1. Database Setup

The provisioning feature requires these tables. They are included in `schema-full.sql`, but if you need to add them manually:

```sql
CREATE TABLE IF NOT EXISTS provisioning_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    display_name text,
    wim_path text,
    wim_index integer DEFAULT 1,
    os_type text,
    os_version text,
    edition text,
    architecture text DEFAULT 'x64',
    size_bytes bigint,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provisioning_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    platform text NOT NULL,
    display_name text,
    ipxe_template text,
    drivers text,
    notes text,
    image_id uuid REFERENCES provisioning_images(id),
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provisioning_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mac_address text,
    template_id uuid REFERENCES provisioning_templates(id),
    status text DEFAULT 'pending',
    node_id uuid,
    hostname text,
    ip_address text,
    progress integer DEFAULT 0,
    started_at timestamptz,
    completed_at timestamptz,
    error_message text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provisioning_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES provisioning_tasks(id),
    event_type text NOT NULL,
    message text,
    details jsonb,
    created_at timestamptz DEFAULT now()
);
```

### 2. PXE Server Container

```yaml
  octofleet-pxe:
    build: ./pxe
    ports:
      - "69:69/udp"
      - "9080:80"
    volumes:
      - ./pxe/config:/config
      - /mnt/isos:/isos:ro
    environment:
      - API_URL=http://octofleet-inventory-api:8080
    networks:
      - octofleet
```

### 3. NFS Server (Required for Ubuntu)

Ubuntu's casper live boot system **requires NFS** — HTTP `url=` does not work.

```bash
sudo apt install nfs-kernel-server

# Mount the ISO
sudo mkdir -p /mnt/ubuntu-24.04
sudo mount -o loop /path/to/ubuntu-24.04-live-server-amd64.iso /mnt/ubuntu-24.04

# Configure exports — insecure option is REQUIRED for PXE clients
echo '/mnt/ubuntu-24.04 *(ro,sync,no_subtree_check,insecure)' | sudo tee -a /etc/exports
sudo exportfs -ra
```

### 4. ISO Storage

```bash
sudo mkdir -p /mnt/isos
echo '192.168.0.24:/mnt/user/isos /mnt/isos nfs defaults,_netdev 0 0' | sudo tee -a /etc/fstab
sudo mount -a
```

### 5. DHCP Configuration

ISC DHCP example:

```
next-server 192.168.0.5;

if option arch = 00:07 {
    filename "ipxe-x86_64.efi";
} else {
    filename "undionly.kpxe";
}
```

### 6. Creating Provisioning Templates

Via API:

```bash
curl -X POST http://localhost:8080/api/v1/provisioning/images \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ubuntu-24.04-server",
    "display_name": "Ubuntu 24.04 LTS Server",
    "os_type": "linux",
    "os_version": "24.04",
    "architecture": "x64"
  }'
```

Or use the Octofleet web UI at `/provisioning`.

</details>

## Provisioning a New Machine

### Via Web UI (easiest)

1. Go to **Provisioning** → **New Task**
2. Enter the target machine's **MAC address**
3. Select a **template** (OS + config)
4. Click **Create Task**
5. Boot the target machine via PXE — it auto-picks up the assignment

### Via API

```bash
# Create provisioning task for a specific MAC
curl -X POST http://localhost:8080/api/v1/provisioning/tasks \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "mac_address": "aa:bb:cc:dd:ee:ff",
    "template_id": "your-template-uuid",
    "hostname": "new-server-01"
  }'
```

### Bulk provisioning

```bash
# Provision 10 machines at once
for mac in aa:bb:cc:11:11:01 aa:bb:cc:11:11:02 ... ; do
  curl -sX POST http://localhost:8080/api/v1/provisioning/tasks \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"mac_address\": \"$mac\", \"template_id\": \"$TEMPLATE_ID\"}"
done
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to fetch" on `/provisioning` page | Run main `docker-compose.yml` (not just PXE container) |
| PXE client gets no IP / no boot | Check DHCP `next-server` points to PXE server |
| Ubuntu boot hangs at NFS | Add `insecure` to `/etc/exports`, run `exportfs -ra` |
| "casper" not found / kernel panic | Use `nfs://` in iPXE template, not `http://` |
| CORS errors on provisioning page | Backend must be running; check `docker logs octofleet-inventory-api` |

## Network Diagram

```
┌─────────────┐     DHCP      ┌──────────────┐
│  PXE Client │ ─────────────│  DHCP Server  │
│  (new node) │              │  (router)     │
└──────┬──────┘              └──────────────┘
       │
       │  TFTP (port 69)
       ▼
┌──────────────┐    HTTP (9080)    ┌──────────────────┐
│  PXE Server  │ ◄──────────────── │  Octofleet API   │
│  (container) │                   │  (port 8080)     │
└──────┬───────┘                   └──────────────────┘
       │
       │  NFS (2049)
       ▼
┌──────────────┐
│  NFS Server  │
│  (ISO mount) │
└──────────────┘
```

> ⚠️ **Beta Notice**: PXE provisioning is under active development. Some features (Windows WIM deployment, cloud-init integration, auto-driver injection) are planned but not yet implemented. Please open issues for bugs or feature requests!
