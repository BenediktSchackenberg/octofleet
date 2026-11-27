#!/usr/bin/env bash
# Tests for collect_live_processes in linux-agent/agent.sh: the live process list with the CPU use
# since the previous push (not ps's lifetime average) as a share of all CPUs, argv[0] as the name,
# the top LIVE_PROCESS_COUNT by CPU, then memory. PROC_DIR points at fake /proc files.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only the two functions: sourcing agent.sh would start the agent
for fn in collect_live_processes _live_process_top; do
    eval "$(awk -v fn="$fn" '$0 ~ "^" fn "\\(\\) \\{" { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

PROC_DIR=$(mktemp -d)
LIVE_CLK_TCK=100 LIVE_PAGE_SIZE=4096
LIVE_PROC_SAMPLE="" LIVE_PROCESSES="[]"
declare -A LIVE_USER_NAMES
ME=$(id -u); ME_NAME=$(id -un)

# proc PID COMM UTIME STIME START_TICKS RSS_PAGES UID CMDLINE (printf format, \0 between arguments)
proc() {
    mkdir -p "$PROC_DIR/$1"
    echo "$1 ($2) S 1 1 1 0 -1 4194560 100 0 0 0 $3 $4 0 0 20 0 1 0 $5 1000000 $6 18446744073709551615" > "$PROC_DIR/$1/stat"
    printf 'Name:\t%s\nUmask:\t0022\nUid:\t%s\t%s\t%s\t%s\n' "$2" "$7" "$7" "$7" "$7" > "$PROC_DIR/$1/status"
    printf "$8" > "$PROC_DIR/$1/cmdline"
}
set_uptime() { echo "$1 0.00" > "$PROC_DIR/uptime"; }
proc_of() { jq -c --argjson p "$1" '.[] | select(.pid == $p)' <<< "$LIVE_PROCESSES"; }
# is PID PATH VALUE: jq compares, so 60 and 60.0 are equal (jq 1.7+ keeps the literal 60.0)
is() { jq -e --argjson p "$1" --argjson v "$3" "[.[] | select(.pid == \$p) | $2] == [\$v]" <<< "$LIVE_PROCESSES" >/dev/null; }
valid() { jq -e "$1" <<< "$LIVE_PROCESSES" >/dev/null; }
field() { jq -r --argjson p "$1" ".[] | select(.pid == \$p) | $2" <<< "$LIVE_PROCESSES"; }

printf 'cpu  1 2 3 4\ncpu0 1 2 3 4\ncpu1 1 2 3 4\nintr 0\n' > "$PROC_DIR/stat"   # 2 CPUs
# 101 ran 9000 ticks over 1000 s of life (lifetime average 9 % of a CPU, ps would show 9.0), now busy
proc 101 "busy" 6000 3000 0 25600 "$ME" '/usr/bin/python3\0-m\0worker\0--password\0secret\0'
proc 102 "postgres" 100 50 0 51200 "$ME" 'postgres: checkpointer   \0\0\0'
proc 103 "kworker/0:1" 0 0 0 0 0 ''
proc 104 "a) b (c" 10 0 0 256 "$ME" 'odd"name\\x\0'
proc 105 "chrome" 0 0 0 128 "$ME" '/opt/chrome/chrome --type=renderer --lang=en-US\0'
set_uptime 1000.00
collect_live_processes          # first call: baseline, sleep 0.5 s, then the list (nothing changed: 0 %)
check "first call: valid JSON list" valid 'type == "array"'
check "first call: all five processes" [ "$(jq length <<< "$LIVE_PROCESSES")" = 5 ]
check "first call: no lifetime average (0 % while nothing ran since the baseline)" is 101 .cpuPercent 0
check "first call: the sample for the next push is kept" bash -c '[[ "$1" == "100000 "* ]]' _ "$LIVE_PROC_SAMPLE"

# 5 s later (500 ticks per CPU, 1000 for both): 101 used 600 ticks (60 %), 102 used 50 (5 %)
proc 101 "busy" 6400 3200 0 25600 "$ME" '/usr/bin/python3\0-m\0worker\0--password\0secret\0'
proc 102 "postgres" 140 60 0 51200 "$ME" 'postgres: checkpointer   \0\0\0'
set_uptime 1005.00
collect_live_processes
check "valid JSON" valid .
check "CPU since the previous push, as a share of all CPUs: 60.0" is 101 .cpuPercent 60
check "second process: 5.0" is 102 .cpuPercent 5
check "sorted by CPU: the busiest first (the first process is not dropped)" [ "$(jq '.[0].pid' <<< "$LIVE_PROCESSES")" = 101 ]
check "same CPU: sorted by memory (postgres before the 1 MB odd one)" bash -c '[ "$(jq -c "[.[].pid]" <<< "$1")" = "[101,102,104,105,103]" ]' _ "$LIVE_PROCESSES"
check "name: argv[0] without the arguments (no --password secret)" [ "$(field 101 .name)" = "/usr/bin/python3" ]
check "name: a process title stays whole, without its padding" [ "$(field 102 .name)" = "postgres: checkpointer" ]
check "name: a title with options is cut at the first option" [ "$(field 105 .name)" = "/opt/chrome/chrome" ]
check "name: kernel thread (empty cmdline) as [comm]" [ "$(field 103 .name)" = "[kworker/0:1]" ]
check "name: quotes and backslashes escaped" [ "$(field 104 .name)" = 'odd"name\x' ]
check "memoryMb from the RSS pages: 100.0" is 101 .memoryMb 100
check "userName from the UID" [ "$(field 101 .userName)" = "$ME_NAME" ]
check "userName of UID 0" [ "$(field 103 .userName)" = "$(getent passwd 0 | cut -d: -f1)" ]

# A reused PID (other start time) does not inherit the old process's CPU time; one started since the
# previous sample counts all its CPU time; one that is gone is left out
rm -rf "${PROC_DIR:?}/105"
proc 102 "sleeper" 50 0 100700 512 "$ME" '/bin/sleeper\0'      # new 102, started at 1007 s, 50 ticks
proc 106 "new" 100 100 100800 512 "$ME" '/bin/new\0'           # started at 1008 s, 200 ticks
proc 107 "old" 300 0 50000 512 "$ME" '/bin/old\0'              # not in the sample, started before it
set_uptime 1010.00
collect_live_processes
check "reused PID: its own CPU time only (50 of 1000 ticks: 5.0)" is 102 .cpuPercent 5
check "reused PID: the new name" [ "$(field 102 .name)" = "/bin/sleeper" ]
check "started since the previous push: all its CPU time (20.0)" is 106 .cpuPercent 20
check "not in the previous sample but older: 0, not its lifetime" is 107 .cpuPercent 0
check "gone processes are left out" [ -z "$(proc_of 105)" ]
check "unchanged process: 0 %" is 101 .cpuPercent 0

# Only the top LIVE_PROCESS_COUNT; a process whose status is gone has no user (null)
LIVE_PROCESS_COUNT=3
rm -f "$PROC_DIR/106/status"
proc 101 "busy" 7800 3200 0 25600 "$ME" '/usr/bin/python3\0'
set_uptime 1015.00
collect_live_processes
check "LIVE_PROCESS_COUNT=3: three processes" [ "$(jq length <<< "$LIVE_PROCESSES")" = 3 ]
check "the busiest is still first" [ "$(jq '.[0].pid' <<< "$LIVE_PROCESSES")" = 101 ]
check "CPU is capped at 100" is 101 .cpuPercent 100
unset LIVE_PROCESS_COUNT
collect_live_processes
check "status gone: userName null" [ "$(field 106 .userName)" = null ]

# Long uptime: ticks above 2^31 (mawk 1.3.4-2020 would print them as 3e+09 and break the sample)
rm -rf "${PROC_DIR:?}"/[0-9]*
LIVE_PROC_SAMPLE=""
proc 201 "long" 3000000000 0 100 512 "$ME" '/bin/long\0'
set_uptime 30000000.00
collect_live_processes
check "long uptime: the sample has whole numbers" bash -c '[[ "$1" == "3000000000 201:100:3000000000" ]]' _ "$LIVE_PROC_SAMPLE"
proc 201 "long" 3000000500 0 100 512 "$ME" '/bin/long\0'
set_uptime 30000005.00
collect_live_processes
check "long uptime: CPU still right (500 of 1000 ticks: 50.0)" is 201 .cpuPercent 50

# No processes readable: an empty list
rm -rf "${PROC_DIR:?}"/[0-9]*
collect_live_processes
check "no processes: []" [ "$LIVE_PROCESSES" = "[]" ]

# Cost: 2,000 processes in one call (one cat, one awk; ps aux reads several files per process)
for i in $(seq 1000 2999); do
    mkdir -p "$PROC_DIR/$i"
    echo "$i (p$i) S 1 1 1 0 -1 4194560 100 0 0 0 $i 0 0 0 20 0 1 0 0 1000000 100 0" > "$PROC_DIR/$i/stat"
done
LIVE_PROC_SAMPLE=""; collect_live_processes
start=$(date +%s%N); collect_live_processes; ms=$(( ($(date +%s%N) - start) / 1000000 ))
echo "      2,000 processes: ${ms} ms"
check "2,000 processes: 20 in the list" [ "$(jq length <<< "$LIVE_PROCESSES")" = 20 ]
check "2,000 processes: under 1 s" [ "$ms" -lt 1000 ]

rm -rf "$PROC_DIR"
echo
if [ "$failures" -eq 0 ]; then echo "All live process tests passed"; else echo "$failures live process test(s) failed"; fi
exit $(( failures > 0 ))
