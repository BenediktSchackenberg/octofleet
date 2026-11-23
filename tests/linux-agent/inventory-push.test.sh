#!/usr/bin/env bash
# Tests for the inventory push of linux-agent/agent.sh:
# - the performance and live collectors give exact integers under mawk: older mawk (1.3.4 20200120 in
#   Debian 12) prints 4294967296 as "4.29497e+09" and clamps printf "%d" to 2147483647, which left an
#   empty number in the JSON and the server rejected the whole inventory (HTTP 422)
# - a section with invalid JSON is left out and saved, the rest is sent
# - a rejected push is saved root-only and logged as one sentence, repeats are rate-limited
# Runs without network or root: awk is mawk (MAWK=... picks another one), curl is a fake command, and
# /proc is replaced by files with large values. In CI it also runs in a Debian 12 container (old mawk).
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
MAWK="${MAWK:-mawk}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }
command -v "$MAWK" >/dev/null 2>&1 || { echo "$MAWK is required (apt-get install mawk)"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"
ln -s "$(command -v "$MAWK")" "$BIN/awk"
export PATH="$BIN:$PATH"
if [[ "$(awk 'BEGIN { print 4194304 * 1024 }')" == *e+* ]]; then
    echo "awk is $("$MAWK" -W version 2>&1 | head -1) - prints large numbers in exponent form (the bug case)"
else
    echo "awk is $("$MAWK" -W version 2>&1 | head -1) - prints large numbers as integers"
fi

# Load the agent's settings and functions, without the command dispatch at the end (it would start it)
eval "$(sed '/^# Main$/,$d' "$AGENT")"
declare -F collect_performance push_inventory >/dev/null || { echo "functions not found in $AGENT"; exit 2; }
LOG_FILE="$WORK/agent.log" DIAG_DIR="$WORK/diag" API_URL="http://server.invalid" API_KEY="test"

# /proc with values above 2^31 and 2^32: 4 GiB RAM, 8 GiB swap, CPU jiffies and disk sectors
PROC_DIR="$WORK/proc"; mkdir -p "$PROC_DIR"
cat > "$PROC_DIR/meminfo" <<'EOF'
MemTotal:        4194304 kB
MemFree:         3145728 kB
MemAvailable:    3670016 kB
Buffers:          262144 kB
Cached:          2097152 kB
SwapCached:            0 kB
SwapTotal:       8388608 kB
SwapFree:        4194304 kB
EOF
cat > "$PROC_DIR/stat" <<'EOF'
cpu  1500000000 2000 1200000000 3000000000 40000 0 5000 0 0 0
cpu0 750000000 1000 600000000 1500000000 20000 0 2500 0 0 0
cpu1 750000000 1000 600000000 1500000000 20000 0 2500 0 0 0
EOF
cat > "$PROC_DIR/diskstats" <<'EOF'
   8       0 sda 3000000000 12 10000000000 400 2500000000 7 9000000000 300 0 500 700
 252       0 dm-0 1 0 1 0 1 0 1 0 0 0 0
EOF

perf=$(collect_performance 2>"$WORK/perf.err")
check "collect_performance gives valid JSON under mawk" jq -e . <<< "$perf" >/dev/null
check "no bash arithmetic error" [ ! -s "$WORK/perf.err" ]
val() { jq -r "$1" <<< "$perf" 2>/dev/null; }
check "memory total 4 GiB as an exact integer" [ "$(val .memory.totalBytes)" = "4294967296" ]
check "memory available exact" [ "$(val .memory.availableBytes)" = "3758096384" ]
check "cached does not match SwapCached" [ "$(val .memory.cachedBytes)" = "2147483648" ]
check "swap total 8 GiB exact" [ "$(val .swap.totalBytes)" = "8589934592" ]
check "swap used = total - free (was empty with the bug)" [ "$(val .swap.usedBytes)" = "4294967296" ]
check "disk read bytes above 2^31 not clamped" [ "$(val '.diskIo[0].readBytes')" = "5120000000000" ]
check "disk reads above 2^31 not clamped" [ "$(val '.diskIo[0].readsCompleted')" = "3000000000" ]
check "only real disks in diskIo" [ "$(val '.diskIo | length')" = "1" ]
check "per-core usage present" [ "$(val '.cpuCores | length')" = "2" ]

live=$(collect_live_metrics 2>"$WORK/live.err")
check "collect_live_metrics gives valid JSON with CPU totals above 2^32" jq -e '.cpuPercent | type == "number"' <<< "$live" >/dev/null
check "collect_live_metrics: no arithmetic error" [ ! -s "$WORK/live.err" ]
check "live memory percent from the same meminfo" [ "$(jq -r .memoryPercent <<< "$live")" = "12.5" ]

# No awk in the agent prints a multiplied value with print (mawk exponent form); printf "%.0f" instead
check "no 'print \$n * ...' left in agent.sh" [ -z "$(grep -nE "awk[^|]*print +\\\$[0-9]+ *\\*" "$AGENT")" ]

# --- a section with invalid JSON is left out, the rest is sent ---
collect_hardware() { echo '{"cpu": {"name": "x"}, "ram": {"totalBytes": 1}}'; }
collect_software() { echo '{"software": []}'; }
collect_system() { echo '{"os": {"name": "Debian"}}'; }
collect_network() { echo '{"networkInterfaces": []}'; }
collect_security() { echo '{"firewall": {}}'; }
collect_performance() { printf '{\n  "swap": {\n    "usedBytes": ,\n    "freeBytes": 1\n  }\n}\n'; }
collect_services() { echo '{"services": []}'; }
collect_updates() { echo '{"updates": []}'; }
collect_disk_health() { echo '{"disks": []}'; }

inv=$(collect_full_inventory 2>"$WORK/inv.err")
check "inventory with one broken section is valid JSON" jq -e . <<< "$inv" >/dev/null
check "the broken section is left out (server keeps its last value)" [ "$(jq 'has("performance")' <<< "$inv")" = "false" ]
check "all other sections are sent" [ "$(jq '[keys[] | select(. != "nodeId" and . != "hostname" and . != "agentVersion" and . != "collectedAt")] | length' <<< "$inv")" = "8" ]
check "the warning names the section" grep -q 'Inventory section "performance" left out' "$WORK/inv.err"
check "the collector output is saved" grep -q '"usedBytes": ,' "$WORK/diag/invalid-section-performance.txt"
check "the diagnosis folder is root-only (700)" [ "$(stat -c %a "$WORK/diag")" = "700" ]
check "the saved section is root-only (600)" [ "$(stat -c %a "$WORK/diag/invalid-section-performance.txt")" = "600" ]
NODE_ID='node "with" quotes'
check "node id is JSON-escaped" [ "$(collect_full_inventory 2>/dev/null | jq -r .nodeId)" = 'node "with" quotes' ]
collect_performance() { echo '{"swap": {}}'; }
collect_full_inventory >/dev/null 2>&1
check "a valid push removes old invalid-section files" [ ! -e "$WORK/diag/invalid-section-performance.txt" ]

# --- a rejected push: readable log line, saved payload, rate limit ---
# fake curl: answers with $WORK/answer (body) and $WORK/code (HTTP status, 000 = not reachable)
cat > "$BIN/curl" <<'EOF'
#!/bin/bash
code=$(cat "$WORK/code")
if [ "$code" = 000 ]; then echo "curl: (7) Failed to connect to server.invalid port 8080: Connection refused" >&2; printf '\n000'; exit 7; fi
cat "$WORK/answer"; printf '\n%s' "$code"
EOF
chmod +x "$BIN/curl"; export WORK
NODE_ID=test-node
collect_performance() { echo '{"swap": {"usedBytes": 1}}'; }
# the character position the server reports: the first "s" of "services" (any position works)
pos=$(collect_full_inventory 2>/dev/null | grep -bo '"services"' | head -1 | cut -d: -f1)
echo 422 > "$WORK/code"
printf '{"detail":[{"type":"json_invalid","loc":["body",%s],"msg":"JSON decode error","input":{},"ctx":{"error":"Expecting value"}}]}' "$pos" > "$WORK/answer"
: > "$LOG_FILE"
push_inventory >/dev/null 2>&1; rc=$?
check "a rejected push returns 1" [ "$rc" = 1 ]
line=$(grep ERROR "$LOG_FILE")
check "one ERROR line" [ "$(grep -c ERROR "$LOG_FILE")" = 1 ]
check "readable: invalid JSON at character N" grep -q "Inventory push failed: the server could not read it, invalid JSON at character $pos (after \"" <<< "$line"
check "readable: shows the text before the position" grep -qF '{"swap": {"usedBytes": 1}}, ")' <<< "$line"
check "readable: names the saved file" grep -q "inventory is saved in $WORK/diag/last-failed-push.json" <<< "$line"
check "no raw server JSON at info level" [ -z "$(grep -F 'json_invalid' "$LOG_FILE")" ]
check "the sent inventory is saved" jq -e '.nodeId == "test-node"' "$WORK/diag/last-failed-push.json" >/dev/null
check "the saved inventory is root-only (600)" [ "$(stat -c %a "$WORK/diag/last-failed-push.json")" = "600" ]

push_inventory >/dev/null 2>&1; push_inventory >/dev/null 2>&1
check "the same failure again is not logged again within PUSH_FAIL_LOG_INTERVAL" [ "$(grep -c ERROR "$LOG_FILE")" = 1 ]
PUSH_FAIL_LOG_INTERVAL=0
push_inventory >/dev/null 2>&1
check "after the interval: still failing, with count and start time" grep -q "Inventory push still failing (4 times since $(date -d "@$PUSH_FAIL_SINCE" '+%Y-%m-%d %H:%M')): the server could not read it" "$LOG_FILE"
PUSH_FAIL_LOG_INTERVAL=3600

: > "$LOG_FILE"; LOG_LEVEL=debug
push_inventory >/dev/null 2>&1
check "LOG_LEVEL=debug logs the raw server answer" grep -q 'DEBUG.*server answer: {"detail":\[{"type":"json_invalid"' "$LOG_FILE"
LOG_LEVEL=info

echo 000 > "$WORK/code"; : > "$LOG_FILE"; rm -f "$WORK/diag/last-failed-push.json"
push_inventory >/dev/null 2>&1
check "a new reason is logged right away" grep -q 'Inventory push failed: server not reachable (Failed to connect to server.invalid port 8080: Connection refused)\.' "$LOG_FILE"
check "not reachable: nothing saved" [ ! -e "$WORK/diag/last-failed-push.json" ]

echo 403 > "$WORK/code"; echo '{"detail":"Invalid API key"}' > "$WORK/answer"; : > "$LOG_FILE"
push_inventory >/dev/null 2>&1
check "HTTP 403: the agent key" grep -q 'Inventory push failed: the server refused the agent key (HTTP 403)' "$LOG_FILE"
echo 422 > "$WORK/code"; echo '{"detail":[{"type":"missing","loc":["body","nodeId"],"msg":"Field required"}]}' > "$WORK/answer"; : > "$LOG_FILE"
push_inventory >/dev/null 2>&1
check "other 422: message and field" grep -q 'rejected by the server (HTTP 422): Field required (field body.nodeId)' "$LOG_FILE"

echo 200 > "$WORK/code"; echo '{"status":"ok"}' > "$WORK/answer"; : > "$LOG_FILE"
push_inventory >/dev/null 2>&1; rc=$?
check "success returns 0" [ "$rc" = 0 ]
check "success after failures says so once" grep -q 'Inventory pushed successfully again, after 8 failed attempt(s) since' "$LOG_FILE"
check "success removes the saved failed push" [ ! -e "$WORK/diag/last-failed-push.json" ]
: > "$LOG_FILE"; push_inventory >/dev/null 2>&1
check "the next success is a normal line" grep -q 'INFO\] Inventory pushed successfully$' "$LOG_FILE"

# an inventory that is not JSON at all is not sent
collect_full_inventory() { echo '{"nodeId": '; }
rm -f "$WORK/answer"; : > "$LOG_FILE"
push_inventory >/dev/null 2>&1; rc=$?
check "invalid inventory: not sent, returns 1" [ "$rc" = 1 ]
check "invalid inventory: logged and saved" grep -q "the collected inventory is not valid JSON, so it was not sent. The inventory is saved in" "$LOG_FILE"

echo
if [ "$failures" -eq 0 ]; then echo "All inventory push tests passed"; else echo "$failures inventory push test(s) failed"; fi
exit $(( failures > 0 ))
