from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..schemas import (
    SessionArchiveResponse,
    SessionCreateRequest,
    SessionParticipantItem,
    SessionParticipantListResponse,
    SessionQueueCreateRequest,
    SessionQueueDeleteResponse,
    SessionQueueListResponse,
    SessionQueueMutationResponse,
    SessionQueueUpdateRequest,
    SessionUpdateRequest,
    SessionWorkspaceResponse,
    SessionResponse,
)
from ..services.session_queue import (
    SessionQueueNotFoundError,
    SessionQueueValidationError,
    cancel_pending_queue_item,
    list_session_queue_items,
    list_session_participant_stats,
    reserve_song_in_session,
    update_queue_item_action,
)
from ..services.sessions import (
    SessionNotFoundError,
    SessionValidationError,
    archive_session,
    create_session,
    get_active_session_by_code,
    get_latest_active_session,
    list_sessions,
    update_session,
)
from ..services.auth import require_admin_or_guest_user, require_admin_player_guest_user, require_admin_user
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


@router.patch("/{session_id}", response_model=SessionResponse)
def patch_session(
    session_id: UUID,
    payload: SessionUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    try:
        return update_session(db, session_id, name=payload.name, vibes=payload.vibes)
    except SessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found") from exc
    except SessionValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/{session_code}/workspace", response_model=SessionWorkspaceResponse)
async def get_session_workspace(
    session_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    session = get_active_session_by_code(db, session_code)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active session not found")

    presence = await ws_hub.get_presence_snapshot(session_code)
    return SessionWorkspaceResponse(
        session=session,
        websocket_status="connected",
        player_connected=bool(presence["player_connected"]),
        admin_connected_count=int(presence["admin_connected_count"]),
        guest_connected_count=int(presence["guest_connected_count"]),
    )


@router.get("/{session_code}/participants", response_model=SessionParticipantListResponse)
async def get_session_participants(
    session_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    try:
        presence = await ws_hub.get_presence_snapshot(session_code)
        items = [
            SessionParticipantItem(**entry)
            for entry in list_session_participant_stats(
                db,
                session_code,
                online_usernames=presence["online_usernames"],
            )
        ]
        return SessionParticipantListResponse(items=items)
    except SessionQueueNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{session_code}/queue", response_model=SessionQueueListResponse)
def get_session_queue(
    session_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_player_guest_user),
):
    _ = current_user
    try:
        return SessionQueueListResponse(items=list_session_queue_items(db, session_code))
    except SessionQueueNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{session_code}/queue", response_model=SessionQueueMutationResponse, status_code=status.HTTP_201_CREATED)
def post_session_queue(
    session_code: str,
    payload: SessionQueueCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_guest_user),
):
    try:
        item = reserve_song_in_session(
            db=db,
            session_code=session_code,
            song_id=payload.song_id,
            reserved_by=current_user.id,
        )
        items = list_session_queue_items(db, session_code)
        anyio.from_thread.run(ws_hub.broadcast_queue_updated, session_code, items)
        return SessionQueueMutationResponse(item=item, message="Song reserved")
    except SessionQueueNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionQueueValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.patch("/{session_code}/queue/{queue_id}", response_model=SessionQueueMutationResponse)
def patch_session_queue(
    session_code: str,
    queue_id: UUID,
    payload: SessionQueueUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    try:
        item = update_queue_item_action(
            db=db,
            session_code=session_code,
            queue_id=queue_id,
            action=payload.action,
            target_order=payload.target_order,
        )
        items = list_session_queue_items(db, session_code)
        anyio.from_thread.run(ws_hub.broadcast_queue_updated, session_code, items)
        return SessionQueueMutationResponse(item=item, message=f"Queue item {payload.action} updated")
    except SessionQueueNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionQueueValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/{session_code}/queue/{queue_id}", response_model=SessionQueueDeleteResponse)
def delete_session_queue(
    session_code: str,
    queue_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    _ = current_user
    try:
        cancel_pending_queue_item(db=db, session_code=session_code, queue_id=queue_id)
        items = list_session_queue_items(db, session_code)
        anyio.from_thread.run(ws_hub.broadcast_queue_updated, session_code, items)
        return SessionQueueDeleteResponse(message="Queue item cancelled")
    except SessionQueueNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SessionQueueValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
