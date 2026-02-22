#!/bin/bash
# Octofleet ISO Manager - Manages ISO loop mounts and NFS shares
# Must be run as root or via sudo
# Usage: iso-manager.sh <command> [args]
#   scan <path>              - List ISOs in directory
#   mount <iso> <target>     - Mount ISO to target directory
#   unmount <target>         - Unmount ISO from target
#   list                     - List current ISO mounts
#   wim-info <wim>           - Get WIM image info (requires wimlib-imagex)
#   nfs-mount <server:path> <target> - Mount NFS share
#   nfs-unmount <target>     - Unmount NFS share
#   nfs-list                 - List current NFS mounts
#   nfs-add-fstab <server:path> <target> - Add NFS mount to fstab

set -e

case "$1" in
    scan)
        DIR="${2:-/mnt/isos}"
        if [ ! -d "$DIR" ]; then
            echo '{"error": "Directory not found"}'
            exit 1
        fi
        echo '{"isos": ['
        first=1
        for iso in "$DIR"/*.iso "$DIR"/*.ISO; do
            [ -f "$iso" ] || continue
            size=$(stat -c%s "$iso" 2>/dev/null || echo 0)
            name=$(basename "$iso")
            if [ $first -eq 1 ]; then
                first=0
            else
                echo ","
            fi
            echo "  {\"path\": \"$iso\", \"name\": \"$name\", \"size\": $size}"
        done
        echo ']}'
        ;;

    mount)
        ISO="$2"
        TARGET="$3"
        if [ -z "$ISO" ] || [ -z "$TARGET" ]; then
            echo '{"error": "Usage: mount <iso> <target>"}'
            exit 1
        fi
        if [ ! -f "$ISO" ]; then
            echo '{"error": "ISO file not found"}'
            exit 1
        fi
        mkdir -p "$TARGET"
        if mountpoint -q "$TARGET" 2>/dev/null; then
            echo '{"status": "already_mounted", "target": "'"$TARGET"'"}'
            exit 0
        fi
        mount -o loop,ro "$ISO" "$TARGET"
        LOOP=$(losetup -j "$ISO" | cut -d: -f1 | head -1)
        echo '{"status": "mounted", "target": "'"$TARGET"'", "loop": "'"$LOOP"'"}'
        ;;

    unmount)
        TARGET="$2"
        if [ -z "$TARGET" ]; then
            echo '{"error": "Usage: unmount <target>"}'
            exit 1
        fi
        if ! mountpoint -q "$TARGET" 2>/dev/null; then
            echo '{"status": "not_mounted"}'
            exit 0
        fi
        umount "$TARGET"
        echo '{"status": "unmounted", "target": "'"$TARGET"'"}'
        ;;

    list)
        echo '{"mounts": ['
        first=1
        mount | grep "iso9660\|loop" | while read line; do
            dev=$(echo "$line" | awk '{print $1}')
            target=$(echo "$line" | awk '{print $3}')
            # Get ISO path from losetup
            iso=$(losetup -l | grep "$dev" | awk '{print $6}' 2>/dev/null || echo "")
            if [ $first -eq 1 ]; then
                first=0
            else
                echo ","
            fi
            echo "  {\"device\": \"$dev\", \"target\": \"$target\", \"iso\": \"$iso\"}"
        done
        echo ']}'
        ;;

    wim-info)
        WIM="$2"
        if [ -z "$WIM" ]; then
            echo '{"error": "Usage: wim-info <wim-file>"}'
            exit 1
        fi
        if [ ! -f "$WIM" ]; then
            echo '{"error": "WIM file not found"}'
            exit 1
        fi
        if ! command -v wimlib-imagex &>/dev/null; then
            echo '{"error": "wimlib-imagex not installed"}'
            exit 1
        fi
        # Parse WIM info to JSON
        echo '{"images": ['
        wimlib-imagex info "$WIM" 2>/dev/null | grep -E "^Index:|^Name:|^Description:" | \
        awk '
        BEGIN { first=1 }
        /^Index:/ { 
            if (!first) print "},"
            first=0
            gsub(/Index:[[:space:]]*/, "")
            printf "  {\"index\": %s", $0
        }
        /^Name:/ {
            gsub(/Name:[[:space:]]*/, "")
            gsub(/"/, "\\\"")
            printf ", \"name\": \"%s\"", $0
        }
        /^Description:/ {
            gsub(/Description:[[:space:]]*/, "")
            gsub(/"/, "\\\"")
            printf ", \"description\": \"%s\"", $0
        }
        END { if (!first) print "}" }
        '
        echo ']}'
        ;;

    extract-kernel)
        ISO="$2"
        TARGET="$3"
        if [ -z "$ISO" ] || [ -z "$TARGET" ]; then
            echo '{"error": "Usage: extract-kernel <iso-mount> <target-dir>"}'
            exit 1
        fi
        mkdir -p "$TARGET"
        # Ubuntu/Debian style
        if [ -f "$ISO/casper/vmlinuz" ]; then
            cp "$ISO/casper/vmlinuz" "$TARGET/"
            cp "$ISO/casper/initrd" "$TARGET/" 2>/dev/null || cp "$ISO/casper/initrd.lz" "$TARGET/initrd" 2>/dev/null
            echo '{"status": "extracted", "type": "ubuntu", "files": ["vmlinuz", "initrd"]}'
        # RHEL/CentOS style
        elif [ -f "$ISO/isolinux/vmlinuz" ]; then
            cp "$ISO/isolinux/vmlinuz" "$TARGET/"
            cp "$ISO/isolinux/initrd.img" "$TARGET/initrd"
            echo '{"status": "extracted", "type": "rhel", "files": ["vmlinuz", "initrd"]}'
        else
            echo '{"error": "Unknown Linux distribution layout"}'
            exit 1
        fi
        ;;

    nfs-mount)
        SERVER_PATH="$2"
        TARGET="$3"
        if [ -z "$SERVER_PATH" ] || [ -z "$TARGET" ]; then
            echo '{"error": "Usage: nfs-mount <server:path> <target>"}'
            exit 1
        fi
        # Validate format (server:path or server:/path)
        if ! echo "$SERVER_PATH" | grep -qE '^[^:]+:/?'; then
            echo '{"error": "Invalid format. Use: server:/path or server:path"}'
            exit 1
        fi
        # Check if nfs-common is installed
        if ! command -v mount.nfs &>/dev/null && ! command -v mount.nfs4 &>/dev/null; then
            echo '{"error": "NFS client not installed. Run: apt install nfs-common"}'
            exit 1
        fi
        mkdir -p "$TARGET"
        if mountpoint -q "$TARGET" 2>/dev/null; then
            echo '{"status": "already_mounted", "target": "'"$TARGET"'"}'
            exit 0
        fi
        # Mount with common options
        if mount -t nfs -o defaults,_netdev "$SERVER_PATH" "$TARGET" 2>&1; then
            echo '{"status": "mounted", "server": "'"$SERVER_PATH"'", "target": "'"$TARGET"'"}'
        else
            # Try nfs4
            if mount -t nfs4 -o defaults,_netdev "$SERVER_PATH" "$TARGET" 2>&1; then
                echo '{"status": "mounted", "server": "'"$SERVER_PATH"'", "target": "'"$TARGET"'", "type": "nfs4"}'
            else
                echo '{"error": "Mount failed. Check server path and permissions."}'
                exit 1
            fi
        fi
        ;;

    nfs-unmount)
        TARGET="$2"
        if [ -z "$TARGET" ]; then
            echo '{"error": "Usage: nfs-unmount <target>"}'
            exit 1
        fi
        if ! mountpoint -q "$TARGET" 2>/dev/null; then
            echo '{"status": "not_mounted"}'
            exit 0
        fi
        umount "$TARGET"
        echo '{"status": "unmounted", "target": "'"$TARGET"'"}'
        ;;

    nfs-list)
        echo '{"mounts": ['
        first=1
        mount | grep -E "type nfs|type nfs4" | while read line; do
            server=$(echo "$line" | awk '{print $1}')
            target=$(echo "$line" | awk '{print $3}')
            fstype=$(echo "$line" | awk '{print $5}')
            # Get size info
            size_info=$(df -h "$target" 2>/dev/null | tail -1 | awk '{print $2, $3, $4, $5}')
            total=$(echo "$size_info" | awk '{print $1}')
            used=$(echo "$size_info" | awk '{print $2}')
            avail=$(echo "$size_info" | awk '{print $3}')
            pct=$(echo "$size_info" | awk '{print $4}')
            if [ $first -eq 1 ]; then
                first=0
            else
                echo ","
            fi
            echo "  {\"server\": \"$server\", \"target\": \"$target\", \"type\": \"$fstype\", \"total\": \"$total\", \"used\": \"$used\", \"available\": \"$avail\", \"percent\": \"$pct\"}"
        done
        echo ']}'
        ;;

    nfs-add-fstab)
        SERVER_PATH="$2"
        TARGET="$3"
        if [ -z "$SERVER_PATH" ] || [ -z "$TARGET" ]; then
            echo '{"error": "Usage: nfs-add-fstab <server:path> <target>"}'
            exit 1
        fi
        # Check if already in fstab
        if grep -q "$SERVER_PATH" /etc/fstab; then
            echo '{"status": "already_exists", "server": "'"$SERVER_PATH"'"}'
            exit 0
        fi
        # Backup fstab
        cp /etc/fstab /etc/fstab.bak.$(date +%Y%m%d%H%M%S)
        # Add entry
        echo "$SERVER_PATH $TARGET nfs defaults,_netdev 0 0" >> /etc/fstab
        echo '{"status": "added", "server": "'"$SERVER_PATH"'", "target": "'"$TARGET"'", "fstab": "/etc/fstab"}'
        ;;

    nfs-remove-fstab)
        SERVER_PATH="$2"
        if [ -z "$SERVER_PATH" ]; then
            echo '{"error": "Usage: nfs-remove-fstab <server:path>"}'
            exit 1
        fi
        if ! grep -q "$SERVER_PATH" /etc/fstab; then
            echo '{"status": "not_found"}'
            exit 0
        fi
        # Backup and remove
        cp /etc/fstab /etc/fstab.bak.$(date +%Y%m%d%H%M%S)
        grep -v "$SERVER_PATH" /etc/fstab > /etc/fstab.tmp && mv /etc/fstab.tmp /etc/fstab
        echo '{"status": "removed", "server": "'"$SERVER_PATH"'"}'
        ;;

    *)
        echo '{"error": "Unknown command. Use: scan, mount, unmount, list, wim-info, extract-kernel, nfs-mount, nfs-unmount, nfs-list, nfs-add-fstab, nfs-remove-fstab"}'
        exit 1
        ;;
esac
