#!/bin/sh
set -u

backup_dir="${BACKUP_DIR:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
interval_seconds="${BACKUP_INTERVAL_SECONDS:-86400}"

case "$retention_days" in
    ''|*[!0-9]*) echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2; exit 1 ;;
esac
case "$interval_seconds" in
    ''|*[!0-9]*) echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
if [ "$retention_days" -lt 1 ] || [ "$interval_seconds" -lt 60 ]; then
    echo "Retention must be at least 1 day and interval must be at least 60 seconds" >&2
    exit 1
fi

mkdir -p "$backup_dir"

cleanup_old_backups() {
    find "$backup_dir" -type f \( -name 'volpehub-*.dump' -o -name 'postgres-*.dump' \) \
        -mtime "+$((retention_days - 1))" -delete
}

create_backup() {
    stamp="$(date -u +%Y%m%d-%H%M%S)"
    target="$backup_dir/volpehub-$stamp.dump"
    temporary="$target.tmp"

    echo "[VolpeHub Backup Scheduler] Creating database snapshot: $target"
    if ! pg_dump --format=custom --file="$temporary"; then
        echo "[VolpeHub Backup Scheduler] pg_dump failed; keeping existing backups" >&2
        rm -f "$temporary"
        return 1
    fi

    if [ ! -s "$temporary" ] || ! pg_restore --list "$temporary" > /dev/null 2>&1; then
        echo "[VolpeHub Backup Scheduler] Archive verification failed; keeping existing backups" >&2
        rm -f "$temporary"
        return 1
    fi

    mv "$temporary" "$target"
    cleanup_old_backups
    echo "[VolpeHub Backup Scheduler] Backup verified; retained files: $(find "$backup_dir" -maxdepth 1 -type f -name 'volpehub-*.dump' | wc -l | tr -d ' ')"
}

while :; do
    create_backup || true
    sleep "$interval_seconds"
done
