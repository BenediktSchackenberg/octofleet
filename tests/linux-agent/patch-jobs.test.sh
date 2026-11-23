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
for fn in package_manager run_package_command refresh_package_lists run_patch_scan run_patch_install schedule_system_reboot execute_job; do
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
unset INVOCATION_ID  # not under systemd unless a test says so
for tool in bash sh jq timeout tail head grep sort paste cat sleep printf env date mktemp rm awk sed; do
    ln -s "$(command -v "$tool")" "$TOOLS/$tool"
done
export WORK PACKAGE_OUTPUT_DIR="$WORK"

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
run_job patch_install '{"all": true}'
check "apt install: success" [ "$(field .success)" = "true" ]
check "apt install: all upgrades (with new dependencies), -y, non-interactive" \
    grep -q "^apt-get -q -y .*--with-new-pkgs upgrade \[DEBIAN_FRONTEND=noninteractive\]" <<< "$(calls)"
check "apt install: keeps changed configuration files" grep -q -- "--force-confold" <<< "$(calls)"
check "apt install: the output has the package manager's lines" grep -q "Setting up openssl" <<< "$(field .stdout)"
check "apt install: says whether a reboot is required" grep -qE "^Reboot required: (yes|no)" <<< "$(field .stdout)"
check "apt install: then an update search (apt-get update after the upgrade)" \
    bash -c 'grep -n "" <<< "$1" | grep -q "^2:apt-get -q update"' _ "$(calls)"
check "apt install: the inventory is sent with that search" [ "$(scan .status)" = "succeeded" ]
check "apt install: the output names the search" grep -q "^Update search afterwards: succeeded" <<< "$(field .stdout)"

run_job patch_install '{}'
check "install without an explicit target fails" [ "$(field .success)" = "false" ] && [ -z "$(calls)" ]
run_job patch_install '{"kb_ids": ["KB1234567"]}'
check "Windows KB IDs cannot trigger all Linux updates" [ "$(field .success)" = "false" ] && [ -z "$(calls)" ]
run_job patch_install '{"packages": [123]}'
check "invalid package array cannot trigger all updates" [ "$(field .success)" = "false" ] && [ -z "$(calls)" ]

run_job patch_install '{"packages": ["openssl", "libssl3t64"]}'
check "apt install of named packages: only upgrades them" \
    grep -q "install --only-upgrade openssl libssl3t64 " <<< "$(calls)"

run_job patch_install '{"packages": [{"name": "openssl", "version": "3.5.1-1ubuntu2.1"}, "libssl3t64"]}'
check "apt install of exact versions: name=version (names without one: newest)" \
    grep -q "install --only-upgrade openssl=3.5.1-1ubuntu2.1 libssl3t64 " <<< "$(calls)"
run_job patch_install '{"packages": [{"name": "openssl", "version": "1; touch /tmp/x"}]}'
check "invalid version: the job fails, apt-get is not called" \
    [ "$(field .success)" = "false" ] && grep -q "Invalid version" <<< "$(field .stdout)" && [ -z "$(calls)" ]
run_job patch_install '{"packages": [{"name": "openssl", "version": ""}]}'
check "empty version is rejected (never 'newest' by accident)" [ "$(field .success)" = "false" ] && [ -z "$(calls)" ]
run_job patch_install '{"packages": [{"name": "openssl"}]}'
check "object without a version is rejected" [ "$(field .success)" = "false" ] && [ -z "$(calls)" ]

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

