#!/usr/bin/env bash
# Tests for the agent on systems without a D-Bus system bus (minimal images): systemd-run
# --wait fails there ("Failed to connect to bus"), so package commands and the logrotate file go
# through a transient unit that the agent polls with systemctl (sd_run_wait in linux-agent/agent.sh).
# Runs without root or systemd: systemd-run, systemctl and shutdown are fakes, and a plain unix
# socket stands in for systemd's private socket. A real check on systemd 249 without dbus is in the PR.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required (to create a unix socket)"; exit 2; }

eval "$(awk '/^# --- systemd helpers/,/^# --- end systemd helpers ---$/' "$AGENT")"
eval "$(awk '/^package_manager\(\) \{/ { f = 1 } /^execute_job\(\) \{/ { exit } f { print }' "$AGENT")"
eval "$(awk '/^LOGROTATE_MARKER=/ { f = 1 } /^run_service\(\) \{/ { exit } f { print }' "$AGENT")"
for fn in systemd_mode sd_run sd_run_wait run_package_command schedule_system_reboot ensure_logrotate; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done
info() { :; }; warn() { echo "WARN $*" >&2; }
LOG_DIR=/var/log/octofleet-agent LOG_ROTATE_COUNT=4 LOG_ROTATE_MAXSIZE=2M

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d)
trap 'kill $SOCK_PID 2>/dev/null; rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"
python3 -c 'import socket, sys, time; s = socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); time.sleep(600)' "$WORK/private" &
SOCK_PID=$!
for _ in $(seq 50); do [[ -S "$WORK/private" ]] && break; sleep 0.1; done

# fake systemd-run: records its arguments and DBUS_SYSTEM_BUS_ADDRESS; fails like systemd 249 does
# without a bus when --wait is used (FAKE_NO_BUS=1), or always (FAKE_UNREACHABLE=1). Runs the command
# (the last arguments after the options) and writes its output to the StandardOutput file.
cat > "$BIN/systemd-run" <<'EOF'
#!/bin/bash
echo "systemd-run $* | DBUS=${DBUS_SYSTEM_BUS_ADDRESS:-}" >> "$WORK/calls"
all=" $* "
[[ -n "${FAKE_UNREACHABLE:-}" ]] && { echo "Failed to connect to bus: No such file or directory" >&2; exit 1; }
[[ -n "${FAKE_NO_BUS:-}" && " $* " == *" --wait "* ]] && { echo "Failed to connect to bus: No such file or directory" >&2; exit 1; }
out=/dev/null cmd=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quiet|--wait|--collect) shift ;;
        --unit|-p|--setenv) [[ "$1" == -p && "$2" == StandardOutput=file:* ]] && out="${2#StandardOutput=file:}"; shift 2 ;;
        --unit=*|--setenv=*|--on-active=*|--on-calendar=*) shift ;;
        *) cmd=("$@"); break ;;
    esac
