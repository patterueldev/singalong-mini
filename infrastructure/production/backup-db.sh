#!/usr/bin/env bash
# One-shot Postgres snapshot to run before any risky operation — most importantly before
# `docker compose up -d --build`, which is what triggered one of the two data-directory
# corruption incidents in issue #60 (a rebuild's disk I/O landing on the same host disk as an
# in-flight Postgres write, right as the app container is torn down and recreated).
#
# The app itself also takes scheduled backups on a timer (see
# apps/singalong-backend/app/tasks/db_backup_task.py) into the same directory as this script
# targets, with retention — this script is for the "about to do something risky, snapshot right
# now" case, run manually or wired into a deploy script.
#
# Usage: ./backup-db.sh   (run from infrastructure/production/, alongside docker-compose.yml)

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${COMPOSE_DIR}/data/backups"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/singalong_manual_${TIMESTAMP}.sql.dump"

mkdir -p "${BACKUP_DIR}"

echo "==> Backing up production DB to ${DUMP_FILE}"

docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T db \
  pg_dump -Fc -U "${POSTGRES_USER:-postgres}" -d singalong >"${DUMP_FILE}"

echo "==> Backup complete: $(du -h "${DUMP_FILE}" | cut -f1)"
echo "==> To restore: docker compose exec -T db pg_restore -U \${POSTGRES_USER:-postgres} -d singalong --clean --if-exists < ${DUMP_FILE}"
