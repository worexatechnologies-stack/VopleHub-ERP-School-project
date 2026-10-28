#!/usr/bin/env sh
set -eu

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
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
temporary_dump="$target_dump.tmp"

echo "[VolpeHub Backup] Backing up database '$POSTGRES_DB' to '$target_dump'..."

if ! docker compose -f docker-compose.prod.yml -p volpehub exec -T db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc < /dev/null > "$temporary_dump"; then
    echo "Error: Database dump command failed" >&2
    rm -f "$temporary_dump"
    exit 1
fi

if [ ! -s "$temporary_dump" ] || ! docker compose -f docker-compose.prod.yml -p volpehub exec -T db \
    pg_restore --list < "$temporary_dump" > /dev/null; then
    echo "Error: Backup verification failed: $temporary_dump" >&2
    rm -f "$temporary_dump"
    exit 1
fi

mv "$temporary_dump" "$target_dump"
echo "[VolpeHub Backup] Backup verified: $(du -h "$target_dump" | cut -f1)"

# Keep only the configured age in seconds. Cleanup happens only after the new
# archive has been created and verified successfully.
retention_seconds="${BACKUP_RETENTION_SECONDS:-86400}"
case "$retention_seconds" in
    ''|*[!0-9]*) echo "Error: BACKUP_RETENTION_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
if [ "$retention_seconds" -lt 60 ]; then
    echo "Error: BACKUP_RETENTION_SECONDS must be at least 60" >&2
    exit 1
fi
now_epoch="$(date -u +%s)"
for old_backup in "$backup_dir"/volpehub-*.dump "$backup_dir"/postgres-*.dump; do
    [ -f "$old_backup" ] || continue
    modified_epoch="$(stat -c %Y "$old_backup")"
    if [ "$((now_epoch - modified_epoch))" -ge "$retention_seconds" ]; then
        rm -f "$old_backup"
    fi
done

echo "[VolpeHub Backup] Current backups in '$backup_dir':"
ls -lh "$backup_dir"/*.dump 2>/dev/null || echo "  (none)"
