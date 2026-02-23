#!/bin/bash
# Test iPXE boot scripts without VM
# Verifies syntax and downloads

set -e

PXE_SERVER="http://192.168.0.5:9080"

echo "=== Octofleet PXE Boot Test ==="
echo

# Test all iPXE scripts are accessible
echo "Checking iPXE scripts..."
for script in ubuntu-menu ubuntu-nfs-v2 ubuntu-nfs-v3 ubuntu-nfs-v4; do
    if curl -sI "${PXE_SERVER}/${script}.ipxe" | grep -q "200 OK"; then
        echo "  ✓ ${script}.ipxe"
    else
        echo "  ✗ ${script}.ipxe MISSING!"
    fi
done

echo
echo "Checking GRUB files..."
for file in grubnetx64.efi shimx64.efi grub.cfg; do
    if curl -sI "${PXE_SERVER}/grub/${file}" | grep -q "200 OK"; then
        echo "  ✓ /grub/${file}"
    else
        echo "  ✗ /grub/${file} MISSING!"
    fi
done

echo
echo "Checking Ubuntu kernel/initrd..."
for version in 24.04 22.04; do
    vmlinuz="${PXE_SERVER}/ubuntu-live/${version}/casper/vmlinuz"
    initrd="${PXE_SERVER}/ubuntu-live/${version}/casper/initrd"
    
    vmlinuz_size=$(curl -sI "$vmlinuz" 2>/dev/null | grep -i content-length | awk '{print $2}' | tr -d '\r')
    initrd_size=$(curl -sI "$initrd" 2>/dev/null | grep -i content-length | awk '{print $2}' | tr -d '\r')
    
    if [ -n "$vmlinuz_size" ] && [ "$vmlinuz_size" -gt 0 ]; then
        echo "  ✓ Ubuntu ${version} vmlinuz ($(numfmt --to=iec-i --suffix=B $vmlinuz_size 2>/dev/null || echo ${vmlinuz_size}B))"
    else
        echo "  ✗ Ubuntu ${version} vmlinuz MISSING!"
    fi
    
    if [ -n "$initrd_size" ] && [ "$initrd_size" -gt 0 ]; then
        echo "  ✓ Ubuntu ${version} initrd ($(numfmt --to=iec-i --suffix=B $initrd_size 2>/dev/null || echo ${initrd_size}B))"
    else
        echo "  ✗ Ubuntu ${version} initrd MISSING!"
    fi
done

echo
echo "Checking NFS server..."
if showmount -e 192.168.0.5 2>/dev/null | grep -q ubuntu; then
    echo "  ✓ NFS exports available:"
    showmount -e 192.168.0.5 2>/dev/null | grep ubuntu | sed 's/^/    /'
else
    echo "  ✗ NFS exports not found!"
fi

echo
echo "=== Script Contents ==="
echo
echo "--- ubuntu-nfs-v2.ipxe (inline args) ---"
curl -s "${PXE_SERVER}/ubuntu-nfs-v2.ipxe"

echo
echo "=== Test Complete ==="
echo
echo "To test interactively:"
echo "1. Boot VM to PXE"
echo "2. At iPXE prompt, type: chain ${PXE_SERVER}/ubuntu-menu.ipxe"
echo "3. Select a variant to test"
