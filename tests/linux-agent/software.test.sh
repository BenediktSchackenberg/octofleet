#!/usr/bin/env bash
# Tests for collect_software in linux-agent/agent.sh on Debian/Ubuntu: only installed packages are
# reported. dpkg-query -W also lists removed packages whose configuration files are left (state rc,
# after `apt remove`); they must not count as installed - an old kernel removed years ago would bring
# its CVEs. dpkg-query is a shell function here that prints what dpkg prints for each state.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 2; }

# Load only collect_software: sourcing agent.sh would start the agent. Its JSON here-document has a
# "}" at the start of a line, so the function ends at the first "}" line after "EOF".
eval "$(awk '/^collect_software\(\) \{/ { f = 1 } f { print } f && /^EOF$/ { e = 1 } e && /^}$/ { exit }' "$AGENT")"
declare -F collect_software >/dev/null || { echo "collect_software not found in $AGENT"; exit 2; }

failures=0
check() {  # check DESCRIPTION CONDITION...
    local description="$1"; shift
    if "$@"; then echo "PASS  $description"; else echo "FAIL  $description"; failures=$((failures + 1)); fi
}

# dpkg is "installed"; rpm, pacman and apk are not (the dpkg branch is taken)
dpkg() { :; }
command() { if [[ "$1" == "-v" && "$2" == "dpkg" ]]; then return 0; fi; if [[ "$1" == "-v" ]]; then return 1; fi; builtin command "$@"; }

# The status (desired, status, error) and the fields the agent asks for, tab-separated
dpkg-query() {
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
        'ii ' bash 5.2.21-2ubuntu4 amd64 '' '' \
        'ii ' linux-image-5.15.0-204-generic 5.15.0-204.214 amd64 linux-signed 5.15.0-204.214 \
        'rc ' linux-image-4.4.0-87-generic 4.4.0-87.110 amd64 linux-signed 4.4.0-87.110 \
        'rc ' libapache2-mod-php7.0 7.0.33-0ubuntu0.16.04.16 amd64 php7.0 7.0.33-0ubuntu0.16.04.16 \
        'hi ' openssl 3.0.2-0ubuntu1.18 amd64 '' '' \
        'iW ' man-db 2.10.2-1 amd64 '' '' \
        'it ' libc-bin 2.35-0ubuntu3.8 amd64 glibc 2.35-0ubuntu3.8 \
        'ri ' oldtool 1.0-1 amd64 '' '' \
        'iU ' halfdone 1.0-1 amd64 '' '' \
        'iF ' broken 1.0-1 amd64 '' '' \
        'iH ' partly 1.0-1 amd64 '' '' \
        'pn ' purged 1.0-1 amd64 '' '' \
        'un ' unknown '' '' '' ''
}

OUT=$(collect_software)
names() { jq -r '[.software[].name] | join(",")' <<< "$OUT"; }
check "valid JSON" bash -c 'jq -e . <<< "$1" >/dev/null' _ "$OUT"
# files on disk: installed, held, triggers pending, marked for removal, unpacked, half-configured
check "packages with their files on disk are reported" \
    [ "$(names)" = "bash,linux-image-5.15.0-204-generic,openssl,man-db,libc-bin,oldtool,halfdone,broken" ]
check "removed with configuration files left (rc) are not" bash -c '! grep -q "4.4.0-87\|php7.0" <<< "$1"' _ "$(names)"
check "half-installed (partly unpacked), purged and unknown are not" bash -c '! grep -qE "partly|purged|unknown" <<< "$1"' _ "$(names)"
check "count matches the list" [ "$(jq -r '.count' <<< "$OUT")" = "8" ]
check "fields after the status stay in place" [ "$(jq -c '.software[1]' <<< "$OUT")" = \
    '{"name":"linux-image-5.15.0-204-generic","version":"5.15.0-204.214","architecture":"amd64","sourcePackage":"linux-signed","sourceVersion":"5.15.0-204.214"}' ]
check "no source package: the package itself" [ "$(jq -c '.software[0] | [.sourcePackage, .sourceVersion]' <<< "$OUT")" = '["bash","5.2.21-2ubuntu4"]' ]

echo
if [ "$failures" -eq 0 ]; then echo "All software tests passed"; else echo "$failures software test(s) failed"; fi
exit $(( failures > 0 ))
