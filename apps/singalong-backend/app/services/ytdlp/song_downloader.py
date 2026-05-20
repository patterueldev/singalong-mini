import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import yt_dlp

from ..songs.contracts import DownloadArtifact
from .naming import ALLOWED_VIDEO_EXTENSIONS

logger = logging.getLogger("uvicorn.error")


class YtDlpSongDownloader:
    def __init__(self, cookies_file: str):
        self._cookies_file = cookies_file

    def _make_progress_hook(self):
        state = {"last_pct": 0.0}

        def hook(download_state: dict):
            if download_state.get("status") == "downloading":
                total = download_state.get("total_bytes") or download_state.get("total_bytes_estimate") or 0
                downloaded = download_state.get("downloaded_bytes", 0)
                if total > 0:
                    pct = (downloaded / total) * 100
                    if pct - state["last_pct"] >= 2.5 or pct >= 99.9:
                        format_id = (
                            download_state.get("info_dict", {}).get("format_id", "")
                            if isinstance(download_state.get("info_dict"), dict)
                            else ""
                        )
                        logger.info(
                            "song-download-progress format=%s pct=%.1f downloaded=%s total=%s",
                            format_id,
                            pct,
                            downloaded,
                            total,
                        )
                        state["last_pct"] = pct
            elif download_state.get("status") == "finished":
                filename = download_state.get("filename") or (
                    download_state.get("info_dict", {}).get("_filename", "")
                    if isinstance(download_state.get("info_dict"), dict)
                    else ""
                )
                logger.info("song-download-segment-finished file=%s", os.path.basename(str(filename)))

        return hook

    def _runtime_cookiefile(self) -> str | None:
        cookies_path = self._cookies_file.strip()
        if cookies_path == "":
            return None
        if not os.path.isfile(cookies_path):
            logger.warning("song-download-cookies-missing path=%s", cookies_path)
            return None

        runtime_cookiefile = "/tmp/yt-dlp-cookies.txt"
        try:
            shutil.copyfile(cookies_path, runtime_cookiefile)
            return runtime_cookiefile
        except OSError as err:
            logger.warning("song-download-cookie-copy-failed path=%s error=%s", cookies_path, err)
            return None

    def _log_formats(self, info: dict) -> None:
        formats = info.get("formats", [])
        if not formats:
            logger.warning("song-download-no-formats-found")
            return

        logger.info("song-download-total-formats count=%s", len(formats))
        for fmt in formats:
            try:
                format_id = fmt.get("format_id", "N/A")
                protocol = fmt.get("protocol", "?")
                height = fmt.get("height") or 0
                extension = fmt.get("ext", "?")
                vcodec = fmt.get("vcodec") or "none"
                acodec = fmt.get("acodec") or "none"
                filesize = fmt.get("filesize")
                if not filesize:
                    filesize_approx = fmt.get("filesize_approx")
                    filesize = int(filesize_approx) if filesize_approx is not None else 0
                size_mb = filesize / (1024 * 1024) if filesize else 0
                combined = "COMBINED" if vcodec != "none" and acodec != "none" else ""
                logger.info(
                    "song-download-format id=%s protocol=%s height=%sp ext=%s vcodec=%s acodec=%s size_mb=%.1f %s",
                    format_id,
                    protocol,
                    height,
                    extension,
                    str(vcodec)[:12],
                    str(acodec)[:12],
                    size_mb,
                    combined,
                )
            except Exception as err:
                logger.debug("song-download-format-log-failed error=%s", err)

    def _has_audio_and_video(self, file_path: Path) -> bool:
        try:
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_type",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    str(file_path),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
        except Exception:
            return False

        stream_types = {line.strip() for line in result.stdout.splitlines() if line.strip() != ""}
        return "video" in stream_types and "audio" in stream_types

    def _select_downloaded_output(self, tmpdir: Path) -> Path:
        candidates: list[Path] = []
        for file_name in os.listdir(tmpdir):
            if file_name.startswith("."):
                continue
            candidate = tmpdir / file_name
            if candidate.is_file() and candidate.suffix.lstrip(".").lower() in ALLOWED_VIDEO_EXTENSIONS:
                candidates.append(candidate)

        if not candidates:
            raise RuntimeError("yt-dlp produced no output file")

        candidates.sort(key=lambda path: path.stat().st_size, reverse=True)
        with_audio = [path for path in candidates if self._has_audio_and_video(path)]
        return with_audio[0] if with_audio else candidates[0]

    def download_to_temp(self, url: str, progress_hook=None) -> DownloadArtifact:
        tmpdir = Path(tempfile.mkdtemp(prefix="singalong_dl_"))
        output_template = str(tmpdir / "%(id)s.%(ext)s")

        ydl_options: dict[str, object] = {
            "quiet": True,
            "no_warnings": False,
            "js_runtimes": {"node": {"path": "/usr/bin/node"}},
            "remote_components": ["ejs:github"],
            # Criteria-based selection:
            # 1) highest <=1080p with both audio+video
            # 2) if none, highest <=720p with both audio+video
            # 3) if none, highest <=360p with both audio+video
            # 4) otherwise fallback to adaptive merge
            "format": (
                "best[ext=mp4][vcodec!=none][acodec!=none][height<=1080]/"
                "best[ext=mp4][vcodec!=none][acodec!=none][height<=720]/"
                "best[ext=mp4][vcodec!=none][acodec!=none][height<=360]/"
                "bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/"
                "bestvideo[height<=1080]+bestaudio/"
                "best[height<=1080]"
            ),
            "merge_output_format": "mp4",
            "outtmpl": output_template,
            "socket_timeout": 30,
            "progress_hooks": [self._make_progress_hook()],
            "noplaylist": True,
        }

        if progress_hook is not None:
            ydl_options["progress_hooks"].append(progress_hook)

        cookiefile = self._runtime_cookiefile()
        if cookiefile is not None:
            ydl_options["cookiefile"] = cookiefile

        with yt_dlp.YoutubeDL(ydl_options) as ydl:
            info = ydl.extract_info(url, download=False)
            self._log_formats(info if isinstance(info, dict) else {})
            logger.info("song-download-yt-dlp-start")
            ydl.download([url])

        selected_file = self._select_downloaded_output(tmpdir)
        logger.info("song-download-selected-file path=%s", selected_file.name)
        return DownloadArtifact(
            info=info if isinstance(info, dict) else {},
            selected_file=selected_file,
            temp_dir=tmpdir,
        )
