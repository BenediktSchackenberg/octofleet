# Blog Post Idee: Zero-Touch Server Provisioning mit Octofleet

## Titel-Optionen:
- "Von Bare Metal zum produktiven Server in 10 Minuten - ohne USB-Stick"
- "PXE Boot 2026: So automatisierst du dein Datacenter"
- "Keine ISOs mehr brennen: Zero-Touch Provisioning mit Open Source"
- "WinPE + Ubuntu Autoinstall: One Platform, Two Worlds"

---

## Hook / Einleitung

> *Jeder Admin kennt das: Neuer Server, ISO runterladen, USB-Stick brennen, durchklicken, warten, nochmal klicken... Multipliziere das mit 50 Servern und du hast eine Woche verloren.*

Was wäre, wenn du einfach den Server einschaltest und 15 Minuten später ist Windows oder Ubuntu fertig installiert - mit allen Treibern, dem richtigen Hostname und bereits im Management-System registriert?

Das ist **Zero-Touch Provisioning**. Und mit Octofleet ist es Open Source.

---

## Kerninhalt

### Das Problem mit traditionellem Provisioning

- USB-Sticks / ISOs für jeden Server
- Manuelle Klicks durch Installer
- Treiber nachinstallieren
- Hostname manuell setzen
- Management Agent installieren
- **Skaliert nicht**

### Die Lösung: PXE + iPXE + API

```
Server startet → PXE → API-gesteuerte Boot-Config → Automated Install → Done
```

### Technische Highlights

1. **ProxyDHCP** - Funktioniert neben bestehendem DHCP
2. **MAC-basierte Tasks** - Jeder Server bekommt sein eigenes Boot-Script
3. **iPXE Chain Loading** - Maximale Flexibilität
4. **API-generierte Configs** - Autounattend.xml / cloud-config dynamisch
5. **Dual-Stack** - Windows (WinPE + DISM) UND Linux (casper + NFS)

### Windows Flow
```
iPXE → WinPE boot.wim → VirtIO drivers → DISM apply → bcdboot → Reboot → OOBE → Agent installed
```

### Linux Flow
```
iPXE → kernel+initrd via HTTP → NFS mount casper → Subiquity autoinstall → SSH ready
```

---

## Lessons Learned (ehrlich!)

### Was nicht funktioniert hat:
- ❌ `url=` Parameter für Ubuntu Live (casper unterstützt das nicht zuverlässig)
- ❌ HTTP-only für große Squashfs files (RAM-Limits)
- ❌ Generische Boot-Scripts (jeder Hypervisor braucht andere Treiber)

### Was überraschend gut funktioniert:
- ✅ NFS für Ubuntu Live Boot (bulletproof, kein RAM-Limit)
- ✅ iPXE chain loading (super flexibel)
- ✅ VirtIO Treiber-Injection in WinPE (funktioniert sofort)

---

## Code Snippets für den Post

### iPXE Boot Script (dynamisch generiert):
```ipxe
#!ipxe
kernel http://pxe-server/ubuntu-live/24.04/casper/vmlinuz
initrd http://pxe-server/ubuntu-live/24.04/casper/initrd
imgargs vmlinuz netboot=nfs nfsroot=192.168.0.5:/mnt/ubuntu-24.04 ip=dhcp boot=casper autoinstall ds=nocloud-net;s=http://api-server/autoinstall/${mac}/
boot
```

### Cloud-Init Autoinstall:
```yaml
#cloud-config
autoinstall:
  version: 1
  identity:
    hostname: ${hostname}
    username: octofleet
    password: "${hashed_password}"
  ssh:
    install-server: true
  storage:
    layout:
      name: lvm
```

---

## Call to Action

- GitHub: https://github.com/BenediktSchackenberg/octofleet
- Docs: /docs/E22-UNIVERSAL-PROVISIONING.md
- "Star the repo if this saved you a weekend of manual installs!"

---

## Mögliche Plattformen

1. **dev.to** - Tech-fokussiert, gute DevOps Community
2. **Medium** - Breiteres Publikum
3. **Hashnode** - Developer-fokussiert
4. **Reddit r/homelab** - Perfekte Zielgruppe!
5. **Hacker News** - Wenn der Artikel gut ist
6. **LinkedIn** - Für Enterprise-Visibility

---

## Bilder/Diagrams die gut wären

1. ASCII Architektur-Diagram (im Post)
2. Screenshot: Octofleet UI mit Provisioning Queue
3. Screenshot: VM bootet ins iPXE Menü
4. Screenshot: Ubuntu Installer läuft automatisch
5. GIF: Kompletter Boot-Prozess in 30 Sekunden (beschleunigt)

---

## Hashtags

#homelab #devops #sysadmin #linux #windows #pxe #automation #infrastructure #opensource #selfhosted
