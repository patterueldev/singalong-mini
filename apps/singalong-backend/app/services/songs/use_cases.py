import logging
import shutil
from pathlib import Path

from ..ytdlp.naming import build_saved_filename
from ..ytdlp.url_utils import extract_canonical_youtube_url
from .ports import SongDownloaderPort

logger = logging.getLogger("uvicorn.error")


class DownloadSuggestedSongUseCase:
    def __init__(self, songs_dir: Path, downloader: SongDownloaderPort):
        self._songs_dir = songs_dir
        self._downloader = downloader

    def execute(self, source_url: str, youtube_id: str) -> None:
        self._songs_dir.mkdir(parents=True, exist_ok=True)
        download_target = extract_canonical_youtube_url(source_url.strip())
        logger.info("song-download-start youtube_id=%s target=%s", youtube_id, download_target)

        artifact = self._downloader.download_to_temp(download_target)
        try:
            if not artifact.selected_file.exists() or not artifact.selected_file.is_file():
                raise RuntimeError("Downloaded file not found after yt-dlp run")

            raw_title = str(artifact.info.get("track") or artifact.info.get("title") or youtube_id)
            final_filename = build_saved_filename(raw_title, youtube_id, artifact.selected_file.suffix)
            final_file = self._songs_dir / final_filename
            shutil.move(str(artifact.selected_file), str(final_file))
            logger.info("song-download-success youtube_id=%s file=%s", youtube_id, final_file.name)
        except Exception:
            logger.exception("song-download-failed youtube_id=%s source_url=%s", youtube_id, source_url)
            raise
        finally:
            shutil.rmtree(artifact.temp_dir, ignore_errors=True)

