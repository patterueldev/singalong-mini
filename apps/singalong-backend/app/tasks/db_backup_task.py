"""Scheduled Postgres backups.

Issue #60: production has been corrupted twice with no way to recover except manual
catalog surgery, because there was no backup anywhere. This takes a `pg_dump -Fc` snapshot
on a schedule into `settings.db_backup_dir` — which lives under the app's own `/data` mount,
*outside* the Postgres data directory, so a corrupted or lost data directory doesn't take the
backups with it — and prunes old dumps to a fixed retention count.

Follows the same start/stop scheduler pattern as trim_cleanup_task.py.
"""

import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler

from ..config import settings

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()

_FILENAME_PREFIX = "singalong_"
_FILENAME_SUFFIX = ".dump"


def _pg_dump_uri() -> str:
    # settings.database_url is a SQLAlchemy URL (postgresql+psycopg://...); pg_dump wants a
    # plain postgresql:// connection URI.
    return settings.database_url.replace("postgresql+psycopg://", "postgresql://", 1)


def run_db_backup() -> Path | None:
    """Take one pg_dump snapshot and prune old ones. Returns the new dump's path, or None
    on failure — this must never raise, since it runs unattended on a schedule."""
    backup_dir = Path(settings.db_backup_dir)
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error("db-backup-failed could not create backup dir %s: %s", backup_dir, exc)
        return None

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    dump_path = backup_dir / f"{_FILENAME_PREFIX}{timestamp}{_FILENAME_SUFFIX}"

    try:
        subprocess.run(
            ["pg_dump", "-Fc", "-f", str(dump_path), _pg_dump_uri()],
            check=True,
            capture_output=True,
            timeout=600,
        )
    except FileNotFoundError:
        logger.error("db-backup-failed pg_dump binary not found on PATH")
        return None
    except subprocess.TimeoutExpired:
        logger.error("db-backup-failed pg_dump timed out")
        dump_path.unlink(missing_ok=True)
        return None
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
        logger.error("db-backup-failed pg_dump exit_code=%s stderr=%s", exc.returncode, stderr)
        dump_path.unlink(missing_ok=True)
        return None

    size_bytes = dump_path.stat().st_size if dump_path.exists() else 0
    logger.info("db-backup-succeeded path=%s size_bytes=%s", dump_path, size_bytes)
    _prune_old_backups(backup_dir)
    return dump_path


def _prune_old_backups(backup_dir: Path) -> None:
    try:
        dumps = sorted(
            backup_dir.glob(f"{_FILENAME_PREFIX}*{_FILENAME_SUFFIX}"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except OSError as exc:
        logger.warning("db-backup-prune-failed could not list %s: %s", backup_dir, exc)
        return

    stale = dumps[settings.db_backup_retention_count :]
    for path in stale:
        try:
            path.unlink()
            logger.info("db-backup-pruned path=%s", path)
        except OSError as exc:
            logger.warning("db-backup-prune-failed path=%s error=%s", path, exc)


def start_backup_scheduler() -> None:
    try:
        scheduler.add_job(
            run_db_backup,
            "interval",
            hours=settings.db_backup_interval_hours,
            id="db_backup",
            name="Postgres Backup",
            replace_existing=True,
        )
        if not scheduler.running:
            scheduler.start()
            logger.info(
                "db-backup-scheduler-started interval_hours=%s retention=%s dir=%s",
                settings.db_backup_interval_hours,
                settings.db_backup_retention_count,
                settings.db_backup_dir,
            )
    except Exception as exc:
        logger.error("Error starting db backup scheduler: %s", exc)


def stop_backup_scheduler() -> None:
    try:
        if scheduler.running:
            scheduler.shutdown()
            logger.info("db-backup-scheduler-stopped")
    except Exception as exc:
        logger.error("Error stopping db backup scheduler: %s", exc)
