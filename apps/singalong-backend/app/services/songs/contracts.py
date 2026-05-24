from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DownloadArtifact:
    info: dict
    selected_file: Path
    temp_dir: Path

