from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Song, SongDownload, User
from ..schemas import SongDownloadItem


def _format_duration(seconds: int | None) -> str | None:
    if seconds is None or seconds <= 0:
        return None
    minutes, remaining = divmod(seconds, 60)
    return f"{minutes}:{remaining:02d}"


def _to_download_item(
    download: SongDownload,
    duration_seconds: int | None = None,
    added_by_username: str | None = None,
) -> SongDownloadItem:
    return SongDownloadItem(
        song_id=download.song_id,
        title=download.title,
        artist=download.artist,
        duration=_format_duration(duration_seconds),
        added_by_username=added_by_username,
        source_thumbnail=download.source_thumbnail,
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
    if len(downloads) == 0:
        return []

    song_meta_by_song_id = {
        song_id: {"duration": duration, "added_by_username": username}
        for song_id, duration, username in db.execute(
            select(Song.id, Song.duration, User.username)
            .outerjoin(User, Song.added_by == User.id)
            .where(Song.id.in_([download.song_id for download in downloads]))
        ).all()
    }
    return [
        _to_download_item(
            download,
            song_meta_by_song_id.get(download.song_id, {}).get("duration"),
            song_meta_by_song_id.get(download.song_id, {}).get("added_by_username"),
        )
        for download in downloads
    ]


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
    added_by_username = db.scalar(select(User.username).where(User.id == song.added_by))
    return _to_download_item(download, song.duration, added_by_username)
