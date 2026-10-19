#!/usr/bin/env sh
# ==============================================================================
# VolpeHub Database Restore Script (Disaster Recovery & Migration)
# Usage: ./restore.sh <path-to-dump-file>
# Example: ./restore.sh backups/volpehub-20261019-120000.dump
# ==============================================================================
set -eu

if [ $# -eq 0 ]; then
  echo "Error: No dump file specified." >&2
  echo "Usage: $0 <path-to-dump-file>" >&2
  exit 1
fi

dump_file="$1"

if [ ! -f "$dump_file" ]; then
  echo "Error: Dump file '$dump_file' not found." >&2
  exit 1
fi

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

echo "=========================================================="
echo "Starting Database Restore for VolpeHub DB: $POSTGRES_DB"
echo "Dump source: $dump_file"
echo "Target compose project: volpehub"
echo "=========================================================="

# 1. Terminate active connection pools for volpehub_education only
echo "Terminating existing VolpeHub database client connections..."
docker compose -f docker-compose.prod.yml -p volpehub exec -T db \
  psql -U "$POSTGRES_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" || true

# 2. Restore PostgreSQL schema and data
echo "Restoring database from custom-format archive..."
docker compose -f docker-compose.prod.yml -p volpehub exec -T db \
  pg_restore --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v < "$dump_file" || true

# 3. Analyze tables for optimal planner statistics
echo "Running ANALYZE on VolpeHub database..."
docker compose -f docker-compose.prod.yml -p volpehub exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ANALYZE;"

echo "=========================================================="
echo "VolpeHub Database Restore Completed Successfully."
echo "=========================================================="