# --- what an installation really changed: the pending updates before and after it ---
# lists BEFORE AFTER: a fake apt whose "list --upgradable" answers BEFORE the first time (before the
# installation) and AFTER from then on
lists() {
    printf "%s\n" "$1" > "$WORK/list-1"; printf "%s\n" "$2" > "$WORK/list-2"; rm -f "$WORK/list-n"
    cat > "$TOOLS/apt" <<'FAKE'
#!/bin/bash
n=$(( $(cat "$WORK/list-n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$WORK/list-n"
echo "Listing..."
cat "$WORK/list-$(( n > 2 ? 2 : n ))"
FAKE
    chmod +x "$TOOLS/apt"
}
PENDING='sos/noble-updates,noble-security 4.9.2-0ubuntu0~24.04.1 all [upgradable from: 4.8.2-0ubuntu0~24.04.2]
distro-info/noble-updates 1.7build1.1 amd64 [upgradable from: 1.7build1]
snapd/noble-updates 2.68.5+ubuntu24.04 amd64 [upgradable from: 2.67.1+24.04]'
HELD='distro-info/noble-updates 1.7build1.1 amd64 [upgradable from: 1.7build1]
snapd/noble-updates 2.68.5+ubuntu24.04 amd64 [upgradable from: 2.67.1+24.04]'
clear_fakes; fake apt-get 0 'The following upgrades have been deferred due to phasing:
  distro-info snapd
The following packages will be upgraded:
  sos
1 upgraded, 0 newly installed, 0 to remove and 2 not upgraded.'
lists "$PENDING" "$HELD"
run_job patch_install '{"all": true}'
check "install summary: counts what was really installed" grep -q "^Installed updates: 1 of 3 (sos)$" <<< "$(field .stdout)"
check "install summary: names the ones left with apt's reason (phased updates)" \
    grep -q "^Not installed: 2 (distro-info, snapd) - held back by apt: phased updates" <<< "$(field .stdout)"
check "install summary: the job itself still succeeds (apt exited 0)" [ "$(field .success)" = "true" ]

fake apt-get 0 'The following upgrades have been deferred due to phasing:
  distro-info snapd
0 upgraded, 0 newly installed, 0 to remove and 2 not upgraded.'
lists "$HELD" "$HELD"
run_job patch_install '{"all": true}'
check "nothing installed: 0 of 2, no false 'installed'" grep -q "^Installed updates: 0 of 2$" <<< "$(field .stdout)"
check "nothing installed: both named as not installed" grep -q "^Not installed: 2 (distro-info, snapd)" <<< "$(field .stdout)"

fake apt-get 0 'The following packages have been kept back:
  snapd
0 upgraded, 0 newly installed, 0 to remove and 1 not upgraded.'
lists "$PENDING" "$HELD"
run_job patch_install '{"packages": ["snapd", "sos"]}'
check "selected packages: only those count (sos installed, snapd kept back)" \
    bash -c 'grep -q "^Installed updates: 1 of 2 (sos)$" <<< "$1" && grep -q "^Not installed: 1 (snapd) - kept back by apt$" <<< "$1"' _ "$(field .stdout)"
lists "$PENDING" "$HELD"
run_job patch_install '{"packages": [{"name": "sos", "version": "4.9.2-0ubuntu0~24.04.1"}]}'
check "exact version: counted by name" grep -q "^Installed updates: 1 of 1 (sos)$" <<< "$(field .stdout)"
lists "" ""
run_job patch_install '{"packages": ["openssl"]}'
check "nothing pending: said so" grep -q "^Installed updates: 0 of 0 (none of them was pending)$" <<< "$(field .stdout)"
lists "$PENDING" ""
run_job patch_install '{"all": true}'
check "all installed: no 'Not installed' line" \
    bash -c 'grep -q "^Installed updates: 3 of 3 (distro-info, snapd, sos)$" <<< "$1" && ! grep -q "^Not installed" <<< "$1"' _ "$(field .stdout)"
rm -f "$TOOLS/apt"

# dnf: a name without .arch stands for all its arches; the update list comes from dnf check-update
clear_fakes
printf "%s\n" "openssl-libs.x86_64  1:3.5.1-4.el9_8  baseos" "openssl-libs.i686  1:3.5.1-4.el9_8  baseos" "kernel.x86_64  5.14.0-611.el9  baseos" > "$WORK/dnf-1"
printf "%s\n" "kernel.x86_64  5.14.0-611.el9  baseos" > "$WORK/dnf-2"
rm -f "$WORK/dnf-n"
cat > "$TOOLS/dnf" <<'FAKE'
#!/bin/bash
echo "dnf $*" >> "$WORK/calls"
if [[ " $* " == *" check-update "* ]]; then
    n=$(( $(cat "$WORK/dnf-n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$WORK/dnf-n"
    cat "$WORK/dnf-$(( n > 2 ? 2 : n ))"; exit 100
fi
exit 0
FAKE
chmod +x "$TOOLS/dnf"
run_job patch_install '{"packages": ["openssl-libs", "kernel.x86_64"]}'
check "dnf summary: a name without arch covers both arches; kernel still pending" \
    bash -c 'grep -q "^Installed updates: 2 of 3 (openssl-libs.i686, openssl-libs.x86_64)$" <<< "$1" && grep -q "^Not installed: 1 (kernel.x86_64)$" <<< "$1"' _ "$(field .stdout)"
clear_fakes

# --- under systemd: the package manager runs in a transient unit, outside the service's sandbox ---
cat > "$TOOLS/systemd-run" <<'EOF'
#!/bin/bash
echo "systemd-run $*" >> "$WORK/calls"
env=() out=/dev/stdout
while [ $# -gt 0 ]; do
  case "$1" in
    --pipe) echo "Failed to start transient service unit: Connection reset by peer" >&2; exit 1 ;;
    --setenv=*) env+=("${1#--setenv=}") ;;
    -p) shift; case "$1" in StandardOutput=file:*) out="${1#StandardOutput=file:}" ;; esac ;;
    --unit) shift ;;
    --*) ;;
    *) break ;;
  esac
  shift
