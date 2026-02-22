# Linux boot script generator for Ubuntu PXE with NFS

UBUNTU_NFS_BOOT_TEMPLATE = """#!ipxe
# Octofleet Ubuntu {version} Deployment via NFS
set pxe-server {pxe_server}
set nfs-server 192.168.0.5
set live-url ${{pxe-server}}/ubuntu-live/{version}

echo =============================================
echo    Octofleet Linux Deployment  
echo    Image: Ubuntu {version} LTS
echo    Hostname: {hostname}
echo =============================================
echo

echo Loading kernel...
kernel ${{live-url}}/casper/vmlinuz || goto failed

echo Loading initrd...
initrd ${{live-url}}/casper/initrd || goto failed

echo
echo Starting Ubuntu Live with NFS root...
echo NFS: ${{nfs-server}}:/mnt/ubuntu-{version}
echo

imgargs vmlinuz initrd=initrd boot=casper netboot=nfs nfsroot=${{nfs-server}}:/mnt/ubuntu-{version} BOOTIF=01-${{mac:hexhyp}} ip=dhcp autoinstall "ds=nocloud-net;s=${{pxe-server}}/autoinstall/{mac_safe}/" console=tty0 ---

boot

:failed
echo Boot failed!
shell
"""
