#!/usr/bin/env bash
# The long-poll of linux-agent/agent.sh (#283): one request the server holds until there is work for
# the node, instead of the terminal, screen and job polls. Tests the request and its answers, the
# fallback to the usual polls when the server has no long-poll (404), the spread reconnects after
# errors, and the idle request rate. curl is a fake command answering from a list; sleep only records.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

for fn in poll_pace long_poll_kinds long_poll_once long_poll_retry_delay long_poll_loop; do
    eval "$(awk -v f="$fn" '$0 ~ "^" f "\\(\\) \\{" { p = 1 } p { print } p && /^}$/ { exit }' "$AGENT")"
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
info() { echo "INFO $*" >> "$WORK/log"; }
warn() { echo "WARN $*" >> "$WORK/log"; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}
in_range() { (( $1 >= $2 && $1 <= $3 )); }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"
# curl: answers with the first line of $WORK/answers ("CODE BODY"); none left: connection refused
cat > "$BIN/curl" <<'EOF'
#!/bin/bash
echo "$*" >> "$WORK/calls"
line=$(head -n1 "$WORK/answers" 2>/dev/null)
sed -i '1d' "$WORK/answers" 2>/dev/null
if [ -z "$line" ]; then printf '\n000'; exit 7; fi
printf '%s\n%s' "${line#* }" "${line%% *}"
EOF
chmod +x "$BIN/curl"
export WORK PATH="$BIN:$PATH"

API_URL="http://server.invalid" API_KEY="test" NODE_ID="node-1" SCREEN_CAPTURE_TOOL=""
LONG_POLL_SECONDS=55 LONG_POLL_RETRY_INTERVAL=15 LONG_POLL_RECHECK_INTERVAL=3600 LONG_POLL_FALLBACK_INTERVAL=600

answers() { printf '%s\n' "$@" > "$WORK/answers"; : > "$WORK/calls"; }
once() { OUT=$(long_poll_once); RC=$?; }

# 1. One request
answers '200 {"wake":["jobs","terminal"]}'
once
check "answer: the kinds of work" [ "$RC" = 0 -a "$OUT" = "jobs terminal" ]
check "request: the node, the kinds it handles and the hold time" \
    grep -q 'http://server.invalid/api/v1/agent/wait/node-1?kinds=jobs,terminal&timeout=55' "$WORK/calls"
check "request: with the agent key" grep -q 'X-API-Key: test' "$WORK/calls"
max=$(grep -o -- '--max-time [0-9]*' "$WORK/calls" | awk '{ print $2 }')
check "curl waits longer than the server holds (75 > 55 s)" [ "${max:-0}" = 75 ]
answers '200 {"wake":[]}'; once
check "empty answer after the hold time" [ "$RC" = 0 -a -z "$OUT" ]
answers '200 {"wake":["shell","remediation","jobs"]}'; once
check "kinds the Linux agent does not handle are left out" [ "$RC" = 0 -a "$OUT" = "jobs" ]
answers '404 {"detail":"Not Found"}'; once
check "404: the server has no long-poll" [ "$RC" = 2 ]
answers '200 <html>frontend</html>'; once
check "an answer that is not the long-poll's counts as no long-poll" [ "$RC" = 2 ]
answers '500 {"detail":"error"}'; once
check "500: an error" [ "$RC" = 1 -a "$OUT" = "HTTP 500" ]
answers; once
check "server not reachable: an error" [ "$RC" = 1 -a "$OUT" = "HTTP 000" ]
SCREEN_CAPTURE_TOOL=scrot
answers '200 {"wake":["screen"]}'; once
check "with a screen capture tool: screen sessions too" [ "$OUT" = "screen" ]
check "... and asked for" grep -q 'kinds=jobs,terminal,screen&' "$WORK/calls"
SCREEN_CAPTURE_TOOL=""

# 2. Reconnects after errors: spread, growing, capped
check "first error: again after 7-22 s" in_range "$(long_poll_retry_delay 1)" 7 22
check "second error in a row: 15-45 s" in_range "$(long_poll_retry_delay 2)" 15 45
check "many errors: at most 7.5 minutes" in_range "$(long_poll_retry_delay 30)" 150 450
spread=$(for _ in $(seq 50); do long_poll_retry_delay 1; done | sort -u | wc -l)
check "server restart: 50 agents come back at more than 10 different seconds" [ "$spread" -gt 10 ]
LONG_POLL_RETRY_INTERVAL=0
check "a retry interval of 0 still waits" in_range "$(long_poll_retry_delay 1)" 1 3
LONG_POLL_RETRY_INTERVAL=15

# 3. The loop: wake-up files for the main loop, DIR/active while the long-poll works
DIR="$WORK/wake"; mkdir -p "$DIR"
# sleep: records the seconds and what the main loop would see, then the main loop has run the polls
sleep() { echo "$1" >> "$WORK/sleeps"; ls "$DIR" | tr '\n' ' ' >> "$WORK/seen"; echo >> "$WORK/seen"; rm -f "$DIR/jobs" "$DIR/terminal" "$DIR/screen"; }
loop() { rm -f "$DIR"/* "$WORK/sleeps" "$WORK/seen" "$WORK/log"; touch "$WORK/sleeps" "$WORK/seen" "$WORK/log"; answers "${@:2}"; long_poll_loop "$DIR" "$1"; }

loop 1 '200 {"wake":["jobs","terminal"]}'
check "wake-up: files for the job and terminal polls" grep -q '^active jobs terminal $' "$WORK/seen"
check "long-poll answered: active" [ -e "$DIR/active" ]
check "logged once" [ "$(grep -c 'Long-poll active' "$WORK/log")" = 1 ]
loop 3 '200 {"wake":[]}' '200 {"wake":[]}' '200 {"wake":[]}'
check "empty answers: asks again at once (only 1 s apart when the server answers at once)" \
    [ "$(sort -u "$WORK/sleeps")" = 1 -a "$(wc -l < "$WORK/calls")" = 3 ]
check "no wake-up files for empty answers" [ -z "$(tr -d ' \n' < "$WORK/seen" | sed 's/active//g')" ]

loop 1 '404 {"detail":"Not Found"}'
check "404: not active, the main loop keeps its usual polls" [ ! -e "$DIR/active" ]
check "404: asks again after LONG_POLL_RECHECK_INTERVAL" [ "$(cat "$WORK/sleeps")" = 3600 ]
check "404: logged" grep -q 'no long-poll' "$WORK/log"

touch "$DIR/active"
answers '200 {"wake":[]}' '404 {"detail":"Not Found"}'
rm -f "$WORK/sleeps"; long_poll_loop "$DIR" 2
check "server downgraded: back to the usual polls" [ ! -e "$DIR/active" ]

loop 4 '200 {"wake":[]}' '502 bad gateway' '502 bad gateway' '200 {"wake":["jobs"]}'
s2=$(sed -n 2p "$WORK/sleeps"); s3=$(sed -n 3p "$WORK/sleeps")
check "error: reconnect after 7-22 s" in_range "${s2:-0}" 7 22
check "second error: 15-45 s" in_range "${s3:-0}" 15 45
check "while failing: not active, the usual polls run" grep -q '^$' "$WORK/seen"
check "error logged once" [ "$(grep -c 'Long-poll failed (HTTP 502)' "$WORK/log")" = 1 ]
check "answers again: active" [ -e "$DIR/active" ]
check "... and the wake-up arrives" grep -q '^active jobs $' "$WORK/seen"
unset -f sleep

# 4. Idle request rate and wake-up delay. The main loop: one round per second; the long-poll comes back
# empty after the server's hold time (55 s minus up to 10 % jitter, as in agent_wait.hold_seconds)
simulate_idle() {  # simulate_idle SECONDS SCREEN(0/1): prints the requests of an idle agent
    local now job_every=$LONG_POLL_FALLBACK_INTERVAL idle_every=$LONG_POLL_FALLBACK_INTERVAL
    local last_poll=$(( -RANDOM % 600 )) terminal_due=$(( RANDOM % 600 )) screen_due=$(( RANDOM % 600 )) wait_due=0
    for (( now = 0; now < $1; now++ )); do
        (( now >= wait_due )) && { echo wait; wait_due=$(( now + 50 + RANDOM % 6 )); }
        (( now - last_poll >= job_every )) && { echo jobs; last_poll=$now; }
        (( $2 && now >= screen_due )) && { echo screen; screen_due=$(( now + $(poll_pace "$now" 0 "$idle_every") )); }
        (( now >= terminal_due )) && { echo terminal; terminal_due=$(( now + $(poll_pace "$now" 0 "$idle_every") )); }
    done
}
hour=$(simulate_idle 3600 0 | wc -l)
hour_screen=$(simulate_idle 3600 1 | wc -l)
per_min=$(awk -v n="$hour" 'BEGIN { printf "%.1f", n / 60 }')
per_min_screen=$(awk -v n="$hour_screen" 'BEGIN { printf "%.1f", n / 60 }')
echo "idle: $hour requests per hour = $per_min/min ($per_min_screen/min with a screen capture tool);" \
     "before: 13/min (12 terminal + 1 job poll), 25/min with a screen capture tool"
check "idle: at most 1.5 requests per minute (jobs + terminal)" [ "$hour" -le 90 ]
check "idle: at most 1.7 requests per minute with screen" [ "$hour_screen" -le 102 ]
check "idle: 10,000 nodes send fewer than 300 requests per second" [ $(( hour_screen * 10000 / 3600 )) -lt 300 ]

check "a wake-up runs the job poll in the same round" grep -q '\[\[ -e "$wake_dir/jobs" \]\] && last_poll=0' "$AGENT"
check "... and the terminal poll" grep -q '\[\[ -e "$wake_dir/terminal" \]\] && terminal_due=0' "$AGENT"
check "... and the screen poll" grep -q '\[\[ -e "$wake_dir/screen" \]\] && screen_due=0' "$AGENT"
check "the main loop sleeps 1 s per round: a wake-up waits at most 1 s" grep -q '^        sleep 1$' "$AGENT"
check "fallback: the usual intervals while the long-poll is not active" \
    grep -q 'job_every=$JOB_POLL_INTERVAL idle_every=$POLL_IDLE_INTERVAL' "$AGENT"
check "the job poll uses that interval" grep -q 'if (( now - last_poll >= job_every )); then' "$AGENT"
check "terminal and screen polls use it" [ "$(grep -c 'poll_pace "$now" "$[a-z]*_active_until" "$idle_every"' "$AGENT")" = 2 ]
check "the long-poll runs in the background" grep -q 'long_poll_loop "$wake_dir" &' "$AGENT"
check "LONG_POLL=false turns it off" grep -q '^LONG_POLL="${LONG_POLL:-true}"' "$AGENT"
check "the default fallback interval is 10 minutes" grep -q '^LONG_POLL_FALLBACK_INTERVAL="${LONG_POLL_FALLBACK_INTERVAL:-600}"' "$AGENT"
check "poll_pace without IDLE uses POLL_IDLE_INTERVAL" [ "$(POLL_IDLE_INTERVAL=1 poll_pace 100 0)" = 1 ]
v=$(poll_pace 100 0 600)
check "poll_pace with IDLE 600: 599-601 s" in_range "$v" 599 601

echo
if [ "$failures" -eq 0 ]; then echo "All long-poll tests passed"; else echo "$failures long-poll test(s) failed"; fi
exit $(( failures > 0 ))
