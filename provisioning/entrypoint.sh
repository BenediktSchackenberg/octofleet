#!/bin/bash
set -e

echo "🐙 Octofleet PXE Server starting..."
echo "   PXE_SERVER_IP: ${PXE_SERVER_IP:-not set}"
echo "   OCTOFLEET_API: ${OCTOFLEET_API:-not set}"

# Generiere dnsmasq.conf dynamisch
cat > /etc/dnsmasq.conf << EOF
# Octofleet PXE - Generated config
port=0

# NUR auf br0 hören
interface=br0
bind-interfaces

# ProxyDHCP - kein IP vergeben, nur Boot-Info
dhcp-range=192.168.0.0,proxy

# PXE Boot für ALLE Clients (nicht nur registrierte)
# UEFI
pxe-service=x86-64_EFI,"Octofleet PXE",ipxe.efi
# BIOS  
pxe-service=x86PC,"Octofleet PXE",undionly.kpxe

enable-tftp
tftp-root=/tftpboot
log-dhcp
log-facility=-
EOF

# Boot script generieren (mit ASCII Art Banner)
cat > /tftpboot/boot.ipxe << 'BOOTEOF'
#!ipxe

set pxe-server http://PXE_IP_PLACEHOLDER:9080
set menu-timeout 15000

echo
echo  ===============================================
echo       ___       _        __ _           _   
echo      / _ \ ___ | |_ ___ / _| | ___  ___| |_ 
echo     | | | / __|| __/ _ \ |_| |/ _ \/ _ \ __|
echo     | |_| \__ \| || (_) |  _| |  __/  __/ |_ 
echo      \___/|___/ \__\___/|_| |_|\___|\___|\__|
echo                                              
echo         Zero-Touch OS Deployment
echo  ===============================================
echo
echo  MAC: ${mac}
echo  IP:  ${ip}
echo

:check_config
echo  Checking for provisioning task...
chain ${pxe-server}/boot/${mac:hexhyp}.ipxe && goto boot_done ||

:menu
menu Octofleet PXE Boot
item --gap --  -------- Options --------
item winpe     Boot WinPE (Manual Install)
item local     Boot from local disk
item shell     iPXE Shell
item reboot    Reboot
choose --timeout ${menu-timeout} --default local target && goto ${target} || goto local

:winpe
echo Loading WinPE...
kernel ${pxe-server}/winpe/wimboot
initrd ${pxe-server}/winpe/BCD         BCD
initrd ${pxe-server}/winpe/boot.sdi    boot.sdi
initrd ${pxe-server}/winpe/boot.wim    boot.wim
boot || goto menu

:local
echo Booting from local disk...
exit 0

:shell
shell
goto menu

:reboot
reboot

:boot_done
echo Done.
BOOTEOF

sed -i "s/PXE_IP_PLACEHOLDER/${PXE_SERVER_IP}/g" /tftpboot/boot.ipxe

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
echo "🌐 Starting HTTP server on port 9080..."
nginx

# Starte dnsmasq im Vordergrund
echo "📡 Starting ProxyDHCP/TFTP server..."
echo "   TFTP: Port 69"
echo "   ProxyDHCP: Port 4011"
echo ""
echo "✅ Octofleet PXE Server ready!"
echo ""

exec dnsmasq --no-daemon --log-facility=-
