import asyncio
import logging
import math
import os
import re
import uuid
from pathlib import Path

import yt_dlp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..agents.orchestrator import OrchestratorAgent
from ..config import settings
from ..db import get_db
from ..models import Session as KaraokeSession, Song, SongDownload, SongQueue, User
from ..schemas import (
    SongDownloadListResponse,
    SongbookItem,
    SongbookListResponse,
    SongAdminUpdateRequest,
    SongAdminUpdateResponse,
    SongSuggestDownloadRequest,
    SongSuggestDownloadResponse,
    SongSuggestEnhanceRequest,
    SongSuggestEnhanceResponse,
    SongSuggestIdentifyRequest,
    SongSuggestIdentifyResponse,
    SongSuggestSearchItem,
    SongSuggestSearchRequest,
    SongSuggestSearchResponse,
    SongSuggestSuggestionsResponse,
    SongSuggestUpdateRequest,
    SongSuggestUpdateResponse,
)
from ..services.auth import get_current_user, require_admin_user
from ..services.download_queue import list_active_download_items
from ..services.thumbnail_service import convert_base64_to_jpg, save_thumbnail
from ..services.ytdlp.naming import normalize_song_title
from ..services.songs_download import extract_youtube_video_id, run_song_download
from ..services.sessions import get_active_session_by_code

router = APIRouter(prefix="/api/songs", tags=["songs"])
logger = logging.getLogger(__name__)
SUGGEST_KEYWORD_REGEX = re.compile(r"\b(karaoke|instrumental|off[\s-]?vocal)\b|カラオケ", re.IGNORECASE)
FILENAME_TOKEN_SANITIZER_REGEX = re.compile(r"[^a-zA-Z0-9_-]+")


def _format_duration(seconds: int | float | None) -> str:
    if not isinstance(seconds, (int, float)):
        return "0:00"

    total_seconds = max(int(seconds), 0)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    remaining_seconds = total_seconds % 60
    if hours > 0:
        return f"{hours}:{minutes:02d}:{remaining_seconds:02d}"
    return f"{minutes:02d}:{remaining_seconds:02d}"


def _pick_thumbnail_url(entry: dict[str, object]) -> str:
    thumbnail = entry.get("thumbnail")
    if isinstance(thumbnail, str) and thumbnail.startswith("http"):
        return thumbnail

    thumbnails = entry.get("thumbnails")
    if isinstance(thumbnails, list):
        for candidate in reversed(thumbnails):
            if isinstance(candidate, dict):
                candidate_url = candidate.get("url")
                if isinstance(candidate_url, str) and candidate_url.startswith("http"):
                    return candidate_url
    return ""


def _extract_distinct_genres(db: Session, query: str | None, limit: int) -> list[str]:
    where_clause = ""
    params: dict[str, object] = {"limit": limit}
    if query:
        where_clause = "AND LOWER(BTRIM(genre::text)) LIKE :pattern"
        params["pattern"] = f"%{query.lower()}%"

    sql = text(
        f"""
        SELECT DISTINCT BTRIM(genre::text) AS value
        FROM songs
        WHERE genre IS NOT NULL
          AND BTRIM(genre::text) <> ''
          {where_clause}
        ORDER BY value
        LIMIT :limit
        """
    )
    return [value for value in db.execute(sql, params).scalars().all() if isinstance(value, str)]


def _extract_distinct_tags(db: Session, query: str | None, limit: int) -> list[str]:
    where_clause = ""
    params: dict[str, object] = {"limit": limit}
    if query:
        where_clause = "AND LOWER(BTRIM(tag_value)) LIKE :pattern"
        params["pattern"] = f"%{query.lower()}%"

    sql = text(
        f"""
        SELECT DISTINCT BTRIM(tag_value) AS value
        FROM songs
        CROSS JOIN LATERAL UNNEST(STRING_TO_ARRAY(COALESCE(tags::text, ''), ',')) AS tag_value
        WHERE BTRIM(tag_value) <> ''
          {where_clause}
        ORDER BY value
        LIMIT :limit
        """
    )
    return [value for value in db.execute(sql, params).scalars().all() if isinstance(value, str)]


def _normalize_entries(values: list[str], lowercase: bool = False) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        entry = value.strip()
        if entry == "":
            continue
        if lowercase:
            entry = entry.lower()
        if entry in seen:
            continue
        seen.add(entry)
        normalized.append(entry)
    return normalized