done
env "${env[@]}" "$@" > "$out" 2>&1
EOF
chmod +x "$TOOLS/systemd-run"
clear_fakes; fake apt-get 0 'Hit:1 http://archive.example/ubuntu resolute InRelease'
INVOCATION_ID=test-invocation run_job patch_scan '{}'
check "under systemd: apt-get update runs through systemd-run --wait, output through a file (no --pipe)" \
    grep -q "^systemd-run --quiet --wait --collect --unit octofleet-packages-.* -p StandardOutput=file:.* -p StandardError=inherit .* timeout 600 apt-get -q update" <<< "$(calls)"
check "under systemd: non-interactive, needrestart only lists" \
    grep -q -- "--setenv=DEBIAN_FRONTEND=noninteractive --setenv=NEEDRESTART_MODE=l" <<< "$(calls)" && \
    grep -q "^apt-get -q update .*\[DEBIAN_FRONTEND=noninteractive\]" <<< "$(calls)"
check "under systemd: the scan result comes back" [ "$(scan .status)" = "succeeded" ] && [ "$(field .success)" = "true" ]
fake apt-get 100 'E: Unable to locate package nosuchpackage'
INVOCATION_ID=test-invocation run_job patch_install '{"packages": ["nosuchpackage"]}'
check "under systemd: apt-get's exit code comes back" [ "$(field .exitCode)" = "100" ]
rm -f "$TOOLS/systemd-run"

# --- dnf ---
clear_fakes; fake dnf 0 'Metadata cache created.'
run_job patch_scan '{}'
check "dnf scan: dnf makecache" grep -q "^dnf -q makecache" <<< "$(calls)" && [ "$(scan .source)" = "dnf" ]
check "dnf scan: succeeded" [ "$(scan .status)" = "succeeded" ] && [ "$(field .success)" = "true" ]
run_job patch_install '{"packages": ["openssl"]}'
check "dnf install: dnf -y upgrade with the packages" grep -q "^dnf -y upgrade openssl " <<< "$(calls)"
run_job patch_install '{"packages": [{"name": "openssl-libs.x86_64", "version": "1:3.5.1-4.el9_8"}, {"name": "python3.11.noarch", "version": "3.11.9-1.el9"}]}'
check "dnf install of exact versions: name-epoch:version-release.arch" \
    grep -q "^dnf -y upgrade openssl-libs-1:3.5.1-4.el9_8.x86_64 python3.11-3.11.9-1.el9.noarch " <<< "$(calls)"
fake dnf 1 'Error: Failed to download metadata for repo'
run_job patch_scan '{}'
check "dnf scan failed: status failed with the error" [ "$(scan .status)" = "failed" ] && grep -q "Failed to download metadata" <<< "$(scan .error)"

# --- pacman and no package manager ---
clear_fakes; fake pacman 0 ''
run_job patch_scan '{}'
check "pacman scan: not supported (no partial upgrades)" [ "$(field .success)" = "false" ] && grep -q "not supported with pacman" <<< "$(scan .error)"
check "pacman scan: pacman is not called" [ -z "$(calls)" ]
run_job patch_install '{"all": true}'
check "pacman install: not supported" [ "$(field .success)" = "false" ] && grep -q "not supported with pacman" <<< "$(field .stdout)"

