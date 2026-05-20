import asyncio
import logging
import os
import re

import yt_dlp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..agents.orchestrator import OrchestratorAgent
from ..db import get_db
from ..models import User
from ..schemas import (
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
from ..services.auth import get_current_user
from ..services.songs_download import extract_youtube_video_id, run_song_download

router = APIRouter(prefix="/api/songs", tags=["songs"])
logger = logging.getLogger(__name__)
SUGGEST_KEYWORD_REGEX = re.compile(r"\b(karaoke|instrumental|off[\s-]?vocal)\b", re.IGNORECASE)


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


def _require_songbook_user(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"guest", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Guest or admin access required")
    return user


@router.post(
    "/suggest/download",
    response_model=SongSuggestDownloadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def suggest_song_download(payload: SongSuggestDownloadRequest, background_tasks: BackgroundTasks):
    youtube_id = extract_youtube_video_id(payload.url.strip())
    if youtube_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid YouTube URL. Supported formats: watch, youtu.be, shorts",
        )

    background_tasks.add_task(run_song_download, payload.url.strip(), youtube_id)
    logger.info("song-download-queued youtube_id=%s", youtube_id)
    return SongSuggestDownloadResponse(
        status="accepted",
        message="Song download queued",
        youtube_id=youtube_id,
    )


@router.post("/suggest/search", response_model=SongSuggestSearchResponse)
def suggest_song_search(
    payload: SongSuggestSearchRequest,
    keyword: str | None = Query(default=None, min_length=1, max_length=200),
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
                exists_in_songbook=None,
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
def suggest_song_identify(payload: SongSuggestIdentifyRequest, _: User = Depends(_require_songbook_user)):
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
    thumbnail_url = _pick_thumbnail_url(info)

    return SongSuggestIdentifyResponse(
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
