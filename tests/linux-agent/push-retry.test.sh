#!/usr/bin/env bash
# Tests for next_push_time in linux-agent/agent.sh: after a failed inventory push the agent tries
# again after PUSH_RETRY_INTERVAL, doubled per further failure up to PUSH_INTERVAL, with jitter.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"

eval "$(awk '/^next_push_time\(\) \{/ { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
declare -F next_push_time >/dev/null || { echo "next_push_time not found in $AGENT"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

PUSH_INTERVAL=1800 PUSH_RETRY_INTERVAL=60
# in_range VALUE LOW HIGH
in_range() { (( $1 >= $2 && $1 <= $3 )); }
check "a successful push: the next one after PUSH_INTERVAL" [ "$(next_push_time 0 1000 3)" = "2800" ]
check "first failure: retry after 60-90 s" in_range "$(next_push_time 1 1000 0)" 1060 1090
check "curl errors (exit 7, 56) count as failed" in_range "$(next_push_time 56 1000 0)" 1060 1090
check "second failure in a row: 120-180 s" in_range "$(next_push_time 1 1000 1)" 1120 1180
check "third failure in a row: 240-360 s" in_range "$(next_push_time 1 1000 2)" 1240 1360
check "many failures: at most PUSH_INTERVAL plus jitter" in_range "$(next_push_time 1 1000 20)" 2800 3700
# Jitter: 50 agents failing at the same moment do not all retry at the same second
times=$(for _ in $(seq 50); do next_push_time 1 1000 0; done | sort -u | wc -l)
check "jitter spreads the retries (50 agents -> more than 10 different times)" [ "$times" -gt 10 ]
PUSH_RETRY_INTERVAL=15
check "PUSH_RETRY_INTERVAL is configurable" in_range "$(next_push_time 1 1000 0)" 1015 1022

grep -q '^PUSH_RETRY_INTERVAL="${PUSH_RETRY_INTERVAL:-60}"' "$AGENT"
check "the default retry interval is 60 s" [ $? -eq 0 ]
check "the initial and the periodic push use it" [ "$(grep -c 'push_due=$(next_push_time "$push_rc"' "$AGENT")" = "2" ]

echo
if [ "$failures" -eq 0 ]; then echo "All push retry tests passed"; else echo "$failures push retry test(s) failed"; fi
exit $(( failures > 0 ))
