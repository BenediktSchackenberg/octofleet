#!/usr/bin/env bash
#
# Octofleet Linux Agent
# Collects inventory and pushes to the Octofleet API
#
set -u
# Note: pipefail intentionally NOT set — it causes || fallbacks to
# duplicate output when grep/awk pipes have no matches (exit 1).

# JSON numbers need "." as decimal separator, but awk (mawk) and printf follow
# LC_NUMERIC (e.g. "2,9" with de_DE). Force the C numeric locale; LC_ALL would
# override it, so its value moves to LANG and the other categories stay as they are.
if [[ -n "${LC_ALL:-}" ]]; then
    export LANG="$LC_ALL"
    unset LC_ALL
fi
export LC_NUMERIC=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
VERSION="0.5.2-linux"

# Load config
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
fi

# Defaults
API_URL="${API_URL:-http://localhost:8080}"
API_KEY="${API_KEY:-octofleet-inventory-dev-key}"
NODE_ID="${NODE_ID:-$(hostname)}"
PUSH_INTERVAL="${PUSH_INTERVAL:-1800}"
JOB_POLL_INTERVAL="${JOB_POLL_INTERVAL:-60}"
LIVE_DATA_INTERVAL="${LIVE_DATA_INTERVAL:-5}"
LOG_FILE="${LOG_FILE:-/var/log/octofleet-agent.log}"
AUTO_UPDATE="${AUTO_UPDATE:-true}"
UPDATE_CHECK_INTERVAL="${UPDATE_CHECK_INTERVAL:-21600}"  # 6 hours

# Network stats cache for rate calculation
declare -A LAST_RX_BYTES
declare -A LAST_TX_BYTES
LAST_NET_TIME=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
GRAY='\033[0;90m'
NC='\033[0m'

show_banner() {
    echo -e "${PURPLE}"
    cat << 'BANNER'
        ████████████        
      ██            ██      
    ██  ██      ██    ██    
    ██  ██      ██    ██    
    ██                ██    
      ██            ██      
    ██  ██  ██  ██  ██  ██  
    █    █  █    █  █    █  
    █    █  █    █  █    █  
BANNER
    echo -e "${CYAN}    ╔═════════════════════════╗"
    echo -e "    ║  ${WHITE}O C T O F L E E T${CYAN}      ║"
    echo -e "    ║  ${GRAY}v${VERSION}${CYAN}        ║"
    echo -e "    ╚═════════════════════════╝${NC}"
    echo ""
}

log() {
    local level="$1"
    shift
    local msg="$*"
    local ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] [$level] $msg" | tee -a "$LOG_FILE" 2>/dev/null || echo "[$ts] [$level] $msg"
}

info() { log "INFO" "$@"; }
warn() { log "WARN" "$@"; }
error() { log "ERROR" "$@"; }

# ============================================================================
# Hardware Collection
# ============================================================================

# Size string from lscpu ("1 MiB (1 instance)", "512 KiB") -> KB
_size_to_kb() {
    awk '{v=$1; u=$2; k=0
          if (u ~ /^K/) k=v; else if (u ~ /^M/) k=v*1024; else if (u ~ /^G/) k=v*1048576
          printf "%d", k}' <<< "${1:-0}"
}

_lscpu_field() {
    jq -r --arg f "$1" '.lscpu[]? | select(.field == $f) | .data' <<< "$LSCPU_JSON" 2>/dev/null | head -1
}

_dmi() {
    local v
    v=$(cat "/sys/class/dmi/id/$1" 2>/dev/null) || v=""
    printf '%s' "$v" | sed 's/[[:space:]]*$//'
}

