from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..schemas import (
    SessionArchiveResponse,
    SessionCreateRequest,
    SessionResponse,
)
from ..services.sessions import (
    SessionNotFoundError,
    SessionValidationError,
    archive_session,
    create_session,
    get_latest_active_session,
    list_sessions,
)
from ..services.auth import require_admin_user
from ..services.ws import ws_hub

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionResponse])
def get_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    return list_sessions(db)


@router.get("/active", response_model=SessionResponse)
def get_active_session(db: Session = Depends(get_db)):
    session = get_latest_active_session(db)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active session")
    return session


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def post_session(
    payload: SessionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    try:
        return create_session(db, payload.name)
    except SessionValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.patch("/{session_id}/archive", response_model=SessionArchiveResponse)
def patch_session_archive(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    try:
        session = archive_session(db, session_id)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found") from exc

    anyio.from_thread.run(ws_hub.broadcast_session_ended, session.session_code)
    return SessionArchiveResponse(session=session, message="Session archived")
