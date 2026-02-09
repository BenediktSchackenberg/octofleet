#!/bin/bash
# Eventlog Collection Scheduler
# Runs every 6 hours via systemd timer

set -e

API_URL="http://192.168.0.5:8080"
API_KEY="openclaw-inventory-dev-key"
LOG_FILE="/home/benedikt/.openclaw/workspace/openclaw-windows-agent/logs/eventlog-scheduler.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date -Iseconds)] $1" | tee -a "$LOG_FILE"
}

log "=== Starting Eventlog Collection ==="

# 1. Create collection job
JOB_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/jobs" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d @/tmp/eventlog-scheduled-job.json)

JOB_ID=$(echo "$JOB_RESPONSE" | jq -r '.id')
INSTANCES=$(echo "$JOB_RESPONSE" | jq -r '.instancesCreated')

if [ "$JOB_ID" == "null" ] || [ -z "$JOB_ID" ]; then
    log "ERROR: Failed to create job: $JOB_RESPONSE"
    exit 1
fi

log "Created job: $JOB_ID ($INSTANCES instances)"

# 2. Wait for job completion (max 2 minutes, skip offline nodes)
MAX_WAIT=120
WAITED=0
POLL_INTERVAL=10

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep $POLL_INTERVAL
    WAITED=$((WAITED + POLL_INTERVAL))
    
    # Check if all non-pending jobs are done (success/failed/cancelled)
    # Pending jobs are nodes that haven't picked up the job yet (offline)
    RUNNING=$(curl -s "$API_URL/api/v1/jobs/$JOB_ID" \
      -H "X-API-Key: $API_KEY" | jq '[.instances[] | select(.status == "running" or .status == "queued")] | length')
    
    COMPLETED=$(curl -s "$API_URL/api/v1/jobs/$JOB_ID" \
      -H "X-API-Key: $API_KEY" | jq '[.instances[] | select(.status == "success" or .status == "failed")] | length')
    
    log "Status: $COMPLETED completed, $RUNNING running"
    
    # If nothing is running and at least one completed, we're good
    if [ "$RUNNING" -eq 0 ] && [ "$COMPLETED" -gt 0 ]; then
        log "All active nodes completed after ${WAITED}s"
        break
    fi
done

# 3. Parse eventlog results
PARSE_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/jobs/$JOB_ID/parse-eventlog" \
  -H "X-API-Key: $API_KEY")

INSERTED=$(echo "$PARSE_RESPONSE" | jq -r '.totalInserted')
log "Parsed and inserted $INSERTED events"

# 4. Summary
RESULTS=$(echo "$PARSE_RESPONSE" | jq -c '[.results[] | {nodeId, status, inserted}]')
log "Results: $RESULTS"

log "=== Eventlog Collection Complete ==="
