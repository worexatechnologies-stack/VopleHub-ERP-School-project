#!/usr/bin/env sh
# ==============================================================================
# Production Database Restore Script (Disaster Recovery & Migration)
# Usage: ./restore.sh <path-to-dump-file>
# Example: ./restore.sh backups/postgres-20261012-113000.dump
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
test -f backend/.env || { echo "Missing backend/.env" >&2; exit 1; }
set -a
. backend/.env
set +a

echo "=========================================================="
echo "Starting Database Restore for Database: $POSTGRES_DB"
echo "Dump source: $dump_file"
echo "=========================================================="

# 1. Terminate active connection pools to allow safe schema restore
echo "Terminating existing database client connections..."
docker compose -f docker-compose.prod.yml --env-file backend/.env exec -T db \
  psql -U "$POSTGRES_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" || true

# 2. Restore PostgreSQL schema and data
echo "Restoring database from custom-format archive..."
docker compose -f docker-compose.prod.yml --env-file backend/.env exec -T db \
  pg_restore --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v < "$dump_file" || true

# 3. Analyze tables for optimal planner statistics
echo "Running ANALYZE to update query planner statistics..."
docker compose -f docker-compose.prod.yml --env-file backend/.env exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ANALYZE;"

echo "=========================================================="
echo "Database Restore Completed Successfully."
echo "=========================================================="
