#!/usr/bin/env bash
# Tests for the pacman update list of the Linux agent (pacman_updates via collect_updates): name,
# new and installed version from "pacman -Qu", repository and architecture from one "pacman -Si".
# Runs without network or root: pacman is a fake in a sealed PATH.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

eval "$(awk '/^collect_updates\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
for fn in pacman_updates pacman_reboot_required os_release_json; do
    eval "$(awk -v fn="$fn" '$0 ~ "^" fn "\\(\\) \\{" { f = 1 } f { print } f && /^}$/ { exit }' "$AGENT")"
done
for fn in collect_updates pacman_updates pacman_reboot_required os_release_json; do
    declare -F "$fn" >/dev/null || { echo "$fn not found in $AGENT"; exit 2; }
done

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

WORK=$(mktemp -d); export WORK
BIN="$WORK/bin"; mkdir -p "$BIN"
# pacman as on CachyOS: linux-cachyos is in two repositories (the one with the new version counts),
# an ignored package, and -Si answers for all names in one call
cat > "$BIN/pacman" <<'FAKE'
#!/bin/bash
echo "pacman $* [LC_ALL=${LC_ALL:-}]" >> "$WORK/calls"
case "$1" in
  -Qu)
    [ -n "${NO_UPDATES:-}" ] && exit 1
    cat <<'OUT'
linux-cachyos 7.3.4-1 -> 7.3.5-1
glibc 2.42+r9-1 -> 2.42+r12-1
mesa 1:25.2.3-1 -> 1:25.2.4-1 [ignored]
OUT
    ;;
  -Si)
    [ -n "${SI_FAILS:-}" ] && { echo "error: database not found" >&2; exit 1; }
    cat <<'OUT'
Repository      : core
Name            : linux-cachyos
Version         : 7.3.4-1
Architecture    : x86_64

Repository      : cachyos-v3
Name            : linux-cachyos
Version         : 7.3.5-1
Architecture    : x86_64_v3

Repository      : core
Name            : glibc
Version         : 2.42+r12-1
Architecture    : x86_64

Repository      : extra
Name            : mesa
Version         : 1:25.2.4-1
Architecture    : x86_64
OUT
    ;;
esac
FAKE
chmod +x "$BIN/pacman"
for tool in bash sh env jq awk cat rm date grep sed sort head tail wc uname timeout mkdir chmod; do
    ln -s "$(command -v "$tool")" "$BIN/$tool"
done
export PATH="$BIN" OS_RELEASE_FILE="$WORK/os-release"
printf 'NAME="CachyOS Linux"\nID=cachyos\nID_LIKE=arch\nBUILD_ID=rolling\n' > "$OS_RELEASE_FILE"
export MODULES_DIR="$WORK/modules"; mkdir -p "$MODULES_DIR/$(uname -r)"
# the Debian marker comes first in collect_updates: point it into $WORK (absent), never at the
# host's /var/run/reboot-required
export REBOOT_REQUIRED_FILE="$WORK/reboot-required"
calls() { cat "$WORK/calls" 2>/dev/null; }

OUT=$(collect_updates)
check "valid JSON, package manager pacman" [ "$(jq -r .packageManager <<< "$OUT")" = pacman ]
check "three updates (ignored ones are listed too)" [ "$(jq -r .totalUpdates <<< "$OUT")" = 3 ]
check "new and installed version" \
    [ "$(jq -c '.updates[0] | [.name, .installedVersion, .newVersion]' <<< "$OUT")" = '["linux-cachyos","7.3.4-1","7.3.5-1"]' ]
check "repository and arch of the entry with the new version" \
    [ "$(jq -c '.updates[0] | [.repository, .arch]' <<< "$OUT")" = '["cachyos-v3","x86_64_v3"]' ]
check "epoch versions" [ "$(jq -c '.updates[2] | [.newVersion, .repository]' <<< "$OUT")" = '["1:25.2.4-1","extra"]' ]
check "no security data on pacman" [ "$(jq -c '[.updates[].security] | unique' <<< "$OUT")" = '[false]' ]
check "one pacman -Si for all names, English output" \
    [ "$(grep -c '^pacman -Si linux-cachyos glibc mesa \[LC_ALL=C\]' <<< "$(calls)")" = 1 ]
check "rolling release: id without versionId" [ "$(jq -c '.release | [.id, .versionId, .idLike]' <<< "$OUT")" = '["cachyos",null,"arch"]' ]

check "rolling release: BUILD_ID is sent" [ "$(jq -r .release.buildId <<< "$OUT")" = rolling ]
check "without arch-audit: no security source" [ "$(jq -r .securitySource <<< "$OUT")" = null ] && [ "$(jq -r .securityUpdates <<< "$OUT")" = 0 ]
check "kernel modules of the running kernel present: no reboot required" [ "$(jq -r .rebootRequired <<< "$OUT")" = false ]
check "without the agent's copy of the databases: the live ones" bash -c '! grep -q -- "--dbpath" <<< "$1"' _ "$(calls)"

# the update search's copy of the sync databases, arch-audit, a kernel update
export PACMAN_CHECK_DB="$WORK/pacman-sync"; mkdir -p "$PACMAN_CHECK_DB/sync"
cat > "$BIN/arch-audit" <<'FAKE'
#!/bin/bash
echo "arch-audit $*" >> "$WORK/calls"
[ "$*" = "--upgradable --quiet --quiet" ] && echo glibc
FAKE
chmod +x "$BIN/arch-audit"
rm -f "$WORK/calls"; rm -rf "$MODULES_DIR/$(uname -r)"
OUT=$(collect_updates)
check "with the agent's copy: pacman -Qu and -Si read it" \
    [ "$(grep -c -- "--dbpath $WORK/pacman-sync" <<< "$(calls)")" = 2 ]
check "arch-audit: the package with a fixed advisory is a security update" \
    [ "$(jq -c '[.updates[] | select(.security) | .name]' <<< "$OUT")" = '["glibc"]' ] && [ "$(jq -r .securityUpdates <<< "$OUT")" = 1 ]
check "arch-audit: named as the security source" [ "$(jq -r .securitySource <<< "$OUT")" = arch-audit ]
check "the running kernel's modules are gone: reboot required" [ "$(jq -r .rebootRequired <<< "$OUT")" = true ]
rm -f "$BIN/arch-audit"; rm -rf "$PACMAN_CHECK_DB"; unset PACMAN_CHECK_DB; mkdir -p "$MODULES_DIR/$(uname -r)"

OUT=$(SI_FAILS=1 collect_updates)
check "pacman -Si fails: updates still listed without repository" \
    [ "$(jq -r .totalUpdates <<< "$OUT")" = 3 ] && [ "$(jq -c '[.updates[].repository] | unique' <<< "$OUT")" = '[null]' ]
OUT=$(NO_UPDATES=1 collect_updates)
check "no updates: empty list, valid JSON" [ "$(jq -r '.updates | length' <<< "$OUT")" = 0 ]

rm -rf "$WORK"
echo
if [ "$failures" -eq 0 ]; then echo "All pacman update tests passed"; else echo "$failures pacman update test(s) failed"; fi
exit $(( failures > 0 ))
