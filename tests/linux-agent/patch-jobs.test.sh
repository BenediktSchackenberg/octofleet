#!/usr/bin/env bash
# Tests for the patch_scan and patch_install jobs of the Linux agent (linux-agent/agent.sh).
# Runs without network or root: PATH holds only fake package managers and the few tools the
# functions need, so a real apt-get, dnf or yum can never run.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only the functions under test: sourcing agent.sh would start the agent. execute_job has a
# JSON here-document with a "}" at the start of a line, so it ends at the first "}" after "EOF".
eval "$(awk '/^package_manager\(\) \{/ { f = 1 } /^execute_job\(\) \{/ { exit } f { print }' "$AGENT")"
eval "$(awk '/^execute_job\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
for fn in package_manager refresh_package_lists run_patch_scan run_patch_install execute_job; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
info() { :; }; warn() { :; }
# push_inventory: record the scan block it would send with the update list
push_inventory() { printf '%s\n' "${PATCH_SCAN_JSON:-none}" >> "$WORK/inventory"; return 0; }
curl() {  # the result POST
    while [ $# -gt 0 ]; do
        case "$1" in -d) printf '%s' "$2" > "$WORK/result"; shift ;; esac
        shift
    done
}
API_URL="http://server.invalid"; API_KEY="test"

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d)
TOOLS="$WORK/tools"; mkdir -p "$TOOLS"
for tool in bash sh jq timeout tail head grep sort paste cat sleep printf env date; do
    ln -s "$(command -v "$tool")" "$TOOLS/$tool"
done
export WORK

# fake NAME EXIT OUTPUT [SLEEP]: a package manager command that logs its arguments (and
# DEBIAN_FRONTEND) to $WORK/calls, prints OUTPUT and exits with EXIT
fake() {
    cat > "$TOOLS/$1" <<EOF
#!/bin/bash
echo "$1 \$* [DEBIAN_FRONTEND=\${DEBIAN_FRONTEND:-}]" >> "\$WORK/calls"
${4:+sleep $4}
cat <<'OUT'
$3
OUT
exit $2
EOF
    chmod +x "$TOOLS/$1"
}
clear_fakes() { rm -f "$TOOLS/apt-get" "$TOOLS/dnf" "$TOOLS/yum" "$TOOLS/pacman"; }

# run_job TYPE PAYLOAD [JOB_TIMEOUT]: execute_job with that job; RESULT holds the reported result
run_job() {
    rm -f "$WORK/result" "$WORK/calls" "$WORK/inventory"
    local job
    job=$(jq -cn --arg t "$1" --arg p "$2" '{instanceId: "i-1", jobName: "test", commandType: $t, commandPayload: $p}')
    [ -n "${3:-}" ] && job=$(jq -c --argjson s "$3" '. + {timeoutSeconds: $s}' <<< "$job")
    PATH="$TOOLS" execute_job "$job"
    RESULT=$(cat "$WORK/result" 2>/dev/null)
}
field() { jq -r "$1" <<< "$RESULT"; }
scan() { tail -n 1 "$WORK/inventory" | jq -r "$1"; }
calls() { cat "$WORK/calls" 2>/dev/null; }

# --- patch_scan with apt ---
clear_fakes; fake apt-get 0 'Hit:1 http://archive.example/ubuntu resolute InRelease
Reading package lists...'
run_job patch_scan '{}'
check "apt scan: success" [ "$(field .success)" = "true" ]
check "apt scan: apt-get update, non-interactive" grep -q "^apt-get -q update .*\[DEBIAN_FRONTEND=noninteractive\]" <<< "$(calls)"
check "apt scan: the inventory is sent with the scan block" [ "$(scan .status)" = "succeeded" ] && [ "$(scan .source)" = "apt" ]
check "apt scan: no error" [ "$(scan .error)" = "null" ]
check "apt scan: the output names the result" grep -q "refreshed with apt: succeeded" <<< "$(field .stdout)"

fake apt-get 0 'Hit:1 http://archive.example/ubuntu resolute InRelease
Err:2 http://mirror.example/repo stable InRelease
  Could not resolve mirror.example
W: Failed to fetch http://mirror.example/repo/dists/stable/InRelease  Could not resolve mirror.example
W: Some index files failed to download. They have been ignored, or old ones used instead.'
run_job patch_scan '{}'
check "apt scan with a failed repository: partial" [ "$(scan .status)" = "partial" ]
check "apt scan with a failed repository: the job still succeeds" [ "$(field .success)" = "true" ]
check "apt scan with a failed repository: the error names it" grep -q "Failed to fetch" <<< "$(scan .error)"

