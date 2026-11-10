#!/usr/bin/env bash
# Tests for the mount list shared by the Hardware and Linux tabs (_mounted_filesystems in
# linux-agent/agent.sh), the used share as df shows it, and the names of DRM-only display
# adapters. Runs without root: findmnt is replaced by a fake command in a temporary PATH directory.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only the helpers: sourcing agent.sh would start the agent.
eval "$(awk '/^_mounted_filesystems\(\) \{/ { f = 1 } f && /^collect_hardware\(\) \{/ { exit } f { print }' "$AGENT")"
for fn in _mounted_filesystems _drm_display_name; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
[[ -n "${_USED_PERCENT_JQ:-}" ]] || { echo "_USED_PERCENT_JQ not found in $AGENT"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

# findmnt output after its own -t filter: the root filesystem, the same filesystem mounted again
# (as container runtimes do), a bind mount of a directory, a filesystem with size 0 and /boot.
bin=$(mktemp -d)
cat > "$bin/findmnt" <<'EOF'
#!/bin/sh
cat <<'JSON'
{"filesystems": [
  {"source": "/dev/mapper/vg-root", "fstype": "ext4", "size": 65174941696, "used": 37964017664, "avail": 23867015168, "target": "/", "fsroot": "/", "options": "rw,relatime"},
  {"source": "/dev/mapper/vg-root", "fstype": "ext4", "size": 65174941696, "used": 37964017664, "avail": 23867015168, "target": "/var/lib/docker/rootfs/x", "fsroot": "/", "options": "rw,relatime"},
  {"source": "/dev/mapper/vg-root", "fstype": "ext4", "size": 65174941696, "used": 37964017664, "avail": 23867015168, "target": "/srv/data", "fsroot": "/var/data", "options": "rw,relatime"},
  {"source": "proc", "fstype": "proc", "size": 0, "used": 0, "avail": 0, "target": "/proc", "fsroot": "/", "options": "rw"},
  {"source": "/dev/sda2", "fstype": "ext4", "size": 2040373248, "used": 194043904, "avail": 1722179584, "target": "/boot", "fsroot": "/", "options": "rw"}
]}
JSON
EOF
chmod +x "$bin/findmnt"
OUT=$(PATH="$bin:$PATH" _mounted_filesystems)
rm -rf "$bin"

valid_json() { jq -e . <<< "$OUT" >/dev/null 2>&1; }
check "output is valid JSON" valid_json
check "two filesystems: / and /boot" [ "$(jq -r '[.[].target] | join(",")' <<< "$OUT")" = "/,/boot" ]
check "sizes are numbers" [ "$(jq -r '.[0].size | type' <<< "$OUT")" = "number" ]
PERCENT=$(jq -r ".[] | select(.target == \"/\") | $_USED_PERCENT_JQ" <<< "$OUT")
check "used share as df: used / (used + available) = 61.4 %" [ "$PERCENT" = "61.4" ]
check "empty filesystem: 0 %" [ "$(jq -r "$_USED_PERCENT_JQ" <<< '{"used": 0, "avail": 0}')" = "0" ]

check "Hyper-V display adapter has a readable name" [ "$(_drm_display_name hyperv_drm)" = "Microsoft Hyper-V Video" ]
check "unknown DRM driver keeps its name" [ "$(_drm_display_name foo_drm)" = "foo_drm" ]

echo
if [ "$failures" -eq 0 ]; then echo "All filesystem tests passed"; else echo "$failures filesystem test(s) failed"; fi
exit $(( failures > 0 ))
