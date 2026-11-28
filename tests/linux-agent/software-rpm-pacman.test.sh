#!/usr/bin/env bash
# Tests for collect_software in linux-agent/agent.sh on rpm (RHEL, Rocky, Alma, Fedora) and pacman (Arch,
# CachyOS) systems: each package with its source package - advisories name the source (openssl, not
# openssl-libs) - and on rpm the version with its epoch (1:3.5.9-1.el9_9: without it the installed
# version reads older than a fix in 1:3.0.7). rpm and pacman's database are faked here.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }
eval "$(awk '/^collect_software\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
declare -F collect_software >/dev/null || { echo "collect_software not found in $AGENT"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}
pkg() { jq -c --arg n "$2" '.software[] | select(.name == $n) | [.version, .sourcePackage, .sourceVersion, .architecture]' <<< "$1"; }

# --- rpm: "installed", dpkg is not ------------------------------------------------------------------
command() { if [[ "$1" == "-v" && "$2" == "rpm" ]]; then return 0; fi; if [[ "$1" == "-v" ]]; then return 1; fi; builtin command "$@"; }
rpm() {  # NAME EPOCHNUM VERSION RELEASE ARCH SOURCERPM
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
        openssl-libs 1 3.5.9 1.el9_9 x86_64 openssl-3.5.9-1.el9_9.src.rpm \
        curl 0 7.76.1 44.el9_9.1 x86_64 curl-7.76.1-44.el9_9.1.src.rpm \
        kernel-core 0 5.14.0 741.27.1.el9_9 x86_64 kernel-5.14.0-741.27.1.el9_9.src.rpm \
        python3-systemd 0 234 19.el9 x86_64 python-systemd-234-19.el9.src.rpm \
        gpg-pubkey 0 350d275d 6279464b '(none)' '(none)'
}
OUT=$(collect_software)
check "rpm: valid JSON, all packages" [ "$(jq -r '.count' <<< "$OUT")" = "5" ]
check "rpm: version with the epoch, source package and version (epoch too)" \
    [ "$(pkg "$OUT" openssl-libs)" = '["1:3.5.9-1.el9_9","openssl","1:3.5.9-1.el9_9","x86_64"]' ]
check "rpm: no epoch prefix for epoch 0" [ "$(pkg "$OUT" curl)" = '["7.76.1-44.el9_9.1","curl","7.76.1-44.el9_9.1","x86_64"]' ]
check "rpm: a sub-package names its source" [ "$(pkg "$OUT" kernel-core | jq -r '.[1]')" = "kernel" ]
check "rpm: a source name with dashes" [ "$(pkg "$OUT" python3-systemd | jq -r '.[1]')" = "python-systemd" ]
check "rpm: no source rpm - the package itself" [ "$(pkg "$OUT" gpg-pubkey)" = '["350d275d-6279464b","gpg-pubkey","350d275d-6279464b","(none)"]' ]
unset -f rpm

# --- pacman: the local database ------------------------------------------------------------------------
command() { if [[ "$1" == "-v" && "$2" == "pacman" ]]; then return 0; fi; if [[ "$1" == "-v" ]]; then return 1; fi; builtin command "$@"; }
DB=$(mktemp -d); trap 'rm -rf "$DB"' EXIT
desc() {  # desc NAME VERSION BASE ARCH (BASE "" = no %BASE% field)
    mkdir -p "$DB/$1-$2"
    { printf '%%NAME%%\n%s\n\n%%VERSION%%\n%s\n\n' "$1" "$2"
      [ -n "$3" ] && printf '%%BASE%%\n%s\n\n' "$3"
      printf '%%DESC%%\nsomething\n\n%%ARCH%%\n%s\n\n' "$4"; } > "$DB/$1-$2/desc"
}
desc openssl 3.6.0-1 openssl x86_64
desc lib32-openssl 1:3.6.0-1 lib32-openssl x86_64
desc linux-cachyos-headers 7.3.5-2 linux-cachyos x86_64_v3
desc oldpkg 1.0-1 "" any
OUT=$(PACMAN_LOCAL_DB="$DB" collect_software)
check "pacman: valid JSON, all packages" [ "$(jq -r '.count' <<< "$OUT")" = "4" ]
check "pacman: base package as source" [ "$(pkg "$OUT" linux-cachyos-headers)" = '["7.3.5-2","linux-cachyos","7.3.5-2","x86_64_v3"]' ]
check "pacman: epoch kept as pacman writes it" [ "$(pkg "$OUT" lib32-openssl | jq -r '.[0]')" = "1:3.6.0-1" ]
check "pacman: no %BASE% - the package itself" [ "$(pkg "$OUT" oldpkg)" = '["1.0-1","oldpkg","1.0-1","any"]' ]
EMPTY=$(mktemp -d)
pacman() { printf 'openssl 3.6.0-1\n'; }
OUT=$(PACMAN_LOCAL_DB="$EMPTY" collect_software); rmdir "$EMPTY"
check "pacman: without the database, pacman -Q" [ "$(jq -c '.software' <<< "$OUT")" = '[{"name":"openssl","version":"3.6.0-1"}]' ]

echo
if [ "$failures" -eq 0 ]; then echo "All rpm/pacman software tests passed"; else echo "$failures rpm/pacman software test(s) failed"; fi
exit $(( failures > 0 ))
