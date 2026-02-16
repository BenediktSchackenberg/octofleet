#!/bin/bash
# Metrics Collection Scheduler
# Runs every 15 minutes via systemd timer

set -e

API_URL="${OCTOFLEET_API_URL:-http://192.168.0.5:8080}"
API_KEY="${OCTOFLEET_API_KEY:-}"
LOG_FILE="${LOG_DIR:-/var/log}/octofleet-metrics-scheduler.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date -Iseconds)] $1" | tee -a "$LOG_FILE"
}

log "=== Starting Metrics Collection ==="

# Create metrics collection job
JOB_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/jobs" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d @/tmp/metrics-job.json)

JOB_ID=$(echo "$JOB_RESPONSE" | jq -r '.id')
INSTANCES=$(echo "$JOB_RESPONSE" | jq -r '.instancesCreated')

if [ "$JOB_ID" == "null" ] || [ -z "$JOB_ID" ]; then
    log "ERROR: Failed to create job: $JOB_RESPONSE"
    exit 1
fi

log "Created job: $JOB_ID ($INSTANCES instances)"

# Wait for completion (max 2 minutes)
MAX_WAIT=120
WAITED=0
POLL_INTERVAL=10

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep $POLL_INTERVAL
    WAITED=$((WAITED + POLL_INTERVAL))
    
    RUNNING=$(curl -s "$API_URL/api/v1/jobs/$JOB_ID" \
      -H "X-API-Key: $API_KEY" | jq '[.instances[] | select(.status == "running" or .status == "queued")] | length')
    
    COMPLETED=$(curl -s "$API_URL/api/v1/jobs/$JOB_ID" \
      -H "X-API-Key: $API_KEY" | jq '[.instances[] | select(.status == "success" or .status == "failed")] | length')
    
    log "Status: $COMPLETED completed, $RUNNING running"
    
    if [ "$RUNNING" -eq 0 ] && [ "$COMPLETED" -gt 0 ]; then
        log "All active nodes completed after ${WAITED}s"
        break
    fi
done

log "=== Metrics Collection Complete ==="
