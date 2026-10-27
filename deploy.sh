#!/usr/bin/env sh
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

echo "[VolpeHub Deployment] Using environment file: $ENV_FILE"

# 1. Pull or build services
docker compose -f docker-compose.prod.yml -p volpehub pull api web celery_worker forwardproxy

# 2. Start database and cache first
docker compose -f docker-compose.prod.yml -p volpehub up -d db redis

# 3. Execute safe migrations
echo "[VolpeHub Deployment] Running database migrations..."
docker compose -f docker-compose.prod.yml -p volpehub run --rm api python manage.py migrate --noinput

echo "[VolpeHub Deployment] Collecting static files before starting API replicas..."
docker compose -f docker-compose.prod.yml -p volpehub run --rm api python manage.py collectstatic --noinput

# 4. Bring up full stack
echo "[VolpeHub Deployment] Starting all application services..."
docker compose -f docker-compose.prod.yml -p volpehub up -d --remove-orphans

# 5. Seed initial administrator idempotently
echo "[VolpeHub Deployment] Seeding initial superadmin..."
docker compose -f docker-compose.prod.yml -p volpehub exec -T api python manage.py seed_initial_superadmin || true

# 6. Check status
docker compose -f docker-compose.prod.yml -p volpehub ps
