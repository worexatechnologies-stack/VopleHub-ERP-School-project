#!/usr/bin/env sh
set -eu

python - <<'PY'
import os
import sys
import time
import psycopg

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    sys.exit("DATABASE_URL is required")
if os.environ.get("CELERY_WORKER") == "1" and not os.environ.get("DJANGO_SETTINGS_MODULE"):
    sys.exit("DJANGO_SETTINGS_MODULE is required for Celery workers")

for attempt in range(1, 61):
    try:
        with psycopg.connect(database_url, connect_timeout=3):
            print("Database is ready")
            break
    except Exception as exc:
        if attempt == 60:
            raise
        print(f"Waiting for database ({attempt}/60): {exc}")
        time.sleep(2)
PY

# Celery workers should not execute migrations or static file collection
if [ "${CELERY_WORKER:-0}" != "1" ]; then
    if [ "${SKIP_STARTUP_MIGRATIONS:-0}" != "1" ]; then
        python manage.py migrate --noinput
    fi
    if [ "${SKIP_STARTUP_COLLECTSTATIC:-0}" != "1" ]; then
        python manage.py collectstatic --noinput
    fi
fi

exec "$@"
