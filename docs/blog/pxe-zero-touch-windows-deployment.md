# Zero-Touch Windows Deployment mit PXE, iPXE und Samba

*Ein Praxisbericht: Wie wir Windows Server 2025 ohne WDS auf KVM/QEMU VMs deployen*

---

## TL;DR

Windows-Deployment ohne WDS? Geht! Mit iPXE, WinPE, Samba und ein bisschen Hartnäckigkeit. Hier die wichtigsten Learnings:

- **ProxyDHCP** mit dnsmasq — kein eigener DHCP-Server nötig
- **VirtIO SCSI-Treiber** (`vioscsi`) in WinPE einbetten
- **SMB in WinPE** braucht `net start lanmanserver` + Geduld
- **MAC-basiertes Routing** für individuelle Deployments

---

## Das Problem

Enterprise-Umgebungen nutzen WDS (Windows Deployment Services) oder SCCM für OS-Deployments. Aber:

- WDS braucht einen Windows Server
- SCCM ist komplex und teuer
- Für Homelab/KVM-Umgebungen: Overkill

**Unser Ziel:** Zero-Touch Windows Deployment auf Unraid/KVM VMs — nur mit Open Source Tools.

---

## Die Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    PXE Boot Flow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐     ┌──────────────┐     ┌─────────────────────┐  │
│  │   VM    │────▶│   dnsmasq    │────▶│   HTTP Server       │  │
│  │ (PXE)   │     │  ProxyDHCP   │     │   (nginx/Python)    │  │
│  └─────────┘     │  + TFTP      │     └─────────────────────┘  │
│       │          └──────────────┘              │                │
│       │                                        │                │
│       │          ┌──────────────┐              │                │
│       └─────────▶│   Samba      │◀─────────────┘                │
│                  │   (images)   │                               │
│                  └──────────────┘                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Boot-Reihenfolge:
1. VM startet → PXE Boot
2. dnsmasq (ProxyDHCP) → liefert iPXE Binary
3. iPXE lädt Boot-Script via HTTP
4. Script prüft MAC → lädt passendes WinPE
5. WinPE startet → mounted Samba-Share
6. DISM applyt Windows Image → Reboot → Fertig!
```

---

## Die Komponenten

### 1. dnsmasq als ProxyDHCP + TFTP

ProxyDHCP ist der Trick: Es ergänzt einen existierenden DHCP-Server um PXE-Infos, ohne ihn zu ersetzen.

```ini
# /etc/dnsmasq.conf
port=0                          # Kein DNS
dhcp-range=192.168.0.0,proxy    # ProxyDHCP Modus
dhcp-boot=tag:efi64,ipxe.efi
pxe-service=tag:efi64,x86-64_EFI,"iPXE",ipxe.efi
enable-tftp
tftp-root=/tftpboot
```

### 2. iPXE Boot Script mit MAC-Routing

```bash
#!ipxe
# boot.ipxe

echo =============================================
echo     OCTOFLEET ZERO-TOUCH DEPLOYMENT
echo =============================================

# MAC-basiertes Routing
chain --autofree http://192.168.0.5:9080/boot/${mac:hexhyp}.ipxe || goto default

:default
# Fallback: Boot-Menü oder lokale Festplatte
exit
```

Jede MAC bekommt ein eigenes Script:
```bash
# 52-54-00-65-d5-42.ipxe
#!ipxe
kernel http://192.168.0.5:9080/images/winpe/wimboot
initrd http://192.168.0.5:9080/images/winpe/boot.wim
boot
```

### 3. Samba Share für Images

```ini
# /etc/samba/smb.conf
[global]
   workgroup = WORKGROUP
   server min protocol = NT1      # WinPE braucht SMB1!
   ntlm auth = yes
   
   # WICHTIG: Schnelle Name Resolution
   name resolve order = bcast host
   dns proxy = no
   hostname lookups = no

[images]
   path = /srv/images
   read only = yes
   guest ok = yes
   public = yes