done
[[ " ${cmd[*]} " == *" reboot"* ]] && exit 0   # a reboot timer: nothing to run now
"${cmd[@]}" > "$out" 2>/dev/null; echo $? > "$WORK/exit"
[[ "$all" == *" --wait "* ]] && exit "$(cat "$WORK/exit")"
exit 0
EOF
# fake systemctl: "show" reports the unit running for FAKE_POLLS calls, then exited/failed with the
# command's exit code (as systemd does with RemainAfterExit=yes); other calls are recorded
cat > "$BIN/systemctl" <<'EOF'
#!/bin/bash
echo "systemctl $*" >> "$WORK/calls"
if [[ "$1" == show ]]; then
    n=$(( $(cat "$WORK/polls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$WORK/polls"
    if (( n <= ${FAKE_POLLS:-2} )); then
        printf 'ActiveState=active\nSubState=running\nExecMainStatus=0\nResult=success\n'
    else
        code=$(cat "$WORK/exit" 2>/dev/null || echo 0)
        if (( code == 0 )); then printf 'ActiveState=active\nSubState=exited\nExecMainStatus=0\nResult=success\n'
        else printf 'ActiveState=failed\nSubState=failed\nExecMainStatus=%s\nResult=exit-code\n' "$code"; fi
    fi
fi
exit 0
EOF
cat > "$BIN/shutdown" <<'EOF'
#!/bin/bash
echo "Failed to connect to bus: No such file or directory" >&2; exit 1
EOF
chmod +x "$BIN"/*
export WORK PATH="$BIN:$PATH" SD_POLL_SECONDS=0
reset() { rm -f "$WORK/calls" "$WORK/polls" "$WORK/exit"; }
calls() { cat "$WORK/calls" 2>/dev/null; }

# --- which way systemd is reached ---
unset DBUS_SYSTEM_BUS_ADDRESS
DBUS_SYSTEM_SOCKET="$WORK/no-such-bus" SYSTEMD_PRIVATE_SOCKET="$WORK/private"
check "no system bus, private socket there: private" [ "$(systemd_mode)" = private ]
check "with a system bus: bus" [ "$(DBUS_SYSTEM_SOCKET="$WORK/private" systemd_mode)" = bus ]
check "DBUS_SYSTEM_BUS_ADDRESS set: bus" [ "$(DBUS_SYSTEM_BUS_ADDRESS=unix:path=/x systemd_mode)" = bus ]
check "neither socket (container, test machine): bus, as before" [ "$(SYSTEMD_PRIVATE_SOCKET="$WORK/none" systemd_mode)" = bus ]
check "no systemd-run: none" [ "$(PATH=/usr/bin/nonexistent systemd_mode)" = none ]

# --- package commands without a bus: started without --wait, polled, exit code and output back ---
reset; export FAKE_NO_BUS=1 INVOCATION_ID=test PACKAGE_OUTPUT_DIR="$WORK"
out=$(run_package_command 60 sh -c 'echo "Reading package lists..."; exit 0'); rc=$?
check "success: exit code 0" [ "$rc" = 0 ]
check "success: the command's output comes back" [ "$out" = "Reading package lists..." ]
check "started over systemd's private socket" grep -q "DBUS=unix:path=$WORK/private" <<< "$(calls)"
check "without --wait, with RemainAfterExit=yes" grep -q -- "--unit octofleet-packages-.* -p RemainAfterExit=yes -p StandardOutput=file:" <<< "$(calls)"
check "no --wait call at all" bash -c '! grep -q -- "--wait" "$WORK/calls"'
check "the unit is polled until it has finished" [ "$(grep -c '^systemctl show' "$WORK/calls")" = 3 ]
check "then stopped and removed" bash -c 'grep -q "^systemctl stop octofleet-packages-.*\.service" "$WORK/calls" && grep -q "^systemctl reset-failed octofleet-packages-" "$WORK/calls"'
check "the output file is removed" [ -z "$(ls "$WORK"/octofleet-packages.* 2>/dev/null)" ]

reset
out=$(run_package_command 60 sh -c 'echo "E: Unable to locate package nosuch"; exit 100'); rc=$?
check "failure: the command's exit code comes back (100)" [ "$rc" = 100 ]
check "failure: its output too" [ "$out" = "E: Unable to locate package nosuch" ]

# --- with a bus nothing changes: systemd-run --wait as before ---
reset; unset FAKE_NO_BUS
out=$(DBUS_SYSTEM_SOCKET="$WORK/private" run_package_command 60 sh -c 'echo ok; exit 3'); rc=$?
check "bus: systemd-run --wait --collect as before" grep -q "^systemd-run --quiet --wait --collect --unit octofleet-packages-" <<< "$(calls)"
check "bus: exit code and output" [ "$rc:$out" = "3:ok" ]
check "bus: not polled" bash -c '! grep -q "^systemctl show" "$WORK/calls"'

# --- systemd not reachable at all: one plain sentence instead of "Failed to connect to bus" ---
reset; export FAKE_UNREACHABLE=1
out=$(run_package_command 60 true); rc=$?
check "unreachable: fails" [ "$rc" != 0 ]
check "unreachable: says what is missing and what to do" grep -q "systemd is not reachable: this system has no D-Bus system bus .* Install and start dbus" <<< "$out"
check "unreachable: no raw bus error" bash -c '! grep -q "Failed to connect to bus" <<< "$1"' _ "$out"
unset FAKE_UNREACHABLE

# --- reboot timer and logrotate without a bus ---
reset; export FAKE_NO_BUS=1
out=$(schedule_system_reboot schedule 2099-01-02T21:00:00Z); rc=$?
check "reboot: a timer over the private socket" bash -c 'grep -q -- "--on-calendar=2099-01-02 21:00:00 UTC /bin/systemctl reboot | DBUS=unix:path=" "$WORK/calls"'
check "reboot: reported as scheduled" [ "$rc:$out" = "0:Reboot scheduled for 2099-01-02 21:00:00 UTC" ]

reset
command -v logrotate >/dev/null 2>&1 || ln -s /bin/true "$BIN/logrotate"  # ensure_logrotate needs it
cat > "$BIN/install" <<'EOF'
#!/bin/bash
cp "$3" "$WORK/installed"  # install -m 644 STAGED TARGET
EOF
chmod +x "$BIN/install"
install_bin=$(command -v install)
eval "$(declare -f ensure_logrotate | sed "s#/usr/bin/install#$install_bin#")"
LOGROTATE_FILE=/sys/octofleet-logrotate-test LOGROTATE_TMP_DIR="$WORK" ensure_logrotate 2>/dev/null; rc=$?
check "logrotate: written through a polled unit" [ "$rc" = 0 ]
check "logrotate: without --wait" bash -c '! grep -q -- "--wait" "$WORK/calls" && grep -q "octofleet-logrotate-.*RemainAfterExit=yes" "$WORK/calls"'
check "logrotate: the configuration arrived" grep -q "$LOGROTATE_MARKER" "$WORK/installed"
unset FAKE_NO_BUS INVOCATION_ID

# --- outside systemd, shutdown cannot reach logind: a plain sentence ---
out=$(schedule_system_reboot force ""); rc=$?
check "shutdown fails without logind: says why" [ "$rc:$out" = "1:Reboot could not be scheduled: shutdown failed (it needs systemd-logind over D-Bus)" ]

echo
if [ "$failures" -eq 0 ]; then echo "All no-D-Bus tests passed"; else echo "$failures no-D-Bus test(s) failed"; fi
exit $(( failures > 0 ))