clear_fakes
run_job patch_scan '{}'
check "no package manager: scan failed with a reason" [ "$(field .success)" = "false" ] && grep -q "No supported package manager" <<< "$(scan .error)"
run_job patch_install '{"all": true}'
check "no package manager: install failed with a reason" [ "$(field .success)" = "false" ] && grep -q "No supported package manager" <<< "$(field .stdout)"

# --- reboot after updates that need it (a fake systemd-run records the timer) ---
cat > "$TOOLS/systemd-run" <<'EOF'
#!/bin/bash
echo "systemd-run $*" >> "$WORK/calls"
env=() out=/dev/stdout
while [ $# -gt 0 ]; do
  case "$1" in
    --pipe) echo "Failed to start transient service unit: Connection reset by peer" >&2; exit 1 ;;
    --setenv=*) env+=("${1#--setenv=}") ;;
    -p) shift; case "$1" in StandardOutput=file:*) out="${1#StandardOutput=file:}" ;; esac ;;
    --unit|--on-calendar|--on-active) shift ;;
    --*) ;;
    *) break ;;
  esac
  shift
done
# a reboot timer only records itself; package commands run
[ "$1" = "/bin/systemctl" ] && exit 0
env "${env[@]}" "$@" > "$out" 2>&1
EOF
chmod +x "$TOOLS/systemd-run"
export REBOOT_REQUIRED_FILE="$WORK/reboot-required"
clear_fakes; fake apt-get 0 'Setting up linux-image (1) ...'
touch "$REBOOT_REQUIRED_FILE"
INVOCATION_ID=t run_job patch_install '{"all": true, "reboot_policy": "force"}'
check "reboot force: a timer runs systemctl reboot in a minute" grep -q "^systemd-run .*--on-active=60s /bin/systemctl reboot" <<< "$(calls)"
check "reboot force: said in the output" grep -q "^Reboot in one minute" <<< "$(field .stdout)"
check "reboot: only after the update search" bash -c '[ "$(grep -n "/bin/systemctl reboot" <<< "$1" | tail -1 | cut -d: -f1)" -gt "$(grep -n "apt-get -q update" <<< "$1" | head -1 | cut -d: -f1)" ]' _ "$(calls)"
INVOCATION_ID=t run_job patch_install '{"all": true, "reboot_policy": "schedule", "reboot_schedule_time": "2099-01-02T21:00:00Z"}'
check "reboot schedule: a calendar timer at the time in UTC" grep -q -- "--on-calendar=2099-01-02 21:00:00 UTC /bin/systemctl reboot" <<< "$(calls)"
check "reboot schedule: said in the output" grep -q "^Reboot scheduled for 2099-01-02 21:00:00 UTC" <<< "$(field .stdout)"
INVOCATION_ID=t run_job patch_install '{"all": true, "reboot_policy": "schedule", "reboot_schedule_time": "2000-01-01T00:00:00Z"}'
check "reboot schedule in the past: in one minute" grep -q -- "--on-active=60s /bin/systemctl reboot" <<< "$(calls)"
INVOCATION_ID=t run_job patch_install '{"all": true}'
check "no reboot_policy: no reboot" bash -c '! grep -q "systemctl reboot" <<< "$1"' _ "$(calls)"
check "no reboot_policy: said in the output" grep -q "^Reboot: not requested" <<< "$(field .stdout)"
rm -f "$REBOOT_REQUIRED_FILE"
INVOCATION_ID=t run_job patch_install '{"all": true, "reboot_policy": "force"}'
check "no reboot required: no reboot even with force" bash -c '! grep -q "systemctl reboot" <<< "$1"' _ "$(calls)"
rm -f "$TOOLS/systemd-run"; unset REBOOT_REQUIRED_FILE

rm -rf "$WORK"
echo
if [ "$failures" -eq 0 ]; then echo "All patch job tests passed"; else echo "$failures patch job test(s) failed"; fi
exit $(( failures > 0 ))
