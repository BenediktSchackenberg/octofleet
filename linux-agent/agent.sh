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
# Scheduled inventory push, spread over the interval (#283): see next_push_time and run_service
PUSH_INTERVAL="${PUSH_INTERVAL:-3600}"
# After a failed push (server not reachable yet, e.g. still starting after a reboot) the first retry;
# it doubles with every further failure, up to PUSH_INTERVAL, with random jitter (see next_push_time)
PUSH_RETRY_INTERVAL="${PUSH_RETRY_INTERVAL:-60}"
JOB_POLL_INTERVAL="${JOB_POLL_INTERVAL:-60}"
LIVE_DATA_INTERVAL="${LIVE_DATA_INTERVAL:-5}"
# Terminal commands and screen sessions: asked for about every POLL_IDLE_INTERVAL seconds while nothing
# happens, every second while a session is open and SESSION_ACTIVE_GRACE seconds after (see poll_pace)
POLL_IDLE_INTERVAL="${POLL_IDLE_INTERVAL:-5}"
SESSION_ACTIVE_GRACE="${SESSION_ACTIVE_GRACE:-60}"
# Long-poll (#283): one request the server holds until there is something for this node (a job, a
# terminal command or session, a screen session) instead of the polls above; they then only run every
# LONG_POLL_FALLBACK_INTERVAL s while idle. Servers without the route (404) keep the polls as they are.
LONG_POLL="${LONG_POLL:-true}"
LONG_POLL_SECONDS="${LONG_POLL_SECONDS:-55}"      # hold time asked for; keep below proxy idle limits
LONG_POLL_FALLBACK_INTERVAL="${LONG_POLL_FALLBACK_INTERVAL:-600}"
LONG_POLL_RETRY_INTERVAL="${LONG_POLL_RETRY_INTERVAL:-15}"  # after an error, doubled per failure, jitter
LONG_POLL_RECHECK_INTERVAL="${LONG_POLL_RECHECK_INTERVAL:-3600}"  # asks a server without the route again
# Logs (#330): one file per component in LOG_DIR (Agent.log, Inventory.log, Jobs.log, Updates.log, ...,
# see log); Agent.log also gets the warnings and errors of all components. Every line also goes to
# stdout (the journal under systemd).
LOG_DIR="${LOG_DIR:-/var/log/octofleet-agent}"
# The single log file of agents before #330: moved into LOG_DIR at the service's start (migrate_legacy_log)
LOG_FILE="${LOG_FILE:-/var/log/octofleet-agent.log}"
# Level of all components: debug, info, warn or error. LOG_LEVEL_<COMPONENT> sets one component, e.g.
# LOG_LEVEL_UPDATES=debug. debug also logs e.g. the server's raw answer to a rejected inventory push.
LOG_LEVEL="${LOG_LEVEL:-info}"
# Root-only folder for diagnosis files: the last inventory the server rejected (last-failed-push.json)
# and the output of a collector that produced invalid JSON (invalid-section-<name>.txt). Inside the
# install folder: the service may only write there and to /var/log (ProtectSystem=strict).
DIAG_DIR="${DIAG_DIR:-${SCRIPT_DIR}/diagnostics}"
# A push that keeps failing for the same reason is logged again at most every PUSH_FAIL_LOG_INTERVAL s
PUSH_FAIL_LOG_INTERVAL="${PUSH_FAIL_LOG_INTERVAL:-3600}"
# Where the collectors read meminfo, stat and diskstats (tests point it at fixed files)
PROC_DIR="${PROC_DIR:-/proc}"
# pacman: the copy of the sync databases that the update search refreshes with checkupdates
# (pacman-contrib). The live databases stay as they are: pacman -Sy without -u would leave a partially
# upgraded system. The inventory reads the pending updates from this copy.
PACMAN_CHECK_DB="${PACMAN_CHECK_DB:-${SCRIPT_DIR}/pacman-sync}"
# logrotate for LOG_DIR/*.log (see ensure_logrotate); LOGROTATE_FILE="" turns it off
LOGROTATE_FILE="${LOGROTATE_FILE-/etc/logrotate.d/octofleet-agent}"
LOG_ROTATE_COUNT="${LOG_ROTATE_COUNT:-4}"     # rotated files kept per component
LOG_ROTATE_MAXSIZE="${LOG_ROTATE_MAXSIZE:-2M}"  # rotated earlier than weekly when larger
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

# log LEVEL COMPONENT MESSAGE...: one line "2026-11-15T16:26:04.561+01:00 INFO [Updates] message" to
# stdout and to LOG_DIR/COMPONENT.log; warnings and errors also to Agent.log. LEVEL: DEBUG, INFO, WARN
# or ERROR; it is written when it reaches LOG_LEVEL_<COMPONENT> (default LOG_LEVEL). Components, with
# the Windows agent's names: Agent (start, configuration, long-poll, logrotate), Inventory, Jobs,
# Updates (update search and install, reboot), Remediation (service reconciliation), Security (file
# audit), LiveData, RemoteTools (terminal, screen), SelfUpdate.
# Bash built-ins only, no process per line. Milliseconds need bash 5 (EPOCHREALTIME); older bash
# writes whole seconds.
LOG_WRITTEN_BYTES=0
log() {
    local level="$1" comp="$2" n min var ts t line; shift 2
    case "$level" in DEBUG) n=0 ;; INFO) n=1 ;; WARN) n=2 ;; *) n=3 ;; esac
    var="LOG_LEVEL_${comp^^}"
    case "${!var:-$LOG_LEVEL}" in [Dd]ebug|DEBUG) min=0 ;; [Ww]arn*|WARN*) min=2 ;; [Ee]rror|ERROR) min=3 ;; *) min=1 ;; esac
    (( n >= min )) || return 0
    t=${EPOCHREALTIME:-}
    if [[ -n "$t" ]]; then
        t=${t/[.,]/}  # microseconds since the epoch (the separator follows the locale)
        printf -v ts '%(%Y-%m-%dT%H:%M:%S)T.%s%(%z)T' "${t:0:-6}" "${t: -6:3}" "${t:0:-6}"
    else
        printf -v ts '%(%Y-%m-%dT%H:%M:%S%z)T' -1
    fi
    line="${ts:0:${#ts}-2}:${ts:${#ts}-2} $level [$comp] $*"  # +0100 -> +01:00
    printf '%s\n' "$line"
    [[ -n "$LOG_DIR" ]] || return 0
    { printf '%s\n' "$line" >> "$LOG_DIR/$comp.log"
      (( n < 2 )) || [[ "$comp" == Agent ]] || printf '%s\n' "$line" >> "$LOG_DIR/Agent.log"; } 2>/dev/null
    # logrotate runs once a day: after LOG_ROTATE_MAXSIZE written by this process it runs now, so a
    # file stays below twice that size even with debug on
    LOG_WRITTEN_BYTES=$(( LOG_WRITTEN_BYTES + ${#line} + 1 ))
    if (( LOG_WRITTEN_BYTES >= LOG_MAX_BYTES )); then
        LOG_WRITTEN_BYTES=0
        rotate_logs_now
    fi
    return 0
}

info() { log INFO "$@"; }
warn() { log WARN "$@"; }
error() { log ERROR "$@"; }
debug() { log DEBUG "$@"; }

# LOG_ROTATE_MAXSIZE in bytes (logrotate's notation: 2M, 500k, 1G or bytes)
LOG_MAX_BYTES=${LOG_ROTATE_MAXSIZE//[!0-9]/}
case "$LOG_ROTATE_MAXSIZE" in
    *[kK]) LOG_MAX_BYTES=$(( ${LOG_MAX_BYTES:-0} * 1024 )) ;;
    *[mM]) LOG_MAX_BYTES=$(( ${LOG_MAX_BYTES:-0} * 1048576 )) ;;
    *[gG]) LOG_MAX_BYTES=$(( ${LOG_MAX_BYTES:-0} * 1073741824 )) ;;
esac
(( ${LOG_MAX_BYTES:-0} >= 4096 )) || LOG_MAX_BYTES=2097152

# Runs logrotate on the agent's configuration now (only files above maxsize are rotated). Its own
# state file in LOG_DIR: the service cannot write logrotate's (ProtectSystem=strict).
rotate_logs_now() {
    [[ -n "$LOGROTATE_FILE" && -f "$LOGROTATE_FILE" ]] && command -v logrotate &>/dev/null || return 0
    logrotate -s "$LOG_DIR/.logrotate.status" "$LOGROTATE_FILE" >/dev/null 2>&1 || true
}

# Numbers from awk: older mawk (e.g. 1.3.4 20200120 in Debian 12) prints results above 2^31 as
# "4.29497e+09" and clamps printf "%d" to 2147483647, which breaks bash arithmetic and the JSON. Print them with "%.0f".
# _meminfo_bytes FIELD: a /proc/meminfo value (kB) in bytes, 0 when missing
_meminfo_bytes() {
    awk -v k="$1:" '$1 == k { printf "%.0f", $2 * 1024; found = 1; exit } END { if (!found) printf "0" }' \
        "$PROC_DIR/meminfo" 2>/dev/null || echo 0
}

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

_mounted_filesystems() {
    # Mounted filesystems as a JSON list (source, fstype, target, size, used, avail in bytes).
    # findmnt's JSON keeps sources and mount points with spaces intact (df output would need
    # whitespace splitting). Like df, skip pseudo filesystems (size 0), bind mounts of
    # directories (FSROOT is not the filesystem root; a btrfs subvolume's root is its subvol=)
    # and further mounts of the same filesystem root (e.g. container overlays of / ).
    findmnt -J -l -b --nofsroot -o SOURCE,FSTYPE,SIZE,USED,AVAIL,TARGET,FSROOT,OPTIONS \
            -t notmpfs,nodevtmpfs,nosquashfs,nooverlay,noefivarfs,noramfs 2>/dev/null | jq -c '
        [.filesystems[]? | select(((.size // 0) | tonumber) > 0) |
         select(.fsroot == "/" or .fsroot == ([(.options // "") | match("(?:^|,)subvol=([^,]+)").captures[0].string] | first))] |
        reduce .[] as $v ([]; if any(.[]; .source == $v.source and .fsroot == $v.fsroot) then . else . + [$v] end) |
        [.[] | {source, fstype, target, size: (.size | tonumber), used: ((.used // 0) | tonumber),
                avail: ((.avail // 0) | tonumber)}]' 2>/dev/null || echo '[]'
}

# Used share of a filesystem as df shows it: used / (used + available) - the blocks reserved
# for root count as neither, so a full disk shows 100 % for normal users.
_USED_PERCENT_JQ='(if (.used + .avail) > 0 then (.used / (.used + .avail) * 1000 | round / 10) else 0 end)'

_virt_hypervisor() {
    local virt
    virt=$(systemd-detect-virt 2>/dev/null || echo none)
    case "$virt" in
        microsoft) echo "Hyper-V" ;;
        kvm)       echo "KVM" ;;
        qemu)      echo "QEMU" ;;
        vmware)    echo "VMware" ;;
        oracle)    echo "VirtualBox" ;;
        xen)       echo "Xen" ;;
        amazon)    echo "AWS Nitro" ;;
        none|"")   echo "" ;;
        *)         echo "$virt" ;;
    esac
}

# Readable names for display adapters that have no PCI device, only a DRM driver
_drm_display_name() {
    case "$1" in
        hyperv_drm)       echo "Microsoft Hyper-V Video" ;;
        virtio_gpu|virtio-gpu) echo "Virtio GPU" ;;
        vmwgfx)           echo "VMware SVGA" ;;
        bochs|bochs-drm)  echo "QEMU Standard VGA (Bochs)" ;;
        qxl)              echo "QXL Paravirtual Graphics" ;;
        cirrus|cirrus-qemu) echo "Cirrus Logic VGA (emulated)" ;;
        simpledrm|simplefb|efifb) echo "Firmware framebuffer" ;;
        *)                echo "$1" ;;
    esac
}

