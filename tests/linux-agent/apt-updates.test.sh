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
declare -F collect_updates >/dev/null || { echo "collect_updates not found in $AGENT"; exit 2; }

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

# Nothing to upgrade
run_case 'Listing... Done'
check "empty list: valid JSON" valid_json
check "empty list: no updates" [ "$(field '.updates | length')" = "0" ] && [ "$(field .totalUpdates)" = "0" ]
check "empty list: no security updates" [ "$(field .securityUpdates)" = "0" ]

echo
if [ "$failures" -eq 0 ]; then echo "All apt update tests passed"; else echo "$failures apt update test(s) failed"; fi
exit $(( failures > 0 ))
