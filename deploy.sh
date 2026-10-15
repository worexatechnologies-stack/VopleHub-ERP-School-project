#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
test -f backend/.env || { echo "Missing backend/.env" >&2; exit 1; }

docker compose -f docker-compose.prod.yml --env-file backend/.env up -d --build
docker compose -f docker-compose.prod.yml --env-file backend/.env exec -T api python manage.py seed_initial_superadmin
docker compose -f docker-compose.prod.yml --env-file backend/.env ps