def _sanitize_filename_token(value: str) -> str:
    token = FILENAME_TOKEN_SANITIZER_REGEX.sub("_", value.strip()).strip("_")
    return token or "song"


def _require_songbook_user(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"guest", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Guest or admin access required")
    return user


@router.post(
    "/suggest/download",
    response_model=SongSuggestDownloadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def suggest_song_download(
    payload: SongSuggestDownloadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from datetime import datetime
    from uuid import uuid4

    from ..models import Song
    from ..services.song_downloader_service import get_downloader

    print(f"[ENDPOINT] /suggest/download - title={payload.title}", flush=True)

    try:
        # Upsert: reuse existing record if same source_id exists
        existing = (
            db.query(Song).filter(Song.source_id == payload.source_id).first()
            if payload.source_id
            else None
        )

        if existing:
            print(f"[ENDPOINT] Overwriting existing song source_id={payload.source_id} song_id={existing.id}", flush=True)
            existing.title = payload.title
            existing.artist = payload.artist
            existing.language = payload.language
            existing.is_off_vocal = payload.is_off_vocal
            existing.has_lyrics = payload.video_has_lyrics
            existing.genre = payload.genre[0] if payload.genre else None
            existing.tags = ",".join(payload.tags) if payload.tags else None
            existing.lyrics = payload.lyrics.strip() or None
            existing.source = payload.source
            existing.source_url = payload.source_url
            existing.last_modified_by = user.id
            existing.status = "downloading"
            existing.archived_at = None
            existing.video_file = None
            existing.thumbnail_file = None
            existing.duration = None
            existing.published_at = None
            db.commit()
            db.refresh(existing)
            song = existing
        else:
            song = Song(
                id=uuid4(),
                title=payload.title,
                artist=payload.artist,
                language=payload.language,
                is_off_vocal=payload.is_off_vocal,
                has_lyrics=payload.video_has_lyrics,
                genre=payload.genre[0] if payload.genre else None,
                tags=",".join(payload.tags) if payload.tags else None,
                lyrics=payload.lyrics.strip() or None,
                source=payload.source,
                source_id=payload.source_id,
                source_url=payload.source_url,
                added_by=user.id,
                status="downloading",
            )
            db.add(song)
            db.commit()
            db.refresh(song)

        print(f"[ENDPOINT] Song record ready - song_id={song.id}", flush=True)

        # Queue background download task
        downloader = get_downloader()
        downloader.queue_song_download(
            song_id=str(song.id),
            source_url=payload.source_url,
            source_id=payload.source_id,
            title=payload.title,
            artist=payload.artist,
            source_thumbnail=payload.source_thumbnail,
            source_thumbnail_data_url=payload.source_thumbnail_data_url or None,
        )

        return SongSuggestDownloadResponse(
            status="accepted",
            message="Song download queued",
            song_id=str(song.id),
        )
    except Exception as e:
        print(f"[ENDPOINT] Error: {e}", flush=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to queue song download",
        )


@router.get("/downloads", response_model=SongDownloadListResponse)
def list_song_downloads(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_user),
):
    return SongDownloadListResponse(items=list_active_download_items(db))


@router.post("/downloads/{song_id}/retry", response_model=SongSuggestDownloadResponse, status_code=status.HTTP_202_ACCEPTED)
def retry_song_download(
    song_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    from ..services.song_downloader_service import get_downloader

    download = db.query(SongDownload).filter(SongDownload.song_id == song_id).first()
    if download is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Download record not found")
    if download.status != "error":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only errored downloads can be retried",
        )

    song = db.query(Song).filter(Song.id == song_id).first()
    if song is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")

    source_url = download.source_url or song.source_url
    if source_url is None or source_url.strip() == "":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Missing source URL")

    song.status = "downloading"
    song.archived_at = None
    db.commit()

    downloader = get_downloader()
    downloader.queue_song_download(
        song_id=str(song.id),
        source_url=source_url,
        source_id=download.source_id or song.source_id or "",
        title=download.title or song.title,
        artist=download.artist or song.artist,
        source_thumbnail=download.source_thumbnail or "",
        source_thumbnail_data_url=download.source_thumbnail_data_url,
    )

    return SongSuggestDownloadResponse(
        status="accepted",
        message="Song download requeued",
        song_id=str(song.id),
    )


@router.post("/suggest/search", response_model=SongSuggestSearchResponse)
def suggest_song_search(
    payload: SongSuggestSearchRequest,
    keyword: str | None = Query(default=None, min_length=1, max_length=200),
    db: Session = Depends(get_db),
    _: User = Depends(_require_songbook_user),
):
    query = (keyword or payload.query).strip()
    if query == "":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Query is required")

    appended_karaoke = SUGGEST_KEYWORD_REGEX.search(query) is None
    effective_query = query if not appended_karaoke else f"{query} karaoke"
    limit = payload.limit

    search_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "default_search": "ytsearch",
    }

    try:
        with yt_dlp.YoutubeDL(search_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{effective_query}", download=False)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Search provider error: {exc}") from exc

    results: list[SongSuggestSearchItem] = []
    source_ids = [entry.get("id") or "" for entry in (info.get("entries") or [])[:limit]]
    lookup_source_ids = [source_id for source_id in source_ids if source_id != ""]
    existing_source_ids = set()
    if lookup_source_ids:
        existing_source_ids = {
            source_id
            for (source_id,) in db.query(Song.source_id)
            .filter(Song.source_id.in_(lookup_source_ids))
            .all()
            if isinstance(source_id, str) and source_id != ""
        }
    for entry in (info.get("entries") or [])[:limit]:
        video_id = entry.get("id") or ""
        raw_url = entry.get("url") or ""
        if isinstance(raw_url, str) and raw_url.startswith("http"):
            source_url = raw_url
        elif video_id != "":
            source_url = f"https://www.youtube.com/watch?v={video_id}"
        else:
            source_url = ""
        thumbnail_url = _pick_thumbnail_url(entry)
        title = entry.get("title") or "Untitled"
        channel_name = entry.get("channel") or entry.get("uploader") or "Unknown Channel"
        channel_url = entry.get("channel_url") or entry.get("uploader_url") or ""
        description = entry.get("description") or ""
        duration_seconds = entry.get("duration")
        view_count = entry.get("view_count")
        uploaded_at = entry.get("upload_date") or ""

        results.append(
            SongSuggestSearchItem(
                id=video_id,
                title=title,
                thumbnail_url=thumbnail_url,
                duration=_format_duration(duration_seconds),
                channel_name=channel_name,
                channel_url=channel_url if isinstance(channel_url, str) else "",
                description=description if isinstance(description, str) else "",
                view_count=view_count if isinstance(view_count, int) else None,
                uploaded_at=uploaded_at if isinstance(uploaded_at, str) else "",
                exists_in_songbook=video_id in existing_source_ids,
                source_url=source_url,
                youtube_id=video_id,
            )
        )

    return SongSuggestSearchResponse(
        effective_query=effective_query,
        appended_karaoke=appended_karaoke,
        results=results,
    )


@router.post("/suggest/identify", response_model=SongSuggestIdentifyResponse)
async def suggest_song_identify(
    payload: SongSuggestIdentifyRequest,
    enhance: bool = False,
    _: User = Depends(_require_songbook_user),
):
    youtube_id = extract_youtube_video_id(payload.url.strip())
    if youtube_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid YouTube URL")

    search_opts = {
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(search_opts) as ydl:
            info = ydl.extract_info(payload.url.strip(), download=False)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Identify provider error: {exc}") from exc

    title = info.get("title") or f"YouTube Video {youtube_id}"
    description = info.get("description") or ""
    thumbnail_url = _pick_thumbnail_url(info)

    # Build initial response
    identify_result = SongSuggestIdentifyResponse(
        source_url=f"https://www.youtube.com/watch?v={youtube_id}",
        source_id=youtube_id,
        source="youtube",
        source_thumbnail=thumbnail_url,
        title=title if isinstance(title, str) else f"YouTube Video {youtube_id}",
        artist="Unknown Artist",
        language=None,
        is_off_vocal=False,
        video_has_lyrics=False,
        genre=None,
        tags=None,
        lyrics=None,
    )

    # If enhance=true, apply enhancement
    if enhance:
        try:
            orchestrator = OrchestratorAgent()
            enhancement_payload = {
                "source_url": identify_result.source_url,
                "source_id": identify_result.source_id,
                "source": identify_result.source,
                "source_thumbnail": identify_result.source_thumbnail,
                "title": identify_result.title,
                "artist": identify_result.artist,
                "language": identify_result.language or None,
                "is_off_vocal": identify_result.is_off_vocal,
                "video_has_lyrics": identify_result.video_has_lyrics,
                "genre": identify_result.genre,
                "tags": identify_result.tags,
                "lyrics": identify_result.lyrics,
                "_youtube_description": description,
            }
            enhanced_payload = await orchestrator.enhance(enhancement_payload)
            
            # Return enhanced result
            identify_result = SongSuggestIdentifyResponse(
                source_url=enhanced_payload.get("source_url", identify_result.source_url),
                source_id=enhanced_payload.get("source_id", identify_result.source_id),
                source=enhanced_payload.get("source", identify_result.source),
                source_thumbnail=enhanced_payload.get("source_thumbnail", identify_result.source_thumbnail),
                title=enhanced_payload.get("title", identify_result.title),
                artist=enhanced_payload.get("artist", identify_result.artist),
                language=enhanced_payload.get("language"),
                is_off_vocal=enhanced_payload.get("is_off_vocal", False),
                video_has_lyrics=enhanced_payload.get("video_has_lyrics", False),
                genre=enhanced_payload.get("genre"),
                tags=enhanced_payload.get("tags"),
                lyrics=enhanced_payload.get("lyrics"),
            )
        except Exception as e:
            logger.warning("[IDENTIFY] Enhancement failed, returning raw result: %s", e)
            # If enhancement fails, return raw result without error

    return identify_result


@router.post("/suggest/update", response_model=SongSuggestUpdateResponse)
def suggest_song_update(payload: SongSuggestUpdateRequest, _: User = Depends(_require_songbook_user)):
    normalized_genre = _normalize_entries(payload.genre)
    normalized_tags = _normalize_entries(payload.tags, lowercase=True)
    normalized_source = payload.source.strip().lower()
    return SongSuggestUpdateResponse(
        status="accepted",
        message="Song suggestion details accepted",
        draft=SongSuggestIdentifyResponse(
            source_url=payload.source_url,
            source_id=payload.source_id,
            source=normalized_source if normalized_source else "youtube",
            source_thumbnail=payload.source_thumbnail,
            title=payload.title,
            artist=payload.artist,
            language=payload.language.strip() or None,
            is_off_vocal=payload.is_off_vocal,
            video_has_lyrics=payload.video_has_lyrics,
            genre=normalized_genre[0] if normalized_genre else None,
            tags=normalized_tags or None,
            lyrics=payload.lyrics.strip() or None,
        ),
    )




@router.post("/suggest/enhance", response_model=SongSuggestEnhanceResponse)
async def suggest_song_enhance(
    payload: SongSuggestEnhanceRequest,
    _: User = Depends(_require_songbook_user),
):
    """
    Enhance song metadata using multiple AI agents.

    This endpoint orchestrates several specialized agents:
    - Title Guesser: Extracts clean title and artist from YouTube metadata
    - Web Researcher: Researches artist verification, year, genre, tags
    - Language Identifier: Detects language from text

    Source fields (source_url, source_id, source, source_thumbnail) are always preserved.
    Title and artist are always enhanced (agents extract/verify them).

    Returns the enhanced metadata in the same canonical shape.
    """
    import sys
    print(f"[ENHANCE] Starting enhancement request - source_id={payload.source_id} title={payload.title} artist={payload.artist}", file=sys.stderr, flush=True)
    logger.info("[ENHANCE] Starting enhancement request - source_id=%s title=%s artist=%s", payload.source_id, payload.title, payload.artist)
    
    # Validate OpenAI API key is available
    if not os.getenv("OPENAI_API_KEY"):
        print("[ENHANCE] OPENAI_API_KEY not configured", file=sys.stderr, flush=True)
        logger.warning("[ENHANCE] OPENAI_API_KEY not configured")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OPENAI_API_KEY is not configured",
        )
    print("[ENHANCE] OPENAI_API_KEY is available", file=sys.stderr, flush=True)
    logger.info("[ENHANCE] OPENAI_API_KEY is available")

    try:
        # Create orchestrator and prepare payload for enhancement
        orchestrator = OrchestratorAgent()
        print("[ENHANCE] OrchestratorAgent initialized", file=sys.stderr, flush=True)
        logger.info("[ENHANCE] OrchestratorAgent initialized")

        # Convert request to dict for processing
        enhancement_payload = {
            "source_url": payload.source_url,
            "source_id": payload.source_id,
            "source": payload.source,
            "source_thumbnail": payload.source_thumbnail,
            "title": payload.title,
            "artist": payload.artist,
            "language": payload.language or None,
            "is_off_vocal": payload.is_off_vocal,
            "video_has_lyrics": payload.video_has_lyrics,
            "genre": payload.genre[0] if payload.genre else None,
            "tags": payload.tags or None,
            "lyrics": payload.lyrics or None,
        }
        print(f"[ENHANCE] Prepared enhancement_payload: source_id={enhancement_payload['source_id']} title={enhancement_payload['title']}", file=sys.stderr, flush=True)
        logger.info("[ENHANCE] Prepared enhancement_payload: source_id=%s title=%s", enhancement_payload["source_id"], enhancement_payload["title"])

        # Run enhancement orchestration
        print("[ENHANCE] Calling orchestrator.enhance()", file=sys.stderr, flush=True)
        logger.info("[ENHANCE] Calling orchestrator.enhance()")
        enhanced_payload = await orchestrator.enhance(enhancement_payload)
        print(f"[ENHANCE] orchestrator.enhance() completed - title={enhanced_payload.get('title')} artist={enhanced_payload.get('artist')}", file=sys.stderr, flush=True)
        logger.info("[ENHANCE] orchestrator.enhance() completed - title=%s artist=%s", enhanced_payload.get("title"), enhanced_payload.get("artist"))

        # Convert enhanced payload back to response model
        enhanced_response = SongSuggestIdentifyResponse(
            source_url=enhanced_payload.get("source_url", ""),
            source_id=enhanced_payload.get("source_id", ""),
            source=enhanced_payload.get("source", "youtube"),
            source_thumbnail=enhanced_payload.get("source_thumbnail", ""),
            title=enhanced_payload.get("title", payload.title),
            artist=enhanced_payload.get("artist", payload.artist),
            language=enhanced_payload.get("language"),
            is_off_vocal=enhanced_payload.get("is_off_vocal", False),
            video_has_lyrics=enhanced_payload.get("video_has_lyrics", False),
            genre=enhanced_payload.get("genre"),
            tags=enhanced_payload.get("tags"),
            lyrics=enhanced_payload.get("lyrics"),
        )

        logger.info(
            "[ENHANCE] song-enhancement-successful youtube_id=%s title_before=%s title_after=%s artist_before=%s artist_after=%s",
            payload.source_id,
            payload.title,
            enhanced_response.title,
            payload.artist,
            enhanced_response.artist,
        )

        return SongSuggestEnhanceResponse(
            status="success",
            message="Song metadata enhanced successfully",
            enhanced=enhanced_response,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[ENHANCE] song-enhancement-failed: %s", e)
        # Graceful degradation: return original payload on any error
        return SongSuggestEnhanceResponse(
            status="degraded",
            message="Enhancement partially failed, returned original values",
            enhanced=SongSuggestIdentifyResponse(
                source_url=payload.source_url,
                source_id=payload.source_id,
                source=payload.source,
                source_thumbnail=payload.source_thumbnail,
                title=payload.title,
                artist=payload.artist,
                language=payload.language or None,
                is_off_vocal=payload.is_off_vocal,
                video_has_lyrics=payload.video_has_lyrics,
                genre=payload.genre[0] if payload.genre else None,
                tags=payload.tags or None,
                lyrics=payload.lyrics or None,
            ),
        )


@router.get("/suggest/suggestions", response_model=SongSuggestSuggestionsResponse)
def suggest_metadata_suggestions(
    keyword: str | None = Query(default=None, min_length=1, max_length=100),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(_require_songbook_user),
):
    query = keyword.strip() if keyword else None
    try:
        genres = _extract_distinct_genres(db, query, limit)
        tags = _extract_distinct_tags(db, query, limit)
    except SQLAlchemyError as exc:
        logger.warning("song-suggestions-query-failed error=%s", exc)
        genres = []
        tags = []

    return SongSuggestSuggestionsResponse(genres=genres, tags=tags)


# ---------------------------------------------------------------------------
# Songbook helpers
# ---------------------------------------------------------------------------

def _build_thumbnail_url(thumbnail_file: str | None) -> str | None:
    if not thumbnail_file:
        return None
    return f"/media/thumbnails/{thumbnail_file}"


def _parse_tags(tags_str: str | None) -> list[str]:
    if not tags_str:
        return []
    import json
    try:
        parsed = json.loads(tags_str)
        if isinstance(parsed, list):
            return [str(t) for t in parsed]
    except (json.JSONDecodeError, ValueError):
        pass
    return [t.strip() for t in tags_str.split(",") if t.strip()]


def _load_added_by_usernames(db: Session, songs: list[Song]) -> dict[uuid.UUID, str]:
    user_ids = [song.added_by for song in songs]
    if not user_ids:
        return {}

    rows = db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()
    return {user_id: username for user_id, username in rows}


def _load_session_song_counts(
    db: Session,
    session: KaraokeSession | None,
    songs: list[Song],
) -> dict[uuid.UUID, int]:
    if session is None or len(songs) == 0:
        return {}
    rows = db.query(SongQueue.song_id, func.count(SongQueue.id)).filter(
        SongQueue.session_id == session.id,
        SongQueue.song_id.in_([song.id for song in songs]),
    ).group_by(SongQueue.song_id).all()
    return {song_id: int(count) for song_id, count in rows}


def _load_session_queue_song_ids(db: Session, session: KaraokeSession | None) -> set[uuid.UUID]:
    if session is None:
        return set()
    rows = db.query(SongQueue.song_id).filter(
        SongQueue.session_id == session.id,
        SongQueue.status == "pending",
    ).all()
    return {song_id for (song_id,) in rows}


def _parse_vibe_terms(vibes: str | None) -> list[str]:
    if vibes is None:
        return []

    terms = [entry.strip() for entry in re.split(r"[,;/\n|]+", vibes) if entry.strip() != ""]
    return terms


def _resolve_songbook_session(
    db: Session,
    session_id: uuid.UUID | None,
    session_code: str | None,
) -> KaraokeSession | None:
    if session_id is not None:
        session = db.get(KaraokeSession, session_id)
        if session is not None and session.archived_at is None:
            return session
        return None

    if session_code is None or session_code == "":
        return None

    return get_active_session_by_code(db, session_code)


def _song_to_item(
    song: Song,
    added_by_username: str | None = None,
    queued_count_in_session: int = 0,
) -> SongbookItem:
    return SongbookItem(
        id=song.id,
        title=song.title,
        artist=song.artist,
        duration=_format_duration(song.duration),
        language=song.language,
        genre=song.genre,
        tags=_parse_tags(song.tags),
        thumbnail_url=_build_thumbnail_url(song.thumbnail_file),
        source_id=song.source_id,
        source_url=song.source_url,
        video_file=song.video_file,
        lyrics=song.lyrics,
        added_by_username=added_by_username,
        queued_count_in_session=queued_count_in_session,
        was_queued_in_session=queued_count_in_session > 0,
    )


# ---------------------------------------------------------------------------
# GET /api/songs  —  paginated songbook
# ---------------------------------------------------------------------------

@router.get("", response_model=SongbookListResponse)
def list_songs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    session_id: uuid.UUID | None = Query(default=None, alias="sessionId"),
    session_code: str | None = Query(default=None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    session = _resolve_songbook_session(db, session_id, session_code)
    queued_song_ids = _load_session_queue_song_ids(db, session)

    base_query = db.query(Song).filter(Song.status == "published", Song.archived_at.is_(None))
    if len(queued_song_ids) > 0:
        base_query = base_query.filter(~Song.id.in_(queued_song_ids))

    vibe_terms = _parse_vibe_terms(session.vibes if session is not None else None)
    if len(vibe_terms) > 0:
        vibe_filters = []
        for term in vibe_terms:
            pattern = f"%{term}%"
            vibe_filters.append(
                or_(
                    Song.title.ilike(pattern),
                    Song.artist.ilike(pattern),
                    Song.genre.ilike(pattern),
                    Song.tags.ilike(pattern),
                )
            )
        base_query = base_query.filter(or_(*vibe_filters))

    base_query = base_query.order_by(func.lower(Song.title), func.lower(Song.artist), Song.id)
    total = base_query.count()
    pages = max(1, math.ceil(total / limit))
    items = base_query.offset((page - 1) * limit).limit(limit).all()
    added_by_usernames = _load_added_by_usernames(db, items)
    session_song_counts = _load_session_song_counts(db, session, items)
    return SongbookListResponse(
        items=[
            _song_to_item(
                s,
                added_by_usernames.get(s.added_by),
                session_song_counts.get(s.id, 0),
            )
            for s in items
        ],
        total=total,
        page=page,
        pages=pages,
    )


# ---------------------------------------------------------------------------
# GET /api/songs/search  —  keyword search across songbook
# ---------------------------------------------------------------------------

@router.get("/search", response_model=SongbookListResponse)
def search_songs(
    q: str = Query("", alias="q"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    session_id: uuid.UUID | None = Query(default=None, alias="sessionId"),
    session_code: str | None = Query(default=None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    session = _resolve_songbook_session(db, session_id, session_code)
    base_query = (
        db.query(Song)
        .filter(Song.status == "published", Song.archived_at.is_(None))
    )
    keyword = q.strip()
    if keyword:
        pattern = f"%{keyword}%"
        base_query = base_query.filter(
            or_(
                Song.title.ilike(pattern),
                Song.artist.ilike(pattern),
                Song.genre.ilike(pattern),
                Song.tags.ilike(pattern),
            )
        )
    base_query = base_query.order_by(func.lower(Song.title), func.lower(Song.artist), Song.id)
    total = base_query.count()
    pages = max(1, math.ceil(total / limit))
    items = base_query.offset((page - 1) * limit).limit(limit).all()
    added_by_usernames = _load_added_by_usernames(db, items)
    session_song_counts = _load_session_song_counts(db, session, items)
    return SongbookListResponse(
        items=[
            _song_to_item(
                s,
                added_by_usernames.get(s.added_by),
                session_song_counts.get(s.id, 0),
            )
            for s in items
        ],
        total=total,
        page=page,
        pages=pages,
    )



# ---------------------------------------------------------------------------
# GET /api/songs/{song_id}  —  single song detail
# ---------------------------------------------------------------------------

@router.get("/{song_id}", response_model=SongbookItem)
def get_song(
    song_id: str,
    session_id: uuid.UUID | None = Query(default=None, alias="sessionId"),
    session_code: str | None = Query(default=None, min_length=6, max_length=6),
    db: Session = Depends(get_db),
):
    import uuid as _uuid
    try:
        uid = _uuid.UUID(song_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")

    song = (
        db.query(Song)
        .filter(Song.id == uid, Song.status == "published", Song.archived_at.is_(None))
        .first()
    )
    if not song:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")
    added_by_username = (
        db.query(User.username)
        .filter(User.id == song.added_by)
        .scalar()
    )
    session = _resolve_songbook_session(db, session_id, session_code)
    session_song_counts = _load_session_song_counts(db, session, [song])
    return _song_to_item(song, added_by_username, session_song_counts.get(song.id, 0))


@router.patch("/{song_id}", response_model=SongAdminUpdateResponse)
def patch_song(
    song_id: str,
    payload: SongAdminUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_user),
):
    import uuid as _uuid

    try:
        uid = _uuid.UUID(song_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")

    song = (
        db.query(Song)
        .filter(Song.id == uid, Song.status == "published", Song.archived_at.is_(None))
        .first()
    )
    if not song:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Song not found")

    normalized_title = payload.title.strip()
    normalized_artist = payload.artist.strip()
    if normalized_title == "" or normalized_artist == "":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Title and artist cannot be empty")

    song.title = normalized_title
    song.artist = normalized_artist
    song.language = payload.language.strip() if isinstance(payload.language, str) and payload.language.strip() != "" else None
    song.genre = payload.genre.strip() if isinstance(payload.genre, str) and payload.genre.strip() != "" else None
    song.tags = ",".join([entry.strip() for entry in payload.tags if entry.strip() != ""]) or None
    song.lyrics = payload.lyrics.strip() if isinstance(payload.lyrics, str) and payload.lyrics.strip() != "" else None
    song.last_modified_by = current_user.id

    if isinstance(payload.source_thumbnail_data_url, str) and payload.source_thumbnail_data_url.strip() != "":
        try:
            source_token = _sanitize_filename_token(song.source_id) if song.source_id else str(song.id)
            thumbnail_filename = f"{normalize_song_title(song.title)}[{source_token}].jpg"
            thumbnail_data = convert_base64_to_jpg(payload.source_thumbnail_data_url)
            save_thumbnail(thumbnail_data, thumbnail_filename, Path(settings.media_root_dir))
            song.thumbnail_file = thumbnail_filename
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid thumbnail data: {exc}") from exc

    db.commit()
    db.refresh(song)
    added_by_username = db.query(User.username).filter(User.id == song.added_by).scalar()
    return SongAdminUpdateResponse(
        item=_song_to_item(song, added_by_username, 0),
        message="Song updated",
    )
