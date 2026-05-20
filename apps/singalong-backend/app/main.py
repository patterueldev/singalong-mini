import asyncio
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi import WebSocketException, status
from sqlalchemy.orm import Session

from .bootstrap import migrate_guest_usernames, seed_admin_user
from .config import settings
from .db import Base, engine, get_db
from .models import User
from .routers.media import router as media_router
from .routers.songs import router as songs_router
from .routers.sessions import router as sessions_router
from .routers.users import router as users_router
from .services.auth import authenticate_websocket_user, authenticate_websocket_user_optional
from .services.sessions import get_active_session_by_code
from .services.ws import ws_hub

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip() != ""],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(users_router)
app.include_router(sessions_router)
app.include_router(songs_router)
app.include_router(media_router)

client_static_path = Path(settings.client_static_dir)
client_index_path = client_static_path / "index.html"


def _serve_client_path(path: str = "") -> FileResponse:
    if not client_static_path.exists() or not client_index_path.exists():
        raise HTTPException(status_code=404, detail="Client app is not available")

    root = client_static_path.resolve()
    requested = (root / path).resolve()
    try:
        requested.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Path not found") from exc

    if path != "" and requested.exists() and requested.is_file():
        return FileResponse(requested)

    if path != "" and "." in Path(path).name:
        raise HTTPException(status_code=404, detail="Static asset not found")

    return FileResponse(client_index_path)


@app.get("/")
def root():
    return RedirectResponse(url="/client/guest", status_code=307)


@app.get("/api")
def api_root():
    return {"message": "Singalong API root"}


@app.get("/client")
def client_root():
    return RedirectResponse(url="/client/", status_code=307)


@app.get("/client/")
def client_index():
    return _serve_client_path()


@app.get("/client/{full_path:path}")
def client_path(full_path: str):
    return _serve_client_path(full_path)


def _require_active_session(db: Session, session_code: str):
    active_session = get_active_session_by_code(db, session_code)
    if active_session is None:
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Active session not found for session_code",
        )
    return active_session


def _authenticate_ws_channel(
    websocket: WebSocket,
    db: Session,
    token: str | None,
    allowed_roles: set[str],
) -> User:
    return authenticate_websocket_user(
        websocket=websocket,
        db=db,
        token_query=token,
        allowed_roles=allowed_roles,
    )


@app.websocket("/ws/player")
async def websocket_player(
    websocket: WebSocket,
    session_code: str = Query(..., min_length=6, max_length=6),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    _ = _authenticate_ws_channel(websocket, db, token, {"player", "admin"})
    _require_active_session(db, session_code)
    await ws_hub.run_connection(websocket=websocket, channel="player", session_code=session_code, db=db)


@app.websocket("/ws/admin")
async def websocket_admin(
    websocket: WebSocket,
    session_code: str = Query(..., min_length=6, max_length=6),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    _ = _authenticate_ws_channel(websocket, db, token, {"admin"})
    _require_active_session(db, session_code)
    await ws_hub.run_connection(websocket=websocket, channel="admin", session_code=session_code, db=db)


@app.websocket("/ws/guest")
async def websocket_guest(
    websocket: WebSocket,
    session_code: str | None = Query(None, min_length=6, max_length=6),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    _ = authenticate_websocket_user_optional(
        websocket=websocket,
        db=db,
        token_query=token,
        allowed_roles={"guest", "admin"},
    )
    if session_code is not None:
        _require_active_session(db, session_code)
    await ws_hub.run_connection(websocket=websocket, channel="guest", session_code=session_code, db=db)


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env}


@app.on_event("startup")
async def on_startup():
    Base.metadata.create_all(bind=engine)
    migrate_guest_usernames()
    seed_admin_user()
    ws_hub.bind_event_loop(asyncio.get_running_loop())

    # Initialize song downloader
    from pathlib import Path

    from .config import settings
    from .db import SessionLocal
    from .services.song_downloader_service import get_downloader, initialize_downloader

    media_dir = Path(settings.media_root_dir)
    initialize_downloader(media_dir, SessionLocal, settings.ytdlp_cookies_file)
    get_downloader().recover_pending_downloads()
