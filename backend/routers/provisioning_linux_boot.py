# Linux boot script generator for Ubuntu PXE with NFS
# Updated 2026-02-23: Multiple iPXE syntax variants + GRUB fallback

# ==============================================================================
# iPXE TEMPLATE V2: Args inline with kernel (most compatible)
# ==============================================================================
UBUNTU_NFS_BOOT_TEMPLATE_V2 = """#!ipxe
# Octofleet Ubuntu {version} Deployment via NFS
# Syntax V2: kernel URL ARGS

set pxe-server {pxe_server}
set nfs-server 192.168.0.5
set nfs-path /mnt/ubuntu-{version}

echo =============================================
echo    Octofleet Linux Deployment  
echo    Image: Ubuntu {version} LTS
echo    Hostname: {hostname}
echo =============================================
echo

echo Loading kernel with arguments...
kernel ${{pxe-server}}/ubuntu-live/{version}/casper/vmlinuz boot=casper netboot=nfs nfsroot=${{nfs-server}}:${{nfs-path}},tcp,vers=3 ip=dhcp BOOTIF=01-${{mac:hexhyp}} autoinstall ds=nocloud-net;s=${{pxe-server}}/autoinstall/{mac_safe}/ --- || goto failed

echo Loading initrd...
initrd ${{pxe-server}}/ubuntu-live/{version}/casper/initrd || goto failed

echo
echo Booting with NFS: ${{nfs-server}}:${{nfs-path}}
boot || goto failed

:failed
echo Boot failed!
shell
"""

# ==============================================================================
# iPXE TEMPLATE V3: kernel + imgargs + initrd + boot
# ==============================================================================
UBUNTU_NFS_BOOT_TEMPLATE_V3 = """#!ipxe
# Octofleet Ubuntu {version} Deployment via NFS
# Syntax V3: kernel + imgargs + initrd

set pxe-server {pxe_server}
set nfs-server 192.168.0.5
set nfs-path /mnt/ubuntu-{version}

echo =============================================
echo    Octofleet Linux Deployment  
echo    Image: Ubuntu {version} LTS
echo    Hostname: {hostname}
echo =============================================
echo

echo Loading kernel...
kernel ${{pxe-server}}/ubuntu-live/{version}/casper/vmlinuz || goto failed

echo Setting kernel arguments...
imgargs vmlinuz boot=casper netboot=nfs nfsroot=${{nfs-server}}:${{nfs-path}},tcp,vers=3 ip=dhcp BOOTIF=01-${{mac:hexhyp}} autoinstall ds=nocloud-net;s=${{pxe-server}}/autoinstall/{mac_safe}/ ---

echo Loading initrd...
initrd ${{pxe-server}}/ubuntu-live/{version}/casper/initrd || goto failed

echo
echo Booting with NFS: ${{nfs-server}}:${{nfs-path}}
boot || goto failed

:failed
echo Boot failed!
shell
"""

# ==============================================================================
# iPXE TEMPLATE V4: initrd first (named), then kernel with initrd=NAME
# ==============================================================================
UBUNTU_NFS_BOOT_TEMPLATE_V4 = """#!ipxe
# Octofleet Ubuntu {version} Deployment via NFS
# Syntax V4: initrd first (named), then kernel with all args

set pxe-server {pxe_server}
set nfs-server 192.168.0.5
set nfs-path /mnt/ubuntu-{version}

echo =============================================
echo    Octofleet Linux Deployment  
echo    Image: Ubuntu {version} LTS
echo    Hostname: {hostname}
echo =============================================
echo

echo Loading initrd...
initrd --name initrd ${{pxe-server}}/ubuntu-live/{version}/casper/initrd || goto failed

echo Loading kernel with arguments...
kernel ${{pxe-server}}/ubuntu-live/{version}/casper/vmlinuz initrd=initrd boot=casper netboot=nfs nfsroot=${{nfs-server}}:${{nfs-path}},tcp,vers=3 ip=dhcp BOOTIF=01-${{mac:hexhyp}} autoinstall ds=nocloud-net;s=${{pxe-server}}/autoinstall/{mac_safe}/ --- || goto failed

echo
echo Booting with NFS: ${{nfs-server}}:${{nfs-path}}
boot || goto failed

:failed
echo Boot failed!
shell
"""

# ==============================================================================
# GRUB TEMPLATE: Alternative for when iPXE fails
# ==============================================================================
UBUNTU_GRUB_ENTRY_TEMPLATE = """
menuentry "Octofleet - {hostname} (Ubuntu {version})" {{
    echo "Loading kernel for {hostname}..."
    linux (http,{pxe_server_ip}:9080)/ubuntu-live/{version}/casper/vmlinuz \\
        boot=casper \\
        netboot=nfs \\
        nfsroot={nfs_server}:/mnt/ubuntu-{version},tcp,vers=3 \\
        ip=dhcp \\
        autoinstall \\
        ds=nocloud-net;s=http://{pxe_server_ip}:9080/autoinstall/{mac_safe}/ \\
        ---
    
    echo "Loading initrd..."
    initrd (http,{pxe_server_ip}:9080)/ubuntu-live/{version}/casper/initrd
    
    echo "Booting {hostname}..."
}}
"""

# ==============================================================================
# Default template (use V2 - inline args is most standard)
# ==============================================================================
UBUNTU_NFS_BOOT_TEMPLATE = UBUNTU_NFS_BOOT_TEMPLATE_V2


def generate_linux_boot_script(
    version: str,
    hostname: str,
    mac: str,
    pxe_server: str = "http://192.168.0.5:9080",
    variant: str = "v2"
) -> str:
    """Generate iPXE boot script for Ubuntu NFS boot.
    
    Args:
        version: Ubuntu version (e.g., "24.04")
        hostname: Target hostname
        mac: MAC address (any format)
        pxe_server: PXE server URL
        variant: Which iPXE syntax to use (v2, v3, v4)
    """
    mac_safe = mac.lower().replace(":", "-").replace(".", "-")
    
    templates = {
        "v2": UBUNTU_NFS_BOOT_TEMPLATE_V2,
        "v3": UBUNTU_NFS_BOOT_TEMPLATE_V3,
        "v4": UBUNTU_NFS_BOOT_TEMPLATE_V4,
    }
    
    template = templates.get(variant, UBUNTU_NFS_BOOT_TEMPLATE_V2)
    
    return template.format(
        version=version,
        hostname=hostname,
        mac_safe=mac_safe,
        pxe_server=pxe_server
    )


def generate_grub_entry(
    version: str,
    hostname: str,
    mac: str,
    pxe_server_ip: str = "192.168.0.5",
    nfs_server: str = "192.168.0.5"
) -> str:
    """Generate GRUB menu entry for Ubuntu NFS boot."""
    mac_safe = mac.lower().replace(":", "-").replace(".", "-")
    
    return UBUNTU_GRUB_ENTRY_TEMPLATE.format(
        version=version,
        hostname=hostname,
        mac_safe=mac_safe,
        pxe_server_ip=pxe_server_ip,
        nfs_server=nfs_server
    )
