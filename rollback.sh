#!/usr/bin/env sh
# ==============================================================================
# VolpeHub Rollback Script
# Roll back VolpeHub containers to a specified or previously recorded Git commit SHA
# Usage: ./rollback.sh [target-commit-sha]
# ==============================================================================
set -eu

cd "$(dirname "$0")"

ENV_FILE=""
if [ -f "./.env" ]; then
    ENV_FILE="./.env"
elif [ -f "./backend/.env" ]; then
    ENV_FILE="./backend/.env"
else
    echo "Error: Neither ./.env nor ./backend/.env found" >&2
    exit 1
fi

set -a
. "$ENV_FILE"
set +a

TARGET_SHA="${1:-}"

if [ -z "$TARGET_SHA" ]; then
    if [ -f ".previous_release" ]; then
        TARGET_SHA="$(cat .previous_release | tr -d '[:space:]')"
        echo "No target SHA provided. Using previous recorded release: $TARGET_SHA"
    else
        echo "Error: No target SHA provided and .previous_release file does not exist." >&2
        echo "Usage: $0 <commit-sha>" >&2
        exit 1
    fi
fi

echo "=========================================================="
echo "Starting Application Rollback for VolpeHub"
echo "Target Release SHA: $TARGET_SHA"
echo "Note: Database schema and volumes remain intact."
echo "=========================================================="

export IMAGE_TAG="$TARGET_SHA"

# Pull the specific immutable image tags from GHCR
echo "Pulling target images from GHCR..."
docker compose -f docker-compose.prod.yml -p volpehub pull api web celery_worker forwardproxy

# Deploy the rolled-back stack
echo "Deploying rolled-back containers..."
docker compose -f docker-compose.prod.yml -p volpehub up -d --remove-orphans

# Health check verification
echo "Verifying health status..."
sleep 5

MAX_WAIT=60
WAITED=0
HEALTHY=0

while [ $WAITED -lt $MAX_WAIT ]; do
    API_STATUS="$(docker inspect --format='{{json .State.Health.Status}}' volpehub-api-1 2>/dev/null || echo '"unknown"')"
    if [ "$API_STATUS" = '"healthy"' ]; then
        HEALTHY=1
        break
    fi
    echo "Waiting for API service health check... ($WAITED/$MAX_WAIT seconds)"
    sleep 5
    WAITED=$((WAITED + 5))
done

if [ $HEALTHY -eq 1 ]; then
    echo "=========================================================="
    echo "Rollback to $TARGET_SHA Succeeded and Verified Healthy!"
    echo "=========================================================="
    if [ -f ".current_release" ]; then
        cp .current_release .rolled_back_from_release || true
    fi
    echo "$TARGET_SHA" > .current_release
else
    echo "Warning: Rollback completed, but health status is: $API_STATUS" >&2
    docker compose -f docker-compose.prod.yml -p volpehub ps
    exit 1
fi
