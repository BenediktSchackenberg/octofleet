#!/usr/bin/env bash
# Tests for the job types of the Linux agent (execute_job in linux-agent/agent.sh): run, inventory,
# restart-agent (patch_scan and patch_install: patch-jobs.test.sh). Runs without network or root: curl,
# systemd-run and systemctl are replaced by fake commands in a temporary PATH directory.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only the functions under test: sourcing agent.sh would start the agent. execute_job has a
# JSON here-document with a "}" at the start of a line, so it ends at the first "}" after "EOF".
eval "$(awk '/^schedule_restart\(\) \{/ { f = 1 } f { print } f && /^}$/ { f = 0 }' "$AGENT")"
eval "$(awk '/^execute_job\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
for fn in schedule_restart execute_job; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
info() { :; }; warn() { :; }
push_inventory() { echo pushed >> "$WORK/inventory"; return 0; }
API_URL="http://server.invalid"; API_KEY="test"

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d)
BIN="$WORK/bin"; mkdir -p "$BIN"
# curl: keep the data of the result POST
cat > "$BIN/curl" <<'EOF'
#!/bin/bash
while [ $# -gt 0 ]; do
  case "$1" in -d) printf '%s' "$2" > "$WORK/result"; shift ;; esac
  shift
done
EOF
cat > "$BIN/systemctl" <<'EOF'
#!/bin/bash
echo "systemctl $*" >> "$WORK/calls"
EOF
cat > "$BIN/systemd-run" <<'EOF'
#!/bin/bash
echo "systemd-run $*" >> "$WORK/calls"
EOF
chmod +x "$BIN"/*
export WORK PATH="$BIN:$PATH"

# run_job TYPE PAYLOAD: execute_job with that job; RESULT holds the reported result
run_job() {
    rm -f "$WORK/result"
    execute_job "$(jq -cn --arg t "$1" --arg p "$2" '{instanceId: "i-1", jobName: "test", commandType: $t, commandPayload: $p}')"
    RESULT=$(cat "$WORK/result" 2>/dev/null)
}
field() { jq -r "$1" <<< "$RESULT"; }

# run: the command array of the "Start job" dialog
run_job run '{"command": ["echo", "hello", "world"], "timeout": 300}'
check "run: success" [ "$(field .success)" = "true" ]
check "run: arguments are preserved" [ "$(field .stdout)" = "hello world" ]
run_job run '{"command": "exit 3"}'
check "run: the exit code is reported" [ "$(field .exitCode)" = "3" ]
check "run: a failed command is a failed job" [ "$(field .status)" = "failed" ]
run_job run '{"command": ["sleep", "5"], "timeout": 1}'
check "run: the timeout stops the command (exit 124)" [ "$(field .exitCode)" = "124" ]
run_job run '{}'
check "run: no command fails" [ "$(field .success)" = "false" ]

# inventory (and the older inventory_push)
rm -f "$WORK/inventory"
run_job inventory '{}'
check "inventory: pushes the inventory" [ "$(wc -l < "$WORK/inventory")" = "1" ]
check "inventory: success" [ "$(field .success)" = "true" ]
run_job inventory_push '{}'
check "inventory_push still works" [ "$(wc -l < "$WORK/inventory")" = "2" ]

# restart-agent: scheduled through systemd-run, after the result
rm -f "$WORK/calls"
run_job restart-agent '{}'
check "restart-agent: success" [ "$(field .success)" = "true" ]
check "restart-agent: systemd-run restarts the service later" \
    grep -q "systemd-run .*--on-active=30s .*/bin/systemctl restart octofleet-agent.service" "$WORK/calls"
# Not installed as a systemd service (e.g. started by hand): no restart. The fake systemctl fails,
# so schedule_restart stops before systemd-run - the real one must never run in a test.
cat > "$BIN/systemctl" <<'EOF'
#!/bin/bash
echo "systemctl $*" >> "$WORK/calls"
exit 1
EOF
rm -f "$WORK/calls"
run_job restart-agent '{}'
check "restart-agent without the systemd service: failed with a reason" \
    [ "$(field .success)" = "false" ] && grep -q "systemd service" <<< "$(field .stdout)"
check "restart-agent without the systemd service: systemd-run not called" \
    bash -c '! grep -q systemd-run "$WORK/calls"'

run_job something-else '{}'
check "unknown type: still failed" [ "$(field .stdout)" = "Unknown command type" ]

rm -rf "$WORK"
echo
if [ "$failures" -eq 0 ]; then echo "All job type tests passed"; else echo "$failures job type test(s) failed"; fi
exit $(( failures > 0 ))
