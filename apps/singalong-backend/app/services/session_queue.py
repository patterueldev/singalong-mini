from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import case, select
from sqlalchemy.orm import Session

from ..models import Session as KaraokeSession
from ..models import Song, SongQueue, User
from ..schemas import SessionQueueItem
from .sessions import get_active_session_by_code


class SessionQueueError(Exception):
    pass


class SessionQueueNotFoundError(SessionQueueError):
    pass


class SessionQueueValidationError(SessionQueueError):
    pass


def _format_duration(seconds: int | None) -> str | None:
    if seconds is None or seconds <= 0:
        return None
    minutes, remaining = divmod(seconds, 60)
    return f"{minutes}:{remaining:02d}"


def _build_thumbnail_url(thumbnail_file: str | None) -> str | None:
    if not thumbnail_file:
        return None
    return f"/media/thumbnails/{thumbnail_file}"


def _require_active_session(db: Session, session_code: str) -> KaraokeSession:
    active_session = get_active_session_by_code(db, session_code)
    if active_session is None:
        raise SessionQueueNotFoundError("Active session not found")
    return active_session


def _pending_rows_for_update(db: Session, session_id: UUID) -> list[SongQueue]:
    return list(
        db.scalars(
            select(SongQueue)
            .where(SongQueue.session_id == session_id, SongQueue.status == "pending")
            .order_by(SongQueue.queue_order.asc())
            .with_for_update()
        ).all()
    )


def _active_rows_for_update(db: Session, session_id: UUID) -> list[SongQueue]:
    return list(
        db.scalars(
            select(SongQueue)
            .where(SongQueue.session_id == session_id, SongQueue.status.in_(("playing", "pending")))
            .order_by(SongQueue.queue_order.asc())
            .with_for_update()
        ).all()
    )


def _queue_items_query(session_id: UUID):
    return (
        select(SongQueue, Song.thumbnail_file, Song.title, Song.artist, Song.duration, User.username)
        .join(Song, Song.id == SongQueue.song_id)
        .outerjoin(User, User.id == SongQueue.reserved_by)
        .where(SongQueue.session_id == session_id)
        .order_by(
            case(
                (SongQueue.status == "playing", 0),
                (SongQueue.status == "pending", 1),
                else_=2,
            ),
            SongQueue.queue_order.asc(),
            SongQueue.reserved_at.asc(),
        )
    )


def _to_queue_item(
    queue: SongQueue,
    thumbnail_file: str | None,
    title: str,
    artist: str,
    duration_seconds: int | None,
    reserved_by_username: str | None,
) -> SessionQueueItem:
    return SessionQueueItem(
        id=queue.id,
        session_id=queue.session_id,
        song_id=queue.song_id,
        thumbnail_url=_build_thumbnail_url(thumbnail_file),
        title=title,
        artist=artist,
        duration=_format_duration(duration_seconds),
        queue_order=queue.queue_order,
        status=queue.status,
        reserved_by=queue.reserved_by,
        reserved_by_username=reserved_by_username,
        reserved_at=queue.reserved_at,
        played_at=queue.played_at,
        playback_position_seconds=queue.playback_position_seconds,
        playback_volume_pct=queue.playback_volume_pct,
        playback_is_playing=queue.playback_is_playing,
        created_at=queue.created_at,
        updated_at=queue.updated_at,
    )


def list_session_queue_items(db: Session, session_code: str) -> list[SessionQueueItem]:
    session = _require_active_session(db, session_code)
    rows = db.execute(_queue_items_query(session.id)).all()
    return [
        _to_queue_item(
            queue=row[0],
            thumbnail_file=row[1],
            title=row[2],
            artist=row[3],
            duration_seconds=row[4],
            reserved_by_username=row[5],
        )
        for row in rows
    ]


def get_session_queue_item(db: Session, session_code: str, queue_id: UUID) -> SessionQueueItem:
    session = _require_active_session(db, session_code)
    row = db.execute(_queue_items_query(session.id).where(SongQueue.id == queue_id)).first()
    if row is None:
        raise SessionQueueNotFoundError("Queue record not found")
    return _to_queue_item(
        queue=row[0],
        thumbnail_file=row[1],
        title=row[2],
        artist=row[3],
        duration_seconds=row[4],
        reserved_by_username=row[5],
    )


