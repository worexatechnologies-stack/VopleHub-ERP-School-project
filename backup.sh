#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
test -f backend/.env || { echo "Missing backend/.env" >&2; exit 1; }
set -a
. backend/.env
set +a

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
docker compose -f docker-compose.prod.yml --env-file backend/.env exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$backup_dir/postgres-$stamp.dump"
find "$backup_dir" -type f -name 'postgres-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
