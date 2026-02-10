#!/usr/bin/env bash
#
# OpenClaw Linux Agent
# Collects inventory and pushes to the OpenClaw Inventory API
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
VERSION="0.1.0"

# Load config
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
fi

# Defaults
API_URL="${API_URL:-http://localhost:8080}"
API_KEY="${API_KEY:-openclaw-inventory-dev-key}"
NODE_ID="${NODE_ID:-$(hostname)}"
PUSH_INTERVAL="${PUSH_INTERVAL:-1800}"
JOB_POLL_INTERVAL="${JOB_POLL_INTERVAL:-60}"
LOG_FILE="${LOG_FILE:-/var/log/openclaw-agent.log}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

collect_hardware() {
    local cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo "Unknown")
    local cpu_cores=$(nproc 2>/dev/null || echo 1)
    local cpu_threads=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)
    
    local mem_total_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    local mem_total_gb=$(echo "scale=2; $mem_total_kb / 1024 / 1024" | bc 2>/dev/null || echo 0)
    local mem_available_kb=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    
    # Disk info
    local disks=$(lsblk -Jbo NAME,SIZE,TYPE,MOUNTPOINT 2>/dev/null | jq -c '.blockdevices // []' || echo '[]')
    
    # Motherboard
    local mb_manufacturer=$(cat /sys/class/dmi/id/board_vendor 2>/dev/null || echo "Unknown")
    local mb_product=$(cat /sys/class/dmi/id/board_name 2>/dev/null || echo "Unknown")
    local bios_version=$(cat /sys/class/dmi/id/bios_version 2>/dev/null || echo "Unknown")
    
    cat << EOF
{
    "cpu": {
        "name": "$cpu_model",
        "cores": $cpu_cores,
        "threads": $cpu_threads,
        "architecture": "$(uname -m)"
    },
    "ram": {
        "totalBytes": $((mem_total_kb * 1024)),
        "totalGB": $mem_total_gb,
        "availableBytes": $((mem_available_kb * 1024))
    },
    "disks": $disks,
    "motherboard": {
        "manufacturer": "$mb_manufacturer",
        "product": "$mb_product"
    },
    "bios": {
        "version": "$bios_version"
    }
}
EOF
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
# Full Inventory
# ============================================================================

collect_full_inventory() {
    local hardware=$(collect_hardware)
    local software=$(collect_software)
    local system=$(collect_system)
    local network=$(collect_network)
    local security=$(collect_security)
    
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
    "security": $security
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

execute_job() {
    local job="$1"
    local instance_id=$(echo "$job" | jq -r '.instance_id')
    local job_name=$(echo "$job" | jq -r '.job_name')
    local command_type=$(echo "$job" | jq -r '.command_type')
    local command_payload=$(echo "$job" | jq -r '.command_payload')
    
    info "Executing job: $job_name ($instance_id)"
    
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
    "instance_id": "$instance_id",
    "status": "$([ $exit_code -eq 0 ] && echo 'success' || echo 'failed')",
    "exit_code": $exit_code,
    "output": $(echo "$output" | jq -Rs '.'),
    "duration_seconds": $duration
}
EOF
)
    
    curl -sS -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$result" \
        "${API_URL}/api/v1/jobs/result" >/dev/null 2>&1 || warn "Failed to report job result"
    
    info "Job $instance_id completed: exit_code=$exit_code, duration=${duration}s"
}

# ============================================================================
# Service Loop
# ============================================================================

run_service() {
    info "OpenClaw Linux Agent v$VERSION starting..."
    info "Node ID: $NODE_ID"
    info "API URL: $API_URL"
    info "Push interval: ${PUSH_INTERVAL}s, Job poll: ${JOB_POLL_INTERVAL}s"
    
    local last_push=0
    local last_poll=0
    
    # Initial push
    push_inventory || true
    last_push=$(date +%s)
    
    while true; do
        local now=$(date +%s)
        
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
        
        sleep 10
    done
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
        echo "OpenClaw Linux Agent v$VERSION"
        ;;
    *)
        echo "Usage: $0 {push|poll|collect|service|version}"
        exit 1
        ;;
esac
