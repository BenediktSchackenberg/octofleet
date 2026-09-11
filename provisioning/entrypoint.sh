#!/bin/bash
set -euo pipefail

# Canonical values come from the menu's pxe.env export. Keep legacy PXE_SERVER_IP
# as an explicit input for existing installations; never guess a LAN address.
export PXE_HTTP_PORT="${PXE_HTTP_PORT:-9080}"
export PXE_SERVER_URL="${PXE_SERVER_URL:-${PXE_SERVER:-}}"
if [ -z "$PXE_SERVER_URL" ] && [ -n "${PXE_SERVER_IP:-}" ]; then
    export PXE_SERVER_URL="http://${PXE_SERVER_IP}:${PXE_HTTP_PORT}"
fi
: "${PXE_SERVER_URL:?Set PXE_SERVER_URL in Settings > Provisioning and export pxe.env}"
export OCTOFLEET_API="${OCTOFLEET_API:-${API_SERVER:-}}"
: "${OCTOFLEET_API:?Set the API address in Settings > Provisioning}"
export TFTP_ROOT="${TFTP_ROOT:-/tftpboot}"
export PROVISIONING_IMAGES_PATH="${PROVISIONING_IMAGES_PATH:-/srv/images}"
export PROVISIONING_DRIVERS_PATH="${PROVISIONING_DRIVERS_PATH:-/srv/drivers}"
export PROVISIONING_ANSWERS_PATH="${PROVISIONING_ANSWERS_PATH:-/srv/answers}"
export PROVISIONING_BOOT_PATH="${PROVISIONING_BOOT_PATH:-/srv/boot}"
export PROVISIONING_SCRIPTS_PATH="${PROVISIONING_SCRIPTS_PATH:-/srv/scripts}"
export PROVISIONING_WINDOWS_INSTALL_PATH="${PROVISIONING_WINDOWS_INSTALL_PATH:-/srv/wininstall}"
export PROVISIONING_MOUNT_BASE="${PROVISIONING_MOUNT_BASE:-/mnt}"
export API_SERVER="${API_SERVER:-$OCTOFLEET_API}"
export NFS_HOST="${NFS_SERVER:-}"
if [[ "$NFS_HOST" == *:* ]]; then NFS_HOST="[$NFS_HOST]"; fi
if [ -z "${NFS_EXPORT_PATH:-}" ]; then
    export NFS_EXPORT_PATH='/mnt/ubuntu-{version}'
fi
export NFS_PATH_2404="${NFS_EXPORT_PATH//\{version\}/24.04}"
export NFS_PATH_2204="${NFS_EXPORT_PATH//\{version\}/22.04}"
pxe_scheme="${PXE_SERVER_URL%%://*}"
pxe_location="${PXE_SERVER_URL#*://}"
pxe_authority="${pxe_location%%/*}"
export PXE_GRUB_BASE="($pxe_scheme,$pxe_authority)${pxe_location#"$pxe_authority"}"

mkdir -p "$TFTP_ROOT" /run/nginx

cat > /etc/dnsmasq.conf <<EOF
port=0
enable-tftp
tftp-root=${TFTP_ROOT}
log-dhcp
log-facility=-
EOF
if [ -n "${PXE_INTERFACE:-}" ]; then
    printf 'interface=%s\nbind-interfaces\n' "$PXE_INTERFACE" >> /etc/dnsmasq.conf
fi
# Leave addressing to the existing DHCP service. ProxyDHCP is optional.
if [ -n "${PXE_PROXY_DHCP_SUBNET:-}" ]; then
    cat >> /etc/dnsmasq.conf <<EOF
dhcp-range=${PXE_PROXY_DHCP_SUBNET},proxy
pxe-service=x86-64_EFI,"Octofleet PXE",ipxe.efi
pxe-service=x86PC,"Octofleet PXE",undionly.kpxe
EOF
fi

envsubst '${PXE_SERVER_URL}' < /etc/octofleet/boot.ipxe.template > "$TFTP_ROOT/boot.ipxe"
for template in /etc/octofleet/tftp-templates/*.ipxe /etc/octofleet/tftp-templates/grub/*.cfg; do
    [ -f "$template" ] || continue
    relative="${template#/etc/octofleet/tftp-templates/}"
    [ "$relative" = "boot.ipxe" ] && continue
    mkdir -p "$(dirname "$TFTP_ROOT/$relative")"
    envsubst '${PXE_SERVER_URL} ${API_SERVER} ${NFS_HOST} ${NFS_PATH_2404} ${NFS_PATH_2204} ${PXE_GRUB_BASE}' < "$template" > "$TFTP_ROOT/$relative"
done
envsubst '${PXE_HTTP_PORT} ${OCTOFLEET_API} ${TFTP_ROOT} ${PROVISIONING_IMAGES_PATH} ${PROVISIONING_DRIVERS_PATH} ${PROVISIONING_ANSWERS_PATH} ${PROVISIONING_BOOT_PATH} ${PROVISIONING_SCRIPTS_PATH} ${PROVISIONING_WINDOWS_INSTALL_PATH} ${PROVISIONING_MOUNT_BASE}' \
    < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

nginx -t
dnsmasq --test
if [ "${1:-}" = "--check" ]; then
    exit 0
fi
nginx
echo "Octofleet PXE ready: ${PXE_SERVER_URL} (HTTP listener ${PXE_HTTP_PORT})"
exec dnsmasq --no-daemon --log-facility=-
