#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

IMAGE_TAG="${1:-${IMAGE_TAG:-}}"
GHCR_NAMESPACE="${2:-${GHCR_NAMESPACE:-worexatechnologies-stack}}"
GHCR_ACTOR="${3:-${GHCR_ACTOR:-}}"
GHCR_PULL_TOKEN="${4:-${GHCR_PULL_TOKEN:-}}"

if [ -n "$IMAGE_TAG" ]; then
    export IMAGE_TAG
fi
if [ -n "$GHCR_NAMESPACE" ]; then
    export GHCR_NAMESPACE
fi

ENV_FILE=""
if [ -f "./.env" ]; then
    ENV_FILE="./.env"
elif [ -f "./backend/.env" ]; then
    ENV_FILE="./backend/.env"
else
    echo "Error: Production .env file not found in $(pwd)" >&2
    exit 1
fi

echo "=== VolpeHub Deployment: ${IMAGE_TAG:-latest} ==="
echo "Using environment file: $ENV_FILE"

# 1. Authenticate with GHCR if token provided
if [ -n "${GHCR_PULL_TOKEN}" ] && [ -n "${GHCR_ACTOR}" ]; then
    echo "Authenticating with GHCR..."
    echo "${GHCR_PULL_TOKEN}" | docker login ghcr.io -u "${GHCR_ACTOR}" --password-stdin > /dev/null 2>&1 || true
fi

# 2. Pull exact container image tags
echo "Pulling container images for release ${IMAGE_TAG:-latest}..."
docker compose -f docker-compose.prod.yml -p volpehub pull api web celery_worker forwardproxy

# 3. Validate Compose configuration
echo "Validating Compose configuration..."
docker compose -f docker-compose.prod.yml -p volpehub config -q

# 4. Execute pre-deployment database backup if database container is running
if docker compose -f docker-compose.prod.yml -p volpehub ps --services --filter "status=running" | grep -q "db"; then
    echo "Creating pre-deployment database backup..."
    ./backup.sh < /dev/null || echo "Warning: Backup encountered a non-fatal warning."
fi

# 5. Start db and redis first
docker compose -f docker-compose.prod.yml -p volpehub up -d db redis

# 6. Apply database migrations safely before traffic switch
echo "Running database migrations..."
docker compose -f docker-compose.prod.yml -p volpehub run -T --rm api python manage.py migrate --noinput < /dev/null

echo "Collecting static files once before starting API replicas..."
docker compose -f docker-compose.prod.yml -p volpehub run -T --rm api python manage.py collectstatic --noinput < /dev/null

# 7. Record release metadata
if [ -f .current_release ]; then
    cp .current_release .previous_release
fi
if [ -n "$IMAGE_TAG" ]; then
    echo "${IMAGE_TAG}" > .current_release
fi

# 8. Apply service changes using targeted compose project
echo "Applying service changes..."
docker compose -f docker-compose.prod.yml -p volpehub up -d --remove-orphans

# 9. Seed initial administrator idempotently
echo "Seeding initial superadmin..."
docker compose -f docker-compose.prod.yml -p volpehub exec -T api python manage.py seed_initial_superadmin < /dev/null || true

# 10. Verify every serving dependency
wait_for_healthy() {
    SERVICE="$1"
    MAX_RETRIES=15
    COUNT=0
    while [ "$COUNT" -lt "$MAX_RETRIES" ]; do
        CONTAINER_ID="$(docker compose -f docker-compose.prod.yml -p volpehub ps -q "$SERVICE" | head -n 1)"
        if [ -n "$CONTAINER_ID" ]; then
            STATUS="$(docker inspect --format='{{json .State.Health.Status}}' "$CONTAINER_ID" 2>/dev/null || echo '"starting"')"
            if [ "$STATUS" = '"healthy"' ]; then
                echo "Service ${SERVICE} is healthy."
                return 0
            fi
            echo "Waiting for ${SERVICE} health (attempt $((COUNT+1))/$MAX_RETRIES, status: $STATUS)..."
        else
            echo "Waiting for ${SERVICE} container to start (attempt $((COUNT+1))/$MAX_RETRIES)..."
        fi
        sleep 5
        COUNT=$((COUNT+1))
    done
    return 1
}

for SERVICE in api web forwardproxy; do
    if ! wait_for_healthy "$SERVICE"; then
        echo "Error: ${SERVICE} container failed health check after deployment!" >&2
        docker compose -f docker-compose.prod.yml -p volpehub ps
        if [ -f .previous_release ]; then
            echo "To rollback, run: ./rollback.sh \$(cat .previous_release)" >&2
        fi
        exit 1
    fi
done

echo "=== VolpeHub Deployment Succeeded ==="
docker compose -f docker-compose.prod.yml -p volpehub ps
