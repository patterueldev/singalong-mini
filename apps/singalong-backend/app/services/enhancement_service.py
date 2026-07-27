"""Enhancement Service - Runs full AI enhancement in the background, decoupled from the
save/download flow.

OrchestratorAgent.enhance() is already a coroutine (it offloads its own blocking LLM
calls via run_in_executor), so unlike the yt-dlp video downloader this doesn't need its
own ThreadPoolExecutor — a background asyncio.Task on the main event loop is enough. The
one place this crosses threads is the download worker thread joining on a job before it
publishes a song; that reuses the same run_coroutine_threadsafe pattern already proven in
app/services/ws.py for broadcasting from that same worker thread.
"""
import asyncio
import logging
from uuid import UUID

from ..agents.orchestrator import OrchestratorAgent
from ..models import Song

logger = logging.getLogger(__name__)


class EnhancementService:
    """Runs a background full-enhancement job per song, independent of the download flow."""

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def enqueue(
        self,
        session_factory,
        song_id: str,
        payload: dict,
        existing_genres: list[str],
        existing_tags: list[str],
    ) -> None:
        """Start a background enhancement job for a song. Must be called from the main event loop."""
        self._loop = asyncio.get_running_loop()
        self._set_status(session_factory, song_id, "running")
        task = asyncio.create_task(self._run(session_factory, song_id, payload, existing_genres, existing_tags))
        self._tasks[song_id] = task

    def wait_for(self, song_id: str, timeout: float = 45.0) -> bool:
        """Block (from any thread) until the song's background enhancement finishes or the
        timeout elapses. Returns True if it finished (or nothing was queued), False on timeout."""
        if self._loop is None:
            return True
        future = asyncio.run_coroutine_threadsafe(self._wait_for_async(song_id, timeout), self._loop)
        try:
            return future.result(timeout=timeout + 5)
        except Exception:
            return False

    async def _wait_for_async(self, song_id: str, timeout: float) -> bool:
        task = self._tasks.get(song_id)
        if task is None:
            return True
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self._tasks.pop(song_id, None)

    async def _run(
        self,
        session_factory,
        song_id: str,
        payload: dict,
        existing_genres: list[str],
        existing_tags: list[str],
    ) -> None:
        try:
            enhanced = await OrchestratorAgent().enhance(payload, existing_genres, existing_tags)
            self._apply_result(session_factory, song_id, enhanced)
        except Exception as e:
            logger.exception("[ENHANCEMENT_SERVICE] background enhance failed for song_id=%s: %s", song_id, e)
            self._set_status(session_factory, song_id, "error")
        finally:
            self._tasks.pop(song_id, None)

    def _set_status(self, session_factory, song_id: str, status: str) -> None:
        db = session_factory()
        try:
            song = db.get(Song, UUID(song_id))
            if song is not None:
                song.enhancement_status = status
                db.commit()
        finally:
            db.close()

    def _apply_result(self, session_factory, song_id: str, enhanced: dict) -> None:
        db = session_factory()
        try:
            song = db.get(Song, UUID(song_id))
            if song is None:
                return
            if enhanced.get("title"):
                song.title = enhanced["title"]
            if enhanced.get("artist"):
                song.artist = enhanced["artist"]
            if enhanced.get("language"):
                song.language = enhanced["language"]
            song.is_off_vocal = enhanced.get("is_off_vocal", song.is_off_vocal)
            song.has_lyrics = enhanced.get("video_has_lyrics", song.has_lyrics)
            if enhanced.get("genre"):
                song.genre = enhanced["genre"]
            if enhanced.get("tags"):
                song.tags = ",".join(enhanced["tags"])
            if enhanced.get("lyrics"):
                song.lyrics = enhanced["lyrics"].strip() or song.lyrics
            song.enhancement_status = "done"
            db.commit()
        finally:
            db.close()


_service_instance: EnhancementService | None = None


def get_enhancement_service() -> EnhancementService:
    """Get the global EnhancementService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = EnhancementService()
    return _service_instance
