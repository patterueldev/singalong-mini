from __future__ import annotations

from datetime import datetime, timezone
from secrets import randbelow
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Session as KaraokeSession

SESSION_CODE_LENGTH = 6
MAX_SESSION_CODE = 10**SESSION_CODE_LENGTH
MAX_SESSION_CREATE_ATTEMPTS = 25


class SessionNotFoundError(Exception):
    pass


class SessionValidationError(Exception):
    pass


def _generate_session_code() -> str:
    return f"{randbelow(MAX_SESSION_CODE):0{SESSION_CODE_LENGTH}d}"


def list_sessions(db: Session) -> list[KaraokeSession]:
    return list(db.scalars(select(KaraokeSession).order_by(KaraokeSession.created_at.desc())).all())


def get_latest_active_session(db: Session) -> KaraokeSession | None:
    return db.scalar(
        select(KaraokeSession)
        .where(KaraokeSession.archived_at.is_(None))
        .order_by(KaraokeSession.created_at.desc())
        .limit(1),
    )


def get_active_session_by_code(db: Session, session_code: str) -> KaraokeSession | None:
    return db.scalar(
        select(KaraokeSession)
        .where(KaraokeSession.session_code == session_code)
        .where(KaraokeSession.archived_at.is_(None))
        .limit(1),
    )


def create_session(db: Session, name: str) -> KaraokeSession:
    normalized_name = name.strip()
    if normalized_name == "":
        raise SessionValidationError("Session name cannot be empty")

    last_error: Exception | None = None
    for _ in range(MAX_SESSION_CREATE_ATTEMPTS):
        session = KaraokeSession(session_code=_generate_session_code(), name=normalized_name)
        db.add(session)
        try:
            db.commit()
            db.refresh(session)
            return session
        except IntegrityError as exc:
            db.rollback()
            last_error = exc

    if last_error is not None:
        raise last_error
    raise RuntimeError("Unable to create session")


def archive_session(db: Session, session_id: UUID) -> KaraokeSession:
    session = db.get(KaraokeSession, session_id)
    if session is None:
        raise SessionNotFoundError

    session.archived_at = session.archived_at or datetime.now(timezone.utc)
    db.commit()
    db.refresh(session)
    return session