```

> ⚠️ **Wichtig:** Ohne `name resolve order = bcast host` wartet Samba bis zu 5 Minuten auf DNS-Timeouts!

---

## Die Stolpersteine (und Lösungen)

### 1. VirtIO Disk nicht erkannt

**Problem:** WinPE findet keine Festplatte.

**Ursache:** KVM/QEMU nutzt VirtIO SCSI, aber WinPE hat keine Treiber.

**Lösung:** VirtIO-Treiber in boot.wim einbetten:

```bash
# Auf Linux mit wimtools
wimmountrw boot.wim 1 /mnt/winpe
cp vioscsi.* /mnt/winpe/Windows/System32/drivers/
wimunmount --commit /mnt/winpe
```

In `startnet.cmd`:
```batch
drvload X:\Windows\System32\drivers\vioscsi.inf
```

> 💡 **Tipp:** Für SCSI-Disks braucht ihr `vioscsi`, nicht `viostor`!

### 2. SMB Share nicht erreichbar

**Problem:** `net use` gibt "System error 53" oder "67".

**Ursache:** SMB-Dienst in WinPE nicht gestartet.

**Lösung:**
```batch
net start lanmanserver
ping -n 10 127.0.0.1 >nul
net use Z: \\192.168.0.5\images
```

Noch besser — Retry-Loop:
```batch
:smb_retry
net use Z: \\192.168.0.5\images 2>nul
if not errorlevel 1 goto smb_ok
echo Warte 10 Sek...
ping -n 10 127.0.0.1 >nul
goto smb_retry
:smb_ok
```

### 3. 3-5 Minuten Wartezeit bis SMB geht

**Problem:** Netzwerk ist da, aber SMB braucht ewig.

**Ursache:** Samba macht DNS Reverse Lookups die timeouten.

**Lösung:** In `smb.conf`:
```ini
name resolve order = bcast host
dns proxy = no
hostname lookups = no
```

---

## Das komplette startnet.cmd

```batch
@echo off
echo =============================================
echo     ZERO-TOUCH DEPLOYMENT
echo =============================================

echo [1] VirtIO Treiber...
drvload X:\Windows\System32\drivers\vioscsi.inf
drvload X:\Windows\System32\drivers\netkvm.inf

echo [2] Netzwerk init...
wpeinit
wpeutil initializenetwork

echo [3] Warte auf IP...
:wait_ip
ping -n 2 127.0.0.1 >nul
ipconfig | find "192.168" >nul
if errorlevel 1 goto wait_ip

echo [4] SMB Service...
net start lanmanserver

echo [5] SMB Mount...
:smb_retry
net use Z: \\192.168.0.5\images 2>nul
if not errorlevel 1 goto smb_ok
ping -n 10 127.0.0.1 >nul
goto smb_retry
:smb_ok

echo [6] Partitionieren...
(echo select disk 0
echo clean
echo convert gpt
echo create partition efi size=100
echo format fs=fat32 quick label=System
echo assign letter=S
echo create partition msr size=16
echo create partition primary
echo format fs=ntfs quick label=Windows
echo assign letter=W
echo exit) > X:\dp.txt
diskpart /s X:\dp.txt

echo [7] Image anwenden...
dism /apply-image /imagefile:Z:\install.wim /index:4 /applydir:W:\

echo [8] Bootloader...
bcdboot W:\Windows /s S: /f UEFI

echo Neustart...
wpeutil reboot
```

---

## Fazit

Zero-Touch Windows Deployment ohne WDS ist möglich — aber nicht trivial. Die größten Hürden:

1. **VirtIO-Treiber** müssen in WinPE
2. **SMB in WinPE** ist zickig
3. **Timing ist alles** — Retry-Loops sind dein Freund

Das Ergebnis: ~10 Minuten von PXE-Boot bis fertiger Windows-Installation. Vollautomatisch. 🚀

---

## Nächste Schritte

- [ ] Autounattend.xml für OOBE-Skip + Admin-Passwort
- [ ] Octofleet Agent auto-install nach erstem Boot
- [ ] Web-UI für Provisioning-Jobs
- [ ] Multi-Tentacle für VLANs (siehe E23)

---

*Dieser Beitrag ist Teil der [Octofleet](https://github.com/BenediktSchackenberg/octofleet) Dokumentation.*

**Tags:** #pxe #winpe #deployment #samba #ipxe #kvm #virtualization
