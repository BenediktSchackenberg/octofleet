#!/usr/bin/env bash
# Terminal and screen polling in linux-agent/agent.sh (#283): the idle request rate, and how long a
# new session waits for the agent. A simulated clock runs the main loop's polling against a simulated
# server; nothing waits for real.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"

eval "$(awk '/^poll_pace\(\) \{/ { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
declare -F poll_pace >/dev/null || { echo "poll_pace not found in $AGENT"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

POLL_IDLE_INTERVAL=5 SESSION_ACTIVE_GRACE=60

# simulate SECONDS OPEN_FROM OPEN_UNTIL: the main loop (one round per second) with a terminal page
# open from OPEN_FROM to OPEN_UNTIL; prints the seconds at which the agent polled
simulate() {
    local now due=0 active_until=0
    for (( now = 0; now < $1; now++ )); do
        if (( now >= due )); then
            echo "$now"
            (( now >= $2 && now < $3 )) && active_until=$(( now + SESSION_ACTIVE_GRACE ))
            due=$(( now + $(poll_pace "$now" "$active_until") ))
        fi
    done
}

# 1. Idle request rate
idle=$(simulate 600 -1 -1 | wc -l)
echo "idle: $idle terminal polls in 10 minutes (before: 600, one per second)"
check "idle: about one poll per 5 s (100-150 in 10 minutes)" [ "$idle" -ge 100 -a "$idle" -le 150 ]
gaps_ok=$(simulate 600 -1 -1 | awk 'NR > 1 && ($1 - p < 4 || $1 - p > 6) { bad = 1 } { p = $1 } END { print bad ? 0 : 1 }')
check "idle: every gap 4-6 s" [ "$gaps_ok" = 1 ]

# 2. Session start delay: a page opens at a random second
max=0 sum=0 runs=200 every_second=1
for (( i = 0; i < runs; i++ )); do
    opened=$(( 60 + RANDOM % 60 ))
    polls=$(simulate 240 "$opened" 240)
    first=$(awk -v o="$opened" '$1 >= o { print; exit }' <<<"$polls")
    delay=$(( first - opened )); sum=$(( sum + delay )); (( delay > max )) && max=$delay
    # from then on every second
    awk -v f="$first" '$1 >= f && $1 < f + 60 { if (p != "" && $1 - p != 1) bad = 1; p = $1 } END { exit bad }' <<<"$polls" || every_second=0
done
echo "session start delay: average $(( sum * 10 / runs / 10 )).$(( sum * 10 / runs % 10 )) s, longest $max s (before: at most 1 s)"
check "session start: the agent notices an open page within 6 s" [ "$max" -le 6 ]
check "while the page is open: every second" [ "$every_second" = 1 ]

# 3. After the page closes: every second for SESSION_ACTIVE_GRACE, then idle again
polls=$(simulate 600 10 70)
fast_after=$(awk '$1 >= 70 && $1 < 129' <<<"$polls" | wc -l)
check "after closing: still every second for 60 s" [ "$fast_after" -eq 59 ]
late_ok=$(awk '$1 >= 135 { if (p != "" && ($1 - p < 4 || $1 - p > 6)) bad = 1; p = $1 } END { print bad ? 0 : 1 }' <<<"$polls")
check "after the grace time: idle again" [ "$late_ok" = 1 ]

# 4. Settings
POLL_IDLE_INTERVAL=1
check "POLL_IDLE_INTERVAL=1 polls every second" [ "$(poll_pace 100 0)" = 1 ]
POLL_IDLE_INTERVAL=0
check "an interval below 1 s counts as 1 s" [ "$(poll_pace 100 0)" = 1 ]
POLL_IDLE_INTERVAL=30
v=$(poll_pace 100 0)
check "POLL_IDLE_INTERVAL is configurable (30 -> 29-31 s)" [ "$v" -ge 29 -a "$v" -le 31 ]
check "the default idle interval is 5 s" grep -q '^POLL_IDLE_INTERVAL="${POLL_IDLE_INTERVAL:-5}"' "$AGENT"
check "the default grace time is 60 s" grep -q '^SESSION_ACTIVE_GRACE="${SESSION_ACTIVE_GRACE:-60}"' "$AGENT"
check "terminal and screen polling both use it" [ "$(grep -c '_due=$(( now + $(poll_pace "$now"' "$AGENT")" = "2" ]
check "the terminal poll reads the server's active flag" grep -q '\.active == true' "$AGENT"

echo
if [ "$failures" -eq 0 ]; then echo "All idle polling tests passed"; else echo "$failures idle polling test(s) failed"; fi
exit $(( failures > 0 ))
