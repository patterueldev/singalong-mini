# Production runbook

Operational procedures for the `infrastructure/production` stack. Written after issue #60
(recurring Postgres data-directory corruption) — see that issue for full incident history and
root-cause analysis. Keep this updated as new failure modes turn up.

## Safe rebuild / deploy flow

`docker compose up -d --build` rebuilds and recreates the `singalong` app container. It does
**not** restart `db`, but the build's disk I/O competes with Postgres's live writes on the same
host disk, and on constrained VMs (see "Host file-descriptor limits" below) this has previously
contributed to corruption.

Before rebuilding in production:

1. Take a snapshot: `./infrastructure/production/backup-db.sh`
2. Check nobody has an active download in flight (`GET /api/songs/downloads`, or ask in the
   session) — not a hard blocker, just avoids adding load during the rebuild window.
3. `docker compose -f infrastructure/production/docker-compose.yml up -d --build`
4. Confirm health: `docker compose -f infrastructure/production/docker-compose.yml ps` (both
   services should report `healthy`), then `GET /api/songs?page=1&limit=1` should return 200.

## Restoring from a backup

The app takes scheduled `pg_dump -Fc` snapshots (see
`apps/singalong-backend/app/tasks/db_backup_task.py`) into
`infrastructure/production/data/backups/`, retaining the most recent
`db_backup_retention_count` (default 20) dumps. `backup-db.sh` takes an on-demand snapshot into
the same directory.

To restore:

```bash
cd infrastructure/production
docker compose exec -T db pg_restore -U "${POSTGRES_USER:-postgres}" -d singalong \
  --clean --if-exists < data/backups/<dump-file>
```

`--clean --if-exists` drops and recreates existing objects first, so this is safe to run against
a DB that already has (possibly corrupted) data in it.

## Recovering from the `pg_statistic` corruption seen in issue #60

Both incidents landed on the same disposable catalog object (`pg_statistic` /
`pg_toast_2619`), which is 100% regenerable — this is not user data and this recovery is safe:

```sql
ALTER SYSTEM SET allow_system_table_mods = on;
-- restart just the db container (docker compose restart db), then:
TRUNCATE pg_statistic;
ALTER SYSTEM SET allow_system_table_mods = off;
-- restart db again, then:
ANALYZE;
```

Verify recovery persists (don't just check one successful request) — re-run `ANALYZE songs;` a
few minutes later, and query `pg_stat_user_tables` to confirm stats stuck.

If corruption ever lands somewhere other than `pg_statistic` (a real user table), stop — do not
improvise catalog surgery on user data. Take a `pg_dump` first (it will tell you immediately if
any table is unreadable), then restore from the most recent good backup instead.

## Host file-descriptor limits (Lima/Colima VM)

Issue #60's second incident was caused by the **VM-wide** file descriptor limit being
exhausted (`PANIC: ... Too many open files in system`), not a per-container limit. The app and
db containers now have their own `ulimits.nofile` caps so the app hits a handled `EMFILE` long
before it can exhaust the VM's descriptors — but if this recurs, check the VM itself:

```bash
# From the host, inside the Lima/Colima VM:
limactl shell <instance-name>   # or `colima ssh`
cat /proc/sys/fs/file-max
lsof | wc -l                     # current system-wide fd usage
```

If `fs.file-max` is low relative to usage, raise it in the VM's `/etc/sysctl.conf`
(`fs.file-max = 2097152` is a reasonable ceiling) and re-apply with `sysctl -p`.

## Known gaps / follow-ups

- The Postgres data directory is a host bind mount (`./data/singalong-db`), not a named Docker
  volume — migrating would improve I/O isolation but needs a dump/restore with downtime. Not yet
  done; see issue #60 for context.
- No WAL archiving / continuous backup (e.g. pgBackRest, wal-g) — only periodic `pg_dump`
  snapshots. Revisit if point-in-time recovery becomes a real requirement.
