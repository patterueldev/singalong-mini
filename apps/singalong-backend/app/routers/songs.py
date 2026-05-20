import logging
import re

import yt_dlp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from ..models import User
from ..schemas import (
    SongSuggestDownloadRequest,
    SongSuggestDownloadResponse,
    SongSuggestIdentifyRequest,
    SongSuggestIdentifyResponse,
    SongSuggestSearchItem,
    SongSuggestSearchRequest,
    SongSuggestSearchResponse,
    SongSuggestUpdateRequest,
    SongSuggestUpdateResponse,
)
from ..services.auth import get_current_user
from ..services.songs_download import extract_youtube_video_id, run_song_download

router = APIRouter(prefix="/api/songs", tags=["songs"])
logger = logging.getLogger(__name__)
SUGGEST_KEYWORD_REGEX = re.compile(r"\b(karaoke|instrumental|off[\s-]?vocal)\b", re.IGNORECASE)


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
def suggest_song_search(payload: SongSuggestSearchRequest, _: User = Depends(_require_songbook_user)):
    query = payload.query.strip()
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
        thumbnail_url = entry.get("thumbnail") or ""
        title = entry.get("title") or "Untitled"
        channel_name = entry.get("channel") or entry.get("uploader") or "Unknown Channel"
        duration_seconds = entry.get("duration")
        if isinstance(duration_seconds, int) and duration_seconds >= 0:
            minutes = duration_seconds // 60
            seconds = duration_seconds % 60
            duration = f"{minutes}:{seconds:02d}"
        else:
            duration = "0:00"

        results.append(
            SongSuggestSearchItem(
                id=video_id,
                title=title,
                channel_name=channel_name,
                thumbnail_url=thumbnail_url,
                duration=duration,
                exists_in_songbook=None,
                source_url=source_url,
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

    return SongSuggestIdentifyResponse(
        title=f"YouTube Video {youtube_id}",
        artist="Unknown Artist",
        source_url=payload.url.strip(),
        youtube_id=youtube_id,
    )


@router.post("/suggest/update", response_model=SongSuggestUpdateResponse)
def suggest_song_update(payload: SongSuggestUpdateRequest, _: User = Depends(_require_songbook_user)):
    return SongSuggestUpdateResponse(
        status="accepted",
        message="Song suggestion details accepted",
        draft=SongSuggestIdentifyResponse(
            title=payload.title,
            artist=payload.artist,
            source_url=payload.source_url,
            youtube_id=payload.youtube_id,
        ),
    )
