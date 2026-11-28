#!/usr/bin/env bash
# Tests for collect_services in linux-agent/agent.sh: systemctl marks not-found and failed units with
# a marker (● or *) unless --plain is given; the marker must not become the unit's name. systemctl is
# a shell function here that prints what a real systemd prints.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only collect_services: sourcing agent.sh would start the agent. Its JSON here-document has a
# "}" at the start of a line, so the function ends at the first "}" line after "EOF".
eval "$(awk '/^collect_services\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
declare -F collect_services >/dev/null || { echo "collect_services not found in $AGENT"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

UNITS='  cron.service                loaded    active   running Regular background program processing daemon
● auditd.service              not-found inactive dead    auditd.service
× nginx.service               loaded    failed   failed  A high performance web server
  getty@tty1.service          loaded    active   running Getty on tty1
  systemd-fsck@dev\x2dsda1.service loaded inactive dead    Says "hi" \ back'
ENABLED='cron.service enabled enabled
nginx.service enabled enabled'

# MARKERS=1: systemctl ignores --plain (prints the markers anyway); else markers only without --plain
systemctl() {
    case "$1" in
        list-units)
            if [[ " $* " == *" --plain "* && -z "${MARKERS:-}" ]]; then sed 's/^\(●\|×\|\*\) /  /' <<< "$UNITS"
            else echo "$UNITS"; fi ;;
        list-unit-files) echo "$ENABLED" ;;
    esac
}

for mode in plain markers; do
    if [ "$mode" = markers ]; then MARKERS=1; else unset MARKERS; fi
    OUT=$(collect_services)
    svc() { jq -c --arg n "$1" '.services[] | select(.name == $n) | [.loadState, .activeState, .subState, .description]' <<< "$OUT"; }
    check "$mode: valid JSON" bash -c 'jq -e . <<< "$1" >/dev/null' _ "$OUT"
    check "$mode: 5 services, no marker as a name" [ "$(jq -r '[.services[].name] | join(",")' <<< "$OUT")" = 'cron,auditd,nginx,getty@tty1,systemd-fsck@dev\x2dsda1' ]
    check "$mode: not-found unit in its fields" [ "$(svc auditd)" = '["not-found","inactive","dead","auditd.service"]' ]
    check "$mode: failed unit in its fields" [ "$(svc nginx)" = '["loaded","failed","failed","A high performance web server"]' ]
    check "$mode: running unit unchanged" [ "$(svc cron)" = '["loaded","active","running","Regular background program processing daemon"]' ]
    check "$mode: quotes and backslashes in the description" [ "$(jq -r '.services[4].description' <<< "$OUT")" = 'Says "hi" \ back' ]
    check "$mode: summary counts 2 active, 1 failed, 2 inactive" [ "$(jq -c '.summary' <<< "$OUT")" = '{"total":5,"active":2,"failed":1,"inactive":2}' ]
    check "$mode: enabled services" [ "$(jq -c '.enabledServices' <<< "$OUT")" = '["cron","nginx"]' ]
done

echo
if [ "$failures" -eq 0 ]; then echo "All services tests passed"; else echo "$failures services test(s) failed"; fi
exit $(( failures > 0 ))
