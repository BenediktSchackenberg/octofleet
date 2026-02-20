# Octofleet PXE Provisioning

Zero-Touch OS Deployment für Windows Server.

## Quick Start

### 1. iPXE Boot Files herunterladen

```bash
cd tftpboot
wget https://boot.ipxe.org/ipxe.efi      # UEFI Boot
wget https://boot.ipxe.org/undionly.kpxe  # BIOS Boot
```

### 2. WinPE vorbereiten

Du brauchst WinPE Boot-Dateien aus dem Windows ADK:

```
images/winpe/
├── BCD          # Boot Configuration Data
├── boot.sdi     # System Deployment Image
└── boot.wim     # WinPE Image
```

**WinPE erstellen:**
```powershell
# Windows ADK installieren, dann:
copype amd64 C:\WinPE
# Dateien aus C:\WinPE\media\Boot\ und C:\WinPE\media\sources\boot.wim kopieren
```

### 3. Windows Install Image

```
images/
└── install.wim   # Von Windows ISO (sources/install.wim)
```

### 4. Container starten

```bash
# .env erstellen
echo "PXE_SERVER_IP=192.168.0.5" > .env
echo "OCTOFLEET_API=http://localhost:8080" >> .env

# Container starten
docker compose up -d

# Logs anschauen
docker compose logs -f
```

### 5. Server provisionieren

```bash
# MAC registrieren und Boot-Config generieren
chmod +x *.sh
./generate-boot.sh 00:15:5D:01:02:03 SQL-SERVER-01

# VM/Server mit PXE booten - fertig!
```

## Verzeichnisstruktur

```
provisioning/
├── docker-compose.yml
├── Dockerfile
├── dnsmasq.conf          # ProxyDHCP Config
├── nginx.conf            # HTTP Server Config
├── hosts.pxe             # Registrierte MACs
├── boot.ipxe             # iPXE Boot Script
├── entrypoint.sh
├── pxe-mac.sh            # MAC Verwaltung
├── generate-boot.sh      # Boot-Config Generator
│
├── tftpboot/             # TFTP Root
│   ├── ipxe.efi          # UEFI Boot (download!)
│   └── undionly.kpxe     # BIOS Boot (download!)
│
├── images/
│   ├── winpe/            # WinPE Boot Files
│   │   ├── BCD
│   │   ├── boot.sdi
│   │   └── boot.wim
│   └── install.wim       # Windows Install Image
│
├── drivers/              # Driver Injection (optional)
├── answers/              # Autounattend.xml Files
└── scripts/              # Post-Install Scripts
```

## Ports

| Port | Protokoll | Dienst |
|------|-----------|--------|
| 69   | UDP       | TFTP (Boot Files) |
| 4011 | UDP       | ProxyDHCP |
| 8888 | TCP       | HTTP (Images, Scripts) |

## Troubleshooting

### VM bootet nicht von PXE
- MAC in `hosts.pxe` registriert?
- VM auf Network Boot (PXE) gestellt?
- UEFI/BIOS richtig konfiguriert?

### "No provisioning task for this MAC"
- `./generate-boot.sh` ausführen
- Oder: Boot ins lokale System (normal)

### Container Logs
```bash
docker compose logs -f pxe
```

### dnsmasq Config neu laden
```bash
docker exec octofleet-pxe killall -HUP dnsmasq
```
