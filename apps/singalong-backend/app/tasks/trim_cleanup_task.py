import logging
from apscheduler.schedulers.background import BackgroundScheduler

from ..db import SessionLocal
from ..services.songs import cleanup_expired_archives

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


async def cleanup_trim_archives():
    """Async function to clean up expired trim archives."""
    db = SessionLocal()
    try:
        result = cleanup_expired_archives(db)
        logger.info(
            f"Trim archive cleanup: {result.get('cleaned_count')} deleted, "
            f"{result.get('space_freed_bytes')} bytes freed"
        )
    except Exception as e:
        logger.error(f"Error in cleanup_trim_archives: {e}")
    finally:
        db.close()


def start_cleanup_scheduler():
    """Start the background scheduler for cleanup tasks."""
    try:
        # Add job to run every 6 hours
        scheduler.add_job(
            cleanup_trim_archives,
            "interval",
            hours=6,
            id="trim_archive_cleanup",
            name="Trim Archive Cleanup",
            replace_existing=True,
        )
        if not scheduler.running:
            scheduler.start()
            logger.info("Trim archive cleanup scheduler started")
    except Exception as e:
        logger.error(f"Error starting cleanup scheduler: {e}")


def stop_cleanup_scheduler():
    """Stop the background scheduler."""
    try:
        if scheduler.running:
            scheduler.shutdown()
            logger.info("Trim archive cleanup scheduler stopped")
    except Exception as e:
        logger.error(f"Error stopping cleanup scheduler: {e}")
