#!/bin/bash
# OpenClaw Linux Agent Installer
# Usage: curl -sSL https://raw.githubusercontent.com/.../install.sh | sudo bash

set -e

INSTALL_DIR="/opt/openclaw-agent"
SERVICE_NAME="openclaw-agent"
API_URL="${API_URL:-http://192.168.0.5:8080/api/v1}"
API_KEY="${API_KEY:-openclaw-inventory-dev-key}"

echo "═══════════════════════════════════════════════════════════"
echo "   OpenClaw Linux Agent Installer"
echo "═══════════════════════════════════════════════════════════"

# Check root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root (sudo)"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv curl jq

# Create install directory
echo "📁 Creating $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Create virtual environment
echo "🐍 Setting up Python environment..."
python3 -m venv venv
source venv/bin/activate
pip install --quiet requests psutil netifaces

# Create agent script
echo "📝 Installing agent..."
cat > agent.py << 'AGENT_EOF'
#!/usr/bin/env python3
"""OpenClaw Linux Agent - Inventory & Monitoring"""

import os
import sys
import time
import json
import socket
import platform
import subprocess
import logging
from datetime import datetime
from pathlib import Path

import requests
import psutil

# Configuration
API_URL = os.environ.get("OPENCLAW_API_URL", "http://192.168.0.5:8080/api/v1")
API_KEY = os.environ.get("OPENCLAW_API_KEY", "openclaw-inventory-dev-key")
POLL_INTERVAL = int(os.environ.get("OPENCLAW_POLL_INTERVAL", "30"))
HOSTNAME = socket.gethostname()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/var/log/openclaw-agent.log')
    ]
)
log = logging.getLogger(__name__)

def get_headers():
    return {"X-API-Key": API_KEY, "Content-Type": "application/json"}

def get_system_info():
    """Collect system inventory"""
    uname = platform.uname()
    
    # CPU info
    cpu_info = {
        "name": platform.processor() or "Unknown",
        "cores": psutil.cpu_count(logical=False),
        "threads": psutil.cpu_count(logical=True),
        "frequency_mhz": psutil.cpu_freq().max if psutil.cpu_freq() else 0
    }
    
    # Memory info
    mem = psutil.virtual_memory()
    memory_info = {
        "total_gb": round(mem.total / (1024**3), 2),
        "available_gb": round(mem.available / (1024**3), 2)
    }
    
    # Disk info
    disks = []
    for part in psutil.disk_partitions():
        try:
            usage = psutil.disk_usage(part.mountpoint)
            disks.append({
                "device": part.device,
                "mountpoint": part.mountpoint,
                "fstype": part.fstype,
                "total_gb": round(usage.total / (1024**3), 2),
                "used_gb": round(usage.used / (1024**3), 2),
                "free_gb": round(usage.free / (1024**3), 2),
                "percent": usage.percent
            })
        except:
            pass
    
    # Network interfaces
    networks = []
    for iface, addrs in psutil.net_if_addrs().items():
        for addr in addrs:
            if addr.family == socket.AF_INET:
                networks.append({
                    "interface": iface,
                    "ip": addr.address,
                    "netmask": addr.netmask
                })
    
    # OS info
    os_info = {
        "name": f"{uname.system} {uname.release}",
        "version": uname.version,
        "architecture": uname.machine,
        "hostname": HOSTNAME
    }
    
    # Get distro info
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    os_info["distribution"] = line.split("=")[1].strip().strip('"')
                    break
    except:
        pass
    
    return {
        "hostname": HOSTNAME,
        "os": os_info,
        "cpu": cpu_info,
        "memory": memory_info,
        "disks": disks,
        "networks": networks,
        "collected_at": datetime.utcnow().isoformat()
    }

def get_metrics():
    """Get current system metrics"""
    cpu_percent = psutil.cpu_percent(interval=1)
    mem = psutil.virtual_memory()
    
    # Get primary disk usage
    disk_percent = 0
    try:
        disk_percent = psutil.disk_usage('/').percent
    except:
        pass
    
    # Network I/O
    net = psutil.net_io_counters()
    
    return {
        "cpu": cpu_percent,
        "memory": mem.percent,
        "disk": disk_percent,
        "netIn": round(net.bytes_recv / (1024**2), 2),
        "netOut": round(net.bytes_sent / (1024**2), 2)
    }

