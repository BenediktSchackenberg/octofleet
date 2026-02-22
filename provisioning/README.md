# Octofleet PXE Zero-Touch Deployment

## Übersicht

Vollautomatische Windows-Installation über Netzwerk ohne manuelle Eingriffe.

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                      PXE Boot Flow                          │
├─────────────────────────────────────────────────────────────┤
│  1. Client bootet → DHCP Request                            │
│  2. DHCP Server → IP + next-server + bootfile               │
│  3. Client lädt iPXE (TFTP): undionly.kpxe / ipxe.efi       │
│  4. iPXE chains zu boot.ipxe (HTTP)                         │
│  5. boot.ipxe lädt MAC-spezifisches Script /boot/{mac}.ipxe │
│  6. wimboot + boot.wim + injected files laden               │
│  7. WinPE startet, führt startnet.cmd aus                   │
│  8. Automatische Installation:                              │
│     - Disk partitionieren (diskpart)                        │
│     - Image via HTTP downloaden (curl.exe)                  │
│     - DISM apply-image                                      │
│     - bcdboot                                               │
│     - Reboot → Windows!                                     │
└─────────────────────────────────────────────────────────────┘
```

## Server-Komponenten (192.168.0.5)

### 1. DHCP + TFTP (dnsmasq)

```conf
# /etc/dnsmasq.d/pxe.conf
dhcp-range=192.168.0.100,192.168.0.200,12h
dhcp-boot=tag:!ipxe,undionly.kpxe
dhcp-match=set:ipxe,175
dhcp-boot=tag:ipxe,http://192.168.0.5:9080/boot.ipxe
dhcp-boot=tag:efi64,ipxe.efi
enable-tftp
tftp-root=/srv/tftp
```

### 2. HTTP Server (nginx:9080)

```nginx
server {
    listen 9080;
    root /home/benedikt/.openclaw/workspace/octofleet-work/provisioning;
    autoindex on;
}
```

### 3. Samba (optional für SMB)

```ini
[global]
name resolve order = bcast host    # WICHTIG für WinPE!
map to guest = Bad User
server min protocol = NT1

[images]
path = /path/to/provisioning/images
guest ok = yes
read only = yes
```

## Verzeichnisstruktur

```
provisioning/
├── boot/                      # MAC-spezifische iPXE Scripts
│   └── 00-15-5d-00-23-02.ipxe
├── images/
│   ├── winpe/
│   │   ├── wimboot            # v2.9.0 (von github.com/ipxe/wimboot)
│   │   └── boot.wim           # aus Windows ISO /sources/boot.wim
│   └── win2025/
│       └── install.wim        # aus Windows ISO /sources/install.wim (~7GB)
├── scripts/
│   ├── startnet.cmd           # Deployment-Script (CRLF!)
│   ├── deploypart.txt         # Diskpart Commands
│   ├── winpeshl.ini           # Auto-Start
│   └── curl.exe               # von curl.se/windows
├── drivers/
│   └── virtio/                # für KVM/QEMU
└── tftpboot/
    ├── ipxe.efi               # UEFI
    └── undionly.kpxe          # BIOS
```

---

## Platform-Konfiguration

### ✅ Hyper-V Gen2 (UEFI) - FUNKTIONIERT

**iPXE Script:**
```ipxe
#!ipxe
kernel http://192.168.0.5:9080/images/winpe/wimboot index=1
initrd http://192.168.0.5:9080/scripts/winpeshl.ini      winpeshl.ini
initrd http://192.168.0.5:9080/scripts/startnet.cmd      startnet.cmd
initrd http://192.168.0.5:9080/scripts/deploypart.txt    deploypart.txt
initrd http://192.168.0.5:9080/scripts/curl.exe          curl.exe
initrd http://192.168.0.5:9080/images/winpe/boot.wim     boot.wim
boot
```

**Anforderungen:**
- Gen2 VM (UEFI)
- Secure Boot: AUS
- Network Adapter: Standard (nicht Legacy)
- Disk: SCSI Controller

### ⚠️ Hyper-V Gen1 (BIOS) - PROBLEME

wimboot hat "Bad CPIO magic" Fehler.
**→ Gen2 verwenden!**

### ✅ KVM/libvirt - FUNKTIONIERT

**Unterschiede:**
- VirtIO Treiber als initrd injizieren (vioscsi.inf/.sys/.cat)
- SMB funktioniert (nach 3-5 Min Wartezeit)
- Oder HTTP mit curl.exe

### 🔧 Bare Metal - TODO

Benötigt:
- Hardware-spezifische Treiber
- UEFI vs Legacy Detection
- Intel RST / RAID Treiber

---

## Scripts

### startnet.cmd

**WICHTIG: CRLF Zeilenenden!** (`unix2dos startnet.cmd`)

```batch
@echo off
echo [1/6] Initializing network...
wpeinit
wpeutil initializenetwork

:WAITNET
ping -n 2 192.168.0.5 >nul 2>&1
if not %errorlevel%==0 goto WAITNET

echo [2/6] Partitioning disk...
diskpart /s X:\Windows\System32\deploypart.txt

echo [3/6] Downloading Windows image...
X:\Windows\System32\curl.exe -# -o W:\install.wim http://192.168.0.5:9080/images/win2025/install.wim

echo [4/6] Applying Windows image...
dism.exe /apply-image /imagefile:W:\install.wim /index:1 /applydir:W:\

echo [5/6] Deleting temp file...
del W:\install.wim

echo [6/6] Configuring boot loader...
bcdboot.exe W:\Windows /s S: /f UEFI

ping -n 11 127.0.0.1 >nul
wpeutil reboot
```

### deploypart.txt (GPT/UEFI)

```
select disk 0
clean
convert gpt
create partition efi size=100
format fs=fat32 quick label=System
assign letter=S
create partition msr size=16
create partition primary
format fs=ntfs quick label=Windows
assign letter=W
exit
```

### winpeshl.ini

```ini
[LaunchApps]
startnet.cmd
```

---

## Bekannte Probleme & Lösungen

| Problem | Ursache | Lösung |
|---------|---------|--------|
| "Bad CPIO magic" | BIOS-Modus | UEFI verwenden (Gen2) |
| SMB dauert 3-5 Min | Samba DNS Timeout | `name resolve order = bcast host` |
| curl/powershell fehlt | Minimales WinPE | curl.exe als initrd injizieren |
| DISM Error 87 | LF statt CRLF | `unix2dos startnet.cmd` |
| 100 Mbit statt Gbit | Legacy NIC | Standard Network Adapter |

---

## Downloads

- **wimboot:** https://github.com/ipxe/wimboot/releases
- **iPXE:** https://ipxe.org/download  
- **curl.exe:** https://curl.se/windows/
- **VirtIO:** https://fedorapeople.org/groups/virt/virtio-win/

---

## Nächste Schritte

1. [ ] Autounattend.xml für unattended Setup
2. [ ] Octofleet Agent Auto-Install
3. [ ] MAC-to-Config in Datenbank
4. [ ] Web UI für Provisioning
5. [ ] Bare Metal Support
6. [ ] Multi-Image Support (Win10, Win11, Server)

---

*Stand: 2026-02-21*