collect_hardware() {
    # Hardware inventory in the same structure the Windows agent reports,
    # so the web UI can render it (cpu, ram.modules, disks.physical/volumes,
    # gpu, mainboard, bios, virtualization).

    # CPU
    LSCPU_JSON=$(lscpu -J 2>/dev/null || echo '{"lscpu":[]}')
    local cpu_model=$(_lscpu_field "Model name:")
    [[ -z "$cpu_model" ]] && cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs)
    local cpu_vendor=$(_lscpu_field "Vendor ID:")
    local sockets=$(_lscpu_field "Socket(s):")
    local cores_per_socket=$(_lscpu_field "Core(s) per socket:")
    [[ "$sockets" =~ ^[0-9]+$ ]] || sockets=1
    [[ "$cores_per_socket" =~ ^[0-9]+$ ]] || cores_per_socket=$(nproc --all 2>/dev/null || echo 1)
    local cpu_cores=$((sockets * cores_per_socket))
    local cpu_threads=$(nproc --all 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)
    local cpu_mhz=$(_lscpu_field "CPU max MHz:")
    [[ -z "$cpu_mhz" ]] && cpu_mhz=$(awk -F: '/^cpu MHz/ {print $2; exit}' /proc/cpuinfo 2>/dev/null)
    cpu_mhz=$(awk '{printf "%d", $1}' <<< "${cpu_mhz:-0}")
    local l2_kb=$(_size_to_kb "$(_lscpu_field "L2 cache:")")
    local l3_kb=$(_size_to_kb "$(_lscpu_field "L3 cache:")")
    local socket_designation=""
    command -v dmidecode &>/dev/null && socket_designation=$(dmidecode -t 4 2>/dev/null | awk -F': ' '/^\tSocket Designation:/ {print $2; exit}')

    local cpu=$(jq -n \
        --arg name "${cpu_model:-Unknown}" --arg manufacturer "$cpu_vendor" --arg arch "$(uname -m)" \
        --arg socket "$socket_designation" \
        --argjson cores "$cpu_cores" --argjson threads "$cpu_threads" --argjson mhz "$cpu_mhz" \
        --argjson l2 "$l2_kb" --argjson l3 "$l3_kb" \
        '{name: $name, manufacturer: $manufacturer, architecture: $arch, cores: $cores,
          logicalProcessors: $threads, threads: $threads, maxClockSpeedMHz: $mhz,
          l2CacheKB: $l2, l3CacheKB: $l3, socketDesignation: $socket}')

    # RAM (modules via dmidecode, requires root)
    local mem_total_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null)
    local mem_available_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null)
    local modules='[]'
    if command -v dmidecode &>/dev/null; then
        modules=$(dmidecode -t 17 2>/dev/null | awk -F': ' '
            function flush() { if (inrec && size != "" && size !~ /No Module|Not Installed|Unknown/) print size "\t" loc "\t" bank "\t" type "\t" speed "\t" mfr "\t" part "\t" serial "\t" ff }
            /^Memory Device/ { flush(); inrec=1; size=loc=bank=type=speed=mfr=part=serial=ff=""; next }
            inrec && /^\tSize:/           { size=$2 }
            inrec && /^\tLocator:/        { loc=$2 }
            inrec && /^\tBank Locator:/   { bank=$2 }
            inrec && /^\tType:/           { type=$2 }
            inrec && /^\tSpeed:/          { speed=$2 }
            inrec && /^\tManufacturer:/   { mfr=$2 }
            inrec && /^\tPart Number:/    { part=$2 }
            inrec && /^\tSerial Number:/  { serial=$2 }
            inrec && /^\tForm Factor:/    { ff=$2 }
            END { flush() }' | jq -R -s -c '
            [split("\n")[] | select(length > 0) | split("\t") |
             {sizeStr: .[0], deviceLocator: .[1], bankLabel: .[2], memoryType: .[3], speedStr: .[4],
              manufacturer: .[5], partNumber: .[6], serialNumber: .[7], formFactor: .[8]} |
             .capacityGB = ((.sizeStr | capture("(?<n>[0-9.]+) *(?<u>[KMGT]?B)") // {n: "0", u: "MB"}) as $s |
                            ($s.n | tonumber) * ({"KB": (1/1048576), "MB": (1/1024), "GB": 1, "TB": 1024}[$s.u] // 0) * 100 | round / 100) |
             .speedMHz = ((.speedStr | capture("(?<n>[0-9]+)") // {n: "0"}).n | tonumber) |
             del(.sizeStr, .speedStr)]' 2>/dev/null || echo '[]')
    fi
    # Installed memory, as the Windows agent reports it (sum of modules): lsmem's
    # online memory, else the dmidecode modules. MemTotal is smaller (kernel,
    # firmware and crashkernel reservations) and is reported as usableGB.
    local installed_bytes=$(lsmem -b --summary=only 2>/dev/null | awk -F: '/Total online memory/ {gsub(/[^0-9]/, "", $2); print $2}')
    [[ "$installed_bytes" =~ ^[0-9]+$ ]] || installed_bytes=0
    local ram=$(jq -n --argjson total_kb "${mem_total_kb:-0}" --argjson avail_kb "${mem_available_kb:-0}" \
        --argjson installed "$installed_bytes" --argjson modules "$modules" \
        '($modules | map(.capacityGB) | add // 0) as $module_gb |
         (if $installed > 0 then $installed / 1073741824
          elif $module_gb > 0 then $module_gb
          else $total_kb / 1048576 end) as $total_gb |
         {totalGB: ($total_gb * 10 | round / 10), totalBytes: ($total_gb * 1073741824 | round),
          usableGB: ($total_kb / 1048576 * 10 | round / 10), usableBytes: ($total_kb * 1024),
          availableBytes: ($avail_kb * 1024), modules: $modules, moduleCount: ($modules | length)}')

    # Disks: physical disks (lsblk) and mounted volumes (findmnt)
    local physical=$(lsblk -J -b -d -o NAME,MODEL,VENDOR,SIZE,TYPE,TRAN,ROTA,SERIAL 2>/dev/null | jq -c '
        [.blockdevices[]? | select(.type == "disk") |
         {deviceId: ("/dev/" + .name),
          model: ((.model // .name) | gsub("^\\s+|\\s+$"; "")),
          manufacturer: ((.vendor // "") | gsub("^\\s+|\\s+$"; "")),
          sizeGB: (.size / 1073741824 * 10 | round / 10),
          interfaceType: (if .tran then (.tran | ascii_upcase)
                          elif (.name | startswith("nvme")) then "NVME"
                          elif (.name | test("^(sd|hd)")) then "SCSI"
                          elif (.name | startswith("vd")) then "VIRTIO"
                          else "Unknown" end),
          mediaType: (if .rota then "HDD" else "SSD" end),
          isSsd: (.rota | not),
          serialNumber: .serial}]' 2>/dev/null || echo '[]')
    # findmnt's JSON keeps sources and mount points with spaces intact (df output would need
    # whitespace splitting). Like df, skip pseudo filesystems (size 0), bind mounts of
    # directories (FSROOT is not the filesystem root; a btrfs subvolume's root is its subvol=)
    # and further mounts of the same filesystem root.
    local volumes=$(findmnt -J -l -b --nofsroot -o SOURCE,FSTYPE,SIZE,AVAIL,TARGET,FSROOT,OPTIONS \
            -t notmpfs,nodevtmpfs,nosquashfs,nooverlay,noefivarfs,noramfs 2>/dev/null | jq -c '
        [.filesystems[]? | select(((.size // 0) | tonumber) > 0) |
         select(.fsroot == "/" or .fsroot == ([(.options // "") | match("(?:^|,)subvol=([^,]+)").captures[0].string] | first))] |
        reduce .[] as $v ([]; if any(.[]; .source == $v.source and .fsroot == $v.fsroot) then . else . + [$v] end) |
        [.[] | (.size | tonumber) as $size | ((.avail // 0) | tonumber) as $avail |
         {volumeName: .source, fileSystem: .fstype, driveLetter: .target,
          sizeGB: ($size / 1073741824 * 10 | round / 10),
          freeGB: ($avail / 1073741824 * 10 | round / 10),
          usedPercent: ((1 - $avail / $size) * 1000 | round / 10)}]' 2>/dev/null || echo '[]')

    # GPU: PCI display controllers, falling back to DRM devices (e.g. hyperv_drm, virtio_gpu)
    local gpus='[]'
    if command -v lspci &>/dev/null; then
        gpus=$(lspci -mm 2>/dev/null | awk -F'"' '$2 ~ /VGA compatible controller|3D controller|Display controller/ {print $6 "\t" $4}' | \
            jq -R -s -c '[split("\n")[] | select(length > 0) | split("\t") | {name: .[0], manufacturer: .[1]}]' 2>/dev/null || echo '[]')
    fi
    local card driver resolution version
    local drm='[]'
    for card in /sys/class/drm/card[0-9]*; do
        [[ -e "$card/device/driver" && "$card" != *-* ]] || continue
        driver=$(basename "$(readlink -f "$card/device/driver")")
        resolution=$(cat "$card"-*/modes 2>/dev/null | head -1)
        version=$(modinfo -F version "$driver" 2>/dev/null)
        drm=$(jq -c --arg d "$driver" --arg r "$resolution" --arg v "${version:-$(uname -r)}" \
            '. + [{name: $d, driverVersion: $v, currentResolution: $r}]' <<< "$drm")
    done
    if [[ "$(jq 'length' <<< "$gpus")" -eq 0 ]]; then
        gpus="$drm"
    else
        # Add driver/resolution of the first DRM device to the first PCI GPU
        gpus=$(jq -c --argjson drm "$drm" 'if ($drm | length) > 0 then .[0] += ($drm[0] | {driverVersion, currentResolution}) else . end' <<< "$gpus")
    fi

    # Mainboard / BIOS / virtualization
    local bios_date=$(_dmi bios_date)
    [[ "$bios_date" =~ ^([0-9]{2})/([0-9]{2})/([0-9]{4})$ ]] && bios_date="${BASH_REMATCH[3]}-${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"
    local is_uefi=false
    [[ -d /sys/firmware/efi ]] && is_uefi=true
    local secure_boot="Unknown"
    if command -v mokutil &>/dev/null; then
        case "$(mokutil --sb-state 2>/dev/null)" in
            *enabled*)  secure_boot="Enabled" ;;
            *disabled*) secure_boot="Disabled" ;;
        esac
    fi
    [[ "$is_uefi" == "false" ]] && secure_boot="Not supported"
    local smbios=""
    command -v dmidecode &>/dev/null && smbios=$(dmidecode 2>/dev/null | awk '/^SMBIOS .* present/ {print $2; exit}')
    local virt=$(systemd-detect-virt 2>/dev/null || echo none)
    local hypervisor
    case "$virt" in
        microsoft) hypervisor="Hyper-V" ;;
        kvm)       hypervisor="KVM" ;;
        qemu)      hypervisor="QEMU" ;;
        vmware)    hypervisor="VMware" ;;
        oracle)    hypervisor="VirtualBox" ;;
        xen)       hypervisor="Xen" ;;
        amazon)    hypervisor="AWS Nitro" ;;
        none|"")   hypervisor="" ;;
        *)         hypervisor="$virt" ;;
    esac

    jq -n \
        --argjson cpu "$cpu" --argjson ram "$ram" \
        --argjson physical "$physical" --argjson volumes "$volumes" --argjson gpu "$gpus" \
        --arg mb_vendor "$(_dmi board_vendor)" --arg mb_product "$(_dmi board_name)" \
        --arg mb_version "$(_dmi board_version)" --arg mb_serial "$(_dmi board_serial)" \
        --arg bios_vendor "$(_dmi bios_vendor)" --arg bios_version "$(_dmi bios_version)" \
        --arg bios_date "$bios_date" --arg uuid "$(_dmi product_uuid | tr '[:lower:]' '[:upper:]')" \
        --arg serial "$(_dmi product_serial)" --arg smbios "$smbios" --arg secure_boot "$secure_boot" \
        --argjson is_uefi "$is_uefi" \
        --arg hypervisor "$hypervisor" --arg sys_vendor "$(_dmi sys_vendor)" --arg sys_product "$(_dmi product_name)" \
        '{cpu: $cpu, ram: $ram,
          disks: {physical: $physical, volumes: $volumes},
          gpu: $gpu,
          mainboard: {manufacturer: $mb_vendor, product: $mb_product, version: $mb_version, serialNumber: $mb_serial},
          bios: {name: $bios_version, manufacturer: $bios_vendor, version: $bios_version, releaseDate: $bios_date,
                 uuid: $uuid, serialNumber: $serial, smbiosVersion: $smbios, isUefi: $is_uefi,
                 secureBootState: $secure_boot},
          virtualization: {isVirtual: ($hypervisor != ""), hypervisor: $hypervisor,
                           manufacturer: $sys_vendor, model: $sys_product}}'
}

# ============================================================================
# Software Collection
# ============================================================================

collect_software() {
    local packages="[]"
    
    # Detect package manager and collect packages
    if command -v dpkg &>/dev/null; then
        # Debian/Ubuntu - use jq to build proper JSON
        packages=$(dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' 2>/dev/null | \
            jq -R -s 'split("\n") | map(select(. != "") | split("\t") | {name: .[0], version: .[1], architecture: .[2]})' 2>/dev/null || echo '[]')
    elif command -v rpm &>/dev/null; then
        # RHEL/Fedora/CentOS
        packages=$(rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n' 2>/dev/null | \
            jq -R -s 'split("\n") | map(select(. != "") | split("\t") | {name: .[0], version: .[1], architecture: .[2]})' 2>/dev/null || echo '[]')
    elif command -v pacman &>/dev/null; then
        # Arch Linux
        packages=$(pacman -Q 2>/dev/null | \
            jq -R -s 'split("\n") | map(select(. != "") | split(" ") | {name: .[0], version: .[1]})' 2>/dev/null || echo '[]')
    elif command -v apk &>/dev/null; then
        # Alpine
        packages=$(apk list --installed 2>/dev/null | \
            jq -R -s 'split("\n") | map(select(. != "") | split(" ")[0] | split("-") | {name: .[0], version: .[1]})' 2>/dev/null || echo '[]')
    fi
    
    local count=$(echo "$packages" | jq 'length' 2>/dev/null || echo 0)
    
    cat << EOF
{
    "count": $count,
    "software": $packages
}
EOF
}

# ============================================================================
# System Collection
# ============================================================================

collect_system() {
    local hostname=$(hostname -f 2>/dev/null || hostname)
    local os_name=$(grep -oP '(?<=^NAME=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "Linux")
    local os_version=$(grep -oP '(?<=^VERSION=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "Unknown")
    local os_id=$(grep -oP '(?<=^ID=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "linux")
    local kernel=$(uname -r)
    local uptime_seconds=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
    local boot_time=$(date -d "@$(($(date +%s) - uptime_seconds))" -Iseconds 2>/dev/null || echo "")
    local timezone=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo "UTC")
    
    cat << EOF
{
    "hostname": "$hostname",
    "operatingSystem": {
        "name": "$os_name",
        "version": "$os_version",
        "id": "$os_id",
        "kernel": "$kernel"
    },
    "os": {
        "name": "$os_name",
        "version": "$os_version",
        "build": "$kernel",
        "computerName": "$hostname",
        "agentVersion": "$VERSION"
    },
    "uptime": {
        "seconds": $uptime_seconds,
        "bootTime": "$boot_time"
    },
    "timezone": "$timezone",
    "architecture": "$(uname -m)",
    "platform": "linux"
}
EOF
}

# ============================================================================
# Network Collection
# ============================================================================

collect_network() {
    local interfaces="[]"
    
    if command -v ip &>/dev/null; then
        interfaces=$(ip -j addr show 2>/dev/null | jq '[.[] | {
            name: .ifname,
            mac: .address,
            mtu: .mtu,
            state: .operstate,
            addresses: [.addr_info[]? | {family: .family, address: .local, prefixlen: .prefixlen}]
        }]' 2>/dev/null || echo '[]')
    fi
    
    local default_gateway=$(ip route show default 2>/dev/null | awk '/default/ {print $3; exit}' || echo "")
    local dns_servers=$(grep -oP '(?<=nameserver ).+' /etc/resolv.conf 2>/dev/null | jq -R -s 'split("\n") | map(select(. != ""))' || echo '[]')
    
    cat << EOF
{
    "interfaces": $interfaces,
    "defaultGateway": "$default_gateway",
    "dnsServers": $dns_servers
}
EOF
}

# ============================================================================
# Security Collection
# ============================================================================

collect_security() {
    # Users with login shell
    local users=$(getent passwd 2>/dev/null | awk -F: '$7 !~ /nologin|false/ {print $1}' | jq -R -s 'split("\n") | map(select(. != ""))' || echo '[]')
    
    # Sudo users
    local sudo_users="[]"
    if [[ -f /etc/sudoers ]] && [[ -r /etc/sudoers ]]; then
        sudo_users=$(grep -oP '^\w+' /etc/sudoers 2>/dev/null | sort -u | jq -R -s 'split("\n") | map(select(. != ""))' 2>/dev/null || echo '[]')
    fi
    # Ensure it's valid JSON
    if ! echo "$sudo_users" | jq empty 2>/dev/null; then
        sudo_users="[]"
    fi
    
    # SSH config
    local ssh_port=$(grep -oP '(?<=^Port ).+' /etc/ssh/sshd_config 2>/dev/null | head -1 || echo "22")
    local ssh_root=$(grep -oP '(?<=^PermitRootLogin ).+' /etc/ssh/sshd_config 2>/dev/null | head -1 || echo "unknown")
    local ssh_password=$(grep -oP '(?<=^PasswordAuthentication ).+' /etc/ssh/sshd_config 2>/dev/null | head -1 || echo "unknown")
    
    # Firewall status
    local firewall_status="unknown"
    local firewall_type="none"
    if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "active"; then
        firewall_status="active"
        firewall_type="ufw"
    elif command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q "running"; then
        firewall_status="active"
        firewall_type="firewalld"
    elif command -v iptables &>/dev/null && iptables -L -n 2>/dev/null | grep -q "Chain"; then
        firewall_status="configured"
        firewall_type="iptables"
    fi
    
    # SELinux/AppArmor
    local mac_status="none"
    if command -v getenforce &>/dev/null; then
        mac_status="selinux:$(getenforce 2>/dev/null || echo 'unknown')"
    elif [[ -d /sys/kernel/security/apparmor ]]; then
        mac_status="apparmor:enabled"
    fi
    
    cat << EOF
{
    "loginUsers": $users,
    "sudoUsers": $sudo_users,
    "ssh": {
        "port": "$ssh_port",
        "permitRootLogin": "$ssh_root",
        "passwordAuthentication": "$ssh_password"
    },
    "firewall": {
        "type": "$firewall_type",
        "status": "$firewall_status"
    },
    "mandatoryAccessControl": "$mac_status"
}
EOF
}

# ============================================================================
# Performance Collection (Enhanced Metrics)
# ============================================================================

collect_performance() {
    # Load averages
    local load_1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)
    local load_5=$(awk '{print $2}' /proc/loadavg 2>/dev/null || echo 0)
    local load_15=$(awk '{print $3}' /proc/loadavg 2>/dev/null || echo 0)
    
    # CPU per core
    local cpu_cores="[]"
    if [[ -f /proc/stat ]]; then
        cpu_cores=$(grep '^cpu[0-9]' /proc/stat 2>/dev/null | awk '
            BEGIN { first = 1 }
            {
                core = substr($1, 4)
                total = $2+$3+$4+$5+$6+$7+$8
                idle = $5
                usage = (total > 0) ? 100 * (1 - idle/total) : 0
                printf "%s{\"core\": %d, \"usagePercent\": %.1f}", (first ? "" : ","), core, usage
                first = 0
            }
        ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
    fi
    
    # Memory detailed
    local mem_total=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
    local mem_free=$(grep MemFree /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
    local mem_available=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
    local mem_buffers=$(grep Buffers /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
    local mem_cached=$(grep "^Cached:" /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
    local swap_total=$(grep SwapTotal /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
    local swap_free=$(grep SwapFree /proc/meminfo 2>/dev/null | awk '{print $2 * 1024}' || echo 0)
    local swap_used=$((swap_total - swap_free))
    
    # Disk I/O (from /proc/diskstats)
    local disk_io="[]"
    if [[ -f /proc/diskstats ]]; then
        disk_io=$(cat /proc/diskstats 2>/dev/null | awk '
            BEGIN { first = 1 }
            $3 ~ /^(sd[a-z]|nvme[0-9]+n[0-9]+|vd[a-z])$/ {
                name = $3
                reads = $4
                read_sectors = $6
                writes = $8
                write_sectors = $10
                read_bytes = read_sectors * 512
                write_bytes = write_sectors * 512
                printf "%s{\"device\": \"%s\", \"readsCompleted\": %d, \"writesCompleted\": %d, \"readBytes\": %d, \"writeBytes\": %d}", 
                    (first ? "" : ","), name, reads, writes, read_bytes, write_bytes
                first = 0
            }
        ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
    fi
    
    # Disk space per mount
    local disk_space=$(df -B1 -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | awk '
        BEGIN { first = 1 }
        NR>1 {
            printf "%s{\"mount\": \"%s\", \"device\": \"%s\", \"totalBytes\": %s, \"usedBytes\": %s, \"availableBytes\": %s, \"usedPercent\": %.1f}",
                (first ? "" : ","), $6, $1, $2, $3, $4, ($2>0 ? $3/$2*100 : 0)
            first = 0
        }
    ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
    
    # Network I/O rates
    local net_io="[]"
    for iface in /sys/class/net/*/; do
        local name=$(basename "$iface")
        [[ "$name" == "lo" ]] && continue
        local rx=$(cat "$iface/statistics/rx_bytes" 2>/dev/null || echo 0)
        local tx=$(cat "$iface/statistics/tx_bytes" 2>/dev/null || echo 0)
        local rx_packets=$(cat "$iface/statistics/rx_packets" 2>/dev/null || echo 0)
        local tx_packets=$(cat "$iface/statistics/tx_packets" 2>/dev/null || echo 0)
        local rx_errors=$(cat "$iface/statistics/rx_errors" 2>/dev/null || echo 0)
        local tx_errors=$(cat "$iface/statistics/tx_errors" 2>/dev/null || echo 0)
        if [[ "$net_io" == "[]" ]]; then
            net_io="[{\"interface\": \"$name\", \"rxBytes\": $rx, \"txBytes\": $tx, \"rxPackets\": $rx_packets, \"txPackets\": $tx_packets, \"rxErrors\": $rx_errors, \"txErrors\": $tx_errors}"
        else
            net_io="${net_io%]},{\"interface\": \"$name\", \"rxBytes\": $rx, \"txBytes\": $tx, \"rxPackets\": $rx_packets, \"txPackets\": $tx_packets, \"rxErrors\": $rx_errors, \"txErrors\": $tx_errors}]"
        fi
    done
    [[ "$net_io" == "[" ]] && net_io="[]"
    [[ "$net_io" != "[]" && "${net_io: -1}" != "]" ]] && net_io="${net_io}]"
    
    cat << EOF
{
    "loadAverage": {
        "load1": $load_1,
        "load5": $load_5,
        "load15": $load_15
    },
    "cpuCores": $cpu_cores,
    "memory": {
        "totalBytes": $mem_total,
        "freeBytes": $mem_free,
        "availableBytes": $mem_available,
        "buffersBytes": $mem_buffers,
        "cachedBytes": $mem_cached
    },
    "swap": {
        "totalBytes": $swap_total,
        "usedBytes": $swap_used,
        "freeBytes": $swap_free
    },
    "diskIo": $disk_io,
    "diskSpace": $disk_space,
    "networkIo": $net_io
}
EOF
}

# ============================================================================
# Services Collection (systemd)
# ============================================================================

collect_services() {
    local services="[]"
    
    if command -v systemctl &>/dev/null; then
        services=$(systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | \
            awk '
                BEGIN { first = 1 }
                {
                    name = $1
                    gsub(/\.service$/, "", name)
                    # Escape backslashes in name (e.g. \x2d)
                    gsub(/\\/, "\\\\", name)
                    load = $2
                    active = $3
                    sub_state = $4
                    desc = ""
                    for (i=5; i<=NF; i++) desc = desc (i>5?" ":"") $i
                    gsub(/\\/, "\\\\", desc)
                    gsub(/"/, "\\\"", desc)
                    printf "%s{\"name\": \"%s\", \"loadState\": \"%s\", \"activeState\": \"%s\", \"subState\": \"%s\", \"description\": \"%s\"}",
                        (first ? "" : ","), name, load, active, sub_state, desc
                    first = 0
                }
            ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' 2>/dev/null || echo '[]')
    fi
    
    # Count by state
    local active_count=$(echo "$services" | jq '[.[] | select(.activeState == "active")] | length' 2>/dev/null || echo 0)
    local failed_count=$(echo "$services" | jq '[.[] | select(.activeState == "failed")] | length' 2>/dev/null || echo 0)
    local inactive_count=$(echo "$services" | jq '[.[] | select(.activeState == "inactive")] | length' 2>/dev/null || echo 0)
    
    # Get enabled services
    local enabled_services="[]"
    if command -v systemctl &>/dev/null; then
        enabled_services=$(systemctl list-unit-files --type=service --state=enabled --no-pager --no-legend 2>/dev/null | \
            awk '
                BEGIN { first = 1 }
                {
                    gsub(/\.service$/, "", $1)
                    printf "%s\"%s\"", (first ? "" : ","), $1
                    first = 0
                }
            ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' 2>/dev/null || echo '[]')
    fi
    
    cat << EOF
{
    "services": $services,
    "summary": {
        "total": $(echo "$services" | jq 'length' 2>/dev/null || echo 0),
        "active": $active_count,
        "failed": $failed_count,
        "inactive": $inactive_count
    },
    "enabledServices": $enabled_services
}
EOF
}

# ============================================================================
# Package Updates Collection
# ============================================================================

collect_updates() {
    local updates="[]"
    local total_updates=0
    local security_updates=0
    local package_manager="unknown"
    
    if command -v apt-get &>/dev/null; then
        package_manager="apt"
        
        # Get upgradable packages (force English output, skip header line)
        updates=$(LANG=C apt list --upgradable 2>/dev/null | grep -v "^Listing" | \
            awk -F'/' '
                BEGIN { first = 1 }
                {
                    name = $1
                    split($2, ver, " ")
                    new_ver = ver[1]
                    printf "%s{\"name\": \"%s\", \"newVersion\": \"%s\", \"security\": false}",
                        (first ? "" : ","), name, new_ver
                    first = 0
                }
            ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
        
        total_updates=$(echo "$updates" | jq 'length' 2>/dev/null || echo 0)
        
        # Check for security updates via apt
        security_updates=$(apt list --upgradable 2>/dev/null | grep -c -- "-security" 2>/dev/null || true)
        [[ -z "$security_updates" ]] && security_updates=0
        
    elif command -v dnf &>/dev/null; then
        package_manager="dnf"
        updates=$(dnf check-update -q 2>/dev/null | awk '
            BEGIN { first = 1 }
            NF==3 {
                printf "%s{\"name\": \"%s\", \"newVersion\": \"%s\", \"repository\": \"%s\", \"security\": false}",
                    (first ? "" : ","), $1, $2, $3
                first = 0
            }
        ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
        
        total_updates=$(echo "$updates" | jq 'length' 2>/dev/null || echo 0)
        security_updates=$(dnf updateinfo list security 2>/dev/null | wc -l || echo 0)
        
    elif command -v yum &>/dev/null; then
        package_manager="yum"
        updates=$(yum check-update -q 2>/dev/null | awk '
            BEGIN { first = 1 }
            NF==3 {
                printf "%s{\"name\": \"%s\", \"newVersion\": \"%s\", \"repository\": \"%s\", \"security\": false}",
                    (first ? "" : ","), $1, $2, $3
                first = 0
            }
        ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
        
        total_updates=$(echo "$updates" | jq 'length' 2>/dev/null || echo 0)
        security_updates=$(yum updateinfo list security 2>/dev/null | wc -l || echo 0)
        
    elif command -v pacman &>/dev/null; then
        package_manager="pacman"
        updates=$(pacman -Qu 2>/dev/null | awk '
            BEGIN { first = 1 }
            {
                printf "%s{\"name\": \"%s\", \"newVersion\": \"%s\", \"security\": false}",
                    (first ? "" : ","), $1, $4
                first = 0
            }
        ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
        
        total_updates=$(echo "$updates" | jq 'length' 2>/dev/null || echo 0)
    fi
    
    # Last update check time
    local last_update_check=""
    if [[ -f /var/lib/apt/periodic/update-stamp ]]; then
        last_update_check=$(date -r /var/lib/apt/periodic/update-stamp -Iseconds 2>/dev/null || echo "")
    elif [[ -f /var/cache/dnf/last_makecache ]]; then
        last_update_check=$(date -r /var/cache/dnf/last_makecache -Iseconds 2>/dev/null || echo "")
    fi
    
    cat << EOF
{
    "packageManager": "$package_manager",
    "totalUpdates": $total_updates,
    "securityUpdates": $security_updates,
    "lastCheckTime": "$last_update_check",
    "updates": $updates
}
EOF
}

# ============================================================================
# SMART Disk Health Collection
# ============================================================================

collect_disk_health() {
    local disks="[]"
    local smartctl_available=false
    
    if command -v smartctl &>/dev/null; then
        smartctl_available=true
        
        # Find physical disks
        for disk in /dev/sd? /dev/nvme?n? /dev/vd?; do
            [[ ! -b "$disk" ]] && continue
            
            local disk_name=$(basename "$disk")
            local smart_data=""
            local health_status="Unknown"
            local temperature=""
            local power_on_hours=""
            local reallocated_sectors=""
            local pending_sectors=""
            local model=""
            local serial=""
            local firmware=""
            
            # Get SMART data (needs root, might fail)
            smart_data=$(smartctl -a "$disk" 2>/dev/null) || continue
            
            # Parse health status
            health_status=$(echo "$smart_data" | grep -oP '(?<=SMART overall-health self-assessment test result: ).+' || echo "Unknown")
            [[ -z "$health_status" ]] && health_status=$(echo "$smart_data" | grep -oP '(?<=SMART Health Status: ).+' || echo "Unknown")
            
            # Parse model/serial
            model=$(echo "$smart_data" | grep -oP '(?<=Device Model: ).+' || echo "$smart_data" | grep -oP '(?<=Model Number: ).+' || echo "Unknown")
            serial=$(echo "$smart_data" | grep -oP '(?<=Serial Number: ).+' || echo "Unknown")
            firmware=$(echo "$smart_data" | grep -oP '(?<=Firmware Version: ).+' || echo "Unknown")
            
            # Parse SMART attributes
            temperature=$(echo "$smart_data" | grep -E "^194|Temperature_Celsius" | awk '{print $10}' | head -1)
            [[ -z "$temperature" ]] && temperature=$(echo "$smart_data" | grep -oP '(?<=Temperature: )\d+' | head -1)
            power_on_hours=$(echo "$smart_data" | grep -E "^  9|Power_On_Hours" | awk '{print $10}' | head -1)
            reallocated_sectors=$(echo "$smart_data" | grep -E "^  5|Reallocated_Sector" | awk '{print $10}' | head -1)
            pending_sectors=$(echo "$smart_data" | grep -E "^197|Current_Pending_Sector" | awk '{print $10}' | head -1)
            
            # NVMe specific
            if [[ "$disk" == *nvme* ]]; then
                temperature=$(echo "$smart_data" | grep -oP '(?<=Temperature: )\d+' | head -1)
                power_on_hours=$(echo "$smart_data" | grep -oP '(?<=Power On Hours: )[\d,]+' | tr -d ',' | head -1)
            fi
            
            # Build JSON entry
            local entry=$(cat << ENTRY
{
    "device": "$disk",
    "name": "$disk_name",
    "model": "$(echo "$model" | xargs)",
    "serial": "$(echo "$serial" | xargs)",
    "firmware": "$(echo "$firmware" | xargs)",
    "healthStatus": "$(echo "$health_status" | xargs)",
    "temperature": ${temperature:-null},
    "powerOnHours": ${power_on_hours:-null},
    "reallocatedSectors": ${reallocated_sectors:-null},
    "pendingSectors": ${pending_sectors:-null}
}
ENTRY
)
            if [[ "$disks" == "[]" ]]; then
                disks="[$entry"
            else
                disks="${disks},$entry"
            fi
        done
        
        [[ "$disks" != "[]" ]] && disks="${disks}]"
    fi
    
    cat << EOF
{
    "smartctlAvailable": $smartctl_available,
    "disks": $disks
}
EOF
}

# ============================================================================
# Live Data Collection (for Real-time Dashboard)
# ============================================================================

collect_live_metrics() {
    # CPU - average across all cores (1 second sample)
    local cpu_percent=0
    if [[ -f /proc/stat ]]; then
        local cpu1=$(head -1 /proc/stat)
        sleep 0.5
        local cpu2=$(head -1 /proc/stat)
        
        local idle1=$(echo "$cpu1" | awk '{print $5}')
        local total1=$(echo "$cpu1" | awk '{sum=0; for(i=2;i<=NF;i++) sum+=$i; print sum}')
        local idle2=$(echo "$cpu2" | awk '{print $5}')
        local total2=$(echo "$cpu2" | awk '{sum=0; for(i=2;i<=NF;i++) sum+=$i; print sum}')
        
        local idle_diff=$((idle2 - idle1))
        local total_diff=$((total2 - total1))
        
        if [[ $total_diff -gt 0 ]]; then
            cpu_percent=$(awk -v i="$idle_diff" -v t="$total_diff" 'BEGIN {printf "%.1f", 100 * (t - i) / t}')
        fi
    fi
    
    # Memory
    local mem_total=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
    local mem_available=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}')
    local mem_percent=0
    if [[ -n "$mem_total" ]] && [[ "$mem_total" -gt 0 ]]; then
        mem_percent=$(awk -v a="$mem_available" -v t="$mem_total" 'BEGIN {printf "%.1f", 100 * (t - a) / t}')
    fi
    
    # Disk (root filesystem)
    local disk_percent=$(df / 2>/dev/null | awk 'NR==2 {gsub(/%/,""); print $5}' || echo 0)
    
    cat << EOF
{
    "cpuPercent": $cpu_percent,
    "memoryPercent": $mem_percent,
    "diskPercent": $disk_percent
}
EOF
}

collect_live_processes() {
    # Top 20 processes by CPU usage
    ps aux --sort=-%cpu 2>/dev/null | head -21 | tail -20 | awk 'BEGIN {print "["} 
        NR>1 {
            if (NR>2) print ","
            gsub(/"/, "\\\"", $11)
            printf "{\"name\":\"%s\",\"pid\":%d,\"cpuPercent\":%.1f,\"memoryMb\":%.1f,\"userName\":\"%s\"}", 
                   $11, $2, $3, $6/1024, $1
        } 
        END {print "]"}' 2>/dev/null || echo "[]"
}

collect_live_network() {
    local now=$(date +%s)
    local interfaces="["
    local first=1
    
    for iface in /sys/class/net/*/; do
        local name=$(basename "$iface")
        [[ "$name" == "lo" ]] && continue
        
        local rx_bytes=$(cat "$iface/statistics/rx_bytes" 2>/dev/null || echo 0)
        local tx_bytes=$(cat "$iface/statistics/tx_bytes" 2>/dev/null || echo 0)
        local link_up="false"
        [[ "$(cat "$iface/operstate" 2>/dev/null)" == "up" ]] && link_up="true"
        local speed=$(cat "$iface/speed" 2>/dev/null || echo 0)
        [[ "$speed" -lt 0 ]] && speed=0
        
        # Calculate rates
        local rx_rate=0 tx_rate=0
        local last_rx="${LAST_RX_BYTES[$name]:-0}"
        local last_tx="${LAST_TX_BYTES[$name]:-0}"
        
        if [[ $LAST_NET_TIME -gt 0 ]]; then
            local elapsed=$((now - LAST_NET_TIME))
            if [[ $elapsed -gt 0 ]]; then
                rx_rate=$(( (rx_bytes - last_rx) / elapsed ))
                tx_rate=$(( (tx_bytes - last_tx) / elapsed ))
            fi
        fi
        
        LAST_RX_BYTES[$name]=$rx_bytes
        LAST_TX_BYTES[$name]=$tx_bytes
        
        [[ $first -eq 0 ]] && interfaces+=","
        first=0
        
        local rx_mb=$(echo "scale=1; $rx_bytes / 1048576" | bc 2>/dev/null | sed 's/^\(-\{0,1\}\)\./\10./' || echo 0)
        local tx_mb=$(echo "scale=1; $tx_bytes / 1048576" | bc 2>/dev/null | sed 's/^\(-\{0,1\}\)\./\10./' || echo 0)
        
        interfaces+="{\"name\":\"$name\",\"linkUp\":$link_up,\"speedMbps\":$speed,\"rxBytesPerSec\":$rx_rate,\"txBytesPerSec\":$tx_rate,\"rxTotalMb\":$rx_mb,\"txTotalMb\":$tx_mb}"
    done
    
    LAST_NET_TIME=$now
    interfaces+="]"
    echo "$interfaces"
}

collect_agent_logs() {
    # Get recent logs from journal or log file
    local logs="[]"
    
    if command -v journalctl &>/dev/null; then
        logs=$(journalctl -u octofleet-agent --no-pager -n 20 --output=json 2>/dev/null | \
            jq -s '[.[] | {
                timestamp: (.__REALTIME_TIMESTAMP | tonumber / 1000000 | strftime("%Y-%m-%dT%H:%M:%SZ")),
                level: (if .PRIORITY == "3" then "Error" elif .PRIORITY == "4" then "Warning" else "Information" end),
                source: "octofleet-agent",
                message: .MESSAGE[0:500]
            }]' 2>/dev/null || echo '[]')
    elif [[ -f "$LOG_FILE" ]]; then
        logs=$(tail -20 "$LOG_FILE" 2>/dev/null | \
            jq -R -s 'split("\n") | map(select(. != "") | {
                timestamp: (capture("^\\[(?<ts>[^\\]]+)\\]") | .ts // ""),
                level: (capture("\\[(?<lvl>INFO|WARN|ERROR)\\]") | .lvl // "INFO"),
                source: "octofleet-agent",
                message: .
            })' 2>/dev/null || echo '[]')
    fi
    
    echo "$logs"
}

push_live_data() {
    local metrics=$(collect_live_metrics)
    local processes=$(collect_live_processes)
    local network=$(collect_live_network)
    local logs=$(collect_agent_logs)
    
    local payload=$(cat << EOF
{
    "nodeId": "$NODE_ID",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "metrics": $metrics,
    "processes": $processes,
    "network": $network,
    "agentLogs": $logs
}
EOF
)
    
    curl -sS -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$payload" \
        "${API_URL}/api/v1/live-data" >/dev/null 2>&1 || true
}

# ============================================================================
# Full Inventory
# ============================================================================

collect_full_inventory() {
    local hardware=$(collect_hardware)
    local software=$(collect_software)
    local system=$(collect_system)
    local network=$(collect_network)
    local security=$(collect_security)
    local performance=$(collect_performance)
    local services=$(collect_services)
    local updates=$(collect_updates)
    local disk_health=$(collect_disk_health)
    
    cat << EOF
{
    "nodeId": "$NODE_ID",
    "hostname": "$(hostname)",
    "agentVersion": "$VERSION",
    "collectedAt": "$(date -Iseconds)",
    "hardware": $hardware,
    "software": $software,
    "system": $system,
    "network": $network,
    "security": $security,
    "performance": $performance,
    "services": $services,
    "updates": $updates,
    "diskHealth": $disk_health
}
EOF
}

# ============================================================================
# API Functions
# ============================================================================

push_inventory() {
    info "Collecting inventory..."
    local tmp_file=$(mktemp)
    collect_full_inventory > "$tmp_file"
    
    info "Pushing inventory to $API_URL..."
    local response=$(curl -sS -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d @"$tmp_file" \
        "${API_URL}/api/v1/inventory/full" 2>&1)
    
    rm -f "$tmp_file"
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" == "200" ]]; then
        info "Inventory pushed successfully"
        return 0
    else
        error "Push failed: HTTP $http_code - $body"
        return 1
    fi
}

poll_jobs() {
    local response=$(curl -sS -w "\n%{http_code}" \
        -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/jobs/pending/${NODE_ID}" 2>&1)
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" != "200" ]]; then
        warn "Job poll failed: HTTP $http_code"
        return 1
    fi
    
    local jobs=$(echo "$body" | jq -r '.jobs // []')
    local job_count=$(echo "$jobs" | jq 'length')
    
    if [[ "$job_count" -gt 0 ]]; then
        info "Found $job_count pending jobs"
        echo "$jobs" | jq -c '.[]' | while read -r job; do
            execute_job "$job"
        done
    fi
}

# ============================================================================
# E18: Service Reconciliation
# ============================================================================

detect_distro() {
    if [[ -f /etc/debian_version ]]; then
        echo "debian"
    elif [[ -f /etc/redhat-release ]]; then
        echo "rhel"
    elif [[ -f /etc/arch-release ]]; then
        echo "arch"
    else
        echo "unknown"
    fi
}

install_package() {
    local pkg="$1"
    local distro=$(detect_distro)
    
    info "Installing package: $pkg (distro: $distro)"
    
    case "$distro" in
        debian)
            DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg" 2>&1
            ;;
        rhel)
            yum install -y "$pkg" 2>&1
            ;;
        arch)
            pacman -S --noconfirm "$pkg" 2>&1
            ;;
        *)
            echo "Unsupported distro for package installation"
            return 1
            ;;
    esac
}

render_template() {
    local template="$1"
    local config_values="$2"
    
    # Simple template rendering: replace {{key}} with values
    local result="$template"
    
    # Extract keys from config_values JSON and replace
    for key in $(echo "$config_values" | jq -r 'keys[]' 2>/dev/null); do
        local value=$(echo "$config_values" | jq -r ".[\"$key\"]")
        # Handle {{key}} and {{key|default:value}}
        result=$(echo "$result" | sed "s/{{${key}[^}]*}}/${value}/g")
    done
    
    # Handle remaining defaults: {{key|default:value}} -> value
    result=$(echo "$result" | sed -E 's/\{\{[^|]+\|default:([^}]+)\}\}/\1/g')
    
    echo "$result"
}

check_service_health() {
    local health_check="$1"
    local config_values="$2"
    
    local check_type=$(echo "$health_check" | jq -r '.type // "tcp"')
    local port=$(echo "$health_check" | jq -r '.port // "80"')
    local path=$(echo "$health_check" | jq -r '.path // "/"')
    local expected=$(echo "$health_check" | jq -r '.expectedStatus // 200')
    
    # Render port if it's a template variable
    port=$(render_template "$port" "$config_values")
    
    case "$check_type" in
        http)
            local status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}${path}" 2>/dev/null || echo "000")
            if [[ "$status" == "$expected" ]]; then
                echo "healthy"
                return 0
            else
                echo "unhealthy (HTTP $status, expected $expected)"
                return 1
            fi
            ;;
        tcp)
            if nc -z localhost "$port" 2>/dev/null; then
                echo "healthy"
                return 0
            else
                echo "unhealthy (port $port not responding)"
                return 1
            fi
            ;;
        *)
            echo "unknown check type: $check_type"
            return 1
            ;;
    esac
}

reconcile_service() {
    local payload="$1"
    local output=""
    
    # Parse service definition
    local service_def=$(echo "$payload" | jq -r '.serviceDefinition')
    local role=$(echo "$payload" | jq -r '.role')
    local assignment_id=$(echo "$payload" | jq -r '.assignmentId')
    
    local service_id=$(echo "$service_def" | jq -r '.serviceId')
    local service_name=$(echo "$service_def" | jq -r '.serviceName')
    local class_name=$(echo "$service_def" | jq -r '.className')
    local config_values=$(echo "$service_def" | jq -r '.configValues')
    local required_packages=$(echo "$service_def" | jq -r '.requiredPackages')
    local config_template=$(echo "$service_def" | jq -r '.configTemplate')
    local health_check=$(echo "$service_def" | jq -r '.healthCheck')
    local desired_version=$(echo "$service_def" | jq -r '.desiredStateVersion')
    
    output+="=== Reconciling Service: $service_name (role: $role) ===\n"
    
    # Step 1: Install required packages
    output+="\n--- Step 1: Installing packages ---\n"
    for pkg in $(echo "$required_packages" | jq -r '.[]' 2>/dev/null); do
        if ! command -v "$pkg" &>/dev/null && ! dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
            output+="Installing: $pkg\n"
            install_output=$(install_package "$pkg" 2>&1) || {
                output+="FAILED to install $pkg: $install_output\n"
                report_service_status "$service_id" "failed" "unhealthy" "Package installation failed: $pkg"
                echo -e "$output"
                return 1
            }
            output+="Installed: $pkg\n"
        else
            output+="Already installed: $pkg\n"
        fi
    done
    
    # Step 2: Apply configuration (if template exists)
    if [[ "$config_template" != "null" && -n "$config_template" ]]; then
        output+="\n--- Step 2: Applying configuration ---\n"
        
        local files=$(echo "$config_template" | jq -r '.files // []')
        for file_entry in $(echo "$files" | jq -c '.[]' 2>/dev/null); do
            local file_path=$(echo "$file_entry" | jq -r '.path.linux // .path')
            local file_content=$(echo "$file_entry" | jq -r '.content')
            local file_mode=$(echo "$file_entry" | jq -r '.mode // "0644"')
            
            # Render templates
            file_path=$(render_template "$file_path" "$config_values")
            file_content=$(render_template "$file_content" "$config_values")
            
            output+="Writing config: $file_path\n"
            mkdir -p "$(dirname "$file_path")"
            echo -e "$file_content" > "$file_path"
            chmod "$file_mode" "$file_path"
        done
        
        # Execute post-config commands
        local commands=$(echo "$config_template" | jq -r '.commands.linux // []')
        for cmd in $(echo "$commands" | jq -r '.[]' 2>/dev/null); do
            cmd=$(render_template "$cmd" "$config_values")
            output+="Running: $cmd\n"
            cmd_output=$(bash -c "$cmd" 2>&1) || {
                output+="Command failed: $cmd_output\n"
                report_service_status "$service_id" "failed" "unhealthy" "Config command failed"
                echo -e "$output"
                return 1
            }
        done
    fi
    
    # Step 3: Start/Enable service
    output+="\n--- Step 3: Starting service ---\n"
    
    # For nginx specifically
    if [[ "$class_name" == "nginx"* ]]; then
        if ! systemctl is-active nginx &>/dev/null; then
            output+="Starting nginx...\n"
            systemctl start nginx 2>&1 || true
        fi
        systemctl enable nginx 2>&1 || true
        output+="nginx service enabled\n"
    fi
    
    # Step 4: Health check
    output+="\n--- Step 4: Health check ---\n"
    sleep 2  # Give service time to start
    
    if [[ "$health_check" != "null" && -n "$health_check" ]]; then
        local health_result=$(check_service_health "$health_check" "$config_values")
        output+="Health: $health_result\n"
        
        if [[ "$health_result" == "healthy" ]]; then
            report_service_status "$service_id" "active" "healthy" "Reconciliation completed" "$desired_version"
        else
            report_service_status "$service_id" "active" "unhealthy" "Health check failed: $health_result"
        fi
    else
        report_service_status "$service_id" "active" "unknown" "No health check defined" "$desired_version"
    fi
    
    output+="\n=== Reconciliation complete ===\n"
    echo -e "$output"
    return 0
}

report_service_status() {
    local service_id="$1"
    local status="$2"
    local health_status="$3"
    local message="$4"
    local state_version="${5:-}"
    
    local payload=$(cat << EOF
{
    "status": "$status",
    "healthStatus": "$health_status",
    "message": "$message",
    "action": "reconcile",
    "result": "$([ "$health_status" == "healthy" ] && echo 'success' || echo 'warning')",
    "stateVersion": $([[ -n "$state_version" ]] && echo "$state_version" || echo "null")
}
EOF
)
    
    curl -sS -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$payload" \
        "${API_URL}/api/v1/services/${service_id}/nodes/${NODE_ID}/status" >/dev/null 2>&1 || warn "Failed to report service status"
}

# Removes the agent from this machine (#160) - the same steps as linux-agent/uninstall.sh.
# Runs as a transient systemd unit: outside this service's sandbox (which cannot write
# /etc/systemd/system) and not ended when the service stops. The delay lets this job report
# its result first.
schedule_uninstall() {
    local delay="${1:-10}"
    local node_uuid="${2:-}"
    local confirmation_token="${3:-}"
    [[ "$delay" =~ ^[0-9]+$ ]] && (( delay >= 5 && delay <= 300 )) || delay=10
    [[ "$node_uuid" =~ ^[0-9a-fA-F-]{36}$ && -n "$confirmation_token" ]] || {
        echo "Refusing to uninstall: confirmation data is missing"
        return 1
    }
    if [[ -z "$SCRIPT_DIR" || "$SCRIPT_DIR" == "/" || ! -f "$SCRIPT_DIR/agent.sh" ]]; then
        echo "Refusing to uninstall: unexpected agent directory '$SCRIPT_DIR'"
        return 1
    fi
    local unit="octofleet-agent.service"
    local script payload url
    script=$(mktemp /var/log/octofleet-uninstall.XXXXXXXX) || return 1
    chmod 600 "$script"
    payload=$(jq -cn --arg token "$confirmation_token" '{confirmationToken: $token}')
    url="${API_URL}/api/v1/nodes/${node_uuid}/uninstall/complete"
    {
        printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'trap '\''rm -f -- "$0"'\'' EXIT'
        printf 'sleep %q\n' "$delay"
        printf 'systemctl disable --now %q || true\n' "$unit"
        printf 'rm -f -- %q\n' "/etc/systemd/system/$unit"
        printf '%s\n' 'systemctl daemon-reload'
        printf 'rm -rf -- %q\n' "$SCRIPT_DIR"
        printf 'rm -f -- %q\n' "$LOG_FILE"
        printf 'test ! -e %q\n' "$SCRIPT_DIR"
        printf 'curl -fsS --max-time 15 -X POST -H %q -H %q --data-binary %q %q >/dev/null\n' \
            'Content-Type: application/json' "X-API-Key: $API_KEY" "$payload" "$url"
    } > "$script"
    if command -v systemd-run &>/dev/null && systemd-run --quiet --collect \
            --unit "octofleet-agent-uninstall-$(date +%s)" /bin/bash "$script"; then
        echo "Agent uninstall started; the agent will be removed in ${delay} seconds."
        return 0
    fi
    # Without systemd (e.g. a container): nothing outlives a service stop, so run directly
    setsid nohup /bin/bash "$script" >/dev/null 2>&1 &
    echo "Agent uninstall started without systemd-run; the agent will be removed in ${delay} seconds."
}

execute_job() {
    local job="$1"
    local instance_id=$(echo "$job" | jq -r '.instanceId // .instance_id')
    local job_name=$(echo "$job" | jq -r '.jobName // .job_name')
    local command_type=$(echo "$job" | jq -r '.commandType // .command_type')
    local command_payload=$(echo "$job" | jq -r '.commandPayload // .command_payload')
    
    info "Executing job: $job_name ($instance_id)"
    
    # Mark job as started
    curl -sS -X POST \
        -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/jobs/instances/${instance_id}/start" >/dev/null 2>&1 || true
    
    local start_time=$(date +%s)
    local output=""
    local exit_code=0
    
    case "$command_type" in
        shell|script)
            local script=$(echo "$command_payload" | jq -r '.script // .command // ""')
            if [[ -n "$script" ]]; then
                output=$(bash -c "$script" 2>&1) || exit_code=$?
            fi
            ;;
        inventory_push)
            push_inventory && exit_code=0 || exit_code=1
            output="Inventory push completed"
            ;;
        service_reconcile)
            output=$(reconcile_service "$command_payload") || exit_code=$?
            ;;
        uninstall-agent)
            local delay=$(echo "$command_payload" | jq -r '.delaySeconds // 10' 2>/dev/null)
            local confirmation_node_id=$(echo "$command_payload" | jq -r '.confirmationNodeId // empty' 2>/dev/null)
            local confirmation_token=$(echo "$command_payload" | jq -r '.confirmationToken // empty' 2>/dev/null)
            output=$(schedule_uninstall "$delay" "$confirmation_node_id" "$confirmation_token" 2>&1) || exit_code=$?
            ;;
        *)
            warn "Unknown command type: $command_type"
            exit_code=1
            output="Unknown command type"
            ;;
    esac
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Report result
    local result=$(cat << EOF
{
    "success": $([ $exit_code -eq 0 ] && echo 'true' || echo 'false'),
    "status": "$([ $exit_code -eq 0 ] && echo 'success' || echo 'failed')",
    "exitCode": $exit_code,
    "stdout": $(echo "$output" | jq -Rs '.'),
    "stderr": ""
}
EOF
)
    
    curl -sS -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$result" \
        "${API_URL}/api/v1/jobs/instances/${instance_id}/result" >/dev/null 2>&1 || warn "Failed to report job result"
    
    info "Job $instance_id completed: exit_code=$exit_code, duration=${duration}s"
}

# ============================================================================
# Screen Capture (E17-03)
# ============================================================================

SCREEN_CAPTURE_TOOL=""
SCREEN_SESSION_ID=""
SCREEN_INTERVAL=1

detect_screen_capture_tool() {
    if command -v gnome-screenshot &>/dev/null; then
        SCREEN_CAPTURE_TOOL="gnome-screenshot"
    elif command -v scrot &>/dev/null; then
        SCREEN_CAPTURE_TOOL="scrot"
    elif command -v import &>/dev/null; then
        SCREEN_CAPTURE_TOOL="import"  # ImageMagick
    elif command -v grim &>/dev/null; then
        SCREEN_CAPTURE_TOOL="grim"  # Wayland
    else
        SCREEN_CAPTURE_TOOL=""
    fi
}

capture_screenshot() {
    local output_file="/tmp/octofleet-screen-${NODE_ID}.jpg"
    local quality="${1:-50}"
    
    case "$SCREEN_CAPTURE_TOOL" in
        gnome-screenshot)
            gnome-screenshot -f "$output_file" 2>/dev/null
            ;;
        scrot)
            scrot -q "$quality" "$output_file" 2>/dev/null
            ;;
        import)
            import -window root -quality "$quality" "$output_file" 2>/dev/null
            ;;
        grim)
            grim -t jpeg -q "$quality" "$output_file" 2>/dev/null
            ;;
        *)
            return 1
            ;;
    esac
    
    if [[ -f "$output_file" ]]; then
        echo "$output_file"
        return 0
    fi
    return 1
}

check_screen_requests() {
    # Poll for screen capture requests
    local response=$(curl -sS -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/screen/pending/${NODE_ID}" 2>/dev/null)
    
    if [[ -z "$response" ]] || [[ "$response" == "null" ]]; then
        return
    fi
    
    local session_id=$(echo "$response" | jq -r '.sessionId // empty')
    local quality=$(echo "$response" | jq -r '.quality // 50')
    
    if [[ -n "$session_id" ]]; then
        SCREEN_SESSION_ID="$session_id"
        
        # Capture screenshot
        local screenshot=$(capture_screenshot "$quality")
        
        if [[ -n "$screenshot" && -f "$screenshot" ]]; then
            # Upload screenshot
            curl -sS -X POST \
                -H "X-API-Key: $API_KEY" \
                -H "Content-Type: image/jpeg" \
                --data-binary "@$screenshot" \
                "${API_URL}/api/v1/screen/frame/${session_id}" >/dev/null 2>&1
            
            rm -f "$screenshot" 2>/dev/null
        fi
    fi
}

# ============================================================================
# Terminal Support (E20)
# ============================================================================

poll_terminal_commands() {
    local response=$(curl -sS -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/terminal/pending/${NODE_ID}" 2>/dev/null)
    
    if [[ -z "$response" ]] || [[ "$response" == "null" ]]; then
        return
    fi
    
    # Parse commands
    local sessions=$(echo "$response" | jq -r '.commands // [] | .[]' 2>/dev/null)
    
    echo "$response" | jq -c '.commands[]?' 2>/dev/null | while read -r session; do
        local session_id=$(echo "$session" | jq -r '.sessionId')
        local shell=$(echo "$session" | jq -r '.shell // "bash"')
        
        echo "$session" | jq -r '.commands[]?' 2>/dev/null | while read -r cmd; do
            if [[ -n "$cmd" && "$cmd" != "null" ]]; then
                info "Executing terminal command: $cmd"
                
                # Execute command
                local output
                case "$shell" in
                    bash)
                        output=$(bash -c "$cmd" 2>&1)
                        ;;
                    *)
                        output=$(eval "$cmd" 2>&1)
                        ;;
                esac
                
                # Send output back
                curl -sS -X POST \
                    -H "Content-Type: application/json" \
                    -H "X-API-Key: $API_KEY" \
                    -d "$(jq -n --arg o "$output" '{output: $o}')" \
                    "${API_URL}/api/v1/terminal/output/${session_id}" >/dev/null 2>&1
            fi
        done
    done
}

# ============================================================================
# Service Loop
# ============================================================================

run_service() {
    show_banner
    info "Octofleet Linux Agent v$VERSION starting..."
    info "Node ID: $NODE_ID"
    info "API URL: $API_URL"
    info "Push interval: ${PUSH_INTERVAL}s, Job poll: ${JOB_POLL_INTERVAL}s, Live data: ${LIVE_DATA_INTERVAL}s"
    info "Auto-update: ${AUTO_UPDATE} (every ${UPDATE_CHECK_INTERVAL}s from the Octofleet server)"
    
    # Detect screen capture tool
    detect_screen_capture_tool
    if [[ -n "$SCREEN_CAPTURE_TOOL" ]]; then
        info "Screen capture available via: $SCREEN_CAPTURE_TOOL"
    fi
    
    local last_push=0
    local last_poll=0
    local last_live=0
    local last_screen=0
    # First update check two minutes after start, then every UPDATE_CHECK_INTERVAL
    local last_self_update=$(( $(date +%s) - UPDATE_CHECK_INTERVAL + 120 ))
    
    # Start file audit collector
    start_file_audit &
    
    # Initial push
    push_inventory || true
    last_push=$(date +%s)
    
    while true; do
        local now=$(date +%s)
        
        # Push live data (every 5 seconds for real-time dashboard)
        if (( now - last_live >= LIVE_DATA_INTERVAL )); then
            push_live_data
            last_live=$now
        fi
        
        # Push inventory
        if (( now - last_push >= PUSH_INTERVAL )); then
            push_inventory || true
            last_push=$now
        fi
        
        # Poll jobs
        if (( now - last_poll >= JOB_POLL_INTERVAL )); then
            poll_jobs || true
            last_poll=$now
        fi
        
        # Check screen capture requests (every second if tool available)
        if [[ -n "$SCREEN_CAPTURE_TOOL" ]] && (( now - last_screen >= SCREEN_INTERVAL )); then
            check_screen_requests 2>/dev/null || true
            last_screen=$now
        fi
        
        # Poll terminal commands (every iteration for responsiveness)
        poll_terminal_commands 2>/dev/null || true
        
        # Self-update
        if (( now - last_self_update >= UPDATE_CHECK_INTERVAL )); then
            check_for_update || true
            last_self_update=$now
        fi
        
        sleep 1
    done
}

# ============================================================================
# Self-update from the Octofleet server
# ============================================================================

# Checks the server for a newer agent.sh, verifies it and replaces this script.
# Exits after a successful update; systemd (Restart=always) starts the new version.
# Returns 0 when already up to date, 1 when the check failed or an update was rejected.
check_for_update() {
    [[ "$AUTO_UPDATE" == "true" ]] || return 0

    local release latest sha url
    release=$(curl -sf --max-time 15 "${API_URL}/api/v1/agent/releases/linux/latest" 2>/dev/null) || return 1
    latest=$(jq -r '.version // empty' <<< "$release" 2>/dev/null)
    sha=$(jq -r '.sha256 // empty' <<< "$release" 2>/dev/null)
    url=$(jq -r '.download_url // empty' <<< "$release" 2>/dev/null)
    [[ -n "$latest" && -n "$sha" && -n "$url" ]] || return 1

    # Only move forward: the server's version must sort after ours
    [[ "$latest" != "$VERSION" ]] || return 0
    [[ "$(printf '%s\n%s\n' "$VERSION" "$latest" | sort -V | tail -1)" == "$latest" ]] || return 0

    info "Update available: v$VERSION -> v$latest"
    local self="${SCRIPT_DIR}/agent.sh"
    local tmp="${SCRIPT_DIR}/agent.sh.new"
    if ! curl -sf --max-time 120 -o "$tmp" "$url"; then
        warn "Update download failed, keeping v$VERSION"
        rm -f "$tmp"; return 1
    fi
    local actual
    actual=$(sha256sum "$tmp" | cut -d' ' -f1)
    if [[ "${actual,,}" != "${sha,,}" ]]; then
        warn "Update rejected: SHA256 mismatch (expected $sha, got $actual)"
        rm -f "$tmp"; return 1
    fi
    if ! bash -n "$tmp" 2>/dev/null || ! grep -q "^VERSION=\"$latest\"" "$tmp"; then
        warn "Update rejected: downloaded agent.sh is invalid or has the wrong version"
        rm -f "$tmp"; return 1
    fi

    chmod 755 "$tmp"
    mv -f "$tmp" "$self"
    info "Updated to v$latest, restarting"
    exit 0
}

# ============================================================
# E21 Story #88: Linux File Audit Collector (inotifywait)
# ============================================================

FILE_AUDIT_ENABLED="${FILE_AUDIT_ENABLED:-true}"
FILE_AUDIT_PATHS="${FILE_AUDIT_PATHS:-/home /etc /var/log}"
FILE_AUDIT_EXCLUDE="${FILE_AUDIT_EXCLUDE:-\.swp$|\.swx$|~$|\.tmp$|/\.git/|__pycache__|/node_modules/}"
FILE_AUDIT_BATCH_SIZE="${FILE_AUDIT_BATCH_SIZE:-50}"
FILE_AUDIT_FLUSH_INTERVAL="${FILE_AUDIT_FLUSH_INTERVAL:-5}"
FILE_AUDIT_PID=""
declare -a FILE_AUDIT_BUFFER=()

start_file_audit() {
    if [[ "$FILE_AUDIT_ENABLED" != "true" ]]; then
        log "INFO" "File audit disabled"
        return
    fi
    
    if ! command -v inotifywait &>/dev/null; then
        log "WARN" "inotifywait not found. Install inotify-tools for file audit."
        return
    fi
    
    log "INFO" "Starting file audit on: $FILE_AUDIT_PATHS"
    
    # Start inotifywait in background
    inotifywait -m -r \
        --format '%T|%w%f|%e|%Xe' \
        --timefmt '%Y-%m-%dT%H:%M:%S' \
        --exclude "$FILE_AUDIT_EXCLUDE" \
        -e create,delete,modify,moved_from,moved_to,attrib \
        $FILE_AUDIT_PATHS 2>/dev/null | while IFS='|' read -r timestamp filepath events extra; do
        
        # Map inotify events to normalized event types
        local event_type="file.unknown"
        case "$events" in
            *CREATE*)  event_type="file.created" ;;
            *DELETE*)  event_type="file.deleted" ;;
            *MODIFY*)  event_type="file.modified" ;;
            *MOVED_FROM*) event_type="file.renamed" ;;
            *MOVED_TO*)   event_type="file.renamed" ;;
            *ATTRIB*)  event_type="file.permissions_changed" ;;
        esac
        
        # Get file owner info
        local uid="" username="" size="" hash=""
        if [[ -e "$filepath" ]]; then
            uid=$(stat -c '%u' "$filepath" 2>/dev/null || echo "")
            username=$(stat -c '%U' "$filepath" 2>/dev/null || echo "")
            size=$(stat -c '%s' "$filepath" 2>/dev/null || echo "0")
            
            # SHA256 for small files (< 10MB) on create/modify
            if [[ "$event_type" == "file.created" || "$event_type" == "file.modified" ]] && [[ -f "$filepath" ]]; then
                local file_size=$(stat -c '%s' "$filepath" 2>/dev/null || echo "0")
                if (( file_size < 10485760 )); then
                    hash=$(sha256sum "$filepath" 2>/dev/null | awk '{print $1}' || echo "")
                fi
            fi
        fi
        
        # Build JSON event
        local json_event=$(cat <<EOF
{
  "nodeId": "$NODE_ID",
  "eventType": "$event_type",
  "timestamp": "${timestamp}Z",
  "file": {
    "path": "$filepath",
    "size": ${size:-0},
    "hash": "$hash"
  },
  "user": {
    "uid": "$uid",
    "name": "$username"
  },
  "source": "inotify",
  "severity": "info"
}
EOF
)
        # Add to buffer
        FILE_AUDIT_BUFFER+=("$json_event")
        
        # Flush if buffer is full
        if (( ${#FILE_AUDIT_BUFFER[@]} >= FILE_AUDIT_BATCH_SIZE )); then
            flush_file_audit_buffer
        fi
    done &
    FILE_AUDIT_PID=$!
    log "INFO" "File audit started (PID: $FILE_AUDIT_PID)"
    
    # Start periodic flush
    while true; do
        sleep "$FILE_AUDIT_FLUSH_INTERVAL"
        if (( ${#FILE_AUDIT_BUFFER[@]} > 0 )); then
            flush_file_audit_buffer
        fi
    done &
}

flush_file_audit_buffer() {
    local count=${#FILE_AUDIT_BUFFER[@]}
    if (( count == 0 )); then return; fi
    
    # Build events array
    local events_json="["
    local first=true
    for evt in "${FILE_AUDIT_BUFFER[@]}"; do
        if $first; then first=false; else events_json+=","; fi
        events_json+="$evt"
    done
    events_json+="]"
    
    # Clear buffer
    FILE_AUDIT_BUFFER=()
    
    # Submit to backend
    local response
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "${API_URL}/api/v1/ingest/events/normalized" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{\"nodeId\": \"$NODE_ID\", \"events\": $events_json}" 2>/dev/null) || true
    
    local http_code=$(echo "$response" | tail -1)
    if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
        log "INFO" "Flushed $count file audit events"
    else
        log "WARN" "Failed to flush file audit events (HTTP $http_code)"
    fi
}

stop_file_audit() {
    if [[ -n "$FILE_AUDIT_PID" ]]; then
        kill "$FILE_AUDIT_PID" 2>/dev/null || true
        log "INFO" "File audit stopped"
    fi
}

# ============================================================================
# Main
# ============================================================================

case "${1:-service}" in
    push)
        push_inventory
        ;;
    poll)
        poll_jobs
        ;;
    collect)
        collect_full_inventory | jq .
        ;;
    service|run)
        run_service
        ;;
    version)
        echo "Octofleet Linux Agent v$VERSION"
        ;;
    update)
        if AUTO_UPDATE=true check_for_update; then
            echo "Octofleet Linux Agent v$VERSION is up to date"
        else
            echo "Update check failed or update rejected, staying on v$VERSION" >&2
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {push|poll|collect|service|version|update}"
        exit 1
        ;;
esac

