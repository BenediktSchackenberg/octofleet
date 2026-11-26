#!/usr/bin/env bash
# Tests for collect_updates in linux-agent/agent.sh with apt: package name, new version,
# suite and security flag from "apt list --upgradable". Runs without network or root:
# apt-get and apt are replaced by fake commands in a temporary PATH directory.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only collect_updates: sourcing agent.sh would start the agent. Its JSON
# here-document has a "}" at the start of a line, so the function ends at the
# first "}" line after "EOF".
eval "$(awk '/^collect_updates\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
eval "$(awk '/^os_release_json\(\) \{/ { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
for fn in collect_updates os_release_json; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
OS_RELEASE_FILE=$(mktemp); export OS_RELEASE_FILE
# the reboot marker of the test, never the host's /var/run/reboot-required
REBOOT_REQUIRED_FILE="$OS_RELEASE_FILE.reboot-required"; export REBOOT_REQUIRED_FILE
cat > "$OS_RELEASE_FILE" <<'REL'
PRETTY_NAME="Ubuntu 26.04 LTS"
NAME="Ubuntu"
VERSION_ID="26.04"
# a comment
ID=ubuntu
ID_LIKE=debian
REL

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

# run_case APT_OUTPUT: collect_updates with a fake apt printing APT_OUTPUT. Sets OUT.
run_case() {
    local bin; bin=$(mktemp -d)
    printf '#!/bin/sh\nexit 0\n' > "$bin/apt-get"
    printf '#!/bin/sh\ncat <<'"'"'EOF'"'"'\n%s\nEOF\n' "$1" > "$bin/apt"
    chmod +x "$bin/apt-get" "$bin/apt"
    OUT=$(PATH="$bin:$PATH" collect_updates)
    rm -rf "$bin"
}
field() { jq -r "$1" <<< "$OUT"; }
valid_json() { jq -e . <<< "$OUT" >/dev/null 2>&1; }

# Two packages, one of them from a security suite (real line format of apt 3.x)
run_case 'Listing... Done
systemd/resolute-updates 259.2-1ubuntu3.1 amd64 [upgradable from: 259.2-1ubuntu3]
openssl/resolute-security,resolute-updates 3.5.1-1ubuntu2.1 amd64 [upgradable from: 3.5.1-1ubuntu2]'
check "output is valid JSON" valid_json
check "package manager is apt" [ "$(field .packageManager)" = "apt" ]
check "two updates counted" [ "$(field .totalUpdates)" = "2" ]
check "one security update counted" [ "$(field .securityUpdates)" = "1" ]
check "newVersion is the version, not the suite" [ "$(field '.updates[] | select(.name == "systemd") | .newVersion')" = "259.2-1ubuntu3.1" ]
check "repository is the suite" [ "$(field '.updates[] | select(.name == "systemd") | .repository')" = "resolute-updates" ]
check "systemd is not a security update" [ "$(field '.updates[] | select(.name == "systemd") | .security')" = "false" ]
check "openssl from -security is a security update" [ "$(field '.updates[] | select(.name == "openssl") | .security')" = "true" ]
check "architecture of each update" [ "$(field '[.updates[].arch] | join(",")')" = "amd64,amd64" ]
check "installed version from 'upgradable from:'" [ "$(field '.updates[] | select(.name == "systemd") | .installedVersion')" = "259.2-1ubuntu3" ]
check "release from /etc/os-release (quotes removed, comments ignored)" \
    [ "$(field '.release | [.id, .versionId, .idLike, .name] | join("|")')" = "ubuntu|26.04|debian|Ubuntu" ]

# A line without "upgradable from:" (other apt versions): no installed version, still valid
run_case 'Listing... Done
curl/resolute-updates 8.14.1-2ubuntu1 amd64'
check "no 'upgradable from:': installedVersion null" [ "$(field '.updates[0].installedVersion')" = "null" ] && valid_json

# Without /etc/os-release: release null, the rest unchanged
OS_RELEASE_FILE=/nonexistent run_case 'Listing... Done
curl/resolute-updates 8.14.1-2ubuntu1 amd64 [upgradable from: 8.14.1-2]'
check "no os-release: release null, valid JSON" [ "$(field .release)" = "null" ] && [ "$(field .totalUpdates)" = "1" ]

# Nothing to upgrade
run_case 'Listing... Done'
check "empty list: valid JSON" valid_json
check "empty list: no updates" [ "$(field '.updates | length')" = "0" ] && [ "$(field .totalUpdates)" = "0" ]
check "empty list: no security updates" [ "$(field .securityUpdates)" = "0" ]

# Reboot flag and the scan block of a patch_scan job
check "no reboot marker: rebootRequired false with apt" [ "$(field .rebootRequired)" = "false" ]
check "no reboot marker: rebootPackages empty" [ "$(field '.rebootPackages | type')" = "array" ] && [ "$(field '.rebootPackages | length')" = "0" ]
touch "$REBOOT_REQUIRED_FILE"; printf 'linux-image-7.0.0-44-generic\nlinux-base\nlinux-base\n' > "$REBOOT_REQUIRED_FILE.pkgs"
run_case 'Listing... Done'
check "reboot marker: rebootRequired true" [ "$(field .rebootRequired)" = "true" ]
check "reboot marker: rebootPackages from reboot-required.pkgs, once each" [ "$(field '.rebootPackages | join(",")')" = "linux-base,linux-image-7.0.0-44-generic" ]
rm -f "$REBOOT_REQUIRED_FILE" "$REBOOT_REQUIRED_FILE.pkgs"
run_case 'Listing... Done'
check "no scan block outside a patch_scan job" [ "$(field .scan)" = "null" ]
PATCH_SCAN_JSON='{"status":"partial","source":"apt","error":"W: Failed to fetch","duration_seconds":3}'
run_case 'Listing... Done'
unset PATCH_SCAN_JSON
check "the scan block of a patch_scan job is sent with the updates" [ "$(field .scan.status)" = "partial" ] && valid_json

rm -f "$OS_RELEASE_FILE"
echo
if [ "$failures" -eq 0 ]; then echo "All apt update tests passed"; else echo "$failures apt update test(s) failed"; fi
exit $(( failures > 0 ))
