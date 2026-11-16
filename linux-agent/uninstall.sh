#!/usr/bin/env bash
#
# Removes the Octofleet Linux agent from this machine.
#
# The Octofleet console does the same through the "uninstall-agent" job (Remove node).
# Run this by hand, as root, on machines the console can no longer reach; then delete the
# node in the console.
#
#   sudo ./uninstall.sh
#
set -euo pipefail

INSTALL_DIR="/opt/octofleet-agent"
SERVICE_NAME="octofleet-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
LOG_FILE="/var/log/octofleet-agent.log"
LOGROTATE_FILE="/etc/logrotate.d/octofleet-agent"

if [[ $EUID -ne 0 ]]; then
    echo "❌ Please run as root (sudo)" >&2
    exit 1
fi

if command -v systemctl &>/dev/null; then
    systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
fi
rm -rf "$INSTALL_DIR"
rm -f "$LOG_FILE" "$LOG_FILE".*
# the agent's logrotate configuration, unless an administrator took it over (marker line removed)
if grep -qF "# octofleet-agent: managed" "$LOGROTATE_FILE" 2>/dev/null; then
    rm -f "$LOGROTATE_FILE"
fi

echo "✅ Octofleet agent removed. Delete the node in the Octofleet console if it is still listed."
