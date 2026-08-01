"""Bounded concurrency + short-TTL caching for ad-hoc yt-dlp metadata/search calls.

Search, identify, and enhance all shell out to yt-dlp for metadata lookups (as opposed to
the dedicated single-worker download pipeline in ``song_downloader_service.py``). Each call
opens several sockets and touches the filesystem; with no cap, a handful of people searching
at once on a small host can exhaust file descriptors system-wide, which is what destabilized
Postgres in issue #60. This module gives all of those call sites one choke point: a bounded
executor plus a semaphore, so concurrent yt-dlp work is capped and callers get a fast, clean
503 instead of piling up.
"""

from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

from fastapi import HTTPException, status

from ...config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T")


class YtDlpWorkQueue:
    """Bounds how many blocking yt-dlp calls can run at once.

    A plain class (rather than bare module globals) so tests can construct one with a small,
    fast-to-exhaust concurrency limit instead of poking at shared process-wide state.
    """

    def __init__(self, *, concurrency: int, queue_max_wait_seconds: float, call_timeout_seconds: float) -> None:
        self._queue_max_wait_seconds = queue_max_wait_seconds
        self._call_timeout_seconds = call_timeout_seconds
        # Separate from the downloader's own single-worker executor
        # (song_downloader_service.py) so a long-running download never starves metadata
        # lookups, and vice versa.
        self._executor = ThreadPoolExecutor(max_workers=max(concurrency, 1), thread_name_prefix="ytdlp-meta")
        self._semaphore = asyncio.Semaphore(max(concurrency, 1))

    async def run(self, fn: Callable[[], T]) -> T:
        """Run a blocking yt-dlp call off the event loop, bounded by a small concurrency limit.

        Waits up to ``queue_max_wait_seconds`` for a free slot, then enforces
        ``call_timeout_seconds`` on the call itself. Both limits raise a 503 rather than
        letting requests pile up indefinitely.
        """
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=self._queue_max_wait_seconds)
        except asyncio.TimeoutError as exc:
            logger.warning("ytdlp-queue-full wait_seconds=%s", self._queue_max_wait_seconds)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Search is busy right now, please try again in a moment",
            ) from exc

        try:
            loop = asyncio.get_running_loop()
            try:
                return await asyncio.wait_for(
                    loop.run_in_executor(self._executor, fn),
                    timeout=self._call_timeout_seconds,
                )
            except asyncio.TimeoutError as exc:
                logger.warning("ytdlp-call-timeout timeout_seconds=%s", self._call_timeout_seconds)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Search took too long, please try again",
                ) from exc
        finally:
            self._semaphore.release()


class TTLCache:
    """Tiny in-process TTL cache. Several clients searching the same title within the TTL
    window collapse into a single upstream yt-dlp call — this is the biggest single reduction
    in concurrent file-descriptor usage for the actual multi-guest workload."""

    def __init__(self, ttl_seconds: float) -> None:
        self._ttl_seconds = ttl_seconds
        self._store: dict[str, tuple[float, object]] = {}
        self._lock = asyncio.Lock()

    async def get_or_set(self, key: str, factory: Callable[[], T]) -> T:
        now = time.monotonic()
        async with self._lock:
            cached = self._store.get(key)
            if cached is not None and cached[0] > now:
                return cached[1]  # type: ignore[return-value]

        value = await factory()

        async with self._lock:
            self._store[key] = (now + self._ttl_seconds, value)
            self._prune(now)
        return value

    def _prune(self, now: float) -> None:
        expired = [key for key, (expires_at, _value) in self._store.items() if expires_at <= now]
        for key in expired:
            del self._store[key]


_default_queue = YtDlpWorkQueue(
    concurrency=settings.ytdlp_search_concurrency,
    queue_max_wait_seconds=settings.ytdlp_queue_max_wait_seconds,
    call_timeout_seconds=settings.ytdlp_call_timeout_seconds,
)


async def run_ytdlp(fn: Callable[[], T]) -> T:
    return await _default_queue.run(fn)


search_cache = TTLCache(ttl_seconds=settings.ytdlp_search_cache_ttl_seconds)
