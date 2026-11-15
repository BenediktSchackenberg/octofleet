#!/usr/bin/env bash
# Tests for the Linux agent's logrotate configuration (ensure_logrotate in linux-agent/agent.sh).
# Runs without root: the configuration goes to a temporary directory; logrotate and systemd-run are
# fakes unless the test says otherwise.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"

# Load only the functions under test: sourcing agent.sh would start the agent
eval "$(awk '/^LOGROTATE_MARKER=/ { f = 1 } /^run_service\(\) \{/ { exit } f { print }' "$AGENT")"
for fn in logrotate_config ensure_logrotate; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
info() { printf 'INFO %s\n' "$*" >> "$WORK/log"; }
warn() { printf 'WARN %s\n' "$*" >> "$WORK/log"; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d); export WORK
TOOLS="$WORK/tools"; mkdir -p "$TOOLS" "$WORK/etc"
REAL_LOGROTATE=$(command -v logrotate || true)
for tool in bash sh cat grep chmod dirname date printf stat rm mv sed head; do ln -s "$(command -v "$tool")" "$TOOLS/$tool"; done
printf '#!/bin/sh\nexit 0\n' > "$TOOLS/logrotate"; chmod +x "$TOOLS/logrotate"
PATH="$TOOLS"
unset INVOCATION_ID
LOG_FILE=/var/log/octofleet-agent.log
LOGROTATE_FILE="$WORK/etc/octofleet-agent"
LOG_ROTATE_COUNT=8
LOG_ROTATE_MAXSIZE=10M
reset() { rm -f "$LOGROTATE_FILE" "$WORK/log" "$WORK/calls"; }

# No configuration yet: installed for LOG_FILE, readable for logrotate
reset
ensure_logrotate
check "installed when missing" test -f "$LOGROTATE_FILE"
check "first line is the marker" bash -c 'head -1 "$1" | grep -q "^# octofleet-agent: managed"' _ "$LOGROTATE_FILE"
check "rotates LOG_FILE" grep -q "^/var/log/octofleet-agent.log {" "$LOGROTATE_FILE"
check "weekly, maxsize, rotate count, copytruncate" bash -c 'grep -q "weekly" "$1" && grep -q "maxsize 10M" "$1" && grep -q "rotate 8" "$1" && grep -q "copytruncate" "$1"' _ "$LOGROTATE_FILE"
check "mode 644" test "$(stat -c %a "$LOGROTATE_FILE")" = 644
check "logged" grep -q "INFO logrotate: .*(weekly or at 10M, 8 files kept)" "$WORK/log"

# Unchanged: not written again
rm -f "$WORK/log"
ensure_logrotate
check "unchanged: nothing logged" test ! -e "$WORK/log"

# Managed file with other settings (e.g. an older agent): updated
LOG_ROTATE_COUNT=4
ensure_logrotate
check "managed file updated" grep -q "rotate 4" "$LOGROTATE_FILE"
LOG_ROTATE_COUNT=8

# The administrator's own file (marker line deleted): left alone
reset
printf '/var/log/octofleet-agent.log {\n    daily\n    rotate 30\n}\n' > "$LOGROTATE_FILE"
ensure_logrotate
check "own file kept" grep -q "rotate 30" "$LOGROTATE_FILE"
check "own file: no marker added" bash -c '! grep -q "octofleet-agent: managed" "$1"' _ "$LOGROTATE_FILE"

# Turned off
reset
LOGROTATE_FILE="" ensure_logrotate
check "LOGROTATE_FILE empty: nothing written" test ! -e "$WORK/etc/octofleet-agent"

# logrotate not installed: a warning, no file
reset
mv "$TOOLS/logrotate" "$TOOLS/logrotate.off"
ensure_logrotate
check "no logrotate: no file" test ! -e "$LOGROTATE_FILE"
check "no logrotate: warned" grep -q "WARN logrotate is not installed" "$WORK/log"
mv "$TOOLS/logrotate.off" "$TOOLS/logrotate"

# Under systemd with a read-only /etc (ProtectSystem=strict): written through a transient unit
reset
cat > "$TOOLS/systemd-run" <<'FAKE'
#!/bin/bash
echo "systemd-run $*" >> "$WORK/calls"
while [ "${1#--}" != "$1" ]; do [ "$1" = "--unit" ] && shift; shift; done
exec "$@"
FAKE
chmod +x "$TOOLS/systemd-run"
chmod 555 "$WORK/etc"
INVOCATION_ID=t ensure_logrotate 2>/dev/null  # the fake unit cannot write either: expected
chmod 755 "$WORK/etc"
check "systemd: written through systemd-run" grep -q "systemd-run --quiet --wait --pipe --collect --unit octofleet-logrotate-" "$WORK/calls"
# (the fake runs the command itself, so it could only write if the directory were writable again)
check "systemd: nothing written directly into the read-only directory" test ! -e "$LOGROTATE_FILE"

# The generated configuration is valid for the real logrotate (when installed)
if [ -n "$REAL_LOGROTATE" ]; then
    reset
    ensure_logrotate
    sed -i "s|^/var/log/octofleet-agent.log {|$WORK/agent.log {|; s/^    su root root$//" "$LOGROTATE_FILE"
    : > "$WORK/agent.log"
    check "logrotate accepts the configuration" bash -c '"$1" -d -s "$2" "$3" >/dev/null 2>&1' _ "$REAL_LOGROTATE" "$WORK/state" "$LOGROTATE_FILE"
else
    echo "SKIP  logrotate not installed: configuration not validated"
fi

rm -rf "$WORK"
echo
if [ "$failures" -eq 0 ]; then echo "All logrotate tests passed"; else echo "$failures logrotate test(s) failed"; fi
exit $(( failures > 0 ))
