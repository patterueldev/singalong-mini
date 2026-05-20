import json
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from ..models import Song, SongDownload
from ..services.ytdlp.naming import build_saved_filename, normalize_song_title
from ..services.thumbnail_service import convert_base64_to_jpg, download_thumbnail, save_thumbnail
from ..services.download_queue import list_active_download_items
from ..services.ytdlp.song_downloader import YtDlpSongDownloader


class SongDownloaderService:
    """Service to handle async song download and processing."""

    def __init__(self, media_dir: str | Path, db_session_factory, cookies_file: str | Path = "/data/cookies.txt"):
        self.media_dir = Path(media_dir)
        self.db_session_factory = db_session_factory
        self.cookies_file = cookies_file
        self.downloader = YtDlpSongDownloader(cookies_file=str(cookies_file))
        self.executor = ThreadPoolExecutor(max_workers=1)

    def queue_song_download(
        self,
        song_id: str,
        source_url: str,
        source_id: str,
        title: str,
        artist: str,
        source_thumbnail: str,
        source_thumbnail_data_url: str | None = None,
    ):
        """Queue a song download task to run in background."""
        print(f"[DOWNLOADER] Queueing download for song_id={song_id}", file=sys.stderr, flush=True)
        db: DBSession = self.db_session_factory()
        try:
            self._upsert_download_record(
                db=db,
                song_id=song_id,
                source_url=source_url,
                source_id=source_id,
                title=title,
                artist=artist,
                source_thumbnail=source_thumbnail,
                source_thumbnail_data_url=source_thumbnail_data_url,
                status="pending",
                current_step="queued",
                progress_pct=None,
                progress_message=None,
                error_message=None,
                started_at=None,
                completed_at=None,
            )
        finally:
            db.close()

        self.executor.submit(
            self._download_song_task,
            song_id=song_id,
            source_url=source_url,
            source_id=source_id,
            title=title,
            artist=artist,
            source_thumbnail=source_thumbnail,
            source_thumbnail_data_url=source_thumbnail_data_url,
        )

    def recover_pending_downloads(self):
        db: DBSession = self.db_session_factory()
        try:
            recoverable = list(
                db.scalars(
                    select(SongDownload).where(SongDownload.status.in_(("pending", "downloading"))).order_by(
                        SongDownload.added_at.asc()
                    )
                ).all()
            )
            queued_song_ids = {download.song_id for download in recoverable}
            missing_songs = list(
                db.scalars(
                    select(Song).where(Song.status == "downloading", Song.archived_at.is_(None)).order_by(
                        Song.created_at.asc()
                    )
                ).all()
            )
        finally:
            db.close()

        for download in recoverable:
            self.queue_song_download(
                song_id=str(download.song_id),
                source_url=download.source_url,
                source_id=download.source_id or "",
                title=download.title,
                artist=download.artist,
                source_thumbnail=download.source_thumbnail or "",
                source_thumbnail_data_url=download.source_thumbnail_data_url,
            )

        for song in missing_songs:
            if song.id in queued_song_ids or song.source_url is None:
                continue
            self.queue_song_download(
                song_id=str(song.id),
                source_url=song.source_url,
                source_id=song.source_id or "",
                title=song.title,
                artist=song.artist,
                source_thumbnail="",
                source_thumbnail_data_url=None,
            )

    def _download_song_task(
        self,
        song_id: str,
        source_url: str,
        source_id: str,
        title: str,
        artist: str,
        source_thumbnail: str,
        source_thumbnail_data_url: str | None = None,
    ):
        """Background task to download video and thumbnail."""
        print(
            f"[DOWNLOADER] Starting download task - song_id={song_id} title={title}",
            file=sys.stderr,
            flush=True,
        )

        db: DBSession = self.db_session_factory()
        try:
            song_uuid = UUID(song_id)
            self._update_download_record(
                db,
                song_uuid,
                status="downloading",
                current_step="video",
                started_at=datetime.utcnow(),
            )

            def progress_hook(download_state: dict) -> None:
                self._handle_progress_hook(db, song_uuid, download_state)

            # Step 1: Download video with retries
            video_filename = None
            video_error = None
            artifact = None
            for attempt in range(1, 4):
                try:
                    print(
                        f"[DOWNLOADER] Downloading video (attempt {attempt}/3)",
                        file=sys.stderr,
                        flush=True,
                    )
                    video_filename = build_saved_filename(title, source_id, "mp4")
                    video_file_path = self.media_dir / "songs" / video_filename

                    # Download using yt_dlp
                    artifact = self.downloader.download_to_temp(source_url, progress_hook=progress_hook)

                    # Move file to final location
                    video_file_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(artifact.selected_file), str(video_file_path))

                    print(
                        f"[DOWNLOADER] Video download successful: {video_filename}",
                        file=sys.stderr,
                        flush=True,
                    )
                    break
                except Exception as e:
                    video_error = str(e)
                    print(
                        f"[DOWNLOADER] Video download attempt {attempt} failed: {video_error}",
                        file=sys.stderr,
                        flush=True,
                    )
                    # Clean up temp dir
                    if artifact and artifact.temp_dir and artifact.temp_dir.exists():
                        shutil.rmtree(artifact.temp_dir, ignore_errors=True)
                    if attempt < 3:
                        wait_time = 30 * attempt  # 30s, 60s, 120s backoff
                        print(
                            f"[DOWNLOADER] Retrying in {wait_time}s...",
                            file=sys.stderr,
                            flush=True,
                        )
                        time.sleep(wait_time)

            if video_filename is None:
                raise Exception(f"Video download failed after 3 attempts: {video_error}")

            # Clean up temp directory after successful move
            if artifact and artifact.temp_dir and artifact.temp_dir.exists():
                shutil.rmtree(artifact.temp_dir, ignore_errors=True)

            # Step 2: Download/convert thumbnail
            thumbnail_filename = None
            try:
                self._update_download_record(db, song_uuid, current_step="thumbnail")
                thumbnail_filename = f"{normalize_song_title(title)}[{source_id}].jpg"

                if source_thumbnail_data_url:
                    # Custom thumbnail: decode base64 → convert to JPG
                    print("[DOWNLOADER] Using custom thumbnail", file=sys.stderr, flush=True)
                    thumbnail_data = convert_base64_to_jpg(source_thumbnail_data_url)
                else:
                    # Source thumbnail URL: download and convert to JPG
                    print("[DOWNLOADER] Downloading source thumbnail", file=sys.stderr, flush=True)
                    resolved_thumbnail = source_thumbnail or self._extract_thumbnail_url(artifact.info if artifact else {})
                    if resolved_thumbnail == "":
                        raise RuntimeError("Unable to resolve source thumbnail for recovery")
                    thumbnail_data = download_thumbnail(resolved_thumbnail)

                # Save thumbnail
                save_thumbnail(thumbnail_data, thumbnail_filename, self.media_dir)
                print(
                    f"[DOWNLOADER] Thumbnail saved: {thumbnail_filename}",
                    file=sys.stderr,
                    flush=True,
                )
            except Exception as e:
                print(f"[DOWNLOADER] Thumbnail processing failed: {e}", file=sys.stderr, flush=True)
                # Mark as error if thumbnail fails
                raise Exception(f"Thumbnail processing failed: {e}")

            # Step 3: Update Song record on success
            stmt = select(Song).where(Song.id == song_uuid)
            song = db.execute(stmt).scalar_one()

            song.video_file = video_filename
            song.thumbnail_file = thumbnail_filename
            song.status = "published"
            song.published_at = datetime.utcnow()

            # Capture duration from yt-dlp info
            if artifact and artifact.info:
                raw_duration = artifact.info.get("duration")
                if isinstance(raw_duration, (int, float)) and raw_duration > 0:
                    song.duration = int(raw_duration)

            self._delete_download_record(db, song_uuid)
            db.commit()
            print(
                f"[DOWNLOADER] Song published successfully - song_id={song_id}",
                file=sys.stderr,
                flush=True,
            )

        except Exception as e:
            print(f"[DOWNLOADER] Download task failed: {e}", file=sys.stderr, flush=True)

            # Update Song with error status
            try:
                song_uuid = UUID(song_id)
                stmt = select(Song).where(Song.id == song_uuid)
                song = db.execute(stmt).scalar_one()

                song.status = "error"
                song.archived_at = datetime.utcnow()

            # Store error details in metadata
                metadata = {}
                try:
                    metadata = json.loads(song.extra_metadata or "{}")
                except Exception:
                    pass

                metadata["error"] = str(e)
                song.extra_metadata = json.dumps(metadata)

                self._update_download_record(
                    db,
                    song_uuid,
                    status="error",
                    current_step="error",
                    error_message=str(e),
                )
                db.commit()
                print(
                    f"[DOWNLOADER] Song marked as error - song_id={song_id}",
                    file=sys.stderr,
                    flush=True,
                )
            except Exception as update_error:
                print(
                    f"[DOWNLOADER] Failed to update Song error status: {update_error}",
                    file=sys.stderr,
                    flush=True,
                )
        finally:
            db.close()

    def _upsert_download_record(
        self,
        db: DBSession,
        song_id: str,
        source_url: str,
        source_id: str,
        title: str,
        artist: str,
        source_thumbnail: str,
        source_thumbnail_data_url: str | None,
        status: str,
        current_step: str | None,
        progress_pct: int | None,
        progress_message: str | None,
        error_message: str | None,
        started_at: datetime | None,
        completed_at: datetime | None,
    ) -> SongDownload:
        song_uuid = UUID(song_id)
        download = db.scalar(select(SongDownload).where(SongDownload.song_id == song_uuid))
        if download is None:
            download = SongDownload(
                song_id=song_uuid,
                source_url=source_url,
                source_id=source_id or None,
                title=title,
                artist=artist,
                source_thumbnail=source_thumbnail or None,
                source_thumbnail_data_url=source_thumbnail_data_url,
                status=status,
                current_step=current_step,
                progress_pct=progress_pct,
                progress_message=progress_message,
                error_message=error_message,
                started_at=started_at,
                completed_at=completed_at,
            )
            db.add(download)
            db.commit()
            db.refresh(download)
            return download

        download.source_url = source_url
        download.source_id = source_id or None
        download.title = title
        download.artist = artist
        download.source_thumbnail = source_thumbnail or None
        download.source_thumbnail_data_url = source_thumbnail_data_url
        download.status = status
        download.current_step = current_step
        download.progress_pct = progress_pct
        download.progress_message = progress_message
        download.error_message = error_message
        download.started_at = started_at
        download.completed_at = completed_at
        db.commit()
        db.refresh(download)
        return download

    def _update_download_record(
        self,
        db: DBSession,
        song_id: UUID,
        **patch: object,
    ) -> None:
        download = db.scalar(select(SongDownload).where(SongDownload.song_id == song_id))
        if download is None:
            return

        for key, value in patch.items():
            if hasattr(download, key):
                setattr(download, key, value)
        db.commit()

    def _delete_download_record(self, db: DBSession, song_id: UUID) -> None:
        download = db.scalar(select(SongDownload).where(SongDownload.song_id == song_id))
        if download is None:
            return
        db.delete(download)

    def _handle_progress_hook(self, db: DBSession, song_id: UUID, download_state: dict) -> None:
        status = download_state.get("status")
        if status != "downloading":
            return

        total = download_state.get("total_bytes") or download_state.get("total_bytes_estimate") or 0
        downloaded = download_state.get("downloaded_bytes", 0)
        pct: int | None = None
        if total > 0:
            pct = max(0, min(100, int((downloaded / total) * 100)))

        progress_message = "Downloading video"
        if pct is not None:
            progress_message = f"Downloading video ({pct}%)"

        download = db.scalar(select(SongDownload).where(SongDownload.song_id == song_id))
        if download is None:
            return
        download.progress_pct = pct
        download.current_step = "video"
        download.status = "downloading"
        download.progress_message = progress_message
        download.error_message = None
        db.commit()

    def _extract_thumbnail_url(self, info: dict) -> str:
        thumbnail = info.get("thumbnail")
        if isinstance(thumbnail, str) and thumbnail.startswith("http"):
            return thumbnail

        thumbnails = info.get("thumbnails")
        if isinstance(thumbnails, list):
            for candidate in reversed(thumbnails):
                if isinstance(candidate, dict):
                    candidate_url = candidate.get("url")
                    if isinstance(candidate_url, str) and candidate_url.startswith("http"):
                        return candidate_url

        return ""


# Global downloader instance
_downloader_instance = None


def initialize_downloader(media_dir: str | Path, db_session_factory, cookies_file: str | Path = "/data/cookies.txt"):
    """Initialize global downloader service."""
    global _downloader_instance
    _downloader_instance = SongDownloaderService(media_dir, db_session_factory, cookies_file)
    print("[DOWNLOADER] Service initialized", file=sys.stderr, flush=True)


def get_downloader() -> SongDownloaderService:
    """Get global downloader instance."""
    if _downloader_instance is None:
        raise RuntimeError("Downloader not initialized. Call initialize_downloader() first.")
    return _downloader_instance
