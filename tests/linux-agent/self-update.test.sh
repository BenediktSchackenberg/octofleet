#!/usr/bin/env bash
# Tests for check_for_update in linux-agent/agent.sh: successful, rejected and failed
# replacements, and the service restart after "agent.sh update". Runs without network
# or systemd: curl, chmod, mv and systemctl are replaced by shell functions per case.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="$REPO/linux-agent/agent.sh"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only check_for_update: sourcing agent.sh would start the agent.
eval "$(sed -n '/^check_for_update() {/,/^}/p' "$AGENT")"
declare -F check_for_update >/dev/null || { echo "check_for_update not found in $AGENT"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

info() { echo "INFO $*"; }
warn() { echo "WARN $*"; }

OLD_AGENT='#!/usr/bin/env bash
VERSION="0.5.2-linux"
echo old'
NEW_AGENT='#!/usr/bin/env bash
VERSION="0.5.3-linux"
echo new'
NEW_SHA=$(printf '%s\n' "$NEW_AGENT" | sha256sum | cut -d' ' -f1)

# run_case [SETUP]: runs check_for_update in a subshell against a fresh install
# directory with a fake server offering 0.5.3-linux; SETUP is evaluated first
# (e.g. to replace chmod or mv). Sets RC, OUT and DIR.
run_case() {
    DIR=$(mktemp -d)
    printf '%s\n' "$OLD_AGENT" > "$DIR/agent.sh"
    chmod 644 "$DIR/agent.sh"
    OUT=$(
        SCRIPT_DIR="$DIR" API_URL="http://octofleet.test" VERSION="0.5.2-linux" AUTO_UPDATE=true
        RELEASE_SHA="$NEW_SHA"
        curl() {
            local out="" url=""
            while (($#)); do
                case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac
            done
            if [[ "$url" == */linux/latest ]]; then
                printf '{"version":"0.5.3-linux","sha256":"%s","download_url":"http://octofleet.test/agent.sh"}' "$RELEASE_SHA"
            else
                printf '%s\n' "$NEW_AGENT" > "$out"
            fi
        }
        eval "${1:-:}"
        check_for_update 2>&1
    )
    RC=$?
}

is_old() { grep -qx 'echo old' "$DIR/agent.sh"; }
is_new() { grep -qx 'echo new' "$DIR/agent.sh"; }
no_candidate() { [[ ! -e "$DIR/agent.sh.new" ]]; }
says() { grep -qF -- "$1" <<< "$OUT"; }
not_says() { ! grep -qF -- "$1" <<< "$OUT"; }

run_case
check "success: exits 0" test "$RC" -eq 0
check "success: reports the update" says "Updated to v0.5.3-linux, restarting"
check "success: agent.sh replaced" is_new
check "success: agent.sh is executable (755)" test "$(stat -c %a "$DIR/agent.sh")" = 755
check "success: no candidate file left" no_candidate

run_case 'chmod() { return 1; }'
check "chmod fails: returns 1" test "$RC" -eq 1
check "chmod fails: warns" says "cannot make the new agent.sh executable"
check "chmod fails: no success message" not_says "Updated to"
check "chmod fails: old agent.sh kept" is_old
check "chmod fails: candidate removed" no_candidate

run_case 'mv() { return 1; }'
check "mv fails: returns 1" test "$RC" -eq 1
check "mv fails: warns" says "cannot replace"
check "mv fails: no success message" not_says "Updated to"
check "mv fails: old agent.sh kept" is_old
check "mv fails: candidate removed" no_candidate

run_case 'RELEASE_SHA=0000000000000000000000000000000000000000000000000000000000000000'
check "checksum mismatch: returns 1" test "$RC" -eq 1
check "checksum mismatch: old agent.sh kept" is_old
check "checksum mismatch: candidate removed" no_candidate

run_case 'VERSION="0.5.3-linux"'
check "already up to date: returns 0" test "$RC" -eq 0
check "already up to date: nothing replaced" is_old

run_case 'MANUAL_UPDATE=true; systemctl() { echo "systemctl $*"; return 0; }'
check "manual update: exits 0" test "$RC" -eq 0
check "manual update: agent.sh replaced" is_new
check "manual update: restarts the running service" says "systemctl restart octofleet-agent"
check "manual update: reports the restart" says "restarted with v0.5.3-linux"

run_case 'MANUAL_UPDATE=true; systemctl() { [[ "$1" == restart ]] && return 1; return 0; }'
check "manual update, restart fails: exits 0 (file replaced)" test "$RC" -eq 0
check "manual update, restart fails: warns" says "restarting octofleet-agent failed"

run_case 'MANUAL_UPDATE=true; systemctl() { [[ "$1" == is-active ]] && return 3; echo "systemctl $*"; }'
check "manual update, service not running: no restart" not_says "systemctl restart"

run_case 'MANUAL_UPDATE=true; mv() { return 1; }; systemctl() { echo "systemctl $*"; return 0; }'
check "manual update, mv fails: returns 1" test "$RC" -eq 1
check "manual update, mv fails: no restart" not_says "systemctl restart"
check "manual update, mv fails: old agent.sh kept" is_old

if (( failures == 0 )); then echo "All self-update tests passed."; else echo "$failures test(s) failed."; fi
exit $(( failures == 0 ? 0 : 1 ))
