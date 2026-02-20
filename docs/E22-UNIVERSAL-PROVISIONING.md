# E22: Universal Provisioning (Hyper-V + KVM + Bare Metal)

## Epic Overview

**Goal:** Zero-Touch OS Deployment für VMs und Bare Metal Server — von PXE Boot bis Domain Join.

**Status:** 📋 Planning  
**Priority:** Medium  
**Estimated Effort:** ~150 Story Points (5 Phasen)

---

## Vision

```
┌─────────────────────────────────────────────────────────────────────┐
│                     OCTOFLEET PROVISIONING                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│         ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│         │ Hyper-V  │    │   KVM    │    │  Bare    │              │
│         │   VMs    │    │   VMs    │    │  Metal   │              │
│         └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│              │               │               │                     │
│              └───────────────┼───────────────┘                     │
│                              ▼                                     │
│                    ┌─────────────────┐                             │
│                    │  Unified API    │                             │
│                    │  /provisioning  │                             │
│                    └────────┬────────┘                             │
│                             │                                      │
│              ┌──────────────┼──────────────┐                      │
│              ▼              ▼              ▼                      │
│         ┌────────┐    ┌──────────┐   ┌─────────┐                 │
│         │ iPXE   │    │ Cloud-   │   │  ISO    │                 │
│         │ Boot   │    │ Init     │   │  Boot   │                 │
│         └────────┘    └──────────┘   └─────────┘                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Supported Targets

| Target | VM Creation | Boot Method | OS Install | Post-Install |
|--------|-------------|-------------|------------|--------------|
| **Hyper-V** | PowerShell (New-VM) | PXE oder ISO | Autounattend.xml | Octofleet Agent |
| **KVM** | virsh/libvirt | PXE oder Cloud-Init | Kickstart/Autounattend | Octofleet Agent |
| **Bare Metal** | Manual (MAC register) | iPXE/PXE | Autounattend.xml | Octofleet Agent |

---

## Architecture

### Provisioning Server (Lightweight, Docker-based)

```yaml
# Kein WDS nötig! Alles in einem Container.
services:
  octofleet-pxe:
    image: octofleet/provisioning:latest
    ports:
      - "69:69/udp"      # TFTP (iPXE boot files)
      - "4011:4011/udp"  # ProxyDHCP (kein DHCP-Server nötig)
      - "8888:8888"      # HTTP (WIM Images, Drivers)
    volumes:
      - ./images:/images        # WIM, ISO, Cloud Images
      - ./drivers:/drivers      # Driver Injection Packs
      - ./answers:/answers      # Autounattend.xml Templates
    environment:
      - OCTOFLEET_API=http://octofleet:8080
    network_mode: host  # Für DHCP/TFTP Broadcast
