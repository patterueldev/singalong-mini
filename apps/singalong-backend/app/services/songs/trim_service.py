import json
import logging
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from ...models import Song, SongTrimArchive, SongTrimHistory, User
from ...config import settings

logger = logging.getLogger(__name__)

MEDIA_ROOT = Path(settings.media_root_dir)
SONGS_DIR = MEDIA_ROOT / "songs"
ARCHIVE_ROOT = MEDIA_ROOT / "archive"


def _ensure_archive_dir(song_id: uuid.UUID) -> Path:
    """Ensure archive directory exists for a song."""
    archive_dir = ARCHIVE_ROOT / str(song_id)
    archive_dir.mkdir(parents=True, exist_ok=True)
    return archive_dir


def _get_video_duration_ms(file_path: str) -> int | None:
    """Get duration of video in milliseconds using ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                file_path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            logger.error(f"ffprobe failed: {result.stderr}")
            return None
        data = json.loads(result.stdout)
        duration_s = float(data.get("format", {}).get("duration", 0))
        duration_ms = int(duration_s * 1000)
        logger.info(f"🎬 ffprobe detected duration for {file_path}: {duration_s}s = {duration_ms}ms")
        return duration_ms
    except (subprocess.TimeoutExpired, json.JSONDecodeError, ValueError, FileNotFoundError) as e:
        logger.error(f"Error getting video duration: {e}")
        return None


def _get_next_archive_version(db: Session, song_id: uuid.UUID) -> int:
    """Get the next version number for archiving."""
    latest = (
        db.query(SongTrimArchive)
        .filter(SongTrimArchive.song_id == song_id)
        .order_by(SongTrimArchive.version.desc())
        .first()
    )
    return (latest.version + 1) if latest else 1


def trim_video(
    db: Session,
    song_id: uuid.UUID,
    trim_start_ms: int,
    trim_end_ms: int,
    admin_id: uuid.UUID,
    backup_expiry_days: int = 30,
) -> dict:
    """
    Trim a video and store backup.
    
    Returns:
        dict with keys: song_id, new_duration_ms, backup_file, backup_expires_at, status
    """
    # Load song
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song:
        return {
            "status": "failed",
            "error": "Song not found",
            "song_id": song_id,
        }

    if not song.video_file:
        return {
            "status": "failed",
            "error": "Song has no video file",
            "song_id": song_id,
        }

    video_path = SONGS_DIR / song.video_file
    if not video_path.exists():
        return {
            "status": "failed",
            "error": "Video file not found on disk",
            "song_id": song_id,
        }

    # Get ACTUAL video duration from ffprobe (not from database)
    # This fixes issues where database duration is stale or incorrect
    actual_duration_ms = _get_video_duration_ms(str(video_path))
    if actual_duration_ms is None:
        return {
            "status": "failed",
            "error": "Could not determine video duration",
            "song_id": song_id,
        }

    # Validate trim points against actual video duration
    if trim_start_ms < 0:
        return {
            "status": "failed",
            "error": "trim_start_ms must be >= 0",
            "song_id": song_id,
        }

    if trim_end_ms <= trim_start_ms:
        return {
            "status": "failed",
            "error": "trim_end_ms must be > trim_start_ms",
            "song_id": song_id,
        }

    if trim_end_ms - trim_start_ms < 1000:  # Less than 1 second
        return {
            "status": "failed",
            "error": "Trimmed duration must be at least 1 second",
            "song_id": song_id,
        }

    if trim_end_ms > actual_duration_ms:
        return {
            "status": "failed",
            "error": f"trim_end_ms ({trim_end_ms}ms) exceeds video duration ({actual_duration_ms}ms)",
            "song_id": song_id,
        }

    try:
        # Create archive directory
        archive_dir = _ensure_archive_dir(song_id)

        # Get next version
        version = _get_next_archive_version(db, song_id)

        # Create backup
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        backup_filename = f"v{version}_{timestamp}.mp4"
        backup_path = archive_dir / backup_filename
        backup_file_rel = f"archive/{song_id}/{backup_filename}"

        logger.info(f"Creating backup: {backup_path}")
        shutil.copy2(video_path, backup_path)

        # Create SongTrimArchive record
        backup_expires_at = datetime.now(timezone.utc) + timedelta(days=backup_expiry_days)
        archive_record = SongTrimArchive(
            id=uuid.uuid4(),
            song_id=song_id,
            version=version,
            file_path=backup_file_rel,
            file_size_bytes=os.path.getsize(backup_path),
            duration_ms=actual_duration_ms,
            expires_at=backup_expires_at,
        )
        db.add(archive_record)

        # Create SongTrimHistory record (pending)
        history_record = SongTrimHistory(
            id=uuid.uuid4(),
            song_id=song_id,
            admin_id=admin_id,
            trim_start_ms=trim_start_ms,
            trim_end_ms=trim_end_ms,
            old_duration_ms=actual_duration_ms,
            backup_file=backup_file_rel,
            backup_expires_at=backup_expires_at,
            status="pending",
        )
        db.add(history_record)
        db.flush()  # Flush to get history_record.id

        # Run FFmpeg to trim
        start_sec = trim_start_ms / 1000.0
        end_sec = trim_end_ms / 1000.0
        
        # Create temporary output file (FFmpeg can't overwrite input in-place)
        temp_output_path = video_path.parent / f"{video_path.stem}_temp.mp4"

        logger.info(f"Trimming video: {video_path} from {start_sec}s to {end_sec}s")
        result = subprocess.run(
            [
                "ffmpeg",
                "-i",
                str(video_path),
                "-ss",
                str(start_sec),
                "-to",
                str(end_sec),
                "-c:v",
                "copy",
                "-c:a",
                "copy",
                "-y",
                str(temp_output_path),
            ],
            capture_output=True,
            text=True,
            timeout=300,  # 5 minutes timeout
        )

        if result.returncode != 0:
            logger.error(f"FFmpeg failed: {result.stderr}")
            # Delete temporary file if it was created
            try:
                temp_output_path.unlink()
                backup_path.unlink()
                db.delete(archive_record)
            except Exception as e:
                logger.error(f"Failed to cleanup after trim failure: {e}")

            history_record.status = "failed"
            history_record.error_message = f"FFmpeg error: {result.stderr[:500]}"
            db.commit()

            return {
                "status": "failed",
                "error": "FFmpeg trimming failed",
                "song_id": song_id,
            }

        # Move temporary file to original location
        try:
            shutil.move(str(temp_output_path), str(video_path))
        except Exception as e:
            logger.error(f"Failed to move trimmed file: {e}")
            try:
                temp_output_path.unlink()
                backup_path.unlink()
                db.delete(archive_record)
            except:
                pass
            history_record.status = "failed"
            history_record.error_message = f"Failed to save trimmed file: {str(e)[:500]}"
            db.commit()
            return {
                "status": "failed",
                "error": "Failed to save trimmed file",
                "song_id": song_id,
            }

        # Get new duration
        new_duration_ms = _get_video_duration_ms(str(video_path))
        if new_duration_ms is None:
            logger.warning("Could not determine new duration, using calculated value")
            new_duration_ms = trim_end_ms - trim_start_ms

        # Update song (duration should be stored in seconds)
        song.trim_start_ms = trim_start_ms
        song.trim_end_ms = trim_end_ms
        song.was_trimmed = True
        song.trimmed_at = datetime.now(timezone.utc)
        song.duration = new_duration_ms // 1000  # Convert ms to seconds
        song.updated_at = datetime.now(timezone.utc)

        # Update history record
        history_record.status = "completed"
        history_record.new_duration_ms = new_duration_ms
        history_record.completed_at = datetime.now(timezone.utc)

        db.commit()
        logger.info(f"Successfully trimmed video: {song_id}")

        return {
            "status": "completed",
            "song_id": song_id,
            "trim_start_ms": trim_start_ms,
            "trim_end_ms": trim_end_ms,
            "old_duration_ms": actual_duration_ms,
            "new_duration_ms": new_duration_ms,
            "backup_file": backup_file_rel,
            "backup_expires_at": backup_expires_at,
        }

    except subprocess.TimeoutExpired:
        logger.error(f"FFmpeg timeout for song {song_id}")
        try:
            backup_path.unlink()
            db.delete(archive_record)
        except Exception as e:
            logger.error(f"Failed to cleanup after timeout: {e}")

        history_record.status = "failed"
        history_record.error_message = "FFmpeg timeout"
        db.commit()

        return {
            "status": "failed",
            "error": "FFmpeg timeout",
            "song_id": song_id,
        }
    except Exception as e:
        logger.error(f"Unexpected error trimming video: {e}")
        db.rollback()
        return {
            "status": "failed",
            "error": f"Unexpected error: {str(e)[:100]}",
            "song_id": song_id,
        }


def restore_backup(
    db: Session,
    trim_history_id: uuid.UUID,
    admin_id: uuid.UUID,
) -> dict:
    """
    Restore a backup of a trimmed video.
    
    Returns:
        dict with keys: status, message
    """
    # Load history record
    history = db.query(SongTrimHistory).filter(SongTrimHistory.id == trim_history_id).first()
    if not history:
        return {"status": "failed", "message": "Trim history not found"}

    # Check permissions (must be admin)
    admin = db.query(User).filter(User.id == admin_id).first()
    if not admin or admin.role != "admin":
        return {"status": "failed", "message": "Only admins can restore backups"}

    try:
        # Load song
        song = db.query(Song).filter(Song.id == history.song_id).first()
        if not song:
            return {"status": "failed", "message": "Song not found"}

        # Load backup file path
        backup_file_path = MEDIA_ROOT / history.backup_file
        if not backup_file_path.exists():
            return {"status": "failed", "message": "Backup file not found"}

        original_video_path = SONGS_DIR / song.video_file
        if not original_video_path:
            return {"status": "failed", "message": "Original video path not set"}

        logger.info(f"Restoring backup: {backup_file_path} -> {original_video_path}")

        # Copy backup back to original location
        shutil.copy2(backup_file_path, original_video_path)

        # Get original duration from backup via ffprobe
        restored_duration_ms = _get_video_duration_ms(str(backup_file_path))
        if restored_duration_ms is None:
            logger.warning(
                f"Could not determine restored duration, using archive value: {history.old_duration_ms}"
            )
            restored_duration_ms = history.old_duration_ms or 0

        # Reset song trim fields (duration should be stored in seconds)
        song.trim_start_ms = None
        song.trim_end_ms = None
        song.was_trimmed = False
        song.trimmed_at = None
        song.duration = restored_duration_ms // 1000  # Convert ms to seconds
        song.updated_at = datetime.now(timezone.utc)

        # Update history record
        history.status = "restored"
        history.restored_at = datetime.now(timezone.utc)

        db.commit()
        logger.info(f"Successfully restored backup for song {song.id}")

        return {
            "status": "success",
            "message": "Video restored from backup",
        }

    except Exception as e:
        logger.error(f"Error restoring backup: {e}")
        db.rollback()
        return {
            "status": "failed",
            "message": f"Error restoring backup: {str(e)[:100]}",
        }


def cleanup_expired_archives(db: Session) -> dict:
    """
    Clean up expired archive files.
    
    Returns:
        dict with keys: cleaned_count, space_freed_bytes
    """
    try:
        now = datetime.now(timezone.utc)
        
        # Query expired archives that haven't been deleted yet
        expired = (
            db.query(SongTrimArchive)
            .filter(SongTrimArchive.expires_at < now, SongTrimArchive.deleted_at.is_(None))
            .all()
        )

        cleaned_count = 0
        space_freed_bytes = 0

        for archive in expired:
            try:
                file_path = MEDIA_ROOT / archive.file_path
                if file_path.exists():
                    file_size = os.path.getsize(file_path)
                    file_path.unlink()
                    space_freed_bytes += file_size
                    logger.info(f"Deleted expired archive: {archive.file_path}")

                # Mark as deleted in DB
                archive.deleted_at = now
                cleaned_count += 1
            except Exception as e:
                logger.error(f"Error cleaning up archive {archive.id}: {e}")

        db.commit()
        logger.info(
            f"Cleanup complete: {cleaned_count} archives deleted, {space_freed_bytes} bytes freed"
        )

        return {
            "cleaned_count": cleaned_count,
            "space_freed_bytes": space_freed_bytes,
        }

    except Exception as e:
        logger.error(f"Error in cleanup_expired_archives: {e}")
        db.rollback()
        return {
            "cleaned_count": 0,
            "space_freed_bytes": 0,
            "error": str(e),
        }


def fix_video_duration(db: Session, song: Song) -> dict:
    """
    Re-scan video file with ffprobe and update duration in database.
    Fixes metadata mismatches where video player reports wrong duration.
    
    Args:
        db: Database session
        song: Song object to fix
        
    Returns:
        dict with keys: status, old_duration, new_duration, message
    """
    try:
        video_path = SONGS_DIR / song.video_file
        if not video_path.exists():
            return {
                "status": "failed",
                "message": f"Video file not found: {song.video_file}",
                "old_duration": str(song.duration),
                "new_duration": None,
            }

        # Get actual duration from ffprobe
        actual_duration_ms = _get_video_duration_ms(str(video_path))
        if actual_duration_ms is None:
            return {
                "status": "failed",
                "message": "Could not scan video duration with ffprobe",
                "old_duration": str(song.duration),
                "new_duration": None,
            }

        # Convert to HH:MM:SS format
        actual_duration_seconds = actual_duration_ms // 1000
        old_duration = song.duration
        
        # Update database
        song.duration = actual_duration_seconds
        song.updated_at = datetime.now(timezone.utc)
        db.commit()

        logger.info(f"Fixed duration for song {song.id}: {old_duration}s → {actual_duration_seconds}s")

        return {
            "status": "success",
            "message": f"Duration fixed successfully",
            "old_duration": f"{old_duration // 3600:02d}:{(old_duration % 3600) // 60:02d}:{old_duration % 60:02d}",
            "new_duration": f"{actual_duration_seconds // 3600:02d}:{(actual_duration_seconds % 3600) // 60:02d}:{actual_duration_seconds % 60:02d}",
        }

    except Exception as e:
        logger.error(f"Error fixing duration for song {song.id}: {e}")
        db.rollback()
        return {
            "status": "failed",
            "message": f"Error: {str(e)[:100]}",
            "old_duration": str(song.duration),
            "new_duration": None,
        }