def reserve_song_in_session(
    db: Session,
    session_code: str,
    song_id: UUID,
    reserved_by: UUID,
) -> SessionQueueItem:
    session = _require_active_session(db, session_code)
    song = db.scalar(select(Song).where(Song.id == song_id))
    if song is None:
        raise SessionQueueNotFoundError("Song not found")
    if song.status != "published" or song.archived_at is not None:
        raise SessionQueueValidationError("Song is not available for reservation")

    active_rows = _active_rows_for_update(db, session.id)
    next_order = (active_rows[-1].queue_order + 1) if active_rows else 1
    has_playing = any(entry.status == "playing" for entry in active_rows)
    queue_row = SongQueue(
        session_id=session.id,
        song_id=song.id,
        queue_order=next_order,
        status="pending" if has_playing else "playing",
        reserved_by=reserved_by,
        playback_is_playing=None if has_playing else True,
        playback_position_seconds=0 if not has_playing else None,
    )
    db.add(queue_row)
    db.commit()

    return get_session_queue_item(db, session_code, queue_row.id)


def cancel_pending_queue_item(db: Session, session_code: str, queue_id: UUID) -> None:
    session = _require_active_session(db, session_code)
    pending_rows = _pending_rows_for_update(db, session.id)
    target = next((entry for entry in pending_rows if entry.id == queue_id), None)
    if target is None:
        existing = db.scalar(select(SongQueue).where(SongQueue.id == queue_id, SongQueue.session_id == session.id))
        if existing is None:
            raise SessionQueueNotFoundError("Queue record not found")
        raise SessionQueueValidationError("Only pending queue items can be cancelled")

    removed_order = target.queue_order
    db.delete(target)
    for entry in pending_rows:
        if entry.id == queue_id:
            continue
        if entry.queue_order > removed_order:
            entry.queue_order -= 1
    db.commit()


def update_queue_item_action(
    db: Session,
    session_code: str,
    queue_id: UUID,
    action: str,
    target_order: int | None = None,
) -> SessionQueueItem:
    if action == "reorder":
        if target_order is None:
            raise SessionQueueValidationError("target_order is required for reorder action")
        return reorder_pending_queue_item(db, session_code, queue_id, target_order)
    if action in {"skip", "finish"}:
        return complete_queue_item(db, session_code, queue_id, action)
    raise SessionQueueValidationError("Unsupported queue action")


def complete_queue_item(
    db: Session,
    session_code: str,
    queue_id: UUID,
    status: str,
) -> SessionQueueItem:
    if status not in {"skip", "finish"}:
        raise SessionQueueValidationError("Unsupported completion status")

    session = _require_active_session(db, session_code)
    active_rows = _active_rows_for_update(db, session.id)
    target = next((entry for entry in active_rows if entry.id == queue_id), None)
    if target is None:
        existing = db.scalar(select(SongQueue).where(SongQueue.id == queue_id, SongQueue.session_id == session.id))
        if existing is None:
            raise SessionQueueNotFoundError("Queue record not found")
        raise SessionQueueValidationError("Only playing or pending queue items can be updated")

    removed_order = target.queue_order
    target.status = "skipped" if status == "skip" else "finished"
    target.played_at = datetime.now(timezone.utc)
    target.playback_is_playing = False
    for entry in active_rows:
        if entry.id == queue_id:
            continue
        if entry.queue_order > removed_order:
            entry.queue_order -= 1
    db.commit()

    return get_session_queue_item(db, session_code, target.id)


