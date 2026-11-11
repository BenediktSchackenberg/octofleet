#!/usr/bin/env bash
# Exercise the job types shared with the backend without starting the agent service.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENT="${AGENT:-$REPO/linux-agent/agent.sh}"
command -v jq >/dev/null || { echo "jq is required"; exit 2; }

eval "$(awk '/^schedule_restart\(\) \{/ { found = 1 } found && /^# ===/ { exit } found { print }' "$AGENT")"
declare -F execute_job >/dev/null || { echo "execute_job not found"; exit 2; }

RESULT=$(mktemp)
RESTART=$(mktemp)
trap 'rm -f "$RESULT" "$RESTART"' EXIT
API_URL=http://localhost:8080
API_KEY=test-key
info() { :; }
warn() { :; }
curl() {
    while (($#)); do
        if [[ "$1" == "-d" ]]; then printf '%s' "$2" > "$RESULT"; shift 2; else shift; fi
    done
}
push_inventory() { echo "Inventory sent"; }
systemctl() { :; }
systemd-run() { printf '%s\n' "$*" > "$RESTART"; }

job() {
    jq -nc --arg kind "$1" --arg payload "$2" \
        '{instanceId: "00000000-0000-0000-0000-000000000001", jobName: "test", commandType: $kind, commandPayload: $payload}'
}
check() {
    local kind="$1" payload="$2" expected="$3"
    execute_job "$(job "$kind" "$payload")"
    jq -e --arg expected "$expected" '.status == "success" and (.stdout | contains($expected))' "$RESULT" >/dev/null || {
        echo "FAIL $kind: $(cat "$RESULT")"; exit 1;
    }
    echo "PASS $kind"
}

check inventory '{}' 'Inventory sent'
check inventory_push '{}' 'Inventory sent'
check run '{"command":["printf","%s","hello world"]}' 'hello world'
check restart-agent '{}' 'Agent restart scheduled'
grep -q -- '--on-active=30s' "$RESTART" || { echo "FAIL restart timer"; exit 1; }

execute_job "$(job run '{"command":[]}')"
jq -e '.status == "failed" and .exitCode == 1' "$RESULT" >/dev/null || {
    echo "FAIL empty run command"; exit 1;
}
echo "PASS empty run command fails"