```

### Components

```
┌─────────────────────────────────────────────────────────────────────┐
│  Octofleet Provisioning Stack                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │    dnsmasq      │  │   HTTP Server   │  │  Octofleet API  │    │
│  │  (ProxyDHCP +   │  │  (nginx/caddy)  │  │   Extensions    │    │
│  │     TFTP)       │  │                 │  │                 │    │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘    │
│           │                    │                    │              │
│           │     ┌──────────────┴──────────────┐    │              │
│           │     │         /images/            │    │              │
│           │     │  • boot.wim (WinPE)         │    │              │
│           │     │  • install.wim (OS)         │    │              │
│           │     │  • drivers/*.inf            │    │              │
│           │     │  • answers/*.xml            │    │              │
│           │     └─────────────────────────────┘    │              │
│           │                                        │              │
│  ┌────────┴────────────────────────────────────────┴────────┐     │
│  │                    iPXE Boot Chain                        │     │
│  │  1. BIOS/UEFI PXE → dnsmasq → ipxe.efi                   │     │
│  │  2. iPXE → HTTP → boot script (chain.ipxe)               │     │
│  │  3. Script calls Octofleet API (MAC lookup)              │     │
│  │  4. API returns: WIM URL + Autounattend URL              │     │
│  │  5. wimboot loads WinPE → starts setup                   │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### provisioning_images

```sql
CREATE TABLE provisioning_images (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,           -- "Windows Server 2025 Standard"
    os_type VARCHAR(50) NOT NULL,         -- windows | linux
    os_version VARCHAR(100),              -- "Windows Server 2025" | "Ubuntu 24.04"
    architecture VARCHAR(20) DEFAULT 'x64',
    
    -- Image Files
    image_path VARCHAR(500) NOT NULL,     -- "/images/windows/2025-std.wim"
    image_index INT DEFAULT 1,            -- WIM index für Edition
    boot_wim_path VARCHAR(500),           -- "/images/windows/boot.wim"
    
    -- Metadata
    size_bytes BIGINT,
    checksum_sha256 VARCHAR(64),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### provisioning_driver_packs

```sql
CREATE TABLE provisioning_driver_packs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,           -- "Dell PowerEdge R750"
    vendor VARCHAR(100),                  -- "Dell", "HPE", "Lenovo"
    model_pattern VARCHAR(255),           -- Regex für Hardware-Matching
    os_type VARCHAR(50) NOT NULL,
    
    driver_path VARCHAR(500) NOT NULL,    -- "/drivers/dell-r750/"
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### provisioning_templates

```sql
CREATE TABLE provisioning_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,           -- "Standard SQL Server"
    description TEXT,
    
    -- VM Defaults
    default_cpu INT DEFAULT 4,
    default_memory_gb INT DEFAULT 16,
    default_disks JSONB,                  -- [{"sizeGb": 100, "purpose": "os"}, ...]
    
    -- OS Settings
    image_id INT REFERENCES provisioning_images(id),
    language VARCHAR(10) DEFAULT 'de-DE',
    timezone VARCHAR(100) DEFAULT 'W. Europe Standard Time',
    
    -- Domain Settings
    domain_join BOOLEAN DEFAULT false,
    domain_name VARCHAR(255),
    domain_ou VARCHAR(500),
    domain_join_method VARCHAR(20) DEFAULT 'offline', -- offline | online
    
    -- Post-Install
    post_install_packages JSONB,          -- [{"packageId": 1}, {"groupId": 5}]
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### provisioning_tasks

```sql
CREATE TABLE provisioning_tasks (
    id SERIAL PRIMARY KEY,
    
    -- Target
    hostname VARCHAR(255) NOT NULL,
    target_type VARCHAR(20) NOT NULL,     -- hyperv | kvm | baremetal
    hypervisor_node_id INT REFERENCES nodes(id),  -- Für VMs
    mac_address VARCHAR(17),              -- Für PXE Boot Matching
    
    -- Template/Config
    template_id INT REFERENCES provisioning_templates(id),
    config_override JSONB,                -- Überschreibt Template-Werte
    
    -- Domain Join
    domain_join_blob TEXT,                -- djoin.exe Output (encrypted)
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- pending | creating_vm | booting | installing | configuring | completed | failed
    current_step VARCHAR(100),
    progress_percent INT DEFAULT 0,
    error_message TEXT,
    
    -- Timing
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Result
    result_node_id INT REFERENCES nodes(id)  -- Nach erfolgreicher Installation
);
```

### provisioning_task_logs

```sql
CREATE TABLE provisioning_task_logs (
    id SERIAL PRIMARY KEY,
    task_id INT REFERENCES provisioning_tasks(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    level VARCHAR(20) DEFAULT 'info',     -- debug | info | warn | error
    step VARCHAR(100),
    message TEXT
);
```

---

## API Endpoints

### Images

```
GET    /api/v1/provisioning/images              # List images
POST   /api/v1/provisioning/images              # Upload/register image
GET    /api/v1/provisioning/images/{id}         # Get image details
DELETE /api/v1/provisioning/images/{id}         # Delete image
POST   /api/v1/provisioning/images/{id}/scan    # Scan WIM for editions
```

### Driver Packs

```
GET    /api/v1/provisioning/drivers             # List driver packs
POST   /api/v1/provisioning/drivers             # Add driver pack
DELETE /api/v1/provisioning/drivers/{id}        # Delete driver pack
```

### Templates

```
GET    /api/v1/provisioning/templates           # List templates
POST   /api/v1/provisioning/templates           # Create template
GET    /api/v1/provisioning/templates/{id}      # Get template
PUT    /api/v1/provisioning/templates/{id}      # Update template
DELETE /api/v1/provisioning/templates/{id}      # Delete template
```

### Tasks

```
GET    /api/v1/provisioning/tasks               # List tasks
POST   /api/v1/provisioning/tasks               # Create provisioning task
GET    /api/v1/provisioning/tasks/{id}          # Get task status
DELETE /api/v1/provisioning/tasks/{id}          # Cancel task
GET    /api/v1/provisioning/tasks/{id}/logs     # Get task logs

# PXE Boot Callback (called by iPXE script)
GET    /api/v1/provisioning/pxe/boot?mac={mac}  # Returns boot config for MAC
POST   /api/v1/provisioning/pxe/status          # WinPE status callback
```

### Hypervisors

```
GET    /api/v1/provisioning/hypervisors                    # List available hypervisors
GET    /api/v1/provisioning/hypervisors/{nodeId}/networks  # List vSwitches/networks
GET    /api/v1/provisioning/hypervisors/{nodeId}/storage   # List storage locations
```

---

## Provisioning Task Request

```json
POST /api/v1/provisioning/tasks
{
  "hostname": "SQL-SERVER-01",
  "targetType": "hyperv",
  "hypervisorNodeId": 5,
  
  "vm": {
    "cpu": 4,
    "memoryGb": 16,
    "generation": 2,
    "secureboot": true,
    "disks": [
      { "sizeGb": 100, "purpose": "os", "type": "dynamic" },
      { "sizeGb": 200, "purpose": "data", "type": "fixed" },
      { "sizeGb": 100, "purpose": "log", "type": "fixed" },
      { "sizeGb": 50, "purpose": "tempdb", "type": "fixed" }
    ],
    "network": {
      "vswitch": "vSwitch-Prod",
      "vlan": 100
    },
    "storagePath": "D:\\Hyper-V\\Virtual Hard Disks"
  },
  
  "os": {
    "imageId": 1,
    "language": "de-DE",
    "timezone": "W. Europe Standard Time",
    "productKey": "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX",
    "adminPassword": "encrypted:....."
  },
  
  "network": {
    "mode": "dhcp",
    // Oder static:
    "mode": "static",
    "ip": "192.168.1.50",
    "subnet": "255.255.255.0",
    "gateway": "192.168.1.1",
    "dns": ["192.168.1.10", "192.168.1.11"]
  },
  
  "domain": {
    "join": true,
    "name": "yourdom.local",
    "ou": "OU=SQL Servers,OU=Servers,DC=yourdom,DC=local",
    "method": "offline",
    "serviceAccount": {
      "username": "YOURDOM\\svc-domainjoin",
      "password": "encrypted:....."
    }
  },
  
  "postInstall": {
    "installAgent": true,
    "addToGroups": [5, 12],
    "runPackages": [
      { "packageId": 8, "parameters": { "instanceName": "YOURDBSERVER" } }
    ],
    "runScripts": [
      { "name": "Configure-Firewall.ps1" }
    ]
  }
}
```

---

## Autounattend.xml Generation

### Template Variables

```xml
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE">
      <SetupUILanguage>
        <UILanguage>{{LANGUAGE}}</UILanguage>
      </SetupUILanguage>
      <InputLocale>{{INPUT_LOCALE}}</InputLocale>
      <SystemLocale>{{SYSTEM_LOCALE}}</SystemLocale>
      <UILanguage>{{LANGUAGE}}</UILanguage>
      <UserLocale>{{USER_LOCALE}}</UserLocale>
    </component>
    
    <component name="Microsoft-Windows-Setup">
      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <!-- EFI System Partition -->
            <CreatePartition wcm:action="add">
              <Order>1</Order>
              <Size>512</Size>
              <Type>EFI</Type>
            </CreatePartition>
            <!-- MSR -->
            <CreatePartition wcm:action="add">
              <Order>2</Order>
              <Size>128</Size>
              <Type>MSR</Type>
            </CreatePartition>
            <!-- Windows -->
            <CreatePartition wcm:action="add">
              <Order>3</Order>
              <Extend>true</Extend>
              <Type>Primary</Type>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order>
              <PartitionID>1</PartitionID>
              <Format>FAT32</Format>
              <Label>System</Label>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order>
              <PartitionID>3</PartitionID>
              <Format>NTFS</Format>
              <Label>Windows</Label>
              <Letter>C</Letter>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      
      <ImageInstall>
        <OSImage>
          <InstallFrom>
            <Path>{{WIM_PATH}}</Path>
            <MetaData wcm:action="add">
              <Key>/IMAGE/INDEX</Key>
              <Value>{{WIM_INDEX}}</Value>
            </MetaData>
          </InstallFrom>
          <InstallTo>
            <DiskID>0</DiskID>
            <PartitionID>3</PartitionID>
          </InstallTo>
        </OSImage>
      </ImageInstall>
      
      <UserData>
        <ProductKey>
          <Key>{{PRODUCT_KEY}}</Key>
        </ProductKey>
        <AcceptEula>true</AcceptEula>
      </UserData>
    </component>
  </settings>
  
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup">
      <ComputerName>{{HOSTNAME}}</ComputerName>
      <TimeZone>{{TIMEZONE}}</TimeZone>
    </component>
    
    {{#IF DOMAIN_JOIN_OFFLINE}}
    <component name="Microsoft-Windows-UnattendedJoin">
      <Identification>
        <Provisioning>
          <AccountData>{{DJOIN_BLOB}}</AccountData>
        </Provisioning>
      </Identification>
    </component>
    {{/IF}}
    
    {{#IF DOMAIN_JOIN_ONLINE}}
    <component name="Microsoft-Windows-UnattendedJoin">
      <Identification>
        <Credentials>
          <Domain>{{DOMAIN_NAME}}</Domain>
          <Username>{{DOMAIN_USER}}</Username>
          <Password>{{DOMAIN_PASSWORD}}</Password>
        </Credentials>
        <JoinDomain>{{DOMAIN_NAME}}</JoinDomain>
        <MachineObjectOU>{{DOMAIN_OU}}</MachineObjectOU>
      </Identification>
    </component>
    {{/IF}}
  </settings>
  
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
      </OOBE>
      
      <UserAccounts>
        <AdministratorPassword>
          <Value>{{ADMIN_PASSWORD_BASE64}}</Value>
          <PlainText>false</PlainText>
        </AdministratorPassword>
      </UserAccounts>
      
      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <CommandLine>powershell.exe -ExecutionPolicy Bypass -File C:\Windows\Setup\Scripts\Install-OctofleetAgent.ps1</CommandLine>
          <Description>Install Octofleet Agent</Description>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>2</Order>
          <CommandLine>powershell.exe -ExecutionPolicy Bypass -File C:\Windows\Setup\Scripts\Callback-Complete.ps1</CommandLine>
          <Description>Notify Octofleet of completion</Description>
        </SynchronousCommand>
      </FirstLogonCommands>
    </component>
  </settings>
</unattend>
```

---

## iPXE Boot Script

### chain.ipxe (Dynamisch generiert)

```ipxe
#!ipxe

# Octofleet PXE Boot Script
# Generated dynamically based on MAC address

set octofleet-api http://{{OCTOFLEET_SERVER}}:8080/api/v1/provisioning

# Get boot config from Octofleet
chain ${octofleet-api}/pxe/boot?mac=${mac}&uuid=${uuid}&manufacturer=${manufacturer}&product=${product} ||

# Fallback: Show menu
:menu
menu Octofleet PXE Boot
item --key w windows    Boot Windows Setup
item --key l local      Boot from local disk
item --key s shell      iPXE Shell
choose --timeout 10000 --default local target && goto ${target}

:windows
# Load from Octofleet API response
kernel wimboot
initrd ${winpe-bcd}    BCD
initrd ${winpe-boot}   boot.sdi
initrd ${winpe-wim}    boot.wim
boot

:local
sanboot --no-describe --drive 0x80

:shell
shell
```

### Boot Config Response

```json
GET /api/v1/provisioning/pxe/boot?mac=00:15:5D:xx:xx:xx

Response (wenn Task existiert):
{
  "action": "install",
  "taskId": 42,
  "hostname": "SQL-SERVER-01",
  "files": {
    "winpe-bcd": "http://pxe-server:8888/winpe/BCD",
    "winpe-boot": "http://pxe-server:8888/winpe/boot.sdi",
    "winpe-wim": "http://pxe-server:8888/winpe/boot.wim"
  },
  "autounattend": "http://pxe-server:8888/answers/task-42.xml",
  "callbackUrl": "http://octofleet:8080/api/v1/provisioning/pxe/status"
}

Response (wenn kein Task):
{
  "action": "localboot",
  "message": "No provisioning task for this MAC"
}
```

---

## Domain Join Methods

### Offline Domain Join (Empfohlen)

```powershell
# Auf Domain Controller ausführen (via Octofleet Job)
$hostname = "SQL-SERVER-01"
$domain = "yourdom.local"
$ou = "OU=SQL Servers,OU=Servers,DC=yourdom,DC=local"

# Generiert Blob für Autounattend.xml
djoin.exe /provision /domain $domain /machine $hostname /machineou $ou /savefile "C:\temp\$hostname.txt"

# Blob Base64-codiert in Autounattend.xml einfügen
$blob = Get-Content "C:\temp\$hostname.txt" -Raw
```

**Vorteile:**
- Kein Domain-Passwort in Autounattend.xml
- Funktioniert auch ohne Netzwerk während OOBE
- Sicherer

### Online Domain Join

```xml
<!-- In Autounattend.xml -->
<component name="Microsoft-Windows-UnattendedJoin">
  <Identification>
    <Credentials>
      <Domain>yourdom.local</Domain>
      <Username>svc-domainjoin</Username>
      <Password>P@ssw0rd!</Password>
    </Credentials>
    <JoinDomain>yourdom.local</JoinDomain>
    <MachineObjectOU>OU=Servers,DC=yourdom,DC=local</MachineObjectOU>
  </Identification>
</component>
```

**Nachteile:**
- Passwort im Klartext (oder Base64) in XML
- Braucht Netzwerk während Setup

---

## Hyper-V Integration

### VM Creation Script (auf Hypervisor Node ausgeführt)

```powershell
param(
    [string]$VMName,
    [int]$CPU,
    [int]$MemoryGB,
    [hashtable[]]$Disks,
    [string]$VSwitch,
    [int]$VLAN,
    [string]$StoragePath,
    [int]$Generation = 2
)

# Create VM
$vm = New-VM -Name $VMName `
    -Generation $Generation `
    -MemoryStartupBytes ($MemoryGB * 1GB) `
    -Path $StoragePath `
    -NoVHD

# Configure CPU
Set-VMProcessor -VM $vm -Count $CPU

# Create and attach disks
foreach ($disk in $Disks) {
    $vhdPath = Join-Path $StoragePath "$VMName-$($disk.purpose).vhdx"
    
    if ($disk.type -eq 'fixed') {
        New-VHD -Path $vhdPath -SizeBytes ($disk.sizeGb * 1GB) -Fixed
    } else {
        New-VHD -Path $vhdPath -SizeBytes ($disk.sizeGb * 1GB) -Dynamic
    }
    
    Add-VMHardDiskDrive -VM $vm -Path $vhdPath
}

# Configure network
$nic = Get-VMNetworkAdapter -VM $vm
Connect-VMNetworkAdapter -VMNetworkAdapter $nic -SwitchName $VSwitch

if ($VLAN -gt 0) {
    Set-VMNetworkAdapterVlan -VMNetworkAdapter $nic -Access -VlanId $VLAN
}

# Configure boot order (Network first for PXE)
$bootOrder = @(
    (Get-VMNetworkAdapter -VM $vm),
    (Get-VMHardDiskDrive -VM $vm | Select-Object -First 1)
)
Set-VMFirmware -VM $vm -BootOrder $bootOrder

# Enable Secure Boot for Gen2
if ($Generation -eq 2) {
    Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate "MicrosoftUEFICertificateAuthority"
}

# Start VM (triggers PXE boot)
Start-VM -VM $vm

# Return MAC address for PXE registration
$mac = (Get-VMNetworkAdapter -VM $vm).MacAddress
return @{
    VMName = $VMName
    MacAddress = $mac -replace '(..)(?=.)', '$1:'
    Status = "Started"
}
```

---

## KVM/libvirt Integration

### VM Creation (auf Linux Hypervisor)

```bash
#!/bin/bash
# create-vm.sh

VM_NAME=$1
CPU=$2
MEMORY_MB=$3
DISK_SIZE_GB=$4
NETWORK=$5
STORAGE_POOL=$6

# Create disk
qemu-img create -f qcow2 /var/lib/libvirt/images/${VM_NAME}.qcow2 ${DISK_SIZE_GB}G

# Create VM with PXE boot
virt-install \
  --name ${VM_NAME} \
  --vcpus ${CPU} \
  --memory ${MEMORY_MB} \
  --disk /var/lib/libvirt/images/${VM_NAME}.qcow2,format=qcow2 \
  --network network=${NETWORK},model=virtio \
  --boot network,hd \
  --os-variant win2k22 \
  --graphics vnc \
  --noautoconsole

# Get MAC address
MAC=$(virsh domiflist ${VM_NAME} | grep -oE '([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}')
echo "MAC: ${MAC}"
```

---

## UI Design

### Provisioning Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│  🖥️ Provisioning                                          [+ New]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Active Tasks                                                │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  🔄 SQL-SERVER-01    Hyper-V    Installing Windows   67%    │   │
│  │  ✅ WEB-SERVER-03    KVM        Completed            100%   │   │
│  │  ❌ APP-SERVER-02    Bare Metal Failed: PXE timeout  -      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   Images     │  │   Drivers    │  │  Templates   │             │
│  │      5       │  │      12      │  │      3       │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### New Provisioning Task

```
┌─────────────────────────────────────────────────────────────────────┐
│  🖥️ Provisioning > New Task                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ── Basic ─────────────────────────────────────────────────────    │
│  Hostname:        [SQL-SERVER-01      ]                            │
│  Template:        [SQL Server Standard ▼]  [or configure manually] │
│                                                                     │
│  ── Target ────────────────────────────────────────────────────    │
│  Type:            ● Hyper-V  ○ KVM  ○ Bare Metal                   │
│  Hypervisor:      [YOURHOST01 ▼]                                    │
│                                                                     │
│  ── VM Configuration ──────────────────────────────────────────    │
│  CPU:             [4    ] cores                                    │
│  Memory:          [16   ] GB                                       │
│  Generation:      ● Gen 2 (UEFI)  ○ Gen 1 (BIOS)                  │
│                                                                     │
│  Disks:                                                            │
│  ┌────────┬────────┬──────────┬─────────┐                         │
│  │ Size   │ Purpose│ Type     │         │                         │
│  ├────────┼────────┼──────────┼─────────┤                         │
│  │ 100 GB │ OS     │ Dynamic  │ [Remove]│                         │
│  │ 200 GB │ Data   │ Fixed    │ [Remove]│                         │
│  │ 100 GB │ Log    │ Fixed    │ [Remove]│                         │
│  │ 50 GB  │ TempDB │ Fixed    │ [Remove]│                         │
│  └────────┴────────┴──────────┴─────────┘                         │
│  [+ Add Disk]                                                      │
│                                                                     │
│  Network:         [vSwitch-Prod ▼]  VLAN: [100 ]                  │
│                                                                     │
│  ── OS ────────────────────────────────────────────────────────    │
│  Image:           [Windows Server 2025 Standard ▼]                 │
│  Language:        [de-DE ▼]                                        │
│  Timezone:        [W. Europe Standard Time ▼]                      │
│  Product Key:     [XXXXX-XXXXX-XXXXX-XXXXX-XXXXX]  (optional)     │
│                                                                     │
│  ── Network Config ────────────────────────────────────────────    │
│  ● DHCP                                                            │
│  ○ Static IP                                                       │
│    IP:      [             ]  Subnet: [             ]              │
│    Gateway: [             ]  DNS:    [             ]              │
│                                                                     │
│  ── Domain ────────────────────────────────────────────────────    │
│  ☑ Join Domain                                                     │
│  Domain:          [yourdom.local        ]                          │
│  OU:              [OU=SQL Servers,OU=Servers,DC=yourdom,DC=local] │
│  Method:          ● Offline (djoin)  ○ Online                     │
│                                                                     │
│  ── Post-Install ──────────────────────────────────────────────    │
│  ☑ Install Octofleet Agent                                         │
│  ☑ Add to Groups: [SQL Servers         ] [+ Add]                  │
│  ☑ Install Packages:                                               │
│    • SQL Server 2025 Standard                        [Remove]      │
│    [+ Add Package]                                                 │
│                                                                     │
│  ──────────────────────────────────────────────────────────────    │
│                                                                     │
│  [Cancel]                              [Create Provisioning Task]  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Task Detail / Progress

```
┌─────────────────────────────────────────────────────────────────────┐
│  🖥️ Provisioning > SQL-SERVER-01                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Status: 🔄 Installing                                              │
│  ████████████████████░░░░░░░░░░  67%                               │
│                                                                     │
│  ── Progress ──────────────────────────────────────────────────    │
│                                                                     │
│  ✅ Create VM on YOURHOST01                           00:00:05      │
│     Created 4 vCPU, 16GB RAM, 4 disks                              │
│     MAC: 00:15:5D:01:02:03                                         │
│                                                                     │
│  ✅ Generate Autounattend.xml                         00:00:01      │
│     Offline domain join blob included                              │
│                                                                     │
│  ✅ Register MAC for PXE Boot                         00:00:01      │
│     Boot config ready                                              │
│                                                                     │
│  ✅ Start VM                                          00:00:02      │
│     PXE boot initiated                                             │
│                                                                     │
│  ✅ WinPE Loaded                                      00:01:23      │
│     Callback received from WinPE                                   │
│                                                                     │
│  🔄 Windows Installation                              00:12:34      │
│     Installing features and drivers...                             │
│                                                                     │
│  ⏳ First Boot & OOBE                                               │
│  ⏳ Domain Join                                                     │
│  ⏳ Install Octofleet Agent                                         │
│  ⏳ Post-Install: SQL Server 2025                                   │
│                                                                     │
│  ── Logs ──────────────────────────────────────────────────────    │
│  18:45:01 [INFO]  VM SQL-SERVER-01 created successfully            │
│  18:45:02 [INFO]  Disks: OS(100GB), Data(200GB), Log(100GB)...    │
│  18:45:03 [INFO]  Network: vSwitch-Prod, VLAN 100                  │
│  18:45:06 [INFO]  PXE boot config registered for 00:15:5D:01:02:03│
│  18:46:29 [INFO]  WinPE callback: Starting Windows Setup           │
│  18:47:15 [INFO]  WinPE callback: Applying image (index 2)         │
│  18:52:03 [INFO]  WinPE callback: Installing drivers               │
│                                                                     │
│  [Cancel Task]                                         [View VM]   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Hyper-V + ISO Boot (~40 SP)

**Scope:** VM erstellen und mit ISO booten (ohne PXE)

- [ ] Database schema
- [ ] API: Images, Templates, Tasks
- [ ] Hyper-V VM creation via PowerShell
- [ ] Autounattend.xml generation
- [ ] ISO mounting for boot
- [ ] Basic UI: Task creation, progress
- [ ] Agent auto-install post-setup

### Phase 2: PXE Boot Infrastructure (~30 SP)

**Scope:** iPXE Server für Network Boot

- [ ] Docker container: dnsmasq + HTTP
- [ ] iPXE boot files (BIOS + UEFI)
- [ ] Dynamic boot script generation
- [ ] WinPE callback mechanism
- [ ] MAC address registration
- [ ] PXE boot for Hyper-V VMs

### Phase 3: KVM Support (~25 SP)

**Scope:** libvirt/virsh Integration

- [ ] KVM VM creation via virsh
- [ ] Network bridge configuration
- [ ] Cloud-init support (Linux)
- [ ] PXE boot for KVM VMs

### Phase 4: Domain Join & Drivers (~35 SP)

**Scope:** Enterprise Features

- [ ] Offline domain join (djoin)
- [ ] Online domain join option
- [ ] Driver pack management
- [ ] Driver injection in WinPE
- [ ] Hardware detection & matching

### Phase 5: Post-Install Orchestration (~20 SP)

**Scope:** Integration mit bestehendem System

- [ ] Auto-add to groups
- [ ] Package installation queue
- [ ] Custom script execution
- [ ] Completion notifications
- [ ] Retry/rollback logic

---

## Open Source Differentiators

| Feature | Foreman | MAAS | Cobbler | **Octofleet** |
|---------|---------|------|---------|---------------|
| Windows Focus | ❌ | ❌ | ❌ | ✅ |
| Hyper-V Native | ❌ | ❌ | ❌ | ✅ |
| KVM Support | ✅ | ✅ | ✅ | ✅ |
| Modern UI | ⚠️ | ⚠️ | ❌ | ✅ |
| Domain Join | ❌ | ❌ | ❌ | ✅ |
| Endpoint Mgmt | ❌ | ❌ | ❌ | ✅ |
| Docker Deploy | ❌ | ❌ | ❌ | ✅ |
| SQL Server Ready | ❌ | ❌ | ❌ | ✅ |

---

## Future Enhancements

- **VMware vSphere** support
- **Azure/AWS** VM provisioning
- **Linux Kickstart** templates
- **SCCM Task Sequence** import
- **Hardware inventory** pre-provision (IPMI/iLO/iDRAC)
- **Multi-site PXE** with edge servers

---

*Letzte Aktualisierung: 2026-02-20*

---

## Lessons Learned (2026-02-20)

### WinPE + VirtIO

| Problem | Ursache | Lösung |
|---------|---------|--------|
| Keine Disk sichtbar | Falscher Treiber | `vioscsi.inf` für SCSI-Disks, nicht `viostor.inf` |
| Netzwerk fehlt | Treiber nicht geladen | `drvload netkvm.inf` + `wpeutil initializenetwork` |

### WinPE + SMB

| Problem | Ursache | Lösung |
|---------|---------|--------|
| "Server service not started" | SMB Client inaktiv | `net start lanmanserver` |
| Error 53/67 nach net use | Service braucht Zeit | Retry-Loop alle 10 Sek |
| 3-5 Min Wartezeit | Samba DNS Lookup | `name resolve order = bcast host` |

### Samba Konfiguration (für WinPE)

```ini
[global]
   server min protocol = NT1    # SMB1 für WinPE
   ntlm auth = yes
   name resolve order = bcast host
   dns proxy = no
   hostname lookups = no
```

### startnet.cmd Best Practices

1. **VirtIO Treiber laden** (vioscsi + netkvm)
2. **wpeinit** + **wpeutil initializenetwork**
3. **Warten auf IP** (Loop bis 192.168 gefunden)
4. **net start lanmanworkstation** (nicht lanmanserver!)
5. **SMB Mount mit Retry-Loop** (nicht nur einmal versuchen!)
6. **Fehlerprüfung** nach jedem Schritt
7. **VirtIO Driver Injection** nach DISM, vor bcdboot!

### WinPE Gotchas

| Fehler | Ursache | Fix |
|--------|---------|-----|
| `findstr` not found | WinPE hat kein findstr | Nutze `find` statt `findstr` |
| INACCESSIBLE_BOOT_DEVICE | VirtIO Treiber fehlt in Windows | `dism /image:W:\ /add-driver /driver:vioscsi.inf` |
| diskpart hängt | X:\diskpart.txt fehlt | Inline generieren mit `echo > X:\dp.txt` |
| setlocal fehler | enabledelayedexpansion Syntax | `setlocal enabledelayedexpansion` am Anfang |

### Driver Injection (KRITISCH!)

VirtIO Treiber müssen ZWEIMAL geladen werden:
1. **In WinPE** → damit Disk/Netzwerk während Installation funktioniert
2. **Ins installierte Windows** → damit Windows nach Reboot bootet!

```batch
:: Nach DISM apply, VOR bcdboot:
dism /image:W:\ /add-driver /driver:X:\Windows\System32\drivers\vioscsi.inf
dism /image:W:\ /add-driver /driver:X:\Windows\System32\drivers\netkvm.inf
```

### Finale startnet.cmd Struktur

```
[1] drvload vioscsi + netkvm     → WinPE kann Disk/Netz sehen
[2] wpeinit                       → WinPE Services initialisieren
[3] wpeutil initializenetwork     → Netzwerk Stack starten
[4] Wait for IP                   → DHCP abwarten
[5] net start lanmanworkstation   → SMB Client starten
[6] net use Z: \\server\share     → SMB Mount (mit Retry!)
[7] diskpart                      → Partitionen erstellen
[8] dism /apply-image             → Windows Image anwenden
[9] dism /add-driver              → VirtIO ins installierte Windows!
[10] bcdboot                      → Bootloader konfigurieren
[11] wpeutil reboot               → Neustart in Windows
```

### Timing

- VirtIO Treiber: ~5 Sek nach drvload warten
- SMB: 30-60 Sek nach lanmanserver starten
- DISM: ~5-10 Min für 7GB WIM
- Gesamte Installation: ~10-15 Min
