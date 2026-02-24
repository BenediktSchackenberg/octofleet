# Alternative PXE Boot Options für Linux

## Problem
Ubuntu hat "legacy netboot" seit 24.04 entfernt. NFS-basierter casper boot ist instabil wegen:
- Timing-Issues mit NFS mount
- initrd enthält keine NFS client module
- kernel args werden nicht richtig geparsed

## Option 1: Debian Netboot (EMPFOHLEN)
Debian hat noch echtes netboot. Stabil und bewährt.

```bash
# Download Debian 12 (Bookworm) netboot
mkdir -p images/debian/12-netboot
wget http://ftp.debian.org/debian/dists/bookworm/main/installer-amd64/current/images/netboot/debian-installer/amd64/linux -O images/debian/12-netboot/linux
wget http://ftp.debian.org/debian/dists/bookworm/main/installer-amd64/current/images/netboot/debian-installer/amd64/initrd.gz -O images/debian/12-netboot/initrd.gz
```

iPXE Script:
```ipxe
kernel ${pxe-server}/debian/12-netboot/linux auto=true priority=critical preseed/url=${pxe-server}/preseed/debian.cfg
initrd ${pxe-server}/debian/12-netboot/initrd.gz
boot
```

## Option 2: Alpine Linux Netboot
Super klein, schnell, perfekt für PXE.

```bash
# Download Alpine 3.19 netboot
mkdir -p images/alpine/3.19
wget https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/x86_64/netboot/vmlinuz-lts -O images/alpine/3.19/vmlinuz
wget https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/x86_64/netboot/initramfs-lts -O images/alpine/3.19/initramfs
wget https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/x86_64/netboot/modloop-lts -O images/alpine/3.19/modloop
```

## Option 3: Ubuntu via memdisk (ISO in RAM)
Lädt komplettes ISO in RAM und bootet davon. Braucht viel RAM (4GB+).

```ipxe
kernel ${pxe-server}/memdisk iso raw
initrd ${pxe-server}/ubuntu-22.04-live-server.iso
boot
```

## Option 4: Netboot.xyz
Chain zu netboot.xyz - die haben alles vorbereitet.

```ipxe
chain --autofree https://boot.netboot.xyz/ipxe/netboot.xyz.efi
```

## Empfehlung
Für Octofleet: **Debian 12 + Preseed** oder **netboot.xyz** als Fallback.
Ubuntu Server Installation via PXE ist seit 24.04 nur noch über komplizierte Wege möglich.