def reorder_pending_queue_item(
    db: Session,
    session_code: str,
    queue_id: UUID,
    target_order: int,
) -> SessionQueueItem:
    session = _require_active_session(db, session_code)
    pending_rows = _pending_rows_for_update(db, session.id)
    if len(pending_rows) == 0:
        raise SessionQueueValidationError("No pending queue items to reorder")

    source_index = next((idx for idx, entry in enumerate(pending_rows) if entry.id == queue_id), None)
    if source_index is None:
        existing = db.scalar(select(SongQueue).where(SongQueue.id == queue_id, SongQueue.session_id == session.id))
        if existing is None:
            raise SessionQueueNotFoundError("Queue record not found")
        raise SessionQueueValidationError("Only pending queue items can be reordered")

    if target_order < 1 or target_order > len(pending_rows):
        raise SessionQueueValidationError("target_order is out of range")

    destination_index = target_order - 1
    if source_index != destination_index:
        moved = pending_rows.pop(source_index)
        pending_rows.insert(destination_index, moved)
        for index, entry in enumerate(pending_rows, start=1):
            entry.queue_order = index
        db.commit()
    else:
        db.rollback()

    return get_session_queue_item(db, session_code, queue_id)


def list_session_participant_stats(db: Session, session_code: str, online_usernames: set[str]) -> list[dict]:
    session = _require_active_session(db, session_code)
    rows = db.execute(
        select(
            User.id,
            User.username,
            SongQueue.status,
        )
        .join(User, User.id == SongQueue.reserved_by)
        .where(SongQueue.session_id == session.id)
        .order_by(User.username.asc(), SongQueue.reserved_at.asc())
    ).all()
    stats: dict[UUID, dict] = {}
    for user_id, username, queue_status in rows:
        if user_id not in stats:
            stats[user_id] = {
                "user_id": user_id,
                "username": username,
                "pending_count": 0,
                "finished_count": 0,
                "skipped_count": 0,
                "total_count": 0,
                "is_online": username in online_usernames,
            }
        entry = stats[user_id]
        entry["total_count"] += 1
        if queue_status in {"playing", "pending"}:
            entry["pending_count"] += 1
        elif queue_status == "finished":
            entry["finished_count"] += 1
        elif queue_status == "skipped":
            entry["skipped_count"] += 1
    return list(stats.values())


def update_top_pending_playback_state(
    db: Session,
    session_code: str,
    *,
    position_seconds: float | None = None,
    volume_pct: int | None = None,
    is_playing: bool | None = None,
) -> SessionQueueItem | None:
    session = _require_active_session(db, session_code)
    active_rows = _active_rows_for_update(db, session.id)
    if len(active_rows) == 0:
        db.rollback()
        return None

    target = next((entry for entry in active_rows if entry.status == "playing"), active_rows[0])
    if position_seconds is not None:
        target.playback_position_seconds = max(0.0, float(position_seconds))
    if volume_pct is not None:
        target.playback_volume_pct = max(0, min(100, int(round(volume_pct))))
    if is_playing is not None:
        target.playback_is_playing = bool(is_playing)
    db.commit()

    return get_session_queue_item(db, session_code, target.id)


def advance_playing_queue_item(
    db: Session,
    session_code: str,
    *,
    completion_status: str,
    expected_current_item_id: str | None = None,
) -> list[SessionQueueItem]:
    if completion_status not in {"finished", "skipped"}:
        raise SessionQueueValidationError("Unsupported completion status")

    session = _require_active_session(db, session_code)
    active_rows = _active_rows_for_update(db, session.id)
    if len(active_rows) == 0:
        db.rollback()
        return list_session_queue_items(db, session_code)

    current = next((entry for entry in active_rows if entry.status == "playing"), active_rows[0])
    if expected_current_item_id is not None and str(current.id) != expected_current_item_id:
        # Stale/duplicate completion signal for an item that's already been advanced past — no-op.
        db.rollback()
        return list_session_queue_items(db, session_code)
    current.status = completion_status
    current.played_at = datetime.now(timezone.utc)
    current.playback_is_playing = False

    removed_order = current.queue_order
    for entry in active_rows:
        if entry.id == current.id:
            continue
        if entry.queue_order > removed_order:
            entry.queue_order -= 1

    remaining_pending = [
        entry for entry in active_rows
        if entry.id != current.id and entry.status == "pending"
    ]
    if len(remaining_pending) > 0:
        next_entry = sorted(remaining_pending, key=lambda row: row.queue_order)[0]
        next_entry.status = "playing"
        next_entry.playback_is_playing = True
        if next_entry.playback_position_seconds is None:
            next_entry.playback_position_seconds = 0

    db.commit()
    return list_session_queue_items(db, session_code)