def get_installed_packages():
    """Get list of installed packages"""
    packages = []
    
    # Try dpkg (Debian/Ubuntu)
    try:
        result = subprocess.run(
            ["dpkg-query", "-W", "-f", "${Package}|${Version}|${Status}\n"],
            capture_output=True, text=True, timeout=30
        )
        for line in result.stdout.strip().split('\n'):
            parts = line.split('|')
            if len(parts) >= 2 and 'installed' in parts[-1]:
                packages.append({
                    "name": parts[0],
                    "version": parts[1],
                    "source": "dpkg"
                })
    except:
        pass
    
    # Try rpm (RHEL/CentOS)
    if not packages:
        try:
            result = subprocess.run(
                ["rpm", "-qa", "--qf", "%{NAME}|%{VERSION}\n"],
                capture_output=True, text=True, timeout=30
            )
            for line in result.stdout.strip().split('\n'):
                parts = line.split('|')
                if len(parts) >= 2:
                    packages.append({
                        "name": parts[0],
                        "version": parts[1],
                        "source": "rpm"
                    })
        except:
            pass
    
    return packages

def get_processes():
    """Get top processes by CPU"""
    procs = []
    for proc in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_info']):
        try:
            info = proc.info
            procs.append({
                "pid": info['pid'],
                "name": info['name'],
                "user": info['username'],
                "cpu": info['cpu_percent'],
                "memoryMb": round(info['memory_info'].rss / (1024**2), 1) if info['memory_info'] else 0
            })
        except:
            pass
    
    return sorted(procs, key=lambda x: x['cpu'], reverse=True)[:20]

def send_full_inventory():
    """Send full inventory to backend (this also registers the node)"""
    log.info(f"📦 Sending full inventory for {HOSTNAME}...")
    
    system_info = get_system_info()
    packages = get_installed_packages()
    
    # Build payload matching Windows Agent format
    payload = {
        "hostname": HOSTNAME,
        "nodeId": HOSTNAME,
        "hardware": {
            "cpu": system_info["cpu"],
            "ram": system_info["memory"],
            "disks": system_info["disks"],
            "network": system_info["networks"]
        },
        "software": {
            "count": len(packages),
            "software": packages
        },
        "system": {
            "os": {
                "name": system_info["os"].get("distribution", system_info["os"]["name"]),
                "version": system_info["os"]["version"],
                "architecture": system_info["os"]["architecture"]
            },
            "hostname": HOSTNAME,
            "agentVersion": "0.4.26-linux"
        }
    }
    
    try:
        resp = requests.post(f"{API_URL}/inventory/full", json=payload, headers=get_headers(), timeout=30)
        if resp.status_code == 200:
            log.info(f"✅ Full inventory sent: {len(packages)} packages")
            return True
        else:
            log.warning(f"Inventory response: {resp.status_code} - {resp.text[:200]}")
            return False
    except Exception as e:
        log.error(f"❌ Inventory failed: {e}")
        return False

def send_metrics():
    """Send metrics to backend"""
    metrics = get_metrics()
    
    payload = {
        "hostname": HOSTNAME,
        "nodeId": HOSTNAME,
        "cpu_percent": metrics["cpu"],
        "ram_percent": metrics["memory"],
        "disk_percent": metrics["disk"],
        "network_in_mb": metrics["netIn"],
        "network_out_mb": metrics["netOut"]
    }
    
    try:
        resp = requests.post(f"{API_URL}/nodes/{HOSTNAME}/metrics", json=payload, headers=get_headers(), timeout=10)
        if resp.status_code == 200:
            log.debug(f"💓 Metrics sent: CPU={metrics['cpu']:.1f}%, RAM={metrics['memory']:.1f}%")
            return True
    except Exception as e:
        log.error(f"Metrics failed: {e}")
    return False

def main():
    log.info("═" * 50)
    log.info(f"OpenClaw Linux Agent v0.4.26")
    log.info(f"Hostname: {HOSTNAME}")
    log.info(f"API: {API_URL}")
    log.info("═" * 50)
    
    # Send initial full inventory (this registers the node)
    send_full_inventory()
    
    last_inventory = time.time()
    
    # Main loop
    while True:
        try:
            # Send metrics every interval
            send_metrics()
            
            # Send full inventory every 5 minutes
            if time.time() - last_inventory > 300:
                send_full_inventory()
                last_inventory = time.time()
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            log.info("Shutting down...")
            break
        except Exception as e:
            log.error(f"Error: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
AGENT_EOF

chmod +x agent.py

# Create config file
cat > config.env << EOF
OPENCLAW_API_URL=$API_URL
OPENCLAW_API_KEY=$API_KEY
OPENCLAW_POLL_INTERVAL=30
EOF

# Create systemd service
echo "⚙️ Creating systemd service..."
cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=OpenClaw Linux Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/config.env
ExecStart=$INSTALL_DIR/venv/bin/python3 $INSTALL_DIR/agent.py
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
echo "🚀 Starting service..."
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl start $SERVICE_NAME

# Show status
sleep 2
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "   ✅ OpenClaw Linux Agent Installed!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Service Status:"
systemctl status $SERVICE_NAME --no-pager | head -10
echo ""
echo "Commands:"
echo "  sudo systemctl status $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo "  sudo tail -f /var/log/openclaw-agent.log"
echo ""
