#!/bin/sh
set -u

backup_dir="${BACKUP_DIR:-/backups}"
retention_seconds="${BACKUP_RETENTION_SECONDS:-86400}"
daily_time="${BACKUP_DAILY_TIME:-02:00}"
timezone="${BACKUP_TIMEZONE:-Asia/Kolkata}"

case "$retention_seconds" in
    ''|*[!0-9]*) echo "BACKUP_RETENTION_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
if [ "$retention_seconds" -lt 60 ]; then
    echo "BACKUP_RETENTION_SECONDS must be at least 60" >&2
    exit 1
fi
case "$daily_time" in
    [01][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) ;;
    *) echo "BACKUP_DAILY_TIME must use 24-hour HH:MM format" >&2; exit 1 ;;
esac
if [ ! -e "/usr/share/zoneinfo/$timezone" ]; then
    echo "Timezone data is missing for BACKUP_TIMEZONE=$timezone" >&2
    exit 1
fi

mkdir -p "$backup_dir"

cleanup_old_backups() {
    now_epoch="$(date -u +%s)"
    for old_backup in "$backup_dir"/volpehub-*.dump "$backup_dir"/postgres-*.dump; do
        [ -f "$old_backup" ] || continue
        modified_epoch="$(stat -c %Y "$old_backup")"
        if [ "$((now_epoch - modified_epoch))" -ge "$retention_seconds" ]; then
            rm -f "$old_backup"
        fi
    done
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

wait_for_next_run() {
    now_epoch="$(date -u +%s)"
    today="$(TZ="$timezone" date +%Y-%m-%d)"
    target_epoch="$(TZ="$timezone" date -d "$today $daily_time:00" +%s)" || return 1

    # If the container restarts just after 2 AM, still run the day's backup
    # within a five-minute grace window instead of skipping until tomorrow.
    if [ "$now_epoch" -ge "$target_epoch" ] && [ "$now_epoch" -lt "$((target_epoch + 300))" ]; then
        wait_seconds=0
    else
        if [ "$target_epoch" -le "$now_epoch" ]; then
            target_epoch="$((target_epoch + 86400))"
        fi
        wait_seconds="$((target_epoch - now_epoch))"
    fi

    next_run="$(TZ="$timezone" date -d "@$((now_epoch + wait_seconds))" '+%Y-%m-%d %H:%M:%S %Z')"
    echo "[VolpeHub Backup Scheduler] Next database backup at $next_run"
    sleep "$wait_seconds"
}

while :; do
    wait_for_next_run || { echo "Could not calculate the next backup time" >&2; sleep 60; continue; }
    while ! create_backup; do
        echo "[VolpeHub Backup Scheduler] Retrying in 15 minutes" >&2
        sleep 900
    done
done
