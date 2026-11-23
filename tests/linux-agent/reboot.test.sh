#!/usr/bin/env bash
# Tests for the reboot job and the logged-on users of the Linux agent (linux-agent/agent.sh).
# Runs without root: PATH holds a fake shutdown, systemd-run, loginctl and who, so the machine is
# never restarted.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

eval "$(grep -E '^LOGGED_ON_(INTERVAL|USERS|AT)=' "$AGENT")"
for fn in refresh_logged_on_users logged_on_users_now run_reboot; do
    eval "$(awk -v fn="$fn" '$0 ~ "^" fn "\\(\\) \\{" { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
TOOLS="$WORK/tools"; mkdir -p "$TOOLS"
for tool in bash sh jq timeout tr cut date cat printf rm grep head; do
    ln -s "$(command -v "$tool")" "$TOOLS/$tool"
done
export WORK
# Fakes: each records its arguments, one per line
for tool in shutdown systemd-run; do
    cat > "$TOOLS/$tool" <<EOF
#!/bin/bash
printf '%s\n' "\$@" > "\$WORK/$tool.args"
exit \${FAKE_${tool//-/_}_RC:-0}
EOF
    chmod +x "$TOOLS/$tool"
done
cat > "$TOOLS/loginctl" <<'EOF'
#!/bin/bash
[ -n "${FAKE_LOGINCTL:-}" ] || exit 1
printf '%s' "$FAKE_LOGINCTL"
EOF
cat > "$TOOLS/who" <<'EOF'
#!/bin/bash
printf '%s' "${FAKE_WHO:-}"
EOF
chmod +x "$TOOLS/loginctl" "$TOOLS/who"
ORIG_PATH=$PATH
PATH="$TOOLS"
unset INVOCATION_ID

fresh() { LOGGED_ON_AT=0; LOGGED_ON_USERS=null; rm -f "$WORK"/*.args; }

# --- logged-on users ---
fresh
FAKE_LOGINCTL='[{"session":"3","uid":1000,"user":"anna","seat":"seat0","tty":"tty2","class":"user"},
 {"session":"c1","uid":1000,"user":"anna","seat":null,"tty":null,"class":"manager"},
 {"session":"7","uid":1001,"user":"bob","seat":null,"tty":"pts/0"}]' refresh_logged_on_users
check "logind: people at a terminal, not manager sessions" \
    test "$(jq -c 'map(.user + "@" + .session)' <<< "$LOGGED_ON_USERS")" = '["anna@tty2","bob@pts/0"]'

fresh
FAKE_WHO=$'carl     pts/1        2026-11-23 09:01 (10.0.0.5)\n' refresh_logged_on_users
check "who when logind does not answer" \
    test "$(jq -c '.[0] | [.user, .session, .since]' <<< "$LOGGED_ON_USERS")" = '["carl","pts/1","2026-11-23 09:01"]'

fresh
refresh_logged_on_users
check "nobody logged on: an empty list" test "$LOGGED_ON_USERS" = "[]"

fresh
rm "$TOOLS/who" "$TOOLS/loginctl"
refresh_logged_on_users
check "no loginctl and no who: unknown (null)" test "$LOGGED_ON_USERS" = "null"
LOGGED_ON_USERS='[{"user":"x"}]'
refresh_logged_on_users
check "read at most every LOGGED_ON_INTERVAL seconds" test "$LOGGED_ON_USERS" = '[{"user":"x"}]'

# --- reboot ---
fresh
out=$(run_reboot '{"action":"reboot","at":null,"message":null}'); rc=$?
check "now: exit 0" test "$rc" -eq 0
check "now: shutdown -r +1 with the default message" test "$(tr '\n' '|' < "$WORK/shutdown.args")" = "-r|+1|Octofleet: this machine restarts|"
check "now: says when" grep -q "^Reboot scheduled for .* (in 1 min)$" <<< "$out"

fresh
at=$(date -u -d "@$(( $(date +%s) + 90 * 60 ))" +%Y-%m-%dT%H:%M:%SZ)
out=$(run_reboot "{\"action\":\"reboot\",\"at\":\"$at\",\"message\":\"Updates: save your work\"}")
check "at a time: minutes until then and the message" \
    test "$(tr '\n' '|' < "$WORK/shutdown.args")" = "-r|+90|Updates: save your work|"

fresh
LOGGED_ON_AT=$(date +%s); LOGGED_ON_USERS='[{"user":"anna","session":"tty2"}]'
out=$(run_reboot '{"action":"reboot"}')
check "names the logged-on users in the job output" grep -q "^Logged-on users: anna (tty2)$" <<< "$out"

fresh
out=$(export INVOCATION_ID=x; run_reboot '{"action":"reboot"}')
check "under systemd: through a transient unit, outside the sandbox" \
    grep -q "^$TOOLS/shutdown$" "$WORK/systemd-run.args"
check "under systemd: waits for shutdown to accept it" grep -qx -- "--wait" "$WORK/systemd-run.args"

fresh
out=$(export FAKE_shutdown_RC=1; run_reboot '{"action":"reboot"}'); rc=$?
check "shutdown refuses: the job fails" test "$rc" -ne 0
check "shutdown refuses: says so" grep -q "Scheduling the reboot failed" <<< "$out"

fresh
out=$(run_reboot '{"action":"reboot","at":"not a time"}'); rc=$?
check "invalid time: fails without calling shutdown" test "$rc" -ne 0 -a ! -e "$WORK/shutdown.args"

fresh
out=$(run_reboot '{"action":"cancel"}'); rc=$?
check "cancel: shutdown -c" test "$(head -1 "$WORK/shutdown.args")" = "-c" -a "$rc" -eq 0
check "cancel: says so" test "$out" = "Reboot cancelled"

fresh
out=$(export INVOCATION_ID=x; run_reboot '{"action":"cancel"}')
check "cancel under systemd: also stops reboot timers of update installations" \
    grep -q "systemctl stop 'octofleet-reboot-\*.timer'" "$WORK/systemd-run.args"

fresh
out=$(run_reboot '{"action":"format"}'); rc=$?
check "unknown action fails" test "$rc" -ne 0

PATH=$ORIG_PATH
echo
if (( failures )); then echo "$failures test(s) failed"; exit 1; fi
echo "All reboot tests passed"
