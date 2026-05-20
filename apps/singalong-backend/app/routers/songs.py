import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from ..schemas import SongSuggestDownloadRequest, SongSuggestDownloadResponse
from ..services.songs_download import extract_youtube_video_id, run_song_download

router = APIRouter(prefix="/api/songs", tags=["songs"])
logger = logging.getLogger(__name__)


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
