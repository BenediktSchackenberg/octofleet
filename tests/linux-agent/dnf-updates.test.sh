#!/usr/bin/env bash
# Tests for the dnf/yum part of the Linux agent's inventory (collect_updates, dnf_updates,
# dnf_reboot_required, run_package_command): update list, per-package security flag and severity
# from the security advisories, the reboot check, English output, and the transient unit without
# --pipe. Runs without network or root: dnf, needs-restarting and systemd-run are fakes.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only the functions under test: sourcing agent.sh would start the agent. collect_updates ends
# at the first "}" line after its "EOF" (JSON here-document); the others at their first "}" line.
eval "$(awk '/^collect_updates\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
for fn in run_package_command dnf_reboot_required dnf_updates; do
    eval "$(awk -v fn="$fn" '$0 ~ "^" fn "\\(\\) \\{" { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
done
for fn in collect_updates run_package_command dnf_reboot_required dnf_updates; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d); export WORK
BIN="$WORK/bin"; mkdir -p "$BIN" "$WORK/plugins"
# dnf as on Rocky Linux 9: check-update (exit 100 with updates, an "Obsoleting Packages" section
# that must not count), updateinfo --security, needs-restarting -r (exit $NEEDS_RESTARTING).
# Only answers in English with LC_ALL=C - the agent parses the text.
cat > "$BIN/dnf" <<'FAKE'
#!/bin/bash
echo "dnf $* [LC_ALL=${LC_ALL:-}]" >> "$WORK/calls"
[ "${LC_ALL:-}" = C ] || { echo "Fehler: Sprache nicht C"; exit 1; }
case "$*" in
  "-q check-update")
    cat <<'OUT'

kernel.x86_64                     5.14.0-611.5.1.el9_8          baseos
openssl-libs.x86_64               1:3.5.1-4.el9_8               baseos
vim-minimal.x86_64                2:8.2.2637-22.el9_8           baseos
Obsoleting Packages
grub2-tools.x86_64                1:2.06-120.el9_8              baseos
OUT
    exit 100 ;;
  "-q updateinfo list --security")
    [ -n "${NO_ERRATA:-}" ] && exit 0
    cat <<'OUT'
RLSA-2026:1234 Important/Sec.  kernel-5.14.0-611.5.1.el9_8.x86_64
RLSA-2026:1240 Moderate/Sec.   openssl-libs-1:3.5.1-4.el9_8.x86_64
RLSA-2026:1241 Low/Sec.        openssl-libs-1:3.5.1-4.el9_8.x86_64
OUT
    exit 0 ;;
  "-q needs-restarting -r") exit "${NEEDS_RESTARTING:-0}" ;;
esac
exit 1
FAKE
chmod +x "$BIN/dnf"
# a sealed PATH: only the fakes and the tools the functions use - never a real apt-get or dnf
for tool in bash sh env jq awk timeout mktemp cat rm date sort head tail grep sed paste wc touch chmod ls; do
    ln -s "$(command -v "$tool")" "$BIN/$tool"
done
export PATH="$BIN" DNF_PLUGIN_DIR="$WORK/plugins" PACKAGE_OUTPUT_DIR="$WORK"
unset INVOCATION_ID
touch "$WORK/plugins/needs_restarting.py"
calls() { cat "$WORK/calls" 2>/dev/null; }
reset() { rm -f "$WORK/calls"; }

# --- update list, security flags, severity (directly, without systemd) ---
reset
OUT=$(collect_updates)
check "valid JSON" jq -e . <<< "$OUT" >/dev/null
check "package manager dnf" [ "$(jq -r .packageManager <<< "$OUT")" = dnf ]
check "three updates; the obsoleting section does not count" [ "$(jq -r .totalUpdates <<< "$OUT")" = 3 ]
check "name.arch, new version and repository" \
    [ "$(jq -c '.updates[0] | [.name, .newVersion, .repository]' <<< "$OUT")" = '["kernel.x86_64","5.14.0-611.5.1.el9_8","baseos"]' ]
check "security flag and severity from the advisories" \
    [ "$(jq -c '[.updates[] | [.name, .security, .severity]]' <<< "$OUT")" = '[["kernel.x86_64",true,"Important"],["openssl-libs.x86_64",true,"Low"],["vim-minimal.x86_64",false,null]]' ]
check "security updates are counted per package, not per advisory line" [ "$(jq -r .securityUpdates <<< "$OUT")" = 2 ]
check "dnf runs with LC_ALL=C" bash -c '! grep -v "LC_ALL=C\]" <<< "$1" | grep -q .' _ "$(calls)"

# --- reboot check ---
NEEDS_RESTARTING=1 OUT=$(NEEDS_RESTARTING=1 collect_updates)
check "dnf needs-restarting exit 1: reboot required" [ "$(jq -r .rebootRequired <<< "$OUT")" = true ]
OUT=$(NEEDS_RESTARTING=0 collect_updates)
check "dnf needs-restarting exit 0: no reboot" [ "$(jq -r .rebootRequired <<< "$OUT")" = false ]
rm -f "$WORK/plugins/needs_restarting.py"
OUT=$(NEEDS_RESTARTING=1 collect_updates)
check "without needs-restarting and the dnf plugin: unknown, not 'required'" [ "$(jq -r .rebootRequired <<< "$OUT")" = null ]
touch "$WORK/plugins/needs_restarting.py"

# --- a distribution without security errata (e.g. CentOS Stream): no flags, no error ---
OUT=$(NO_ERRATA=1 collect_updates)
check "no errata: updates listed, none flagged" \
    [ "$(jq -r .totalUpdates <<< "$OUT")" = 3 ] && [ "$(jq -r .securityUpdates <<< "$OUT")" = 0 ]

# --- under systemd: a transient unit, output through a file, never --pipe ---
cat > "$BIN/systemd-run" <<'FAKE'
#!/bin/bash
echo "systemd-run $*" >> "$WORK/calls"
for a in "$@"; do [ "$a" = --pipe ] && { echo "Failed to start transient service unit: Connection reset by peer" >&2; exit 1; }; done
env=() out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --setenv=*) env+=("${1#--setenv=}") ;;
    -p) shift; case "$1" in StandardOutput=file:*) out="${1#StandardOutput=file:}" ;; esac ;;
    --unit) shift ;;
    --*) ;;
    *) break ;;
  esac
  shift
done
env "${env[@]}" "$@" > "$out" 2>&1
FAKE
chmod +x "$BIN/systemd-run"
reset
OUT=$(INVOCATION_ID=test collect_updates)
check "under systemd: updates through the transient unit" [ "$(jq -r .totalUpdates <<< "$OUT")" = 3 ] && [ "$(jq -r .securityUpdates <<< "$OUT")" = 2 ]
check "under systemd: no --pipe" bash -c '! grep -q -- --pipe <<< "$1"' _ "$(calls)"
check "under systemd: output file option" grep -q -- "-p StandardOutput=file:$WORK/octofleet-packages\." <<< "$(calls)"
check "under systemd: the output files are removed" bash -c '! ls "$1"/octofleet-packages.* >/dev/null 2>&1' _ "$WORK"
check "under systemd: the exit code comes back" [ "$(NEEDS_RESTARTING=1 INVOCATION_ID=test bash -c "$(declare -f run_package_command); run_package_command 10 dnf -q needs-restarting -r >/dev/null; echo \$?")" = 1 ]

rm -rf "$WORK"
echo
if [ "$failures" -eq 0 ]; then echo "All dnf update tests passed"; else echo "$failures dnf update test(s) failed"; fi
exit $(( failures > 0 ))
