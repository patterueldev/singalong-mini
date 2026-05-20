import json
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from ..models import Song
from ..services.ytdlp.naming import build_saved_filename
from ..services.thumbnail_service import convert_base64_to_jpg, download_thumbnail, save_thumbnail
from ..services.ytdlp.song_downloader import YtDlpSongDownloader


class SongDownloaderService:
    """Service to handle async song download and processing."""

    def __init__(self, media_dir: str | Path, db_session_factory, cookies_file: str | Path = "/data/cookies.txt"):
        self.media_dir = Path(media_dir)
        self.db_session_factory = db_session_factory
        self.cookies_file = cookies_file
        self.downloader = YtDlpSongDownloader(cookies_file=str(cookies_file))
        self.executor = ThreadPoolExecutor(max_workers=3)

    def queue_song_download(
        self,
        song_id: str,
        source_url: str,
        source_id: str,
        title: str,
        source_thumbnail: str,
        source_thumbnail_data_url: str | None = None,
    ):
        """Queue a song download task to run in background."""
        print(f"[DOWNLOADER] Queueing download for song_id={song_id}", file=sys.stderr, flush=True)
        self.executor.submit(
            self._download_song_task,
            song_id=song_id,
            source_url=source_url,
            source_id=source_id,
            title=title,
            source_thumbnail=source_thumbnail,
            source_thumbnail_data_url=source_thumbnail_data_url,
        )

    def _download_song_task(
        self,
        song_id: str,
        source_url: str,
        source_id: str,
        title: str,
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
                    artifact = self.downloader.download_to_temp(source_url)
                    
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
                thumbnail_filename = build_saved_filename(title, source_id, "jpg")

                if source_thumbnail_data_url:
                    # Custom thumbnail: decode base64 → convert to JPG
                    print("[DOWNLOADER] Using custom thumbnail", file=sys.stderr, flush=True)
                    thumbnail_data = convert_base64_to_jpg(source_thumbnail_data_url)
                else:
                    # Source thumbnail: download → convert to JPG
                    print("[DOWNLOADER] Downloading source thumbnail", file=sys.stderr, flush=True)
                    thumbnail_data = download_thumbnail(source_thumbnail)
                    # Convert to JPG if needed
                    from PIL import Image
                    from io import BytesIO

                    try:
                        image = Image.open(BytesIO(thumbnail_data))
                        if image.format and image.format.lower() != "jpeg":
                            if image.mode in ("RGBA", "P"):
                                rgb_image = Image.new("RGB", image.size, (255, 255, 255))
                                rgb_image.paste(
                                    image,
                                    mask=image.split()[-1] if image.mode == "RGBA" else None,
                                )
                                image = rgb_image
                            jpg_buffer = BytesIO()
                            image.save(jpg_buffer, format="JPEG", quality=85, optimize=True)
                            jpg_buffer.seek(0)
                            thumbnail_data = jpg_buffer.getvalue()
                    except Exception:
                        # If conversion fails, use original data
                        pass

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
            stmt = select(Song).where(Song.id == song_id)
            song = db.execute(stmt).scalar_one()

            song.video_file = f"songs/{video_filename}"
            song.thumbnail_file = f"thumbnails/{thumbnail_filename}"
            song.status = "published"
            song.published_at = datetime.utcnow()

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
                stmt = select(Song).where(Song.id == song_id)
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
