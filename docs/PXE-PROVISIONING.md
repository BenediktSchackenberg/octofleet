# PXE Zero-Touch Provisioning Setup Guide

This guide covers setting up Octofleet's PXE provisioning infrastructure for automated OS deployment.

## Architecture Overview

```
PXE Client (BIOS/UEFI)
    │
    ├── DHCP → points to TFTP server (iPXE boot)
    │
    ├── TFTP → serves iPXE bootloader
    │
    ├── HTTP → serves iPXE scripts, ISOs, boot configs
    │
    └── NFS → serves Ubuntu live filesystem (casper requires NFS)
```

## Prerequisites

- A Linux server (Ubuntu 22.04/24.04 recommended)
- Docker & Docker Compose
- Octofleet backend running with PostgreSQL
- OS images/ISOs available on the network

## 1. Database Setup

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

## 2. PXE Server Container

Octofleet provides a PXE container that serves TFTP (iPXE bootloader) and HTTP (boot scripts).

### Docker Compose (add to your `docker-compose.yml`):

```yaml
  octofleet-pxe:
    build: ./pxe
    ports:
      - "69:69/udp"     # TFTP
      - "9080:80"       # HTTP (iPXE scripts & images)
    volumes:
      - ./pxe/config:/config
      - /mnt/isos:/isos:ro    # Mount your ISO storage
    environment:
      - API_URL=http://octofleet-inventory-api:8080
    networks:
      - octofleet
```

### Port Summary

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| TFTP    | 69   | UDP      | iPXE bootloader delivery |
| HTTP    | 9080 | TCP      | iPXE scripts, menus, images |
| NFS     | 2049 | TCP      | Ubuntu live filesystem (casper) |

## 3. NFS Server (Required for Ubuntu)

Ubuntu's casper live boot system **requires NFS** — HTTP `url=` does not work.

### Install NFS Server

```bash
sudo apt install nfs-kernel-server
```

### Export the Ubuntu filesystem

```bash
# Mount the ISO
sudo mkdir -p /mnt/ubuntu-24.04
sudo mount -o loop /path/to/ubuntu-24.04-live-server-amd64.iso /mnt/ubuntu-24.04

# Configure exports
echo '/mnt/ubuntu-24.04 *(ro,sync,no_subtree_check,insecure)' | sudo tee -a /etc/exports
sudo exportfs -ra
```

> ⚠️ **Important**: The `insecure` option is required! PXE clients use source ports > 1024, which NFS rejects by default.

### Multiple Ubuntu versions

```bash
/mnt/ubuntu-24.04 *(ro,sync,no_subtree_check,insecure)
/mnt/ubuntu-22.04 *(ro,sync,no_subtree_check,insecure)
```

## 4. ISO Storage

Mount your ISO storage (NAS, local disk, etc.):

```bash
# Example: NFS mount from NAS
sudo mkdir -p /mnt/isos
echo '192.168.0.24:/mnt/user/isos /mnt/isos nfs defaults,_netdev 0 0' | sudo tee -a /etc/fstab
sudo mount -a
```

## 5. DHCP Configuration

Your DHCP server needs to point PXE clients to the TFTP server. Example for ISC DHCP:

```
# /etc/dhcp/dhcpd.conf
next-server 192.168.0.5;          # IP of your PXE server

# UEFI vs BIOS boot
if option arch = 00:07 {
    filename "ipxe-x86_64.efi";   # UEFI
} else {
    filename "undionly.kpxe";      # BIOS
}
```

For router-based DHCP (e.g., pfSense, OPNsense), set:
- **Next Server**: IP of your PXE server
- **Default BIOS filename**: `undionly.kpxe`
- **UEFI filename**: `ipxe-x86_64.efi`

## 6. Creating Provisioning Templates

Use the Octofleet UI (`/provisioning`) or API:

### Via API

```bash
# Create an image entry
curl -X POST http://localhost:8080/api/v1/provisioning/images \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ubuntu-24.04-server",
    "display_name": "Ubuntu 24.04 LTS Server",
    "os_type": "linux",
    "os_version": "24.04",
    "architecture": "x64"
  }'

# Create a template
curl -X POST http://localhost:8080/api/v1/provisioning/templates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "linux",
    "display_name": "Ubuntu 24.04 Default Install",
    "ipxe_template": "#!ipxe\nkernel nfs://192.168.0.5/mnt/ubuntu-24.04/casper/vmlinuz\ninitrd nfs://192.168.0.5/mnt/ubuntu-24.04/casper/initrd\nboot",
    "notes": "Default Ubuntu 24.04 server installation"
  }'
```

## 7. Verifying the Setup

```bash
# Check PXE container
docker logs octofleet-pxe

# Check NFS exports
showmount -e localhost

# Check provisioning API
curl -s http://localhost:8080/api/v1/provisioning/templates \
  -H "Authorization: Bearer $TOKEN" | jq .

# Test TFTP (from another machine)
tftp 192.168.0.5 -c get undionly.kpxe
```

## Troubleshooting

### "Failed to fetch" on `/provisioning` page
- Ensure the provisioning tables exist in the database (see Section 1)
- Check backend logs: `docker logs octofleet-inventory-api`
- Common cause: missing `display_name` column (run the ALTER statements in Section 1)

### PXE client gets no IP / no boot
- Verify DHCP `next-server` points to your PXE server
- Check TFTP is accessible: `tftp <server-ip> -c get undionly.kpxe`

### Ubuntu boot hangs at NFS
- Verify `insecure` option in `/etc/exports`
- Run `sudo exportfs -ra` after changes
- Check NFS connectivity: `showmount -e <server-ip>`

### "casper" not found / kernel panic
- Ubuntu live boot requires NFS, not HTTP — ensure your iPXE template uses `nfs://`
- Verify the ISO is mounted and the filesystem is accessible

## Network Diagram

```
┌─────────────┐     DHCP      ┌──────────────┐
│  PXE Client │ ──────────── │  DHCP Server  │
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
