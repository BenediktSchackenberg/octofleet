#!/bin/bash
# ============================================================
# Octofleet PXE - MAC Registrierung
# ============================================================

HOSTS_FILE="$(dirname "$0")/hosts.pxe"

usage() {
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  add <MAC>         Registriere MAC für PXE Boot"
    echo "  remove <MAC>      Entferne MAC aus PXE Boot"
    echo "  list              Zeige alle registrierten MACs"
    echo "  reload            Lade dnsmasq config neu"
    echo ""
    echo "Example:"
    echo "  $0 add 00:15:5D:01:02:03"
    exit 1
}

normalize_mac() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | tr '-' ':'
}

add_mac() {
    local mac=$(normalize_mac "$1")
    
    if grep -q "$mac" "$HOSTS_FILE" 2>/dev/null; then
        echo "⚠️  MAC $mac ist bereits registriert"
        return 1
    fi
    
    echo "dhcp-host=$mac,set:pxe" >> "$HOSTS_FILE"
    echo "✅ MAC $mac registriert für PXE Boot"
    
    reload_dnsmasq
}

remove_mac() {
    local mac=$(normalize_mac "$1")
    
    if ! grep -q "$mac" "$HOSTS_FILE" 2>/dev/null; then
        echo "⚠️  MAC $mac nicht gefunden"
        return 1
    fi
    
    sed -i "/$mac/d" "$HOSTS_FILE"
    echo "✅ MAC $mac entfernt"
    
    reload_dnsmasq
}

list_macs() {
    echo "📋 Registrierte MACs:"
    grep -E "^dhcp-host=" "$HOSTS_FILE" 2>/dev/null | while read line; do
        mac=$(echo "$line" | sed 's/dhcp-host=//' | sed 's/,set:pxe//')
        echo "   $mac"
    done
    
    count=$(grep -cE "^dhcp-host=" "$HOSTS_FILE" 2>/dev/null || echo 0)
    echo ""
    echo "Total: $count"
}

reload_dnsmasq() {
    if docker ps | grep -q octofleet-pxe; then
        echo "🔄 Reloading dnsmasq..."
        docker exec octofleet-pxe killall -HUP dnsmasq 2>/dev/null || true
    fi
}

case "$1" in
    add)
        [ -z "$2" ] && usage
        add_mac "$2"
        ;;
    remove|rm|del)
        [ -z "$2" ] && usage
        remove_mac "$2"
        ;;
    list|ls)
        list_macs
        ;;
    reload)
        reload_dnsmasq
        echo "✅ Config reloaded"
        ;;
    *)
        usage
        ;;
esac
