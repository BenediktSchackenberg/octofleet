#!/usr/bin/env bash
# Start the PXE stack with the configuration exported from the Octofleet menu.
# Usage: ./provisioning/setup-pxe.sh [path/to/pxe.env]
# Prepare storage, ISO mounts and bootloaders as described in docs/PROVISIONING-CONFIGURATION.md.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${1:-${PXE_CONFIG_FILE:-$SCRIPT_DIR/pxe.env}}"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Export PXE configuration from Settings > Provisioning and save it as $CONFIG_FILE" >&2
    exit 1
fi
if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    echo "Run this script from an Octofleet checkout containing provisioning/docker-compose.yml." >&2
    exit 1
fi
command -v docker >/dev/null || { echo "Install Docker Engine and the Compose plugin first." >&2; exit 1; }
CONFIG_FILE="$(cd -- "$(dirname -- "$CONFIG_FILE")" && pwd)/$(basename -- "$CONFIG_FILE")"
docker compose --project-directory "$SCRIPT_DIR" --env-file "$CONFIG_FILE" -f "$SCRIPT_DIR/docker-compose.yml" config --quiet
docker compose --project-directory "$SCRIPT_DIR" --env-file "$CONFIG_FILE" -f "$SCRIPT_DIR/docker-compose.yml" up -d --build --force-recreate
echo "PXE stack started. Configure the existing DHCP server to use this host and its iPXE bootloader."
