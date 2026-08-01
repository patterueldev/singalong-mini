"""Periodic Postgres integrity canary.

Issue #60: both corruption incidents were only discovered when a user hit a 500 mid-session.
This runs a cheap, low-impact check on a schedule — a forced read of the `songs` table (which
would surface TOAST/page corruption the same way the incident's `/api/songs` reads did) plus
an `ANALYZE songs` (which is exactly the operation that failed against the corrupted
`pg_statistic` row in both incidents) — and logs loudly the moment it fails, so corruption is
caught by whoever is watching logs/alerts instead of by a guest's search breaking mid-party.

Follows the same start/stop scheduler pattern as trim_cleanup_task.py.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text

from ..db import SessionLocal

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def run_db_health_check() -> bool:
    """Returns True if the canary passed. Never raises — this runs unattended."""
    db = SessionLocal()
    try:
        db.execute(text("SELECT md5(string_agg(t.*::text, '')) FROM songs t"))
        db.execute(text("ANALYZE songs"))
        db.commit()
        logger.info("db-health-check-ok")
        return True
    except Exception as exc:
        db.rollback()
        logger.error(
            "db-health-check-FAILED — possible catalog/data corruption, see issue #60 runbook: %s",
            exc,
        )
        return False
    finally:
        db.close()


def start_health_scheduler() -> None:
    try:
        from ..config import settings

        scheduler.add_job(
            run_db_health_check,
            "interval",
            minutes=settings.db_health_check_interval_minutes,
            id="db_health_check",
            name="Postgres Health Check",
            replace_existing=True,
        )
        if not scheduler.running:
            scheduler.start()
            logger.info(
                "db-health-scheduler-started interval_minutes=%s",
                settings.db_health_check_interval_minutes,
            )
    except Exception as exc:
        logger.error("Error starting db health scheduler: %s", exc)


def stop_health_scheduler() -> None:
    try:
        if scheduler.running:
            scheduler.shutdown()
            logger.info("db-health-scheduler-stopped")
    except Exception as exc:
        logger.error("Error stopping db health scheduler: %s", exc)
