from pathlib import Path

from ..config import settings
from .songs.use_cases import DownloadSuggestedSongUseCase
from .ytdlp.song_downloader import YtDlpSongDownloader
from .ytdlp.url_utils import extract_youtube_video_id

_download_use_case = DownloadSuggestedSongUseCase(
    songs_dir=Path(settings.songs_media_dir),
    downloader=YtDlpSongDownloader(cookies_file=settings.ytdlp_cookies_file),
)


def run_song_download(url: str, youtube_id: str) -> None:
    _download_use_case.execute(url, youtube_id)


__all__ = ["extract_youtube_video_id", "run_song_download"]

