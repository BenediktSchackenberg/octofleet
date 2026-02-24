# Octofleet PXE - KVM/libvirt Setup Guide

Zero-Touch Windows Server 2025 Deployment via PXE für KVM/libvirt VMs.

## VM Konfiguration

### Wichtige Einstellungen

| Setting | Wert | Grund |
|---------|------|-------|
| **Disk Bus** | SATA | VirtIO braucht extra Treiber in WinPE |
| **Network** | VirtIO oder e1000 | Beides funktioniert |
| **Firmware** | UEFI (OVMF) | Pflicht für GPT/EFI Boot |
| **Boot Order** | Network first | PXE Boot aktivieren |

### virt-manager Einstellungen

1. **Neue VM erstellen** → "Manual install"
2. **Firmware:** UEFI x86_64 (OVMF)
3. **Storage:** 
   - Bus type: **SATA** (nicht VirtIO!)
   - Format: qcow2
4. **Network:** VirtIO ist OK
5. **Boot Options:** Network boot aktivieren

### virsh XML Beispiel

```xml
<domain type='kvm'>
  <name>win2025-test</name>
  <memory unit='GiB'>4</memory>
  <vcpu>2</vcpu>
  <os>
    <type arch='x86_64' machine='q35'>hvm</type>
    <loader readonly='yes' type='pflash'>/usr/share/OVMF/OVMF_CODE.fd</loader>
    <boot dev='network'/>
    <boot dev='hd'/>
  </os>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='/var/lib/libvirt/images/win2025-test.qcow2'/>
      <target dev='sda' bus='sata'/>  <!-- SATA nicht virtio! -->
    </disk>
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>  <!-- Network kann VirtIO sein -->
    </interface>
  </devices>
</domain>
```

## PXE Server Setup

### Voraussetzungen

- Docker für PXE Container
- Samba für Windows Install Files
- HTTP Server (nginx) für WinPE + Images

### boot.wim Vorbereitung

Die Scripts müssen IN die boot.wim eingebaut werden (nicht per initrd injection):

```bash
cd /path/to/provisioning/images/winpe

# Mount WinPE
sudo mkdir -p /tmp/winpe-mount
sudo wimlib-imagex mountrw boot.wim 1 /tmp/winpe-mount

# Scripts einbauen
sudo cp scripts/startnet.cmd /tmp/winpe-mount/Windows/System32/
sudo cp scripts/deploypart.txt /tmp/winpe-mount/Windows/System32/
sudo cp scripts/curl.exe /tmp/winpe-mount/Windows/System32/

# Unmount + Commit
sudo wimlib-imagex unmount --commit /tmp/winpe-mount
```

### Boot Index auf WinPE setzen

```bash
# Boot Index muss 1 sein (WinPE), nicht 2 (Windows Setup)
wimlib-imagex info boot.wim 1 --boot
```

### iPXE Script (minimal)

```ipxe
#!ipxe
set pxe-server http://192.168.0.5:9080
kernel ${pxe-server}/winpe/wimboot
initrd -n boot.wim ${pxe-server}/winpe/boot.wim
boot
```

## SMB Share

```ini
# /etc/samba/smb.conf
[wininstall]
   path = /srv/wininstall
   browseable = yes
   read only = yes
   guest ok = yes
   public = yes
```

### Share Struktur

```
/srv/wininstall/
├── server2022/
│   └── install.wim
├── win2025/
│   └── install.wim
├── answers/
│   └── deploypart.txt
└── curl.exe
```

## Deployment Flow

1. VM startet → PXE Boot
2. iPXE lädt wimboot + boot.wim
3. WinPE startet → startnet.cmd läuft automatisch
4. Network init (wpeinit)
5. Disk partitionieren (diskpart)
6. Windows Image via HTTP/SMB laden
7. DISM apply-image
8. bcdboot für UEFI
9. Reboot → Windows Setup

## Troubleshooting

### "A media driver is missing"
- **Ursache:** VirtIO Disk ohne Treiber
- **Lösung:** Disk Bus auf SATA umstellen

### "No space" beim PXE Boot
- **Ursache:** iPXE RAM-Limit (~400MB)
- **Lösung:** Nur bei alter Hardware - moderne VMs haben das Problem nicht

### Script startet nicht automatisch
- **Ursache:** Scripts nicht in boot.wim oder Boot Index = 2
- **Lösung:** Scripts in WIM einbauen, Boot Index auf 1 setzen

### Windows Setup statt WinPE
- **Ursache:** Boot Index = 2
- **Lösung:** `wimlib-imagex info boot.wim 1 --boot`

## Nach Installation

MAC-spezifisches iPXE Script entfernen damit die VM von lokaler Disk bootet:

```bash
rm provisioning/tftpboot/boot/<MAC>.ipxe
```

---

*Getestet: 2026-02-24 mit Windows Server 2025 auf KVM/libvirt (QEMU)*
