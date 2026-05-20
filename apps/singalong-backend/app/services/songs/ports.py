from typing import Protocol

from .contracts import DownloadArtifact


class SongDownloaderPort(Protocol):
    def download_to_temp(self, url: str) -> DownloadArtifact: ...

