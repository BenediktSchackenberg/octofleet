#!/usr/bin/env bash
# Tests for the Linux agent's logs per component (#330, log in linux-agent/agent.sh): the line format
# (ISO 8601 with offset), one file per component, warnings and errors in Agent.log too, the level per
# component, no process per line, the size check between logrotate's daily runs, the move of the old
# single log file and the live data's agent log lines. Runs without root in a temporary directory.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"

# Load only the functions under test: sourcing agent.sh would start the agent
load_logging() {
    eval "$(awk '/^LOG_WRITTEN_BYTES=0$/ { f = 1 } f { print } /^rotate_logs_now\(\) \{/ { r = 1 } f && r && /^}$/ { exit }' "$AGENT")"
}
LOG_ROTATE_MAXSIZE=2M; load_logging
for fn in migrate_legacy_log collect_agent_logs; do
    eval "$(awk -v fn="$fn" '$0 ~ "^" fn "\\(\\) \\{" { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
done
for fn in log info warn error debug rotate_logs_now migrate_legacy_log collect_agent_logs; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
LOG_DIR="$WORK/logs"; mkdir -p "$LOG_DIR"
LOG_LEVEL=info LOGROTATE_FILE="" LOG_FILE="$WORK/var/octofleet-agent.log"
fresh() { rm -f "$LOG_DIR"/*.log; unset LOG_LEVEL_UPDATES LOG_LEVEL_JOBS; LOG_LEVEL=info; }

# --- the line ---
fresh
out=$(TZ=UTC-01:30 info Updates "job=42 patch_install: Installed updates: 1 of 1 (nginx)")
check "stdout: ISO 8601 with milliseconds and offset, level, component, message" \
    grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}\+01:30 INFO \[Updates\] job=42 patch_install: Installed updates: 1 of 1 \(nginx\)$' <<< "$out"
check "the same line in Updates.log" test "$(cat "$LOG_DIR/Updates.log")" = "$out"
check "the time is now" test "${out:0:16}" = "$(TZ=UTC-01:30 date +%Y-%m-%dT%H:%M)" -o "${out:0:16}" = "$(TZ=UTC-01:30 date -d '-1 min' +%Y-%m-%dT%H:%M)"
out=$(TZ=UTC+05 info Agent x)
check "negative offset" grep -Eq '^[0-9T:.-]+-05:00 INFO \[Agent\] x$' <<< "$out"
out=$(unset EPOCHREALTIME; TZ=UTC info Agent "older bash")
check "without EPOCHREALTIME (bash 4): whole seconds" grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\+00:00 INFO \[Agent\] older bash$' <<< "$out"

# --- one file per component, warnings and errors also in Agent.log ---
fresh
{ info Inventory "Inventory pushed successfully"; warn Jobs "Job 7 (run) failed"; error Inventory "Inventory push failed"
  info Agent "starting"; warn Agent "Long-poll failed"; } >/dev/null
check "Inventory.log: info and error" test "$(grep -c '\[Inventory\]' "$LOG_DIR/Inventory.log")" = 2
check "Jobs.log: the warning" grep -q '^.* WARN \[Jobs\] Job 7 (run) failed$' "$LOG_DIR/Jobs.log"
check "Agent.log: own lines and the other components' warnings and errors" \
    test "$(cut -d' ' -f2- "$LOG_DIR/Agent.log")" = "$(printf '%s\n' 'WARN [Jobs] Job 7 (run) failed' 'ERROR [Inventory] Inventory push failed' 'INFO [Agent] starting' 'WARN [Agent] Long-poll failed')"
check "no other files" test "$(ls "$LOG_DIR" | tr '\n' ' ')" = "Agent.log Inventory.log Jobs.log "

# --- levels ---
fresh
{ debug Updates "d1"; LOG_LEVEL=debug; debug Updates "d2"; LOG_LEVEL=info; } >/dev/null
check "debug is off by default, LOG_LEVEL=debug turns it on" test "$(grep -c DEBUG "$LOG_DIR/Updates.log")" = 1
check "debug line written" grep -q 'DEBUG \[Updates\] d2$' "$LOG_DIR/Updates.log"
fresh
LOG_LEVEL_UPDATES=debug
{ debug Updates "u"; debug Inventory "i"; } >/dev/null
check "LOG_LEVEL_UPDATES=debug: Updates only" bash -c '[ -s "$1/Updates.log" ] && [ ! -e "$1/Inventory.log" ]' _ "$LOG_DIR"
fresh
LOG_LEVEL_JOBS=error LOG_LEVEL=WARN
{ warn Jobs "w"; error Jobs "e"; info Inventory "i"; warn Inventory "w"; } >/dev/null
check "LOG_LEVEL_JOBS=error: no warning" test "$(cut -d' ' -f2 "$LOG_DIR/Jobs.log")" = ERROR
check "LOG_LEVEL=WARN (any case): no info" test "$(cut -d' ' -f2 "$LOG_DIR/Inventory.log")" = WARN
fresh
out=$(debug Agent "x"; echo "rc=$?")
check "a line below the level: nothing printed, exit 0" test "$out" = "rc=0"

# --- no process per line: works with an empty PATH ---
fresh
out=$(PATH=/nonexistent; info Agent "no date, no tee"; warn Jobs "still"; echo "rc=$?")
check "no external command per line" bash -c 'grep -q "INFO \[Agent\] no date, no tee" "$1/Agent.log" && grep -q "WARN \[Jobs\] still" "$1/Jobs.log"' _ "$LOG_DIR"
check "exit 0" grep -q '^rc=0$' <<< "$out"
body="$(declare -f log)"
check "log has no date or tee call" bash -c '[ -n "$1" ] && ! grep -Eq "\b(date|tee)\b" <<< "$1"' _ "$body"
check "log has no command substitution or pipe" bash -c '! grep -vE "\)$" <<< "$1" | grep -Eq "$2"' _ "$body" '\$\([^(]|[^|] \| '  # not the case patterns

# --- not writable (no root): stdout still works, no error output ---
fresh
out=$(LOG_DIR="$WORK/missing/dir"; info Agent "only stdout" 2>&1)
check "missing folder: the line on stdout, no error message" grep -Eq '^[^ ]+ INFO \[Agent\] only stdout$' <<< "$out"

# --- size check between logrotate's daily runs ---
fresh
BIN="$WORK/bin"; mkdir -p "$BIN"
printf '#!/bin/sh\necho "$@" >> "%s/rotations"\n' "$WORK" > "$BIN/logrotate"; chmod +x "$BIN/logrotate"
LOGROTATE_FILE="$WORK/logrotate.conf"; echo "# conf" > "$LOGROTATE_FILE"
LOG_ROTATE_MAXSIZE=8k; load_logging
check "LOG_ROTATE_MAXSIZE 8k in bytes" test "$LOG_MAX_BYTES" = 8192
LOG_WRITTEN_BYTES=0
PATH="$BIN:$PATH"
for i in $(seq 1 100); do info Updates "line $i: $(printf '%060d' 0)"; done >/dev/null   # ~100 B per line
check "logrotate ran once after 8 KB" test "$(wc -l < "$WORK/rotations")" = 1
check "with its own state file in LOG_DIR" grep -q -- "-s $LOG_DIR/.logrotate.status $LOGROTATE_FILE" "$WORK/rotations"
check "counter started again" test "$LOG_WRITTEN_BYTES" -lt 8192
rm -f "$WORK/rotations"
LOGROTATE_FILE=""; for i in $(seq 1 100); do info Updates "line $i: $(printf '%060d' 0)"; done >/dev/null
check "LOGROTATE_FILE empty: not run" test ! -e "$WORK/rotations"
for size in "2M:2097152" "500k:512000" "1G:1073741824" "100000:100000" "1k:2097152"; do
    LOG_ROTATE_MAXSIZE=${size%%:*}; load_logging
    check "LOG_ROTATE_MAXSIZE ${size%%:*} -> ${size#*:} bytes" test "$LOG_MAX_BYTES" = "${size#*:}"
done
LOG_ROTATE_MAXSIZE=2M; load_logging

# --- the old single log file moves into LOG_DIR ---
fresh
mkdir -p "$WORK/var"
echo "[2026-11-20 10:00:00] [INFO] old line" > "$LOG_FILE"
echo "older" > "$LOG_FILE.1"; echo "oldest" > "$LOG_FILE.2.gz"
out=$(migrate_legacy_log)
check "moved as octofleet-agent.log.0" grep -q "old line" "$LOG_DIR/octofleet-agent.log.0"
check "rotated copies moved with their names" bash -c '[ -f "$1/octofleet-agent.log.1" ] && [ -f "$1/octofleet-agent.log.2.gz" ] && [ ! -e "$2.1" ] && [ ! -e "$2.2.gz" ]' _ "$LOG_DIR" "$LOG_FILE"
check "old path is a link to Agent.log" test "$(readlink "$LOG_FILE")" = "$LOG_DIR/Agent.log"
check "logged in Agent.log" grep -q "INFO \[Agent\] Logs are now one file per component in $LOG_DIR; the previous log $LOG_FILE moved there as octofleet-agent.log.0" "$LOG_DIR/Agent.log"
check "not matched by logrotate's *.log" bash -c 'cd "$1" && [ "$(ls *.log)" = Agent.log ]' _ "$LOG_DIR"
before=$(cat "$LOG_DIR/Agent.log")
migrate_legacy_log >/dev/null
check "second start: nothing to do" test "$(cat "$LOG_DIR/Agent.log")" = "$before"
fresh; rm -rf "$WORK/var"
migrate_legacy_log >/dev/null
check "fresh install: no link, no line" bash -c '[ ! -e "$1" ] && [ ! -L "$1" ] && [ ! -e "$2/Agent.log" ]' _ "$LOG_FILE" "$LOG_DIR"

# --- the live data's agent log lines (no journal): read from Agent.log ---
fresh
{ info Agent "starting"; warn Jobs "Job 7 failed"; } >/dev/null
TOOLS="$WORK/tools"; mkdir -p "$TOOLS"
for tool in jq tail; do ln -s "$(command -v "$tool")" "$TOOLS/$tool"; done
logs=$(PATH="$TOOLS"; collect_agent_logs)
check "two entries" test "$(jq length <<< "$logs")" = 2
check "level and timestamp from the line" test "$(jq -r '.[1] | .level + " " + (.timestamp | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+[+-][0-9]{2}:[0-9]{2}$") | tostring)' <<< "$logs")" = "WARN true"

# --- the agent's components and call sites ---
check "every log call names a component" bash -c '! grep -nE "^[^#]*\b(info|warn|error|debug) \"" "$1" | grep -vE "(jq|--arg) "' _ "$AGENT"
check "only the known components" bash -c '
    used=$(grep -vE "^[[:space:]]*#" "$1" | grep -oE "\b(info|warn|error|debug|log [A-Z]+) \"?[A-Z][A-Za-z]+\b" | grep -oE "[A-Z][A-Za-z]+$" | grep -vE "^(INFO|WARN|ERROR|DEBUG)$" | sort -u | tr "\n" " ")
    [ "$(wc -w <<< "$used")" -ge 8 ] || { echo "components found: $used"; exit 1; }
    for c in $used; do case " Agent Inventory Jobs Updates Remediation Security LiveData RemoteTools SelfUpdate " in *" $c "*) ;; *) echo "unknown component: $c"; exit 1 ;; esac; done' _ "$AGENT"

echo
if [ "$failures" -eq 0 ]; then echo "All logging tests passed"; else echo "$failures logging test(s) failed"; fi
exit $(( failures > 0 ))