fake apt-get 100 'E: Could not get lock /var/lib/apt/lists/lock. It is held by process 1234 (apt-get)'
run_job patch_scan '{}'
check "apt scan failed: the job fails" [ "$(field .success)" = "false" ]
check "apt scan failed: status failed with the error" [ "$(scan .status)" = "failed" ] && grep -q "Could not get lock" <<< "$(scan .error)"
check "apt scan failed: the inventory is still sent" [ "$(wc -l < "$WORK/inventory")" = "1" ]

fake apt-get 0 'Reading package lists...' 5
run_job patch_scan '{"timeout": 1}'
check "apt scan: the payload's timeout stops it" [ "$(scan .status)" = "failed" ] && [ "$(scan .error)" = "Timed out after 1 s" ]
run_job patch_scan '{}' 1
check "apt scan: without one, the job's timeoutSeconds" [ "$(scan .error)" = "Timed out after 1 s" ]

# --- patch_install with apt ---
clear_fakes; fake apt-get 0 'Setting up openssl (3.5.1-1ubuntu2.1) ...'
run_job patch_install '{}'
check "apt install: success" [ "$(field .success)" = "true" ]
check "apt install: all upgrades (with new dependencies), -y, non-interactive" \
    grep -q "^apt-get -q -y .*--with-new-pkgs upgrade \[DEBIAN_FRONTEND=noninteractive\]" <<< "$(calls)"
check "apt install: keeps changed configuration files" grep -q -- "--force-confold" <<< "$(calls)"
check "apt install: the output has the package manager's lines" grep -q "Setting up openssl" <<< "$(field .stdout)"
check "apt install: says whether a reboot is required" grep -qE "^Reboot required: (yes|no)" <<< "$(field .stdout)"
check "apt install: the inventory is sent afterwards (no scan block)" [ "$(cat "$WORK/inventory")" = "none" ]

run_job patch_install '{"packages": ["openssl", "libssl3t64"]}'
check "apt install of named packages: only upgrades them" \
    grep -q "install --only-upgrade openssl libssl3t64 " <<< "$(calls)"

run_job patch_install '{"packages": ["openssl; touch /tmp/x"]}'
check "invalid package name: the job fails" [ "$(field .success)" = "false" ] && grep -q "Invalid package name" <<< "$(field .stdout)"
check "invalid package name: apt-get is not called" [ -z "$(calls)" ]
run_job patch_install '{"packages": ["-o", "APT::Get::Trivial-Only=false"]}'
check "an option as a package name is rejected" [ "$(field .success)" = "false" ] && [ -z "$(calls)" ]

fake apt-get 100 'E: Unable to locate package nosuchpackage'
run_job patch_install '{"packages": ["nosuchpackage"]}'
check "apt install failed: the job fails with apt-get's exit code" \
    [ "$(field .success)" = "false" ] && [ "$(field .exitCode)" = "100" ]
check "apt install failed: the error is in the output" grep -q "Unable to locate package" <<< "$(field .stdout)"

# --- dnf ---
clear_fakes; fake dnf 0 'Metadata cache created.'
run_job patch_scan '{}'
check "dnf scan: dnf makecache" grep -q "^dnf -q makecache" <<< "$(calls)" && [ "$(scan .source)" = "dnf" ]
check "dnf scan: succeeded" [ "$(scan .status)" = "succeeded" ] && [ "$(field .success)" = "true" ]
run_job patch_install '{"packages": ["openssl"]}'
check "dnf install: dnf -y upgrade with the packages" grep -q "^dnf -y upgrade openssl " <<< "$(calls)"
fake dnf 1 'Error: Failed to download metadata for repo'
run_job patch_scan '{}'
check "dnf scan failed: status failed with the error" [ "$(scan .status)" = "failed" ] && grep -q "Failed to download metadata" <<< "$(scan .error)"

# --- pacman and no package manager ---
clear_fakes; fake pacman 0 ''
run_job patch_scan '{}'
check "pacman scan: not supported (no partial upgrades)" [ "$(field .success)" = "false" ] && grep -q "not supported with pacman" <<< "$(scan .error)"
check "pacman scan: pacman is not called" [ -z "$(calls)" ]
run_job patch_install '{}'
check "pacman install: not supported" [ "$(field .success)" = "false" ] && grep -q "not supported with pacman" <<< "$(field .stdout)"

clear_fakes
run_job patch_scan '{}'
check "no package manager: scan failed with a reason" [ "$(field .success)" = "false" ] && grep -q "No supported package manager" <<< "$(scan .error)"
run_job patch_install '{}'
check "no package manager: install failed with a reason" [ "$(field .success)" = "false" ] && grep -q "No supported package manager" <<< "$(field .stdout)"

rm -rf "$WORK"
echo
if [ "$failures" -eq 0 ]; then echo "All patch job tests passed"; else echo "$failures patch job test(s) failed"; fi
exit $(( failures > 0 ))
