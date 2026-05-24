from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from ..config import settings

router = APIRouter(prefix="/media", tags=["media"])
allowed_media_directories = {"assets", "songs", "thumbnails"}
media_root_path = Path(settings.media_root_dir)


def _resolve_media_path(media_path: str) -> Path:
    requested_path = Path(media_path)
    if media_path.strip() == "" or requested_path.is_absolute():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    if len(requested_path.parts) == 0 or requested_path.parts[0] not in allowed_media_directories:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    media_root = media_root_path.resolve()
    candidate = (media_root / requested_path).resolve()
    try:
        candidate.relative_to(media_root)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found") from exc

    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    return candidate


@router.get("/{media_path:path}")
def get_media(media_path: str):
    return FileResponse(_resolve_media_path(media_path))
