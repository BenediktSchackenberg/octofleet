#!/usr/bin/env bash
# Tests for the Linux agent's logrotate configuration (ensure_logrotate in linux-agent/agent.sh).
# Runs without root: the configuration goes to a temporary directory; logrotate and systemd-run are
# fakes unless the test says otherwise.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"

# Load only the functions under test: sourcing agent.sh would start the agent
eval "$(awk '/^LOGROTATE_MARKER=/ { f = 1 } /^run_service\(\) \{/ { exit } f { print }' "$AGENT")"
eval "$(awk '/^# --- systemd helpers/,/^# --- end systemd helpers ---$/' "$AGENT")"  # systemd_mode, sd_run, sd_run_wait
for fn in logrotate_config ensure_logrotate; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
info() { shift; printf 'INFO %s\n' "$*" >> "$WORK/log"; }  # info COMPONENT MESSAGE
warn() { shift; printf 'WARN %s\n' "$*" >> "$WORK/log"; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d); export WORK
TOOLS="$WORK/tools"; mkdir -p "$TOOLS" "$WORK/etc"
REAL_LOGROTATE=$(command -v logrotate || true)
for tool in bash sh cat grep chmod dirname date printf stat rm mv sed head mktemp ls mkdir tr gzip; do ln -s "$(command -v "$tool")" "$TOOLS/$tool"; done
printf '#!/bin/sh\nexit 0\n' > "$TOOLS/logrotate"; chmod +x "$TOOLS/logrotate"
PATH="$TOOLS"
unset INVOCATION_ID
LOG_DIR=/var/log/octofleet-agent
LOGROTATE_FILE="$WORK/etc/octofleet-agent"
eval "$(grep -E '^LOG_ROTATE_(COUNT|MAXSIZE)=' "$AGENT")"  # the defaults
reset() { rm -f "$LOGROTATE_FILE" "$WORK/log" "$WORK/calls"; }

check "defaults: 4 files of 2 MB per component" test "$LOG_ROTATE_COUNT:$LOG_ROTATE_MAXSIZE" = 4:2M

# No configuration yet: installed for LOG_DIR/*.log, readable for logrotate
reset
ensure_logrotate
check "installed when missing" test -f "$LOGROTATE_FILE"
check "first line is the marker" bash -c 'head -1 "$1" | grep -q "^# octofleet-agent: managed"' _ "$LOGROTATE_FILE"
check "rotates every component's file (wildcard)" grep -qxF "/var/log/octofleet-agent/*.log {" "$LOGROTATE_FILE"
check "not the old single file" bash -c '! grep -q "octofleet-agent.log {" "$1"' _ "$LOGROTATE_FILE"
check "weekly, maxsize, rotate count, copytruncate" bash -c 'grep -q "weekly" "$1" && grep -q "maxsize 2M" "$1" && grep -q "rotate 4" "$1" && grep -q "copytruncate" "$1"' _ "$LOGROTATE_FILE"
check "mode 644" test "$(stat -c %a "$LOGROTATE_FILE")" = 644
check "logged" grep -qF "INFO logrotate: $LOGROTATE_FILE for /var/log/octofleet-agent/*.log (weekly or at 2M, 4 files kept)" "$WORK/log"

# Unchanged: not written again
rm -f "$WORK/log"
ensure_logrotate
check "unchanged: nothing logged" test ! -e "$WORK/log"

# Managed file of an older agent (the single file /var/log/octofleet-agent.log): updated to the wildcard
printf '# octofleet-agent: managed - delete this line to keep your own changes\n/var/log/octofleet-agent.log {\n    weekly\n    maxsize 10M\n    rotate 8\n}\n' > "$LOGROTATE_FILE"
ensure_logrotate
check "older agent's file updated" bash -c 'grep -qxF "/var/log/octofleet-agent/*.log {" "$1" && grep -q "rotate 4" "$1"' _ "$LOGROTATE_FILE"

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
exit 1  # a fake transient unit must not write to the host's /sys
FAKE
chmod +x "$TOOLS/systemd-run"
INVOCATION_ID=t LOGROTATE_FILE=/sys/octofleet-logrotate-test LOGROTATE_TMP_DIR="$WORK" ensure_logrotate 2>/dev/null
check "systemd: written through systemd-run without --pipe" grep -q "systemd-run --quiet --wait --collect --unit octofleet-logrotate-" "$WORK/calls"
check "systemd: no --pipe" bash -c '! grep -q -- --pipe "$1"' _ "$WORK/calls"
check "systemd: nothing written directly into the read-only directory" test ! -e /sys/octofleet-logrotate-test
check "systemd: staged file removed after failure" bash -c '! ls "$1"/octofleet-logrotate.* >/dev/null 2>&1' _ "$WORK"

# The generated configuration is valid for the real logrotate (when installed)
if [ -n "$REAL_LOGROTATE" ]; then
    reset
    ensure_logrotate
    mkdir -p "$WORK/logs"
    sed -i "s|^/var/log/octofleet-agent/\*.log {|$WORK/logs/*.log {|; s/^    su root root$//" "$LOGROTATE_FILE"
    : > "$WORK/logs/Agent.log"
    check "logrotate accepts the configuration" bash -c '"$1" -d -s "$2" "$3" >/dev/null 2>&1' _ "$REAL_LOGROTATE" "$WORK/state" "$LOGROTATE_FILE"
    # each component on its own: only the file above maxsize is rotated, the others stay
    head -c 3000000 /dev/zero | tr '\0' 'x' > "$WORK/logs/Updates.log"
    echo "small" > "$WORK/logs/Jobs.log"
    "$REAL_LOGROTATE" -s "$WORK/state" "$LOGROTATE_FILE" >/dev/null 2>&1
    check "the large file is rotated at maxsize" bash -c '[ -f "$1/Updates.log.1" ] && [ ! -s "$1/Updates.log" ]' _ "$WORK/logs"
    check "the small files stay" bash -c '[ "$(cat "$1/Jobs.log")" = small ] && [ ! -e "$1/Jobs.log.1" ]' _ "$WORK/logs"
    check "logrotate leaves the moved old log alone" bash -c 'echo old > "$1/octofleet-agent.log.0"; "$2" -f -s "$3" "$4" >/dev/null 2>&1; [ "$(cat "$1/octofleet-agent.log.0")" = old ] && [ ! -e "$1/octofleet-agent.log.0.1" ]' _ "$WORK/logs" "$REAL_LOGROTATE" "$WORK/state" "$LOGROTATE_FILE"
else
    echo "SKIP  logrotate not installed: configuration not validated"
fi

rm -rf "$WORK"
echo
if [ "$failures" -eq 0 ]; then echo "All logrotate tests passed"; else echo "$failures logrotate test(s) failed"; fi
exit $(( failures > 0 ))
