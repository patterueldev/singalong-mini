import logging
import re

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
    normalized = re.sub(r"[^a-zA-Z0-9]+", "", effective_query).lower() or "song"

    results = [
        SongSuggestSearchItem(
            id=f"mock-{normalized[:8]}-{index + 1}",
            title=f"{effective_query} (Karaoke Mix {index + 1})",
            artist=f"Mock Channel {index + 1}",
            source_url=f"https://www.youtube.com/watch?v={normalized[:6]}{index + 1}",
        )
        for index in range(3)
    ]

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
