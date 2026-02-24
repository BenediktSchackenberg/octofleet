---
title: "PXE Zero-Touch Deployment: Was ich dabei gelernt habe"
date: 2026-02-24
author: Benedikt Schackenberg
tags: [octofleet, pxe, windows, deployment, devops]
---

# PXE Zero-Touch Deployment: Was ich dabei gelernt habe

Nach ein paar intensiven Debugging-Sessions läuft das Zero-Touch Windows Deployment für Octofleet endlich. Hier die wichtigsten Erkenntnisse - vielleicht spart es dem ein oder anderen ein paar Stunden.

## Das Ziel

Windows Server 2025 automatisch auf VMs deployen. Kein manuelles Klicken, keine USB-Sticks. MAC-Adresse registrieren, VM starten, fertig.

## Die Stolpersteine

### 1. wimboot initrd injection ist unzuverlässig

Mein erster Ansatz war, die Deployment-Scripts per iPXE initrd zu injizieren:

```ipxe
kernel ${pxe-server}/winpe/wimboot
initrd ${pxe-server}/scripts/startnet.cmd startnet.cmd
initrd ${pxe-server}/winpe/boot.wim boot.wim
boot
```

Das Problem: Die Scripts kamen abgeschnitten oder gar nicht an. Nach viel Debugging die Erkenntnis: **Scripts müssen direkt IN die boot.wim**.

```bash
wimlib-imagex mountrw boot.wim 1 /tmp/mount
cp startnet.cmd /tmp/mount/Windows/System32/
cp curl.exe /tmp/mount/Windows/System32/
wimlib-imagex unmount --commit /tmp/mount
```

WinPE führt `startnet.cmd` aus `/Windows/System32/` automatisch beim Boot aus. Problem gelöst.

### 2. Boot Index beachten!

Die boot.wim von Windows hat zwei Images:
- Index 1: WinPE (Kommandozeile)
- Index 2: Windows Setup (GUI mit Treiber-Dialog)

Default Boot Index ist oft 2. Wenn ihr statt der Kommandozeile den "Select driver" Dialog seht:

```bash
wimlib-imagex info boot.wim 1 --boot
```

Das setzt Boot Index auf 1 = pure WinPE.

### 3. KVM/libvirt: SATA statt VirtIO

VirtIO ist schneller, aber WinPE hat keine VirtIO-Treiber eingebaut. Die Optionen:

1. VirtIO-Treiber in boot.wim injizieren (kompliziert, braucht Windows DISM)
2. Disk auf SATA umstellen (funktioniert sofort)

Für Deployment nehme ich SATA. Performance ist egal wenn eh gerade 7GB über's Netzwerk fliegen.

### 4. Hyper-V: Nur Gen2!

Hyper-V Gen1 (BIOS) hat einen Bug mit wimboot - "Bad CPIO magic". Gen2 (UEFI) funktioniert problemlos.

### 5. Alte Hardware und iPXE RAM-Limit

Auf einem alten i5-2400 Board bekam ich "No space" Fehler. iPXE kann nur ~400MB in den RAM laden, egal wie viel System-RAM da ist. boot.wim mit 500MB+ = keine Chance.

Moderne VMs haben das Problem nicht.

## Der finale Flow

1. VM startet, bootet PXE
2. iPXE lädt wimboot + boot.wim
3. WinPE startet, `startnet.cmd` läuft automatisch
4. Netzwerk initialisieren
5. Disk partitionieren (GPT/UEFI)
6. Windows Image per HTTP laden (curl.exe)
7. DISM apply-image
8. bcdboot für UEFI Bootloader
9. Reboot → Windows startet

Das minimale iPXE Script:

```ipxe
#!ipxe
kernel http://192.168.0.5:9080/winpe/wimboot
initrd -n boot.wim http://192.168.0.5:9080/winpe/boot.wim
boot
```

Ja, wirklich nur drei Zeilen. Der Rest passiert in der boot.wim.

## Fazit

PXE Deployment ist kein Hexenwerk, aber die Details machen's. Die wichtigsten Learnings:

- Scripts IN die boot.wim, nicht per initrd
- Boot Index = 1 für WinPE
- SATA für KVM wenn keine Treiber-Integration
- Hyper-V Gen2 only

Das Setup läuft jetzt stabil für Windows Server 2022 und 2025. Als nächstes kommt Linux dazu.

Die komplette Doku liegt im [Octofleet Repo](https://github.com/BenediktSchackenberg/octofleet/tree/main/provisioning/docs).

---

*Octofleet ist mein Open-Source Endpoint Management Tool. Noch in Entwicklung, aber das PXE Deployment funktioniert schon ganz gut.*
