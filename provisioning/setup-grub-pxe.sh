#!/bin/bash
# Download GRUB network boot files for PXE
# Run this on the PXE server

set -e

TFTPBOOT="/home/benedikt/.openclaw/workspace/octofleet-work/provisioning/tftpboot"
GRUB_DIR="${TFTPBOOT}/grub"

mkdir -p "${GRUB_DIR}"

echo "=== Downloading GRUB Network Boot Files ==="

# Ubuntu package with grub-netboot
if command -v apt-get &>/dev/null; then
    echo "Installing grub-efi-amd64-signed..."
    sudo apt-get update
    sudo apt-get install -y grub-efi-amd64-signed shim-signed grub-common
    
    # Copy GRUB EFI binary
    if [ -f /usr/lib/grub/x86_64-efi-signed/grubnetx64.efi.signed ]; then
        cp /usr/lib/grub/x86_64-efi-signed/grubnetx64.efi.signed "${GRUB_DIR}/grubnetx64.efi"
        echo "✓ Copied grubnetx64.efi"
    elif [ -f /usr/lib/shim/shimx64.efi.signed ]; then
        cp /usr/lib/shim/shimx64.efi.signed "${GRUB_DIR}/shimx64.efi"
        echo "✓ Copied shimx64.efi"
    fi
    
    # Copy GRUB modules
    if [ -d /usr/lib/grub/x86_64-efi ]; then
        cp -r /usr/lib/grub/x86_64-efi "${GRUB_DIR}/"
        echo "✓ Copied GRUB modules"
    fi
fi

# Alternative: Download from Ubuntu archive directly
if [ ! -f "${GRUB_DIR}/grubnetx64.efi" ]; then
    echo "Downloading from Ubuntu archive..."
    GRUB_PKG="grub-efi-amd64-signed_1.197+2.12-1ubuntu1_amd64.deb"
    cd /tmp
    wget -q "http://archive.ubuntu.com/ubuntu/pool/main/g/grub2-signed/${GRUB_PKG}" -O grub-signed.deb || true
    
    if [ -f grub-signed.deb ]; then
        dpkg-deb -x grub-signed.deb grub-extract
        cp grub-extract/usr/lib/grub/x86_64-efi-signed/grubnetx64.efi.signed "${GRUB_DIR}/grubnetx64.efi" 2>/dev/null || true
        rm -rf grub-extract grub-signed.deb
    fi
fi

echo ""
echo "=== GRUB PXE Setup ==="
echo "Files in ${GRUB_DIR}:"
ls -la "${GRUB_DIR}/"

echo ""
echo "=== Next Steps ==="
echo "1. Update dnsmasq.conf to serve grubnetx64.efi for UEFI clients"
echo "2. Create grub.cfg with your boot menu"
echo "3. Restart PXE container"
