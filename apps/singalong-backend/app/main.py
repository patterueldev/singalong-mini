import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi import WebSocketException, status
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .bootstrap import seed_admin_user
from .config import settings
from .db import Base, engine, get_db
from .models import User
from .routers.media import router as media_router
from .routers.songs import router as songs_router
from .routers.sessions import router as sessions_router
from .routers.users import legacy_router as users_legacy_router
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
app.include_router(users_legacy_router)
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


@app.get("/api/public-config")
def public_config(request: Request):
    configured = settings.singalong_base_url.strip()
    if configured != "":
        return {"guest_base_url": configured.rstrip("/")}

    request_base = str(request.base_url).rstrip("/")
    return {"guest_base_url": request_base}


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
    user = _authenticate_ws_channel(websocket, db, token, {"player", "admin"})
    _require_active_session(db, session_code)
    await ws_hub.run_connection(
        websocket=websocket,
        channel="player",
        session_code=session_code,
        db=db,
        username=user.username,
    )


@app.websocket("/ws/admin")
async def websocket_admin(
    websocket: WebSocket,
    session_code: str = Query(..., min_length=6, max_length=6),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    user = _authenticate_ws_channel(websocket, db, token, {"admin"})
    _require_active_session(db, session_code)
    await ws_hub.run_connection(
        websocket=websocket,
        channel="admin",
        session_code=session_code,
        db=db,
        username=user.username,
    )


@app.websocket("/ws/guest")
async def websocket_guest(
    websocket: WebSocket,
    session_code: str | None = Query(None, min_length=6, max_length=6),
    token: str | None = Query(None),
    db: Session = Depends(get_db),
):
    user = authenticate_websocket_user_optional(
        websocket=websocket,
        db=db,
        token_query=token,
        allowed_roles={"guest", "admin"},
    )
    if session_code is not None:
        _require_active_session(db, session_code)
    await ws_hub.run_connection(
        websocket=websocket,
        channel="guest",
        session_code=session_code,
        db=db,
        username=user.username if user is not None else None,
    )


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env}


@app.on_event("startup")
async def on_startup():
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    if inspector.has_table("sessions"):
        session_columns = {column["name"] for column in inspector.get_columns("sessions")}
        if "vibes" not in session_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN vibes TEXT"))
    if inspector.has_table("song_queue"):
        queue_columns = {column["name"] for column in inspector.get_columns("song_queue")}
        with engine.begin() as conn:
            conn.execute(text("ALTER TYPE song_queue_status ADD VALUE IF NOT EXISTS 'playing'"))
            if "playback_position_seconds" not in queue_columns:
                conn.execute(text("ALTER TABLE song_queue ADD COLUMN playback_position_seconds DOUBLE PRECISION"))
            if "playback_volume_pct" not in queue_columns:
                conn.execute(text("ALTER TABLE song_queue ADD COLUMN playback_volume_pct INTEGER"))
            if "playback_is_playing" not in queue_columns:
                conn.execute(text("ALTER TABLE song_queue ADD COLUMN playback_is_playing BOOLEAN"))
    if inspector.has_table("songs"):
        songs_columns = {column["name"]: column for column in inspector.get_columns("songs")}
        with engine.begin() as conn:
            if "trim_start_ms" not in songs_columns:
                conn.execute(text("ALTER TABLE songs ADD COLUMN trim_start_ms INTEGER"))
            if "trim_end_ms" not in songs_columns:
                conn.execute(text("ALTER TABLE songs ADD COLUMN trim_end_ms INTEGER"))
            if "was_trimmed" not in songs_columns:
                conn.execute(text("ALTER TABLE songs ADD COLUMN was_trimmed BOOLEAN DEFAULT FALSE"))
            if "trimmed_at" not in songs_columns:
                conn.execute(text("ALTER TABLE songs ADD COLUMN trimmed_at TIMESTAMP WITH TIME ZONE"))
            if "enhancement_status" not in songs_columns:
                conn.execute(text("ALTER TABLE songs ADD COLUMN enhancement_status VARCHAR(10)"))
            # Migrate constrained VARCHAR columns to unbounded TEXT
            for col_name in ("title", "artist"):
                col_info = songs_columns.get(col_name)
                if col_info and "VARCHAR" in str(col_info["type"]).upper():
                    conn.execute(text(f"ALTER TABLE songs ALTER COLUMN {col_name} TYPE TEXT"))
            # Bump language from VARCHAR(10) to VARCHAR(20)
            lang_col = songs_columns.get("language")
            if lang_col and "VARCHAR" in str(lang_col["type"]).upper():
                conn.execute(text("ALTER TABLE songs ALTER COLUMN language TYPE VARCHAR(20)"))
            # A background enhancement job can't be resumed across a process restart —
            # reset anything left mid-flight so it doesn't look stuck forever.
            conn.execute(
                text("UPDATE songs SET enhancement_status = 'error' WHERE enhancement_status IN ('pending', 'running')")
            )
        # Migrate song_downloads constrained VARCHAR to TEXT (separate block so
        # column dict is fresh from the inspector).
        if inspector.has_table("song_downloads"):
            downloads_columns = {column["name"]: column for column in inspector.get_columns("song_downloads")}
            for col_name in ("title", "artist"):
                col_info = downloads_columns.get(col_name)
                if col_info and "VARCHAR" in str(col_info["type"]).upper():
                    try:
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE song_downloads ALTER COLUMN {col_name} TYPE TEXT"))
                    except Exception as exc:
                        logger.warning(
                            "Could not migrate song_downloads.%s to TEXT (will retry next startup): %s",
                            col_name, exc,
                        )
    seed_admin_user()
    ws_hub.bind_event_loop(asyncio.get_running_loop())

    # Initialize song downloader
    from pathlib import Path

    from .config import settings
    from .db import SessionLocal
    from .services.song_downloader_service import get_downloader, initialize_downloader
    from .tasks.trim_cleanup_task import start_cleanup_scheduler

    media_dir = Path(settings.media_root_dir)
    initialize_downloader(media_dir, SessionLocal, settings.ytdlp_cookies_file)
    get_downloader().recover_pending_downloads()

    # Start trim archive cleanup scheduler
    start_cleanup_scheduler()


@app.on_event("shutdown")
async def on_shutdown():
    """Shutdown event handler."""
    from .tasks.trim_cleanup_task import stop_cleanup_scheduler

    stop_cleanup_scheduler()
