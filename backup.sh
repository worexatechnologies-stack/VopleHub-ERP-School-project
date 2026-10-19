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

set -a
. "$ENV_FILE"
set +a

POSTGRES_USER="${POSTGRES_USER:-${POSTGRES_SUPERUSER:-postgres}}"
POSTGRES_DB="${POSTGRES_DB:-volpehub_education}"

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
target_dump="$backup_dir/volpehub-$stamp.dump"

echo "[VolpeHub Backup] Backing up database '$POSTGRES_DB' to '$target_dump'..."

docker compose -f docker-compose.prod.yml -p volpehub exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$target_dump"

# Verification: verify file exists and is not empty
if [ ! -s "$target_dump" ]; then
    echo "Error: Backup failed or produced empty file: $target_dump" >&2
    rm -f "$target_dump"
    exit 1
fi

echo "[VolpeHub Backup] Backup successful: $(du -h "$target_dump" | cut -f1)"

# Retention pruning (default: 14 days)
find "$backup_dir" -type f -name 'volpehub-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
find "$backup_dir" -type f -name 'postgres-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
