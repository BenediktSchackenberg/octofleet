#!/usr/bin/env bash
#
# Octofleet Linux Agent
# Collects inventory and pushes to the Octofleet API
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"
VERSION="0.4.30-linux"

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
            cpu_percent=$(echo "scale=1; 100 * (1 - $idle_diff / $total_diff)" | bc 2>/dev/null || echo 0)
        fi
    fi
    
    # Memory
    local mem_total=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
    local mem_available=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}')
    local mem_percent=0
    if [[ -n "$mem_total" ]] && [[ "$mem_total" -gt 0 ]]; then
        mem_percent=$(echo "scale=1; 100 * (1 - $mem_available / $mem_total)" | bc 2>/dev/null || echo 0)
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
        
        local rx_mb=$(echo "scale=1; $rx_bytes / 1048576" | bc 2>/dev/null || echo 0)
        local tx_mb=$(echo "scale=1; $tx_bytes / 1048576" | bc 2>/dev/null || echo 0)
        
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
    
    # Detect screen capture tool
    detect_screen_capture_tool
    if [[ -n "$SCREEN_CAPTURE_TOOL" ]]; then
        info "Screen capture available via: $SCREEN_CAPTURE_TOOL"
    fi
    
    local last_push=0
    local last_poll=0
    local last_live=0
    local last_screen=0
    
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
        
        sleep 1
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
        echo "Octofleet Linux Agent v$VERSION"
        ;;
    *)
        echo "Usage: $0 {push|poll|collect|service|version}"
        exit 1
        ;;
esac