collect_hardware() {
    # Hardware inventory in the same structure the Windows agent reports,
    # so the web UI can render it (cpu, ram.modules, disks.physical/volumes,
    # gpu, mainboard, bios, virtualization).

    local hypervisor=$(_virt_hypervisor)

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
    # Maximum clock only when the CPU reports one (lscpu "CPU max MHz"; virtual machines usually
    # have none). The current clock is its own field - on a VM it is often a boost clock.
    local cpu_mhz=$(_lscpu_field "CPU max MHz:")
    cpu_mhz=$(awk '{printf "%d", $1}' <<< "${cpu_mhz:-0}")
    local cpu_cur_mhz=$(awk -F: '/^cpu MHz/ {print $2; exit}' /proc/cpuinfo 2>/dev/null)
    cpu_cur_mhz=$(awk '{printf "%d", $1}' <<< "${cpu_cur_mhz:-0}")
    local l2_kb=$(_size_to_kb "$(_lscpu_field "L2 cache:")")
    local l3_kb=$(_size_to_kb "$(_lscpu_field "L3 cache:")")
    local socket_designation=""
    command -v dmidecode &>/dev/null && socket_designation=$(dmidecode -t 4 2>/dev/null | awk -F': ' '/^\tSocket Designation:/ {print $2; exit}')

    local cpu=$(jq -n \
        --arg name "${cpu_model:-Unknown}" --arg manufacturer "$cpu_vendor" --arg arch "$(uname -m)" \
        --arg socket "$socket_designation" \
        --argjson cores "$cpu_cores" --argjson threads "$cpu_threads" --argjson mhz "$cpu_mhz" \
        --argjson cur_mhz "$cpu_cur_mhz" \
        --argjson l2 "$l2_kb" --argjson l3 "$l3_kb" \
        '{name: $name, manufacturer: $manufacturer, architecture: $arch, cores: $cores,
          logicalProcessors: $threads, threads: $threads,
          maxClockSpeedMHz: (if $mhz > 0 then $mhz else null end),
          currentClockSpeedMHz: (if $cur_mhz > 0 then $cur_mhz else null end),
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
    # Virtual disks report "rotational" whatever is behind them, so no SSD/HDD on a VM
    # (the Windows agent reports none there either).
    local physical=$(lsblk -J -b -d -o NAME,MODEL,VENDOR,SIZE,TYPE,TRAN,ROTA,SERIAL 2>/dev/null | \
        jq -c --argjson virtual "$([[ -n "$hypervisor" ]] && echo true || echo false)" '
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
          mediaType: (if $virtual then null elif .rota then "HDD" else "SSD" end),
          isSsd: (if $virtual then null else (.rota | not) end),
          serialNumber: .serial}]' 2>/dev/null || echo '[]')
    local volumes=$(_mounted_filesystems | jq -c "[.[] | {volumeName: .source, fileSystem: .fstype, driveLetter: .target,
          sizeGB: (.size / 1073741824 * 10 | round / 10), freeGB: (.avail / 1073741824 * 10 | round / 10),
          usedPercent: $_USED_PERCENT_JQ}]" 2>/dev/null || echo '[]')

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
        # Drivers built into the kernel have no version of their own: the kernel release is theirs
        version=$(modinfo -F version "$driver" 2>/dev/null)
        drm=$(jq -c --arg n "$(_drm_display_name "$driver")" --arg d "$driver" --arg r "$resolution" \
            --arg v "${version:-$(uname -r)}" \
            '. + [{name: $n, driverName: $d, driverVersion: $v, currentResolution: $r}]' <<< "$drm")
    done
    if [[ "$(jq 'length' <<< "$gpus")" -eq 0 ]]; then
        gpus="$drm"
    else
        # Add driver/resolution of the first DRM device to the first PCI GPU
        gpus=$(jq -c --argjson drm "$drm" 'if ($drm | length) > 0 then .[0] += ($drm[0] | {driverName, driverVersion, currentResolution}) else . end' <<< "$gpus")
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
                 uuid: $uuid, serialNumber: $serial, smbiosVersion: $bios_version, smbiosSpecVersion: $smbios,
                 isUefi: $is_uefi,
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
        packages=$(dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\n' 2>/dev/null | \
            jq -R -s 'split("\n") | map(select(. != "") | split("\t") |
                {name: .[0], version: .[1], architecture: .[2],
                 sourcePackage: (if .[3] == "" then .[0] else .[3] end),
                 sourceVersion: (if .[4] == "" then .[1] else .[4] end)})' 2>/dev/null || echo '[]')
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
        packages=$(apk --installed query --format json --fields name,version,origin '*' 2>/dev/null | \
            jq '[.[] | {name: .name, version: .version,
                sourcePackage: (.origin // .name), sourceVersion: .version}]' 2>/dev/null || echo '[]')
        if [ "$packages" = "[]" ]; then
            packages=$(apk list --installed 2>/dev/null | \
                jq -R -s 'split("\n") | map(select(. != "") | split(" ")[0] |
                    capture("^(?<name>.+)-(?<version>[0-9][^-]*-r[0-9]+)$") |
                    {name: .name, version: .version})' 2>/dev/null || echo '[]')
        fi
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
    # Rolling releases (Arch, CachyOS) have no VERSION: their BUILD_ID ("rolling")
    [[ -z "$os_version" ]] && os_version=$(grep -oP '(?<=^BUILD_ID=).+' /etc/os-release 2>/dev/null | tr -d '"')
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
    # Users with a login shell (a shell listed in /etc/shells, not nologin/false)
    local users
    users=$(awk -F: 'NR==FNR { if ($0 ~ /^\//) shells[$0] = 1; next }
                     ($7 in shells) && $7 !~ /(nologin|false)$/ { print $1 }' /etc/shells <(getent passwd 2>/dev/null) 2>/dev/null \
        | jq -R -s 'split("\n") | map(select(. != ""))' 2>/dev/null)
    echo "$users" | jq -e 'type == "array"' &>/dev/null || users="[]"

    # Administrators: members of the sudo/admin/wheel groups and users with their own sudoers entry
    local sudo_users
    sudo_users=$( {
        for group in sudo admin wheel; do
            getent group "$group" 2>/dev/null | awk -F: '{ print $4 }' | tr ',' '\n'
        done
        cat /etc/sudoers /etc/sudoers.d/* 2>/dev/null \
            | awk '$1 !~ /^(#|%|Defaults|[A-Z_]+_Alias)/ && NF > 1 && $2 ~ /=/ { print $1 }'
    } | grep -v '^$' | sort -u | jq -R -s 'split("\n") | map(select(. != ""))' 2>/dev/null)
    echo "$sudo_users" | jq -e 'type == "array"' &>/dev/null || sudo_users="[]"

    # SSH: the effective configuration (includes sshd_config.d and the defaults)
    local ssh_port="" ssh_root="" ssh_password="" sshd_bin
    sshd_bin=$(command -v sshd || echo /usr/sbin/sshd)
    if [[ -x "$sshd_bin" ]]; then
        local effective
        effective=$("$sshd_bin" -T 2>/dev/null)
        ssh_port=$(awk '$1 == "port" { print $2; exit }' <<< "$effective")
        ssh_root=$(awk '$1 == "permitrootlogin" { print $2; exit }' <<< "$effective")
        ssh_password=$(awk '$1 == "passwordauthentication" { print $2; exit }' <<< "$effective")
    fi

    # Firewall: active / inactive per tool
    local firewall_status="inactive"
    local firewall_type="none"
    if command -v ufw &>/dev/null; then
        firewall_type="ufw"
        ufw status 2>/dev/null | grep -q '^Status: active' && firewall_status="active"
    fi
    if [[ "$firewall_status" != "active" ]] && command -v firewall-cmd &>/dev/null; then
        if firewall-cmd --state 2>/dev/null | grep -q '^running'; then
            firewall_type="firewalld"; firewall_status="active"
        elif [[ "$firewall_type" == "none" ]]; then
            firewall_type="firewalld"
        fi
    fi
    # Rules on incoming traffic (INPUT chain or an nftables input hook) - not Docker's NAT/forward chains
    if [[ "$firewall_status" != "active" ]] && command -v iptables &>/dev/null \
        && iptables -S INPUT 2>/dev/null | grep -qE '^-A INPUT|^-P INPUT (DROP|REJECT)'; then
        firewall_type="iptables"; firewall_status="active"
    elif [[ "$firewall_status" != "active" ]] && command -v nft &>/dev/null \
        && nft list ruleset 2>/dev/null | awk '/hook input/ { inside = 1; if (/policy drop/) found = 1; next }
                                               inside && /^[[:space:]]*}/ { inside = 0 }
                                               inside && NF { found = 1 }
                                               END { exit !found }'; then
        firewall_type="nftables"; firewall_status="active"
    fi
    if [[ "$firewall_type" == "none" ]]; then
        firewall_status="unknown"
    fi

    # SELinux/AppArmor
    local mac_status="none"
    if command -v getenforce &>/dev/null; then
        mac_status="selinux:$(getenforce 2>/dev/null || echo 'unknown')"
    elif [[ -d /sys/kernel/security/apparmor ]]; then
        mac_status="apparmor:enabled"
    fi

    jq -n --argjson loginUsers "$users" --argjson sudoUsers "$sudo_users" \
        --arg port "$ssh_port" --arg root "$ssh_root" --arg password "$ssh_password" \
        --arg fwType "$firewall_type" --arg fwStatus "$firewall_status" --arg mac "$mac_status" \
        '{loginUsers: $loginUsers, sudoUsers: $sudoUsers,
          ssh: {port: $port, permitRootLogin: $root, passwordAuthentication: $password},
          firewall: {type: $fwType, status: $fwStatus},
          mandatoryAccessControl: $mac}'
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
    if [[ -f "$PROC_DIR/stat" ]]; then
        cpu_cores=$(grep '^cpu[0-9]' "$PROC_DIR/stat" 2>/dev/null | awk '
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
    local mem_total=$(_meminfo_bytes MemTotal)
    local mem_free=$(_meminfo_bytes MemFree)
    local mem_available=$(_meminfo_bytes MemAvailable)
    local mem_buffers=$(_meminfo_bytes Buffers)
    local mem_cached=$(_meminfo_bytes Cached)
    local swap_total=$(_meminfo_bytes SwapTotal)
    local swap_free=$(_meminfo_bytes SwapFree)
    local swap_used=$((swap_total - swap_free))
    
    # Disk I/O (from /proc/diskstats)
    local disk_io="[]"
    if [[ -f "$PROC_DIR/diskstats" ]]; then
        disk_io=$(awk '
            BEGIN { first = 1 }
            $3 ~ /^(sd[a-z]|nvme[0-9]+n[0-9]+|vd[a-z])$/ {
                name = $3
                reads = $4
                read_sectors = $6
                writes = $8
                write_sectors = $10
                read_bytes = read_sectors * 512
                write_bytes = write_sectors * 512
                printf "%s{\"device\": \"%s\", \"readsCompleted\": %.0f, \"writesCompleted\": %.0f, \"readBytes\": %.0f, \"writeBytes\": %.0f}",
                    (first ? "" : ","), name, reads, writes, read_bytes, write_bytes
                first = 0
            }
        ' "$PROC_DIR/diskstats" 2>/dev/null | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
    fi
    
    # Disk space per mount
    local disk_space=$(_mounted_filesystems | jq -c "[.[] | {mount: .target, device: .source, totalBytes: .size,
          usedBytes: .used, availableBytes: .avail, usedPercent: $_USED_PERCENT_JQ}]" 2>/dev/null || echo '[]')
    
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
    local security_source=null
    local phased_updates=0
    
    if command -v apt-get &>/dev/null; then
        package_manager="apt"
        
        # Get upgradable packages (force English output, skip header line)
        # Line format: "name/suite[,suite...] new-version arch [upgradable from: old-version]"
        updates=$(LANG=C apt list --upgradable 2>/dev/null | grep -v "^Listing" | \
            awk '
                BEGIN { first = 1 }
                $1 ~ /\// {
                    split($1, pkg, "/")
                    security = (pkg[2] ~ /-security/) ? "true" : "false"
                    installed = ""
                    if ($(NF - 1) == "from:") { installed = $NF; sub(/\]$/, "", installed) }
                    printf "%s{\"name\": \"%s\", \"newVersion\": \"%s\", \"repository\": \"%s\", \"security\": %s, \"arch\": \"%s\", \"installedVersion\": %s}",
                        (first ? "" : ","), pkg[1], $2, pkg[2], security, $3,
                        (installed == "" ? "null" : "\"" installed "\"")
                    first = 0
                }
            ' | awk 'BEGIN{printf "["} {printf "%s", $0} END{print "]"}' || echo '[]')
        
        # Updates Ubuntu phases in and apt holds back on this machine for now: marked, so the console
        # neither counts them as installable nor offers them again and again
        local phased
        phased=$(apt_phased_updates)
        if [[ "$phased" != "{}" ]]; then
            updates=$(jq -c --argjson p "$phased" \
                'map(.name as $n | if ($p | has($n)) then . + {phased: true, phasedPercent: $p[$n]} else . end)' <<< "$updates" 2>/dev/null || echo "$updates")
        fi
        phased_updates=$(echo "$updates" | jq '[.[] | select(.phased == true)] | length' 2>/dev/null || echo 0)
        total_updates=$(echo "$updates" | jq 'length' 2>/dev/null || echo 0)
        security_updates=$(echo "$updates" | jq '[.[] | select(.security)] | length' 2>/dev/null || echo 0)
        
    elif command -v dnf &>/dev/null || command -v yum &>/dev/null; then
        # dnf needs its cache and lock file even to read: through run_package_command, outside
        # the service's sandbox (inside it check-update failed and the node reported 0 updates)
        command -v dnf &>/dev/null && package_manager="dnf" || package_manager="yum"
        updates=$(dnf_updates "$package_manager")
        total_updates=$(echo "$updates" | jq 'length' 2>/dev/null || echo 0)
        security_updates=$(echo "$updates" | jq '[.[] | select(.security)] | length' 2>/dev/null || echo 0)
        
    elif command -v pacman &>/dev/null; then
        package_manager="pacman"
        updates=$(pacman_updates)
        total_updates=$(echo "$updates" | jq 'length' 2>/dev/null || echo 0)
        security_updates=$(echo "$updates" | jq '[.[] | select(.security)] | length' 2>/dev/null || echo 0)
        # pacman has no security data; arch-audit (Arch's advisories) gives an approximation
        command -v arch-audit &>/dev/null && security_source='"arch-audit"'
    fi
    
    # Last update check time
    local last_update_check=""
    if [[ -f /var/lib/apt/periodic/update-stamp ]]; then
        last_update_check=$(date -r /var/lib/apt/periodic/update-stamp -Iseconds 2>/dev/null || echo "")
    elif [[ -f /var/cache/dnf/last_makecache ]]; then
        last_update_check=$(date -r /var/cache/dnf/last_makecache -Iseconds 2>/dev/null || echo "")
    fi
    
    # Reboot required after updates: Debian/Ubuntu mark it with /var/run/reboot-required (and the
    # packages in reboot-required.pkgs); dnf/yum systems answer through needs-restarting -r (exit 1)
    local reboot_required=null reboot_packages="[]"
    if [[ -e /var/run/reboot-required ]]; then
        reboot_required=true
        [[ -r /var/run/reboot-required.pkgs ]] && \
            reboot_packages=$(sort -u /var/run/reboot-required.pkgs | jq -Rsc 'split("\n") | map(select(length > 0))' 2>/dev/null || echo '[]')
    elif [[ "$package_manager" == "apt" ]]; then
        reboot_required=false
    elif [[ "$package_manager" == "dnf" || "$package_manager" == "yum" ]]; then
        reboot_required=$(dnf_reboot_required)
    elif [[ "$package_manager" == "pacman" ]]; then
        reboot_required=$(pacman_reboot_required)
    fi

    cat << EOF
{
    "packageManager": "$package_manager",
    "totalUpdates": $total_updates,
    "securityUpdates": $security_updates,
    "phasedUpdates": $phased_updates,
    "lastCheckTime": "$last_update_check",
    "rebootRequired": $reboot_required,
    "rebootPackages": $reboot_packages,
    "securitySource": $security_source,
    "release": $(os_release_json),
    "scan": ${PATCH_SCAN_JSON:-null},
    "updates": $updates
}
EOF
}

# apt_phased_updates: the pending updates apt holds back on this machine because Ubuntu releases them
# to a share of machines at a time ("deferred due to phasing" in a dry run of "apt-get upgrade"), as
# {"name": percent} - percent is the share already getting it ("phased 10%" in apt-cache policy), or
# null when apt does not say. {} when none. A dry run reads the local package lists: no download,
# no lock, about 0.6 s. apt installs such an update by itself once this machine's turn comes.
apt_phased_updates() {
    local names n pct json='{}'
    names=$(LANG=C apt-get -s -q upgrade 2>/dev/null | \
        awk '/deferred due to phasing:/ { f = 1; next } f && /^ / { print; next } f { exit }' | tr -s ' ' '\n' | sed 's/:.*$//' | grep -v '^$' | sort -u)
    [[ -z "$names" ]] && { echo '{}'; return 0; }
    while IFS= read -r n; do
        pct=$(LANG=C apt-cache policy "$n" 2>/dev/null | sed -n 's/.*(phased \([0-9][0-9]*\)%).*/\1/p' | head -1)
        json=$(jq -c --arg n "$n" --arg p "$pct" '. + {($n): (if $p == "" then null else ($p | tonumber) end)}' <<< "$json" 2>/dev/null || echo "$json")
    done <<< "$names"
    echo "$json"
}

# os_release_json: the distribution release from /etc/os-release as {id, versionId, idLike, name},
# or null. The server keys "first seen" of package versions by it (#271). The file is parsed,
# never sourced.
os_release_json() {
    local file="${OS_RELEASE_FILE:-/etc/os-release}"
    [[ -r "$file" ]] || { echo null; return; }
    jq -cRn '[inputs | capture("^(?<k>[A-Z_]+)=(?<v>.*)$")
             | {key: .k, value: (.v | if test("^([\"\\x27]).*\\1$") then .[1:-1] else . end)}]
            | from_entries
            | {id: (.ID // null), versionId: (.VERSION_ID // null), idLike: (.ID_LIKE // null),
               name: (.NAME // null), buildId: (.BUILD_ID // null)}' < "$file" 2>/dev/null || echo null
}

# pacman_updates: the available updates of pacman as a JSON array of {name, newVersion,
# installedVersion, repository, arch, security}. "pacman -Qu" prints "name old -> new"; one
# "pacman -Si" for all names adds repository and architecture (the entry with the new version,
# when several repositories have the package). Both read the copy of the sync databases that the
# update search refreshes (PACMAN_CHECK_DB, checkupdates) when there is one - the live databases
# change only with "pacman -Syu", so they never show anything new. The security flag comes from
# arch-audit when it is installed: packages with a fixed Arch advisory (approximate on
# derivatives such as CachyOS, which build their own packages); pacman itself has no security data.
pacman_updates() {
    local updates info audit="" db=()
    [[ -n "${PACMAN_CHECK_DB:-}" && -d "$PACMAN_CHECK_DB/sync" ]] && db=(--dbpath "$PACMAN_CHECK_DB")
    updates=$(LC_ALL=C pacman -Qu "${db[@]}" 2>/dev/null | awk 'NF >= 4 && $3 == "->" { printf "%s\t%s\t%s\n", $1, $2, $4 }')
    [[ -z "$updates" ]] && { echo '[]'; return; }
    info=$(LC_ALL=C pacman -Si "${db[@]}" $(awk -F'\t' '{ print $1 }' <<< "$updates") 2>/dev/null | awk '
        /^Repository / { r = $3 } /^Name / { n = $3 } /^Version / { v = $3 }
        /^Architecture / { printf "%s\t%s\t%s\t%s\n", n, v, r, $3 }')
    # arch-audit needs -q twice to omit versions; the lookup below matches package names only.
    command -v arch-audit &>/dev/null && audit=$(timeout 60 arch-audit --upgradable --quiet --quiet 2>/dev/null)
    jq -Rn --arg info "$info" --arg audit "$audit" '
        ($info | split("\n") | map(select(length > 0) | split("\t"))) as $info
        | ($audit | split("\n") | map(select(length > 0) | {key: ., value: true}) | from_entries) as $sec
        | [inputs | select(length > 0) | split("\t") | . as $u
           | ([$info[] | select(.[0] == $u[0] and .[1] == $u[2])] + [$info[] | select(.[0] == $u[0])])[0] as $i
           | {name: $u[0], newVersion: $u[2], installedVersion: $u[1], repository: ($i[2] // null),
              arch: ($i[3] // null), security: ($sec[$u[0]] // false)}]' <<< "$updates" 2>/dev/null || echo '[]'
}

# pacman_reboot_required: "true" when the running kernel's modules are gone (a kernel update
# replaced /usr/lib/modules/<version> - new modules cannot be loaded until a reboot), else "false"
pacman_reboot_required() {
    [[ -d "${MODULES_DIR:-/usr/lib/modules}/$(uname -r)" ]] && echo false || echo true
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
    if [[ -f "$PROC_DIR/stat" ]]; then
        local cpu1=$(head -1 "$PROC_DIR/stat")
        sleep 0.5
        local cpu2=$(head -1 "$PROC_DIR/stat")
        
        local idle1=$(echo "$cpu1" | awk '{print $5}')
        local total1=$(echo "$cpu1" | awk '{sum=0; for(i=2;i<=NF;i++) sum+=$i; printf "%.0f", sum}')
        local idle2=$(echo "$cpu2" | awk '{print $5}')
        local total2=$(echo "$cpu2" | awk '{sum=0; for(i=2;i<=NF;i++) sum+=$i; printf "%.0f", sum}')
        
        local idle_diff=$((idle2 - idle1))
        local total_diff=$((total2 - total1))
        
        if [[ $total_diff -gt 0 ]]; then
            cpu_percent=$(awk -v i="$idle_diff" -v t="$total_diff" 'BEGIN {printf "%.1f", 100 * (t - i) / t}')
        fi
    fi
    
    # Memory
    local mem_total=$(awk '$1 == "MemTotal:" {print $2}' "$PROC_DIR/meminfo" 2>/dev/null)
    local mem_available=$(awk '$1 == "MemAvailable:" {print $2}' "$PROC_DIR/meminfo" 2>/dev/null)
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
    elif [[ -f "$LOG_DIR/Agent.log" ]]; then
        logs=$(tail -20 "$LOG_DIR/Agent.log" 2>/dev/null | \
            jq -R -s 'split("\n") | map(select(. != "") | {
                timestamp: ((capture("^(?<ts>[^ ]+) ") | .ts) // ""),
                level: ((capture("^[^ ]+ (?<lvl>DEBUG|INFO|WARN|ERROR) ") | .lvl) // "INFO"),
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
    refresh_logged_on_users
    
    local payload=$(cat << EOF
{
    "nodeId": "$NODE_ID",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "metrics": $metrics,
    "processes": $processes,
    "network": $network,
    "agentLogs": $logs,
    "loggedOnUsers": $LOGGED_ON_USERS
}
EOF
)
    
    curl -sS -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$payload" \
        "${API_URL}/api/v1/live-data" >/dev/null 2>&1 || debug LiveData "Live data push failed (curl exit $?)"
}

# ============================================================================
# Full Inventory
# ============================================================================

# Inventory sections in push order: JSON key and collector
INVENTORY_SECTIONS=(hardware:collect_hardware software:collect_software system:collect_system
    network:collect_network security:collect_security performance:collect_performance
    services:collect_services updates:collect_updates diskHealth:collect_disk_health)

# _save_diag NAME: stdin to a root-only file in DIAG_DIR (folder mode 700, file mode 600); prints its path
_save_diag() {
    local file="$DIAG_DIR/$1"
    (umask 077; mkdir -p "$DIAG_DIR" && chmod 700 "$DIAG_DIR" && cat > "$file" && chmod 600 "$file") 2>/dev/null \
        && echo "$file"
}

# The full inventory as one JSON object. Every section is checked with jq first: a collector that
# produced invalid JSON (e.g. an empty number) is left out with a warning and its output saved, so
# the rest of the inventory still arrives - the server keeps a missing section's last value.
# Warnings go to stderr, stdout is the JSON.
collect_full_inventory() {
    local entry key value file body="" left_out=0
    for entry in "${INVENTORY_SECTIONS[@]}"; do
        key=${entry%%:*}
        value=$("${entry#*:}")
        if jq -e 'type == "object"' >/dev/null 2>&1 <<< "$value"; then
            body+=$',\n    "'"$key"'": '"$value"
        else
            left_out=1
            file=$(_save_diag "invalid-section-$key.txt" <<< "$value")
            warn Inventory "Inventory section \"$key\" left out: its collector produced invalid JSON${file:+ (saved to $file)}" >&2
        fi
    done
    (( left_out )) || rm -f "$DIAG_DIR"/invalid-section-*.txt 2>/dev/null

    printf '{\n    "nodeId": %s,\n    "hostname": %s,\n    "agentVersion": %s,\n    "collectedAt": %s%s\n}\n' \
        "$(jq -n --arg v "$NODE_ID" '$v')" "$(jq -n --arg v "$(hostname)" '$v')" \
        "$(jq -n --arg v "$VERSION" '$v')" "$(jq -n --arg v "$(date -Iseconds)" '$v')" "$body"
}

# ============================================================================
# API Functions
# ============================================================================

# Failed inventory pushes in a row (see push_inventory): reason, count, first failure, last log line
PUSH_FAIL_REASON="" PUSH_FAIL_COUNT=0 PUSH_FAIL_SINCE=0 PUSH_FAIL_LOGGED=0

# push_failure_reason HTTP_CODE BODY PAYLOAD_FILE: one readable sentence for a failed push
push_failure_reason() {
    local code="$1" body="$2" payload="$3" detail pos context
    case "$code" in
        000) echo "server not reachable ($(head -c 200 <<< "$body" | tr '\n' ' ' | sed 's/^curl: ([0-9]*) //; s/ *$//'))"; return ;;
        401|403) echo "the server refused the agent key (HTTP $code)"; return ;;
        5??) echo "server error (HTTP $code)"; return ;;
    esac
    # FastAPI 422: {"detail": [{"type": "json_invalid", "loc": ["body", 150206], "msg": "..."}]}
    detail=$(jq -r '(.detail | if type == "array" then .[0] else {msg: tostring} end) as $d
                    | [$d.type // "", ($d.loc // [] | map(tostring) | join(".")), $d.msg // ""] | @tsv' \
             <<< "$body" 2>/dev/null)
    if [[ "$detail" == json_invalid$'\t'* ]]; then
        pos=$(cut -f2 <<< "$detail"); pos=${pos##*.}
        if [[ "$pos" =~ ^[0-9]+$ && -f "$payload" ]]; then
            context=$(head -c "$pos" "$payload" | tail -c 40 | tr '\n\t' '  ' | tr -s ' ')
            echo "the server could not read it, invalid JSON at character $pos (after \"$context\")"
        else
            echo "the server could not read it, invalid JSON (HTTP $code)"
        fi
    elif [[ -n "$(cut -f3 <<< "$detail")" ]]; then
        local field=$(cut -f2 <<< "$detail")
        echo "rejected by the server (HTTP $code): $(cut -f3 <<< "$detail" | head -c 200)${field:+ (field $field)}"
    else
        echo "rejected by the server (HTTP $code)"
    fi
}

# log_push_failure REASON [SAVED_FILE]: logs a failed push once, then for the same reason at most every
# PUSH_FAIL_LOG_INTERVAL seconds ("still failing, n times since ..."); a new reason is logged right away
log_push_failure() {
    local reason="$1" saved="${2:-}" now
    now=$(date +%s)
    (( PUSH_FAIL_COUNT == 0 )) && PUSH_FAIL_SINCE=$now
    PUSH_FAIL_COUNT=$(( PUSH_FAIL_COUNT + 1 ))
    if [[ "$reason" != "$PUSH_FAIL_REASON" ]]; then
        PUSH_FAIL_REASON="$reason" PUSH_FAIL_LOGGED=$now
        error Inventory "Inventory push failed: $reason.${saved:+ The inventory is saved in $saved.}"
    elif (( now - PUSH_FAIL_LOGGED >= PUSH_FAIL_LOG_INTERVAL )); then
        PUSH_FAIL_LOGGED=$now
        error Inventory "Inventory push still failing ($PUSH_FAIL_COUNT times since $(date -d "@$PUSH_FAIL_SINCE" '+%Y-%m-%d %H:%M')): $reason."
    fi
}

push_inventory() {
    info Inventory "Collecting inventory..."
    local tmp_file=$(mktemp) saved=""
    collect_full_inventory > "$tmp_file"

    # Never send a document the server cannot parse: that would lose the whole inventory
    if ! jq -e 'type == "object"' "$tmp_file" >/dev/null 2>&1; then
        saved=$(_save_diag last-failed-push.json < "$tmp_file")
        rm -f "$tmp_file"
        log_push_failure "the collected inventory is not valid JSON, so it was not sent" "$saved"
        return 1
    fi

    info Inventory "Pushing inventory to $API_URL..."
    local response=$(curl -sS -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d @"$tmp_file" \
        "${API_URL}/api/v1/inventory/full" 2>&1)

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')

    if [[ "$http_code" == "200" ]]; then
        rm -f "$tmp_file" "$DIAG_DIR/last-failed-push.json" 2>/dev/null
        if (( PUSH_FAIL_COUNT > 0 )); then
            info Inventory "Inventory pushed successfully again, after $PUSH_FAIL_COUNT failed attempt(s) since $(date -d "@$PUSH_FAIL_SINCE" '+%Y-%m-%d %H:%M')"
            PUSH_FAIL_REASON="" PUSH_FAIL_COUNT=0
        else
            info Inventory "Inventory pushed successfully"
        fi
        return 0
    fi
    [[ "$http_code" =~ ^[0-9]{3}$ ]] || http_code=000
    local reason=$(push_failure_reason "$http_code" "$body" "$tmp_file")
    # Rejected by the server: keep what was sent for diagnosis (not when the server was not reachable)
    [[ "$http_code" != 000 ]] && saved=$(_save_diag last-failed-push.json < "$tmp_file")
    rm -f "$tmp_file"
    debug Inventory "Inventory push: HTTP $http_code, server answer: $(head -c 2000 <<< "$body")"
    log_push_failure "$reason" "$saved"
    return 1
}

poll_jobs() {
    local response=$(curl -sS -w "\n%{http_code}" \
        -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/jobs/pending/${NODE_ID}" 2>&1)
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" != "200" ]]; then
        warn Jobs "Job poll failed: HTTP $http_code"
        return 1
    fi
    
    local jobs=$(echo "$body" | jq -r '.jobs // []')
    local job_count=$(echo "$jobs" | jq 'length')
    
    if [[ "$job_count" -gt 0 ]]; then
        info Jobs "Found $job_count pending jobs"
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
    
    info Remediation "Installing package: $pkg (distro: $distro)"
    
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
        "${API_URL}/api/v1/services/${service_id}/nodes/${NODE_ID}/status" >/dev/null 2>&1 || warn Remediation "Failed to report service status"
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
        printf 'rm -f -- %q %q.*\n' "$LOG_FILE" "$LOG_FILE"
        [[ "$LOG_DIR" == /?*/?* ]] && printf 'rm -rf -- %q\n' "$LOG_DIR"
        [[ -n "$LOGROTATE_FILE" ]] && printf 'grep -qF %q %q 2>/dev/null && rm -f -- %q || true\n' \
            "$LOGROTATE_MARKER" "$LOGROTATE_FILE" "$LOGROTATE_FILE"
        printf 'test ! -e %q\n' "$SCRIPT_DIR"
        printf 'curl -fsS --max-time 15 -X POST -H %q -H %q --data-binary %q %q >/dev/null\n' \
            'Content-Type: application/json' "X-API-Key: $API_KEY" "$payload" "$url"
    } > "$script"
    if [[ "$(systemd_mode)" != none ]] && sd_run --quiet --collect \
            --unit "octofleet-agent-uninstall-$(date +%s)" /bin/bash "$script"; then
        echo "Agent uninstall started; the agent will be removed in ${delay} seconds."
        return 0
    fi
    # Without systemd (e.g. a container): nothing outlives a service stop, so run directly
    setsid nohup /bin/bash "$script" >/dev/null 2>&1 &
    echo "Agent uninstall started without systemd-run; the agent will be removed in ${delay} seconds."
}

schedule_restart() {
    # A transient timer runs outside this service, after the job result has been sent.
    if [[ "$(systemd_mode)" == none ]] || ! systemctl cat octofleet-agent.service &>/dev/null; then
        echo "Cannot schedule agent restart: the systemd service is unavailable"
        return 1
    fi
    sd_run --quiet --collect --on-active=30s \
        --unit "octofleet-agent-restart-$(date +%s)-$$" \
        /bin/systemctl restart octofleet-agent.service || return 1
    echo "Agent restart scheduled in 30 seconds"
}

# --- Package updates: patch_scan and patch_install jobs ---
# (no "# ===" section line here: the job tests load everything from schedule_restart to the next one)

# The package manager used for updates: apt, dnf, yum or pacman
# --- systemd helpers (tests load this block) ---
# The service runs sandboxed (ProtectSystem=strict), so system changes (package installs, the reboot
# timer, /etc/logrotate.d, restarting itself) run as transient units through systemd-run. Minimal
# systems (stripped-down vendor and cloud images) have no dbus daemon. As root, systemd-run still starts units
# over systemd's private socket, but --wait fails there ("Failed to connect to bus" on systemd 249):
# it needs the bus to follow the unit. sd_run_wait then polls the unit with systemctl instead.
DBUS_SYSTEM_SOCKET="${DBUS_SYSTEM_SOCKET:-/run/dbus/system_bus_socket}"
SYSTEMD_PRIVATE_SOCKET="${SYSTEMD_PRIVATE_SOCKET:-/run/systemd/private}"

# systemd_mode: "bus" (the D-Bus system bus, or no way to tell), "private" (no system bus, but
# systemd's private socket), "none" (no systemd-run)
systemd_mode() {
    if ! command -v systemd-run &>/dev/null; then
        echo none
    elif [[ -z "${DBUS_SYSTEM_BUS_ADDRESS:-}" && ! -S "$DBUS_SYSTEM_SOCKET" && -S "$SYSTEMD_PRIVATE_SOCKET" ]]; then
        echo private
    else
        echo bus
    fi
}

SYSTEMD_UNREACHABLE="systemd is not reachable: this system has no D-Bus system bus (the dbus service is not installed or not running) and systemd's own socket ($SYSTEMD_PRIVATE_SOCKET) cannot be used either. Install and start dbus (e.g. apt-get install dbus; systemctl enable --now dbus) and run the job again."

# sd_run ARGS...: systemd-run ARGS, over systemd's private socket when there is no system bus.
# A failure to reach systemd at all is explained in one sentence on stdout.
sd_run() {
    local err rc=0
    if [[ "$(systemd_mode)" == private ]]; then
        err=$(DBUS_SYSTEM_BUS_ADDRESS="unix:path=$SYSTEMD_PRIVATE_SOCKET" systemd-run "$@" 2>&1 >/dev/null) || rc=$?
    else
        err=$(systemd-run "$@" 2>&1 >/dev/null) || rc=$?
    fi
    if (( rc != 0 )); then
        if [[ "$err" == *"Failed to connect to bus"* || "$err" == *"Transport endpoint is not connected"* ]]; then
            echo "$SYSTEMD_UNREACHABLE"
        elif [[ -n "$err" ]]; then
            echo "$err"
        fi
    fi
    return "$rc"
}

# sd_run_wait UNIT [systemd-run options...] COMMAND...: runs COMMAND as transient unit UNIT and waits
# for it, like systemd-run --wait --collect; returns COMMAND's exit code. Without a system bus the
# unit keeps its state after exit (RemainAfterExit) and is polled every second, then removed.
sd_run_wait() {
    local unit="$1"; shift
    if [[ "$(systemd_mode)" != private ]]; then
        local rc=0
        systemd-run --quiet --wait --collect --unit "$unit" "$@" || rc=$?
        return "$rc"
    fi
    sd_run --quiet --unit "$unit" -p RemainAfterExit=yes "$@" || return 1
    local state sub status result key value
    while :; do
        state="" sub="" status=0 result=""
        while IFS='=' read -r key value; do
            case "$key" in
                ActiveState) state="$value" ;;
                SubState) sub="$value" ;;
                ExecMainStatus) status="$value" ;;
                Result) result="$value" ;;
            esac
        done < <(systemctl show -p ActiveState -p SubState -p ExecMainStatus -p Result "$unit.service" 2>/dev/null)
        [[ "$state" == activating || ( "$state" == active && "$sub" != exited ) ]] || break
        sleep "${SD_POLL_SECONDS:-1}"
    done
    systemctl stop "$unit.service" &>/dev/null
    systemctl reset-failed "$unit.service" &>/dev/null
    [[ "$status" =~ ^[0-9]+$ ]] || status=1
    (( status == 0 )) && [[ -n "$result" && "$result" != success ]] && status=1
    return "$status"
}
# --- end systemd helpers ---

package_manager() {
    if command -v apt-get &>/dev/null; then echo apt
    elif command -v dnf &>/dev/null; then echo dnf
    elif command -v yum &>/dev/null; then echo yum
    elif command -v pacman &>/dev/null; then echo pacman
    else return 1
    fi
}

# run_package_command LIMIT COMMAND...: run the package manager, stopped after LIMIT seconds (exit 124).
# The agent's service runs with ProtectSystem=strict: /usr, /etc and /var/lib are read-only for it,
# so apt and dnf cannot write their lists or install anything - dnf cannot even read without its
# lock file in /var/cache/dnf. Under systemd (INVOCATION_ID) the command therefore runs in a
# transient unit outside that sandbox, like the restart-agent job; otherwise directly.
# The unit writes its output to a file under /var/log (writable for the service) instead of
# --pipe: with --pipe, systemd 252 (RHEL 9 and derivatives) refused to start the unit from the
# service ("Connection reset by peer"). StandardOutput=file: and StandardError=inherit work from
# systemd 236 on. --wait passes the command's exit code on.
# LC_ALL=C: the agent parses the output (English, whatever the system language).
# NEEDRESTART_MODE=l: needrestart lists services with old libraries instead of restarting them
# (the agent too, in the middle of the job).
run_package_command() {
    local limit="$1"; shift
    if [[ -n "${INVOCATION_ID:-}" && "$(systemd_mode)" != none ]]; then
        local out rc=0
        out=$(mktemp "${PACKAGE_OUTPUT_DIR:-/var/log}/octofleet-packages.XXXXXX") || return 1
        sd_run_wait "octofleet-packages-$(date +%s)-$$" \
            -p "StandardOutput=file:$out" -p StandardError=inherit \
            --setenv=LC_ALL=C --setenv=LANG=C --setenv=DEBIAN_FRONTEND=noninteractive --setenv=NEEDRESTART_MODE=l \
            timeout "$limit" "$@" || rc=$?
        cat "$out" 2>/dev/null
        rm -f "$out"
        return "$rc"
    else
        LC_ALL=C LANG=C DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l timeout "$limit" "$@"
    fi
}

# dnf_reboot_required: "true", "false" or "null" (unknown) for dnf/yum systems. needs-restarting
# comes with yum-utils, which a minimal install lacks; dnf's own plugin (dnf-plugins-core) has
# the same check. Without either: unknown - "dnf needs-restarting" fails without the plugin too,
# and that must not look like a pending reboot. Through run_package_command: dnf needs its cache.
dnf_reboot_required() {
    local rc=0
    if command -v needs-restarting &>/dev/null; then
        run_package_command 120 needs-restarting -r >/dev/null 2>&1 || rc=$?
    elif command -v dnf &>/dev/null && compgen -G "${DNF_PLUGIN_DIR:-/usr/lib/python3*/site-packages/dnf-plugins}/needs_restarting.py" >/dev/null; then
        run_package_command 120 dnf -q needs-restarting -r >/dev/null 2>&1 || rc=$?
    else
        echo null; return
    fi
    case "$rc" in 0) echo false ;; 1) echo true ;; *) echo null ;; esac
}

# dnf_updates PM: the available updates of dnf or yum as a JSON array of {name, package, arch,
# newVersion, installedVersion, repository, security, severity}. name is "name.arch" as
# check-update prints it (and what patch_install takes); package is the name without it. The security
# flag and severity come from the security advisories (updateinfo), matched by name and arch -
# the distributions' errata; repositories without them (e.g. CentOS Stream) give no flags.
dnf_updates() {
    local pm="$1" updates advisories installed
    updates=$(run_package_command 600 "$pm" -q check-update 2>/dev/null | awk '
        /^(Obsoleting|Security:)/ { exit }
        NF == 3 && $1 ~ /\./ { printf "%s\t%s\t%s\n", $1, $2, $3 }')
    [[ -z "$updates" ]] && { echo '[]'; return; }
    # "RLSA-2026:1234 Important/Sec. openssl-1:3.5.1-4.el9_8.x86_64" -> openssl.x86_64 Important
    advisories=$(run_package_command 600 "$pm" -q updateinfo list --security 2>/dev/null | awk '
        NF >= 3 && $2 ~ /\/Sec\.$/ {
            nevra = $3; arch = nevra; sub(/.*\./, "", arch); sub(/\.[^.]*$/, "", nevra)
            sub(/-[^-]*$/, "", nevra); sub(/-[^-]*$/, "", nevra)
            severity = $2; sub(/\/Sec\.$/, "", severity)
            printf "%s.%s\t%s\n", nevra, arch, severity }')
    # The installed version per name.arch, from one rpm query for all names ("[epoch:]version-release"
    # like check-update prints it). Install-only packages (kernel) have several: the highest wins.
    local -a names
    mapfile -t names < <(awk -F'\t' '{ print $1 }' <<< "$updates")
    installed=$(run_package_command 120 rpm -q --qf '%{NAME}.%{ARCH}\t%{EPOCHNUM}:%{VERSION}-%{RELEASE}\n' \
        "${names[@]}" 2>/dev/null | awk -F'\t' 'NF == 2 { v = $2; sub(/^0:/, "", v); print $1 "\t" v }' | sort -t$'\t' -k1,1 -k2,2V)
    jq -Rn --arg advisories "$advisories" --arg installed "$installed" '
        ($advisories | split("\n") | map(select(length > 0) | split("\t") | {key: .[0], value: .[1]})
         | sort_by({"Low": 1, "Moderate": 2, "Important": 3, "Critical": 4}[.value] // 0)
         | from_entries) as $sec
        | ($installed | split("\n") | map(select(length > 0) | split("\t") | {key: .[0], value: .[1]})
           | from_entries) as $inst
        | [inputs | select(length > 0) | split("\t")
           | (.[0] | capture("^(?<package>.+)\\.(?<arch>[^.]+)$") // {package: ., arch: null}) as $na
           | {name: .[0], package: $na.package, arch: $na.arch, newVersion: .[1],
              installedVersion: ($inst[.[0]] // null), repository: .[2], security: ($sec[.[0]] != null),
              severity: ($sec[.[0]] // null)}]' <<< "$updates" 2>/dev/null || echo '[]'
}

# refresh_package_lists LIMIT: download the current package lists, within LIMIT seconds. Prints the
# scan block for the inventory: {status, source, error, duration_seconds} with status succeeded,
# partial (some repositories failed) or failed.
refresh_package_lists() {
    local limit="$1" pm out="" rc=0 status=succeeded error="" start=$SECONDS
    pm=$(package_manager) || pm=""
    case "$pm" in
        apt)
            out=$(run_package_command "$limit" apt-get -q update -o DPkg::Lock::Timeout=120 2>&1) || rc=$?
            # apt-get update exits 0 when single repositories fail; they show as "Err:" / "W: Failed to fetch"
            local problems
            problems=$(grep -E '^(Err:|E:|W: (Failed to fetch|Some index files failed))' <<< "$out" | head -n 5)
            if (( rc != 0 )); then status=failed; error=${problems:-$(tail -n 3 <<< "$out")}
            elif [[ -n "$problems" ]]; then status=partial; error=$problems
            fi
            ;;
        dnf|yum)
            out=$(run_package_command "$limit" "$pm" -q makecache 2>&1) || rc=$?
            (( rc != 0 )) && { status=failed; error=$(tail -n 3 <<< "$out"); }
            ;;
        pacman)
            # checkupdates (pacman-contrib) refreshes a copy of the sync databases (PACMAN_CHECK_DB) and
            # leaves the live ones alone - pacman -Sy without the upgrade would leave a partially
            # upgraded system. Exit 0: updates, 2: none, anything else: failed.
            if ! command -v checkupdates &>/dev/null; then
                status=failed
                error="checkupdates is missing - install pacman-contrib on the node: sudo pacman -S pacman-contrib"
            else
                out=$(run_package_command "$limit" env CHECKUPDATES_DB="$PACMAN_CHECK_DB" checkupdates 2>&1) || rc=$?
                if (( rc != 0 && rc != 2 )); then status=failed; error=$(grep -v -- ' -> ' <<< "$out" | tail -n 3); fi
            fi
            ;;
        *)
            status=failed; error="No supported package manager (apt, dnf, yum, pacman)"
            ;;
    esac
    (( rc == 124 )) && error="Timed out after ${limit} s"
    jq -nc --arg status "$status" --arg source "${pm:-unknown}" --arg error "$error" \
        --argjson duration "$((SECONDS - start))" \
        '{status: $status, source: $source, error: (if $error == "" then null else $error[0:2000] end),
          duration_seconds: $duration}'
}

# patch_scan job: refresh the package lists, then push the inventory with the update list and the
# scan result. A failed refresh still pushes it (the list then comes from the old package lists)
# but fails the job.
run_patch_scan() {
    local limit="$1" status
    PATCH_SCAN_JSON=$(refresh_package_lists "$limit")
    status=$(jq -r '.status' <<< "$PATCH_SCAN_JSON")
    jq -r '"Package lists refreshed with \(.source): \(.status) after \(.duration_seconds) s"
           + (if .error then "\n\(.error)" else "" end)' <<< "$PATCH_SCAN_JSON"
    if push_inventory >/dev/null 2>&1; then
        echo "Inventory with the update list sent"
    else
        echo "Sending the inventory failed"; status=failed
    fi
    PATCH_SCAN_JSON=""
    [[ "$status" != "failed" ]]
}

# pending_update_names PM: the pending updates as the update list names them, one per line (apt: the
# package name; dnf/yum: name.arch). Reads the local package lists, downloads nothing.
pending_update_names() {
    case "$1" in
        apt) LANG=C apt list --upgradable 2>/dev/null | awk -F/ 'NF > 1 && $1 !~ /^Listing/ { print $1 }' ;;
        dnf|yum) dnf_updates "$1" | jq -r '.[].name' 2>/dev/null ;;
        pacman) pacman_updates | jq -r '.[].name' 2>/dev/null ;;
    esac
}

# install_summary PM BEFORE AFTER OUTPUT [NAME...]: what an installation really changed, from the
# pending updates before it (BEFORE) and after the update search that follows it (AFTER), for the
# packages asked for (NAME..., none: all). A package manager can exit 0 without upgrading anything -
# Ubuntu rolls out phased updates to a share of machines at a time and apt holds them back - and the
# job then read "Updates installed". Prints "Installed updates: N of M (names)" and, for the ones
# still pending, "Not installed: K (names)" with apt's reason.
install_summary() {
    local pm="$1" before="$2" after="$3" out="$4" n k reason=""; shift 4
    local -A pending=() left=() wanted=()
    while IFS= read -r n; do [[ -n "$n" ]] && pending[$n]=1; done <<< "$before"
    while IFS= read -r n; do [[ -n "$n" ]] && left[$n]=1; done <<< "$after"
    if (( $# )); then
        # a name asks for the update of that name; on dnf/yum a name without .arch for all its arches
        for n in "$@"; do
            for k in "${!pending[@]}"; do
                [[ "$k" == "$n" || ( "$pm" != apt && "${k%.*}" == "$n" ) ]] && wanted[$k]=1
            done
        done
    else
        for k in "${!pending[@]}"; do wanted[$k]=1; done
    fi
    local -a installed=() still=()
    for k in "${!wanted[@]}"; do
        if [[ -n "${left[$k]:-}" ]]; then still+=("$k"); else installed+=("$k"); fi
    done
    local list
    if (( ${#wanted[@]} == 0 )); then
        echo "Installed updates: 0 of 0 (none of them was pending)"
        return 0
    fi
    list=$(printf '%s\n' "${installed[@]}" | sort | paste -sd, - | sed 's/,/, /g')
    echo "Installed updates: ${#installed[@]} of ${#wanted[@]}${list:+ ($list)}"
    (( ${#still[@]} )) || return 0
    if grep -q "deferred due to phasing" <<< "$out"; then
        reason="held back by apt: phased updates, which Ubuntu rolls out to a share of machines at a time"
    elif grep -q "kept back" <<< "$out"; then
        reason="kept back by apt"
    fi
    list=$(printf '%s\n' "${still[@]}" | sort | paste -sd, - | sed 's/,/, /g')
    echo "Not installed: ${#still[@]} ($list)${reason:+ - $reason}"
}

# patch_install job: upgrade named packages ({"packages": [...]}) or explicitly all
# ({"all": true}). A package is a name (its newest version) or {"name", "version"} (exactly that
# version, as the update list reported it - bulk installs of approved updates, #271). Reject other payloads: a job with Windows KB IDs must never upgrade every Linux
# package by accident. Prints the end of the package manager's output and whether a reboot is required,
# then searches for updates again and pushes the inventory with that search, so the update list and
# the node's last update search are both current.
run_patch_install() {
    local payload="$1" limit="$2" pm out="" rc=0 pkg version before
    local -a packages=() entries=() names=()
    local selection
    # "packages": names (newest version) or {"name", "version"} objects (exactly that version: a
    # bulk installation of approved updates must not install a newer, not yet approved one)
    selection=$(jq -r '
        if type != "object" then "invalid"
        elif .all == true and (has("packages") | not) then "all"
        elif (.all == null or .all == false) and (.packages | type) == "array"
             and (.packages | length) > 0
             and (.packages | all(.[]; type == "string"
                  or (type == "object" and (.name | type) == "string" and (.version | type) == "string"
                      and (.version | length) > 0)))
             then "selected"
        else "invalid" end' <<< "$payload" 2>/dev/null) || selection=invalid
    if [[ "$selection" == "invalid" ]]; then
        echo 'Invalid patch_install payload: specify {"all":true} or a nonempty array of names or {"name","version"} in "packages"'
        return 1
    fi
    if [[ "$selection" == "selected" ]]; then
        mapfile -t entries < <(jq -r '.packages[] | if type == "string" then [., ""] else [.name, .version] end | @tsv' <<< "$payload")
    fi
    for pkg in "${entries[@]}"; do
        version="${pkg#*$'\t'}"; pkg="${pkg%%$'\t'*}"
        [[ "$pkg" =~ ^[A-Za-z0-9][A-Za-z0-9+._:@-]*$ ]] || { echo "Invalid package name: $pkg"; return 1; }
        [[ -z "$version" || "$version" =~ ^[A-Za-z0-9][A-Za-z0-9+.:~_-]*$ ]] || { echo "Invalid version for $pkg: $version"; return 1; }
        packages+=("$pkg"$'\t'"$version")
        names+=("$pkg")
    done
    pm=$(package_manager) || { echo "No supported package manager (apt, dnf, yum)"; return 1; }
    # What was pending before, to report what the installation really changed
    before=$(pending_update_names "$pm")
    # The package manager's notation: apt name=version; dnf/yum name-[epoch:]version-release.arch
    # (the name from the update list is name.arch)
    local i
    for i in "${!packages[@]}"; do
        pkg="${packages[$i]%%$'\t'*}"; version="${packages[$i]#*$'\t'}"
        if [[ -z "$version" ]]; then packages[$i]="$pkg"
        elif [[ "$pm" == "apt" ]]; then packages[$i]="$pkg=$version"
        elif [[ "$pkg" == *.* ]]; then packages[$i]="${pkg%.*}-$version.${pkg##*.}"
        else packages[$i]="$pkg-$version"
        fi
    done
    case "$pm" in
        apt)
            local -a options=(-q -y -o DPkg::Lock::Timeout=120
                -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
            if (( ${#packages[@]} )); then
                out=$(run_package_command "$limit" \
                    apt-get "${options[@]}" install --only-upgrade "${packages[@]}" 2>&1) || rc=$?
            else
                out=$(run_package_command "$limit" \
                    apt-get "${options[@]}" --with-new-pkgs upgrade 2>&1) || rc=$?
            fi
            ;;
        dnf|yum)
            out=$(run_package_command "$limit" "$pm" -y upgrade "${packages[@]}" 2>&1) || rc=$?
            ;;
        pacman)
            # Arch supports no partial upgrades: always the whole system (pacman -Syu)
            if (( ${#packages[@]} )); then
                echo "pacman installs all updates at once (pacman -Syu): Arch does not support upgrading single packages"
                return 1
            fi
            out=$(run_package_command "$limit" pacman -Syu --noconfirm 2>&1) || rc=$?
            ;;
        *)
            echo "Installing updates is not supported with $pm"; return 1
            ;;
    esac
    tail -n 60 <<< "$out"
    (( rc == 124 )) && echo "Timed out after ${limit} s"
    local flag="${REBOOT_REQUIRED_FILE:-/var/run/reboot-required}" reboot_needed=false
    if [[ -e "$flag" ]]; then
        reboot_needed=true
        echo "Reboot required: yes$( [[ -r "$flag.pkgs" ]] && printf ' (%s)' "$(sort -u "$flag.pkgs" | paste -sd, -)")"
    elif [[ "$pm" == "pacman" && "$(pacman_reboot_required)" == "true" ]]; then
        reboot_needed=true
        echo "Reboot required: yes (the kernel was updated)"
    elif [[ "$pm" == "dnf" || "$pm" == "yum" ]] && [[ "$(dnf_reboot_required)" == "true" ]]; then
        reboot_needed=true
        echo "Reboot required: yes"
    else
        echo "Reboot required: no"
    fi
    PATCH_SCAN_JSON=$(refresh_package_lists 600)
    jq -r '"Update search afterwards: \(.status)" + (if .error then " (\(.error))" else "" end)' <<< "$PATCH_SCAN_JSON"
    install_summary "$pm" "$before" "$(pending_update_names "$pm")" "$out" "${names[@]}"
    push_inventory >/dev/null 2>&1 || echo "Sending the inventory failed"
    PATCH_SCAN_JSON=""
    # The reboot comes last (at the earliest in a minute), after the result and the inventory
    if [[ "$reboot_needed" == true ]]; then
        schedule_system_reboot "$(jq -r '.reboot_policy // "no_reboot"' <<< "$payload" 2>/dev/null)" \
            "$(jq -r '.reboot_schedule_time // empty' <<< "$payload" 2>/dev/null)" || echo "Scheduling the reboot failed"
    fi
    return "$rc"
}

# schedule_system_reboot POLICY TIME: reboot after updates that need it. force: in one minute;
# schedule: at TIME (ISO 8601 with offset; a past time means one minute); anything else: no reboot.
# Under systemd a transient timer runs `systemctl reboot` (outside the service's sandbox, like
# restart-agent); otherwise shutdown -r.
schedule_system_reboot() {
    local policy="$1" at="$2" when="" now unit="octofleet-reboot-$(date +%s)-$$"
    case "$policy" in
        force) ;;
        schedule)
            when=$(date -u -d "$at" '+%Y-%m-%d %H:%M:%S' 2>/dev/null) || { echo "Reboot: invalid time '$at'"; return 1; }
            now=$(date +%s)
            (( $(date -u -d "$when UTC" +%s) > now + 60 )) || when=""
            ;;
        *) echo "Reboot: not requested (no_reboot)"; return 0 ;;
    esac
    if [[ -n "${INVOCATION_ID:-}" && "$(systemd_mode)" != none ]]; then
        if [[ -n "$when" ]]; then
            sd_run --quiet --collect --unit "$unit" --on-calendar="$when UTC" /bin/systemctl reboot || return 1
            echo "Reboot scheduled for $when UTC"
        else
            sd_run --quiet --collect --unit "$unit" --on-active=60s /bin/systemctl reboot || return 1
            echo "Reboot in one minute"
        fi
    else
        local minutes=1
        [[ -n "$when" ]] && minutes=$(( ($(date -u -d "$when UTC" +%s) - $(date +%s) + 59) / 60 ))
        shutdown -r +"$minutes" "Octofleet: reboot after updates" >/dev/null 2>&1 || {
            echo "Reboot could not be scheduled: shutdown failed (it needs systemd-logind over D-Bus)"; return 1; }
        echo "Reboot in $minutes min"
    fi
}

# Logged-on users for the console's reboot dialog: LOGGED_ON_USERS holds JSON ([{user, session,
# since}]) or "null" when the agent cannot tell. logind first (it also knows sessions utmp does not
# list), else who. Read at most every LOGGED_ON_INTERVAL seconds; the live push runs every few.
LOGGED_ON_INTERVAL=${LOGGED_ON_INTERVAL:-30}
LOGGED_ON_USERS="null"
LOGGED_ON_AT=0
refresh_logged_on_users() {
    local now; now=$(date +%s)
    (( now - LOGGED_ON_AT >= LOGGED_ON_INTERVAL )) || return 0
    LOGGED_ON_USERS=$(logged_on_users_now)
    LOGGED_ON_AT=$now
}

logged_on_users_now() {
    local out
    # systemd's manager sessions (user@.service) and background sessions are not people at a terminal
    if command -v loginctl &>/dev/null && out=$(LC_ALL=C timeout 5 loginctl list-sessions -o json 2>/dev/null) \
            && jq -e 'type == "array"' >/dev/null 2>&1 <<< "$out"; then
        jq -c '[.[] | select((.class // "user") | test("^user")) | select((.user // "") != "")
                | {user, session: (.tty // .seat // (.session | tostring)), since: null}]
               | unique_by([.user, .session])' <<< "$out" 2>/dev/null && return
    fi
    if command -v who &>/dev/null; then
        LC_ALL=C timeout 5 who 2>/dev/null | jq -Rsc 'split("\n") | map(select(length > 0) | split(" ") | map(select(length > 0))
            | {user: .[0], session: .[1], since: (((.[2] // "") + " " + (.[3] // "")) | ltrimstr(" ") | rtrimstr(" "))})' 2>/dev/null && return
    fi
    echo null
}

# run_reboot PAYLOAD: the console's `reboot` job. {"action": "reboot", "at": UTC ISO time, "message"}
# restarts the machine at that time (at the earliest in a minute, so the result reaches the server
# first) with shutdown -r +N, which warns logged-on users with the message and can be withdrawn;
# {"action": "cancel"} withdraws it (and a reboot an update installation scheduled). Under systemd it
# runs through a transient unit, outside the service's sandbox, like restart-agent.
run_reboot() {
    local payload="$1" action at message minutes target now
    action=$(jq -r '.action // "reboot"' <<< "$payload" 2>/dev/null)
    local shutdown_bin; shutdown_bin=$(command -v shutdown) || { echo "shutdown not found"; return 1; }
    # No D-Bus system bus (minimal images): shutdown -r needs systemd-logind over the bus, and
    # systemd-run --wait fails ("Failed to connect to bus"). As root, systemd-run still starts a
    # timer over systemd's private socket, and systemctl works there too.
    local no_bus=0
    [[ -n "${INVOCATION_ID:-}" && ! -S "${DBUS_SYSTEM_SOCKET:-/run/dbus/system_bus_socket}" \
        && -S "${SYSTEMD_PRIVATE_SOCKET:-/run/systemd/private}" ]] && command -v systemd-run &>/dev/null && no_bus=1
    if [[ "$action" == cancel ]]; then
        local rc=0
        if (( no_bus )); then
            systemctl stop 'octofleet-reboot-*.timer' 2>/dev/null || rc=1
        elif [[ -n "${INVOCATION_ID:-}" ]] && command -v systemd-run &>/dev/null; then
            systemd-run --quiet --collect --wait --unit "octofleet-reboot-cancel-$(date +%s)-$$" /bin/sh -c \
                "systemctl stop 'octofleet-reboot-*.timer' 2>/dev/null; $shutdown_bin -c 'Octofleet: the reboot was cancelled' 2>/dev/null; exit 0" || rc=1
        else
            "$shutdown_bin" -c "Octofleet: the reboot was cancelled" 2>/dev/null || rc=1
        fi
        (( rc == 0 )) && echo "Reboot cancelled" || echo "Cancelling the reboot failed"
        return "$rc"
    fi
    [[ "$action" == reboot ]] || { echo "Unknown reboot action: $action"; return 1; }
    at=$(jq -r '.at // empty' <<< "$payload" 2>/dev/null)
    message=$(jq -j '.message // empty' <<< "$payload" 2>/dev/null | tr '\000-\037' ' ' | tr -s ' ' | cut -c1-200)
    [[ -n "$message" ]] || message="Octofleet: this machine restarts"
    now=$(date +%s)
    target=$now
    if [[ -n "$at" ]]; then
        target=$(date -u -d "$at" +%s 2>/dev/null) || { echo "Reboot: invalid time '$at'"; return 1; }
    fi
    minutes=$(( (target - now + 59) / 60 ))
    (( minutes >= 1 )) || minutes=1
    refresh_logged_on_users
    if [[ "$LOGGED_ON_USERS" != null && "$LOGGED_ON_USERS" != "[]" ]]; then
        echo "Logged-on users: $(jq -r 'map(.user + (if .session then " (" + .session + ")" else "" end)) | join(", ")' <<< "$LOGGED_ON_USERS" 2>/dev/null)"
    fi
    if (( no_bus )); then
        # a timer runs systemctl reboot (cancel stops it); logged-on users get no shutdown message
        systemd-run --quiet --collect --unit "octofleet-reboot-$(date +%s)-$$" --on-active="${minutes}min" \
            /bin/systemctl reboot || { echo "Scheduling the reboot failed"; return 1; }
        echo "No D-Bus system bus: the reboot runs from a systemd timer, logged-on users are not warned"
    elif [[ -n "${INVOCATION_ID:-}" ]] && command -v systemd-run &>/dev/null; then
        systemd-run --quiet --collect --wait --unit "octofleet-reboot-$(date +%s)-$$" \
            "$shutdown_bin" -r "+$minutes" "$message" || { echo "Scheduling the reboot failed"; return 1; }
    else
        "$shutdown_bin" -r "+$minutes" "$message" >/dev/null 2>&1 || { echo "Scheduling the reboot failed"; return 1; }
    fi
    echo "Reboot scheduled for $(date -u -d "@$(( now + minutes * 60 ))" '+%Y-%m-%d %H:%M UTC') (in $minutes min)"
}

# next_push_time EXIT_CODE NOW FAILURES [FIRST]: when the next inventory push is due.
# After a successful push: PUSH_INTERVAL +/- 10 %; after the first one since the start (FIRST=1)
# a random 50-150 % of PUSH_INTERVAL, so nodes started together (agent update, power cut) spread
# over a whole interval instead of pushing in the same second every time (#283).
# After a failed one: PUSH_RETRY_INTERVAL, doubled for every earlier failure in a row (FAILURES) up
# to PUSH_INTERVAL, plus a random 0-50 %. When the server comes back after an outage, a large fleet
# then does not retry in lockstep every minute.
next_push_time() {
    if (( $1 == 0 )); then
        if (( ${4:-0} == 1 )); then
            echo $(( $2 + PUSH_INTERVAL * (500 + RANDOM % 1001) / 1000 ))
        else
            echo $(( $2 + PUSH_INTERVAL * (900 + RANDOM % 201) / 1000 ))
        fi
        return
    fi
    local delay=$(( PUSH_RETRY_INTERVAL << ($3 > 6 ? 6 : $3) ))
    (( delay > PUSH_INTERVAL )) && delay=$PUSH_INTERVAL
    echo $(( $2 + delay + RANDOM % (delay / 2 + 1) ))
}

execute_job() {
    local job="$1"
    local instance_id=$(echo "$job" | jq -r '.instanceId // .instance_id')
    local job_name=$(echo "$job" | jq -r '.jobName // .job_name')
    local command_type=$(echo "$job" | jq -r '.commandType // .command_type')
    local command_payload=$(echo "$job" | jq -r '.commandPayload // .command_payload')
    
    info Jobs "Job $instance_id started: $job_name (type $command_type)"
    
    # Mark job as started
    curl -sS -X POST \
        -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/jobs/instances/${instance_id}/start" >/dev/null 2>&1 || true
    
    local start_time=$(date +%s)
    local output=""
    local exit_code=0
    local timeout_seconds
    timeout_seconds=$(jq -r '.timeout // 300' <<< "$command_payload" 2>/dev/null)
    [[ "$timeout_seconds" =~ ^[0-9]+$ ]] && (( timeout_seconds > 0 && timeout_seconds <= 86400 )) || timeout_seconds=300
    
    case "$command_type" in
        run)
            local command_kind
            command_kind=$(jq -r '.command | type' <<< "$command_payload" 2>/dev/null)
            if [[ "$command_kind" == "array" ]]; then
                local -a argv=()
                mapfile -d '' -t argv < <(jq -j '.command[] | tostring, "\u0000"' <<< "$command_payload")
                if (( ${#argv[@]} )); then
                    output=$(timeout "$timeout_seconds" "${argv[@]}" 2>&1) || exit_code=$?
                else
                    output="Missing command"; exit_code=1
                fi
            elif [[ "$command_kind" == "string" ]]; then
                local script
                script=$(jq -r '.command' <<< "$command_payload")
                if [[ -n "$script" ]]; then
                    output=$(timeout "$timeout_seconds" bash -c "$script" 2>&1) || exit_code=$?
                else
                    output="Missing command"; exit_code=1
                fi
            else
                output="Missing command"; exit_code=1
            fi
            ;;
        shell|script)
            local script=$(echo "$command_payload" | jq -r '.script // .command // ""')
            if [[ -n "$script" ]]; then
                output=$(bash -c "$script" 2>&1) || exit_code=$?
            else
                output="Missing script"; exit_code=1
            fi
            ;;
        inventory|inventory_push)
            output=$(push_inventory 2>&1) || exit_code=$?
            ;;
        restart-agent)
            output=$(schedule_restart 2>&1) || exit_code=$?
            ;;
        patch_scan|patch_install)
            local patch_limit
            patch_limit=$(jq -r '.timeout // empty' <<< "$command_payload" 2>/dev/null)
            [[ -n "$patch_limit" ]] || patch_limit=$(jq -r '.timeoutSeconds // .timeout_seconds // empty' <<< "$job" 2>/dev/null)
            [[ "$patch_limit" =~ ^[0-9]+$ ]] && (( patch_limit > 0 && patch_limit <= 86400 )) || \
                patch_limit=$([[ "$command_type" == patch_scan ]] && echo 600 || echo 3600)
            if [[ "$command_type" == patch_scan ]]; then
                output=$(run_patch_scan "$patch_limit" 2>&1) || exit_code=$?
            else
                output=$(run_patch_install "$command_payload" "$patch_limit" 2>&1) || exit_code=$?
            fi
            ;;
        service_reconcile)
            output=$(reconcile_service "$command_payload") || exit_code=$?
            ;;
        reboot)
            output=$(run_reboot "$command_payload" 2>&1) || exit_code=$?
            ;;
        uninstall-agent)
            local delay=$(echo "$command_payload" | jq -r '.delaySeconds // 10' 2>/dev/null)
            local confirmation_node_id=$(echo "$command_payload" | jq -r '.confirmationNodeId // empty' 2>/dev/null)
            local confirmation_token=$(echo "$command_payload" | jq -r '.confirmationToken // empty' 2>/dev/null)
            output=$(schedule_uninstall "$delay" "$confirmation_node_id" "$confirmation_token" 2>&1) || exit_code=$?
            ;;
        *)
            warn Jobs "Unknown command type: $command_type"
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
        "${API_URL}/api/v1/jobs/instances/${instance_id}/result" >/dev/null 2>&1 || warn Jobs "Job $instance_id: reporting the result failed"
    
    if (( exit_code == 0 )); then
        info Jobs "Job $instance_id ($command_type) succeeded after ${duration} s"
    else
        warn Jobs "Job $instance_id ($command_type) failed: exit code $exit_code after ${duration} s: $(tail -n 1 <<< "$output" | head -c 300)"
    fi
    # Update searches, installations and reboots: what happened, in Updates.log
    if [[ "$command_type" == patch_scan || "$command_type" == patch_install || "$command_type" == reboot ]]; then
        local line
        while IFS= read -r line; do
            [[ -n "$line" ]] && info Updates "job=$instance_id $command_type: $line"
        done < <(grep -E '^(Package lists refreshed|Update search afterwards|Installed updates|Not installed|Reboot|Scheduling the reboot|Cancelling the reboot|Sending the inventory failed|Logged-on users|No D-Bus|Invalid|Timed out|No supported)' <<< "$output")
        (( exit_code == 0 )) || warn Updates "job=$instance_id $command_type failed: exit code $exit_code after ${duration} s"
    fi
}

# ============================================================================
# Screen Capture (E17-03)
# ============================================================================

SCREEN_CAPTURE_TOOL=""
SCREEN_SESSION_ID=""

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
    # Poll for screen capture requests. Returns 0 while a session is pending (poll fast), else 1.
    local response=$(curl -sS -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/screen/pending/${NODE_ID}" 2>/dev/null)
    
    if [[ -z "$response" ]] || [[ "$response" == "null" ]]; then
        return 1
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
        return 0
    fi
    return 1
}

# ============================================================================
# Terminal Support (E20)
# ============================================================================

# Runs pending terminal commands. Returns 0 while a terminal page for this node is open or commands
# came (poll fast), else 1. Servers before #283 send no "active" field: then only commands count.
poll_terminal_commands() {
    local response=$(curl -sS -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/terminal/pending/${NODE_ID}" 2>/dev/null)
    
    if [[ -z "$response" ]] || [[ "$response" == "null" ]]; then
        return 1
    fi
    local active
    active=$(echo "$response" | jq -r 'if .active == true or ((.commands // []) | length) > 0 then 1 else 0 end' 2>/dev/null)
    
    # Parse commands
    local sessions=$(echo "$response" | jq -r '.commands // [] | .[]' 2>/dev/null)
    
    echo "$response" | jq -c '.commands[]?' 2>/dev/null | while read -r session; do
        local session_id=$(echo "$session" | jq -r '.sessionId')
        local shell=$(echo "$session" | jq -r '.shell // "bash"')
        
        echo "$session" | jq -r '.commands[]?' 2>/dev/null | while read -r cmd; do
            if [[ -n "$cmd" && "$cmd" != "null" ]]; then
                info RemoteTools "Executing terminal command: $cmd"
                
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
    [[ "$active" == 1 ]]
}

# poll_pace NOW ACTIVE_UNTIL [IDLE]: seconds until the next terminal or screen poll (#283). While a
# session is open, or was until ACTIVE_UNTIL, every second (each loop); otherwise about IDLE (default
# POLL_IDLE_INTERVAL), +-1 s so agents started together do not poll in the same second.
poll_pace() {
    if (( $1 < $2 )); then echo 1; return; fi
    local idle=${3:-$POLL_IDLE_INTERVAL}
    idle=$(( idle < 1 ? 1 : idle ))
    (( idle >= 3 )) && idle=$(( idle - 1 + RANDOM % 3 ))
    echo "$idle"
}

# ============================================================================
# Long-poll (#283)
# ============================================================================

# The kinds of work this agent handles: no remediation and no shell sessions on Linux, screen only
# with a capture tool. The server does not wake the agent for the others.
long_poll_kinds() {
    echo "jobs,terminal${SCREEN_CAPTURE_TOOL:+,screen}"
}

# One long-poll. Prints the kinds of work there is now (space-separated, empty after the hold time).
# Returns 0 on an answer, 2 when the server has no long-poll (404, or no JSON answer from an older
# server or a proxy), 1 on any other error (it then prints the reason).
long_poll_once() {
    local response code body
    response=$(curl -sS --max-time $(( LONG_POLL_SECONDS + 20 )) -w "\n%{http_code}" \
        -H "X-API-Key: $API_KEY" \
        "${API_URL}/api/v1/agent/wait/${NODE_ID}?kinds=$(long_poll_kinds)&timeout=${LONG_POLL_SECONDS}" 2>/dev/null)
    code=$(tail -n1 <<< "$response")
    body=$(sed '$d' <<< "$response")
    case "$code" in
        200) jq -er '.wake | if type == "array" then map(select(. == "jobs" or . == "terminal" or . == "screen")) | join(" ") else error("no wake list") end' <<< "$body" 2>/dev/null || return 2 ;;
        404) return 2 ;;
        *) echo "HTTP ${code:-000}"; return 1 ;;
    esac
}

# long_poll_retry_delay FAILURES: seconds until the next long-poll after FAILURES errors in a row.
# LONG_POLL_RETRY_INTERVAL doubled per further failure up to 5 minutes, spread over 50-150 %: after a
# server restart the agents of a large fleet do not all come back in the same second.
long_poll_retry_delay() {
    local n=$(( $1 < 1 ? 1 : $1 ))
    local delay=$(( LONG_POLL_RETRY_INTERVAL << (n > 6 ? 5 : n - 1) ))
    (( delay > 300 )) && delay=300
    (( delay < 2 )) && delay=2
    echo $(( delay / 2 + RANDOM % (delay + 1) ))
}

# long_poll_loop DIR [ROUNDS]: runs in the background next to the main loop. For every kind of work
# the server names it creates DIR/<kind>; the main loop then runs that poll at once and deletes the
# file after it. DIR/active exists while the long-poll works: the main loop then polls only every
# LONG_POLL_FALLBACK_INTERVAL s. ROUNDS (tests): stop after that many requests.
long_poll_loop() {
    local dir="$1" rounds="${2:-0}" round=0 failures=0 rc out kind started i
    while (( rounds == 0 || round < rounds )); do
        round=$(( round + 1 ))
        started=$SECONDS
        out=$(long_poll_once); rc=$?
        case "$rc" in
            0)
                if [[ ! -e "$dir/active" ]]; then
                    touch "$dir/active"
                    info Agent "Long-poll active: the server wakes the agent for $(long_poll_kinds); idle polls every ${LONG_POLL_FALLBACK_INTERVAL}s"
                fi
                failures=0
                for kind in $out; do touch "$dir/$kind"; done
                # Give the main loop time to run the polls before asking again (else the same work
                # wakes the agent twice), at most 30 s
                for (( i = 0; i < 30; i++ )); do
                    [[ -e "$dir/jobs" || -e "$dir/terminal" || -e "$dir/screen" ]] || break
                    sleep 1
                done
                (( SECONDS - started < 1 )) && sleep 1
                ;;
            2)
                [[ -e "$dir/active" || $round == 1 ]] && info Agent "The server has no long-poll (older version): polling every few seconds, asking again in ${LONG_POLL_RECHECK_INTERVAL}s"
                rm -f "$dir/active"
                failures=0
                sleep "$LONG_POLL_RECHECK_INTERVAL"
                ;;
            *)
                failures=$(( failures + 1 ))
                if [[ -e "$dir/active" ]]; then
                    rm -f "$dir/active"
                    warn Agent "Long-poll failed ($out): polling every few seconds until it answers again"
                fi
                sleep "$(long_poll_retry_delay "$failures")"
                ;;
        esac
    done
}

# ============================================================================
# Service Loop
# ============================================================================

# The agent's logrotate configuration. The marker line lets the agent update a file it installed; an
# administrator who deletes the line keeps their own version.
LOGROTATE_MARKER="# octofleet-agent: managed"
logrotate_config() {
    cat <<EOF
$LOGROTATE_MARKER - delete this line to keep your own changes
$LOG_DIR/*.log {
    weekly
    maxsize $LOG_ROTATE_MAXSIZE
    rotate $LOG_ROTATE_COUNT
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su root root
}
EOF
}

# Install the logrotate configuration for LOG_DIR/*.log if there is none, or update one the agent installed
# (marker line). A file without the marker belongs to the administrator and is left alone. At the
# service's start (so also after a self-update) and from install.sh. The service runs with
# ProtectSystem=strict and cannot write /etc: it writes through a transient unit, like the package
# manager. copytruncate: background parts of the agent keep appending to the same name.
ensure_logrotate() {
    [[ -n "$LOGROTATE_FILE" && "$LOG_DIR" == /* ]] || return 0
    if [[ -e "$LOGROTATE_FILE" ]] && ! grep -qF "$LOGROTATE_MARKER" "$LOGROTATE_FILE" 2>/dev/null; then
        return 0
    fi
    local wanted
    wanted=$(logrotate_config)
    [[ -f "$LOGROTATE_FILE" && "$(cat "$LOGROTATE_FILE")" == "$wanted" ]] && return 0
    if ! command -v logrotate &>/dev/null; then
        warn Agent "logrotate is not installed - $LOG_DIR/*.log are not rotated (install logrotate; the agent then adds $LOGROTATE_FILE)"
        return 0
    fi
    if [[ -n "${INVOCATION_ID:-}" && "$(systemd_mode)" != none ]] && [[ ! -w "$(dirname "$LOGROTATE_FILE")" ]]; then
        # --pipe cannot start transient units from the service on systemd 252 (RHEL 9).
        # Stage the content in the agent's writable log directory, then install it in a unit.
        local staged
        staged=$(mktemp "${LOGROTATE_TMP_DIR:-/var/log}/octofleet-logrotate.XXXXXX") || return 1
        printf '%s\n' "$wanted" > "$staged"
        if ! sd_run_wait "octofleet-logrotate-$(date +%s)-$$" \
            /usr/bin/install -m 644 "$staged" "$LOGROTATE_FILE"; then
            rm -f "$staged"
            warn Agent "Could not write $LOGROTATE_FILE"; return 1
        fi
        rm -f "$staged"
    else
        { printf '%s\n' "$wanted" > "$LOGROTATE_FILE" && chmod 644 "$LOGROTATE_FILE"; } 2>/dev/null || {
            warn Agent "Could not write $LOGROTATE_FILE"; return 1; }
    fi
    info Agent "logrotate: $LOGROTATE_FILE for $LOG_DIR/*.log (weekly or at $LOG_ROTATE_MAXSIZE, $LOG_ROTATE_COUNT files kept)"
}

# Agents before #330 wrote one file, LOG_FILE (/var/log/octofleet-agent.log). At the service's start
# it moves into LOG_DIR as octofleet-agent.log.0, its rotated copies keep their names there (.1,
# .2.gz, ...; not rotated any more, removed on uninstall), and LOG_FILE becomes a link to Agent.log for
# commands and scripts that still read it.
migrate_legacy_log() {
    [[ -f "$LOG_FILE" && ! -L "$LOG_FILE" && "$LOG_FILE" == /* && -d "$LOG_DIR" ]] || return 0
    local old name="${LOG_FILE##*/}"
    for old in "$LOG_FILE".*; do
        [[ -f "$old" ]] && mv -f "$old" "$LOG_DIR/${old##*/}" 2>/dev/null
    done
    mv -f "$LOG_FILE" "$LOG_DIR/$name.0" 2>/dev/null || return 0
    ln -s "$LOG_DIR/Agent.log" "$LOG_FILE" 2>/dev/null
    info Agent "Logs are now one file per component in $LOG_DIR; the previous log $LOG_FILE moved there as $name.0"
}

run_service() {
    show_banner
    migrate_legacy_log
    info Agent "Octofleet Linux Agent v$VERSION starting..."
    info Agent "Node ID: $NODE_ID"
    info Agent "API URL: $API_URL"
    info Agent "Push interval: ${PUSH_INTERVAL}s, Job poll: ${JOB_POLL_INTERVAL}s, Live data: ${LIVE_DATA_INTERVAL}s"
    info Agent "Auto-update: ${AUTO_UPDATE} (every ${UPDATE_CHECK_INTERVAL}s from the Octofleet server)"
    local level_var levels=""
    for level_var in $(compgen -v LOG_LEVEL_); do levels+=", ${level_var#LOG_LEVEL_} ${!level_var}"; done
    info Agent "Logs: $LOG_DIR, level $LOG_LEVEL$levels"
    [[ "$(systemd_mode)" == private ]] && info Agent "No D-Bus system bus on this system: updates, reboots and logrotate run through systemd's private socket"
    ensure_logrotate || true
    
    # Detect screen capture tool
    detect_screen_capture_tool
    if [[ -n "$SCREEN_CAPTURE_TOOL" ]]; then
        info RemoteTools "Screen capture available via: $SCREEN_CAPTURE_TOOL"
    fi
    
    local push_due=0
    local push_failures=0
    local push_first=1
    local push_rc
    local last_poll=0
    local last_live=0
    local screen_due=0 screen_active_until=0
    local terminal_due=0 terminal_active_until=0
    local wake_dir="" job_every idle_every
    # First update check two minutes after start, then every UPDATE_CHECK_INTERVAL
    local last_self_update=$(( $(date +%s) - UPDATE_CHECK_INTERVAL + 120 ))
    
    # Start file audit collector
    start_file_audit &
    
    # Long-poll in the background (#283); the main loop picks up its wake-ups from wake_dir
    if [[ "$LONG_POLL" == true ]] && wake_dir=$(mktemp -d "${TMPDIR:-/tmp}/octofleet-wake.XXXXXX"); then
        long_poll_loop "$wake_dir" &
        trap "kill $! 2>/dev/null; rm -rf '$wake_dir'" EXIT
    else
        wake_dir=""
    fi
    
    # Push after the start, so the node does not keep showing its state from before a restart; a
    # random 0-60 s later, so nodes started together do not push together. Right after a boot the
    # server may not answer yet (on the Octofleet server itself its containers are still starting):
    # then the next try comes after PUSH_RETRY_INTERVAL, not after PUSH_INTERVAL.
    push_due=$(( $(date +%s) + RANDOM % 61 ))
    
    while true; do
        local now=$(date +%s)
        
        # Push live data (every 5 seconds for real-time dashboard)
        if (( now - last_live >= LIVE_DATA_INTERVAL )); then
            push_live_data
            last_live=$now
        fi
        
        # Push inventory
        if (( now >= push_due )); then
            push_inventory; push_rc=$?
            push_due=$(next_push_time "$push_rc" "$now" "$push_failures" "$push_first")
            if (( push_rc == 0 )); then push_failures=0; push_first=0; else push_failures=$(( push_failures + 1 )); fi
        fi
        
        # While the long-poll works the server says when there is something: the polls run at once
        # then, and otherwise only every LONG_POLL_FALLBACK_INTERVAL s (#283)
        job_every=$JOB_POLL_INTERVAL idle_every=$POLL_IDLE_INTERVAL
        if [[ -n "$wake_dir" && -e "$wake_dir/active" ]]; then
            job_every=$LONG_POLL_FALLBACK_INTERVAL idle_every=$LONG_POLL_FALLBACK_INTERVAL
        else
            # No long-poll (off, older server, failing): back to the usual pace at once
            (( terminal_due > now + idle_every + 1 )) && terminal_due=$(( now + idle_every ))
            (( screen_due > now + idle_every + 1 )) && screen_due=$(( now + idle_every ))
        fi
        if [[ -n "$wake_dir" ]]; then
            [[ -e "$wake_dir/jobs" ]] && last_poll=0
            [[ -e "$wake_dir/terminal" ]] && terminal_due=0
            [[ -e "$wake_dir/screen" ]] && screen_due=0
        fi
        
        # Poll jobs
        if (( now - last_poll >= job_every )); then
            poll_jobs || true
            last_poll=$now
            [[ -n "$wake_dir" ]] && rm -f "$wake_dir/jobs"
        fi
        
        # Screen capture requests (if a capture tool is installed) and terminal commands: every second
        # while a session is open, otherwise about every POLL_IDLE_INTERVAL seconds (#283)
        if [[ -n "$SCREEN_CAPTURE_TOOL" ]] && (( now >= screen_due )); then
            check_screen_requests 2>/dev/null && screen_active_until=$(( now + SESSION_ACTIVE_GRACE ))
            screen_due=$(( now + $(poll_pace "$now" "$screen_active_until" "$idle_every") ))
            [[ -n "$wake_dir" ]] && rm -f "$wake_dir/screen"
        fi
        if (( now >= terminal_due )); then
            poll_terminal_commands 2>/dev/null && terminal_active_until=$(( now + SESSION_ACTIVE_GRACE ))
            terminal_due=$(( now + $(poll_pace "$now" "$terminal_active_until" "$idle_every") ))
            [[ -n "$wake_dir" ]] && rm -f "$wake_dir/terminal"
        fi
        
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
# With MANUAL_UPDATE=true ("agent.sh update") the running service is restarted
# instead, since it would otherwise keep running the old version.
# Returns 0 when already up to date, 1 when the check failed or an update was
# rejected or could not be installed; the old agent.sh is then left in place.
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

    info SelfUpdate "Update available: v$VERSION -> v$latest"
    local self="${SCRIPT_DIR}/agent.sh"
    local tmp="${SCRIPT_DIR}/agent.sh.new"
    if ! curl -sf --max-time 120 -o "$tmp" "$url"; then
        warn SelfUpdate "Update download failed, keeping v$VERSION"
        rm -f "$tmp"; return 1
    fi
    local actual
    actual=$(sha256sum "$tmp" | cut -d' ' -f1)
    if [[ "${actual,,}" != "${sha,,}" ]]; then
        warn SelfUpdate "Update rejected: SHA256 mismatch (expected $sha, got $actual)"
        rm -f "$tmp"; return 1
    fi
    if ! bash -n "$tmp" 2>/dev/null || ! grep -q "^VERSION=\"$latest\"" "$tmp"; then
        warn SelfUpdate "Update rejected: downloaded agent.sh is invalid or has the wrong version"
        rm -f "$tmp"; return 1
    fi

    # set -e is not active and this function runs in an if/|| context: check
    # each step, so a failed replacement never reports success or exits.
    if ! chmod 755 "$tmp"; then
        warn SelfUpdate "Update to v$latest failed: cannot make the new agent.sh executable, keeping v$VERSION"
        rm -f "$tmp"; return 1
    fi
    if ! mv -f "$tmp" "$self"; then
        warn SelfUpdate "Update to v$latest failed: cannot replace $self, keeping v$VERSION"
        rm -f "$tmp"; return 1
    fi

    if [[ "${MANUAL_UPDATE:-false}" == "true" ]]; then
        info SelfUpdate "Updated to v$latest"
        if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet octofleet-agent; then
            if systemctl restart octofleet-agent; then
                info SelfUpdate "Service octofleet-agent restarted with v$latest"
            else
                warn SelfUpdate "Updated to v$latest, but restarting octofleet-agent failed; restart it to use the new version"
            fi
        fi
        exit 0
    fi
    info SelfUpdate "Updated to v$latest, restarting"
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
        log INFO Security "File audit disabled"
        return
    fi
    
    if ! command -v inotifywait &>/dev/null; then
        log WARN Security "inotifywait not found. Install inotify-tools for file audit."
        return
    fi
    
    log INFO Security "Starting file audit on: $FILE_AUDIT_PATHS"
    
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
    log INFO Security "File audit started (PID: $FILE_AUDIT_PID)"
    
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
        log INFO Security "Flushed $count file audit events"
    else
        log WARN Security "Failed to flush file audit events (HTTP $http_code)"
    fi
}

stop_file_audit() {
    if [[ -n "$FILE_AUDIT_PID" ]]; then
        kill "$FILE_AUDIT_PID" 2>/dev/null || true
        log INFO Security "File audit stopped"
    fi
}

# ============================================================================
# Main
# ============================================================================

[[ -d "$LOG_DIR" ]] || mkdir -p -m 750 "$LOG_DIR" 2>/dev/null

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
    logrotate)
        ensure_logrotate
        ;;
    update)
        if AUTO_UPDATE=true MANUAL_UPDATE=true check_for_update; then
            echo "Octofleet Linux Agent v$VERSION is up to date"
        else
            echo "Update check failed or update rejected, staying on v$VERSION" >&2
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {push|poll|collect|service|version|update|logrotate}"
        exit 1
        ;;
esac

