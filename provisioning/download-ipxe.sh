#!/bin/bash
# Download iPXE boot files from rom-o-matic or build
# Run this before starting the container

cd "$(dirname "$0")/tftpboot"

echo "📥 Downloading iPXE boot files..."

# Option 1: Von ipxe.org (wenn verfügbar)
# Option 2: Von netboot.xyz
# Option 3: Selbst bauen

# Versuche netboot.xyz Version (enthält bereits nützliche Features)
echo "Downloading from netboot.xyz..."

# UEFI
if [ ! -f ipxe.efi ] || [ $(stat -c%s ipxe.efi 2>/dev/null || echo 0) -lt 100000 ]; then
    curl -sSL -o ipxe.efi "https://boot.netboot.xyz/ipxe/netboot.xyz.efi"
    echo "✅ ipxe.efi downloaded ($(stat -c%s ipxe.efi) bytes)"
fi

# BIOS
if [ ! -f undionly.kpxe ] || [ $(stat -c%s undionly.kpxe 2>/dev/null || echo 0) -lt 50000 ]; then
    curl -sSL -o undionly.kpxe "https://boot.netboot.xyz/ipxe/netboot.xyz.kpxe"
    echo "✅ undionly.kpxe downloaded ($(stat -c%s undionly.kpxe) bytes)"
fi

# Prüfen
echo ""
echo "📋 Boot files:"
ls -lh *.efi *.kpxe 2>/dev/null || echo "⚠️  No boot files found!"

echo ""
echo "💡 Falls die Downloads fehlschlagen, iPXE manuell bauen:"
echo "   git clone https://github.com/ipxe/ipxe.git"
echo "   cd ipxe/src"
echo "   make bin-x86_64-efi/ipxe.efi"
echo "   make bin/undionly.kpxe"
