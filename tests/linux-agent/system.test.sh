#!/usr/bin/env bash
# Tests for collect_system in linux-agent/agent.sh: boot time and uptime in the fields the Windows
# agent sends (os.lastBootTime in UTC without offset, os.uptimeHours, os.uptimeFormatted), from the
# kernel's btime in /proc/stat, now minus /proc/uptime without it. PROC_DIR points at fake files.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only collect_system: sourcing agent.sh would start the agent. Its JSON here-document has a
# "}" at the start of a line, so the function ends at the first "}" line after "EOF".
eval "$(awk '/^collect_system\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
declare -F collect_system >/dev/null || { echo "collect_system not found in $AGENT"; exit 2; }
VERSION="0.0.0-test"

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

PROC_DIR=$(mktemp -d); export PROC_DIR
field() { jq -r "$1" <<< "$OUT"; }

# btime: the boot time; uptime counted from it (3 days, 4 hours, 5 minutes and a bit ago)
now=$(date +%s); boot=$(( now - (3 * 86400 + 4 * 3600 + 5 * 60 + 30) ))
printf 'cpu  1 2 3 4\nbtime %s\nprocesses 42\n' "$boot" > "$PROC_DIR/stat"
echo "12.00 34.00" > "$PROC_DIR/uptime"   # ignored while btime is there
OUT=$(collect_system)
check "valid JSON" jq -e . <<< "$OUT" >/dev/null
check "os.lastBootTime: btime in UTC, without offset" [ "$(field .os.lastBootTime)" = "$(date -u -d "@$boot" +%Y-%m-%dT%H:%M:%S)" ]
check "os.uptimeHours: hours with two decimals" bash -c '[[ "$1" == 76.0[89] ]]' _ "$(field .os.uptimeHours)"
check "os.uptimeFormatted like the Windows agent" bash -c '[[ "$1" == "3d 4h 5m" || "$1" == "3d 4h 6m" ]]' _ "$(field .os.uptimeFormatted)"
check "uptime.bootTime: the same moment with offset" [ "$(date -d "$(field .uptime.bootTime)" +%s)" = "$boot" ]
OUT2=$(collect_system)
check "the boot time is the same on every push" [ "$(jq -r .os.lastBootTime <<< "$OUT2")" = "$(field .os.lastBootTime)" ]

# Without btime: now minus /proc/uptime; under an hour only minutes
printf 'cpu  1 2 3 4\n' > "$PROC_DIR/stat"
echo "1530.25 99.00" > "$PROC_DIR/uptime"
OUT=$(collect_system)
check "without btime: from /proc/uptime" bash -c 'b=$(date -d "$1Z" +%s); n=$(date +%s); (( n - b >= 1530 && n - b <= 1535 ))' _ "$(field .os.lastBootTime)"
check "under an hour: minutes only" [ "$(field .os.uptimeFormatted)" = "25m" ]
check "under an hour: uptimeHours below 1" bash -c '[[ "$1" == 0.4[23] ]]' _ "$(field .os.uptimeHours)"
check "uptime.seconds from /proc/uptime" [ "$(field .uptime.seconds)" = "1530" ]

# Neither readable: no boot time (null), still valid JSON
rm -f "$PROC_DIR/stat" "$PROC_DIR/uptime"
OUT=$(collect_system)
check "nothing readable: valid JSON" jq -e . <<< "$OUT" >/dev/null
check "nothing readable: lastBootTime and uptimeFormatted null" [ "$(field '[.os.lastBootTime, .os.uptimeFormatted] | map(tostring) | join(",")')" = "null,null" ]
check "nothing readable: uptimeHours 0" [ "$(field .os.uptimeHours)" = "0" ]

rm -rf "$PROC_DIR"
echo
if [ "$failures" -eq 0 ]; then echo "All system tests passed"; else echo "$failures system test(s) failed"; fi
exit $(( failures > 0 ))
