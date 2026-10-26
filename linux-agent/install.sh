#!/usr/bin/env bash
# Octofleet Linux Agent Installer
#
# Installs linux-agent/agent.sh as a systemd service.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/linux-agent/install.sh | sudo bash -s -- \
#     --api-url http://YOUR_SERVER:8080 --api-key YOUR_API_KEY [--node-id NAME] [--ref main]
#
#   API_URL / API_KEY / NODE_ID environment variables are accepted as well
#   (use "sudo -E" or "sudo API_URL=... API_KEY=... bash install.sh").
#
# When run from a repository checkout, the local agent.sh and
# octofleet-agent.service are installed; otherwise they are downloaded
# from GitHub at --ref (default: main).

set -euo pipefail

INSTALL_DIR="/opt/octofleet-agent"
SERVICE_NAME="octofleet-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
REPO_RAW="https://raw.githubusercontent.com/BenediktSchackenberg/octofleet"

API_URL="${API_URL:-}"
API_KEY="${API_KEY:-}"
NODE_ID="${NODE_ID:-}"
REF="${OCTOFLEET_REF:-main}"

usage() {
    cat <<USAGE
Usage: install.sh --api-url URL --api-key KEY [--node-id NAME] [--ref GIT_REF]

  --api-url   Octofleet API, e.g. http://your-server:8080 (without /api/v1)
  --api-key   Octofleet API key
  --node-id   Node identifier (default: hostname)
  --ref       Git ref to download agent files from (default: main)
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --api-url) API_URL="${2:-}"; shift 2 ;;
        --api-key) API_KEY="${2:-}"; shift 2 ;;
        --node-id) NODE_ID="${2:-}"; shift 2 ;;
        --ref)     REF="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "❌ Unknown option: $1" >&2; usage >&2; exit 1 ;;
    esac
done

echo "═══════════════════════════════════════════════════════════"
echo "   Octofleet Linux Agent Installer"
echo "═══════════════════════════════════════════════════════════"

if [[ "$EUID" -ne 0 ]]; then
    echo "❌ Please run as root (sudo)" >&2
    exit 1
fi

if [[ -z "$API_URL" || -z "$API_KEY" ]]; then
    echo "❌ --api-url and --api-key are required." >&2
    echo "" >&2
    usage >&2
    exit 1
fi

# agent.sh appends /api/v1 itself
API_URL="${API_URL%/}"
API_URL="${API_URL%/api/v1}"

# Dependencies used by agent.sh
missing=()
for cmd in curl jq bc; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
done
if [[ ${#missing[@]} -gt 0 ]]; then
    echo "📦 Installing dependencies: ${missing[*]}"
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq && apt-get install -y -qq "${missing[@]}"
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y -q "${missing[@]}"
    elif command -v yum >/dev/null 2>&1; then
        yum install -y -q "${missing[@]}"
    elif command -v pacman >/dev/null 2>&1; then
        pacman -Sy --noconfirm "${missing[@]}"
    else
        echo "❌ Please install: ${missing[*]}" >&2
        exit 1
    fi
fi

# Source of agent files: local checkout or GitHub
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/agent.sh" && -f "$SCRIPT_DIR/octofleet-agent.service" ]]; then
    echo "📁 Using agent files from $SCRIPT_DIR"
    cp "$SCRIPT_DIR/agent.sh" "$SCRIPT_DIR/octofleet-agent.service" "$TMP_DIR/"
else
    echo "⬇️  Downloading agent files ($REF)..."
    curl -fsSL "$REPO_RAW/$REF/linux-agent/agent.sh" -o "$TMP_DIR/agent.sh"
    curl -fsSL "$REPO_RAW/$REF/linux-agent/octofleet-agent.service" -o "$TMP_DIR/octofleet-agent.service"
fi
bash -n "$TMP_DIR/agent.sh"

echo "📝 Installing agent to $INSTALL_DIR..."
install -d -m 700 "$INSTALL_DIR"
# Remove the embedded Python agent installed by earlier versions of this script
rm -rf "$INSTALL_DIR/venv" "$INSTALL_DIR/agent.py"
install -m 755 "$TMP_DIR/agent.sh" "$INSTALL_DIR/agent.sh"

# config.env contains the API key: readable by root only. agent.sh sources it and the
# unit reads it as EnvironmentFile; %q quotes each value so that both read it back
# exactly, even with $, `, quotes or spaces.
(
    umask 077
    {
        printf 'API_URL=%q\n' "$API_URL"
        printf 'API_KEY=%q\n' "$API_KEY"
        printf 'NODE_ID=%q\n' "${NODE_ID:-$(hostname)}"
        printf 'PUSH_INTERVAL=1800\n'
        printf 'JOB_POLL_INTERVAL=60\n'
        printf 'LIVE_DATA_INTERVAL=5\n'
    } > "$INSTALL_DIR/config.env"
)
chmod 600 "$INSTALL_DIR/config.env"

echo "⚙️  Installing systemd service..."
install -m 644 "$TMP_DIR/octofleet-agent.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"

sleep 2
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "   ✅ Octofleet Linux Agent installed ($("$INSTALL_DIR/agent.sh" version 2>/dev/null | tail -1))"
echo "═══════════════════════════════════════════════════════════"
echo ""
systemctl --no-pager status "$SERVICE_NAME" | head -5 || true
echo ""
echo "Commands:"
echo "  sudo systemctl status $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo "  sudo tail -f /var/log/octofleet-agent.log"
