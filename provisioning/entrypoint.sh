#!/bin/bash
set -e

echo "🐙 Octofleet PXE Server starting..."
echo "   PXE_SERVER_IP: ${PXE_SERVER_IP:-not set}"
echo "   OCTOFLEET_API: ${OCTOFLEET_API:-not set}"

# Ersetze Variablen in dnsmasq.conf
sed -i "s/\${PXE_SERVER_IP}/${PXE_SERVER_IP}/g" /etc/dnsmasq.conf

# Ersetze Variablen in boot.ipxe
sed -i "s/\${next-server}/${PXE_SERVER_IP}/g" /tftpboot/boot.ipxe 2>/dev/null || true

# Prüfe ob iPXE boot files vorhanden sind
if [ ! -f /tftpboot/ipxe.efi ]; then
    echo "⚠️  Warning: /tftpboot/ipxe.efi not found!"
    echo "   Download from: https://boot.ipxe.org/ipxe.efi"
fi

if [ ! -f /tftpboot/undionly.kpxe ]; then
    echo "⚠️  Warning: /tftpboot/undionly.kpxe not found!"
    echo "   Download from: https://boot.ipxe.org/undionly.kpxe"
fi

# Zeige registrierte MACs
echo ""
echo "📋 Registered MACs for PXE boot:"
grep -E "^dhcp-host=" /etc/hosts.pxe 2>/dev/null | sed 's/dhcp-host=/   /' | sed 's/,set:pxe//' || echo "   (none)"
echo ""

# Starte nginx im Hintergrund
echo "🌐 Starting HTTP server on port 8888..."
nginx

# Starte dnsmasq im Vordergrund
echo "📡 Starting ProxyDHCP/TFTP server..."
echo "   TFTP: Port 69"
echo "   ProxyDHCP: Port 4011"
echo ""
echo "✅ Octofleet PXE Server ready!"
echo ""

exec dnsmasq --no-daemon --log-facility=-
