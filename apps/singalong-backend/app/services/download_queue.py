from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Song, SongDownload
from ..schemas import SongDownloadItem


def _to_download_item(download: SongDownload) -> SongDownloadItem:
    return SongDownloadItem(
        song_id=download.song_id,
        title=download.title,
        artist=download.artist,
        source_id=download.source_id,
        source_url=download.source_url,
        status=download.status,
        progress_pct=download.progress_pct,
        current_step=download.current_step,
        progress_message=download.progress_message,
        error_message=download.error_message,
        added_at=download.added_at,
        started_at=download.started_at,
        completed_at=download.completed_at,
        updated_at=download.updated_at,
    )


def list_active_download_items(db: Session) -> list[SongDownloadItem]:
    downloads = list(
        db.scalars(
            select(SongDownload).where(SongDownload.status.in_(("pending", "downloading", "error"))).order_by(
                SongDownload.added_at.asc()
            )
        ).all()
    )
    return [_to_download_item(download) for download in downloads]


def iter_recoverable_downloads(db: Session) -> Iterable[SongDownload]:
    return db.scalars(
        select(SongDownload)
        .where(SongDownload.status.in_(("pending", "downloading")))
        .order_by(SongDownload.added_at.asc())
    ).all()


def build_download_item_from_song(db: Session, song: Song) -> SongDownloadItem | None:
    download = db.scalar(select(SongDownload).where(SongDownload.song_id == song.id))
    if download is None:
        return None
    return _to_download_item(download)
