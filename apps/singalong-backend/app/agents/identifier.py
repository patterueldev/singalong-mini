"""Identifier Agent - Fast title/artist/off-vocal/has-lyrics identification.

Deliberately lighter than OrchestratorAgent.enhance(): skips genre/tags/language
classification and lyrics research entirely, so it returns in roughly the time of
one LLM call plus one web search instead of the full multi-wave pipeline.
"""
import asyncio
import logging
import sys
from typing import Optional

from app.config import settings

from .artist_researcher import ArtistResearcherAgent
from .content_classifier import SongContentClassifierAgent
from .off_vocal_detector import OffVocalDetectorAgent
from .title_guesser import TitleGuesserAgent
from .title_researcher import TitleResearcherAgent
from ..services.brave_search import BraveSearchService
from ..services.title_format import normalize_display_title

logger = logging.getLogger(__name__)

OFF_VOCAL_CONFIDENCE_THRESHOLD = 0.6
CONTENT_CONFIDENCE_THRESHOLD = 0.6


class IdentifierAgent:
    """Identifies title, artist, and off-vocal/has-lyrics flags for a song suggestion."""

    def __init__(self):
        """Initialize the Identifier with its sub-agents."""
        self.title_guesser = TitleGuesserAgent()
        self.off_vocal_detector = OffVocalDetectorAgent()
        self.content_classifier = SongContentClassifierAgent()
        self.title_researcher = TitleResearcherAgent()
        self.artist_researcher = ArtistResearcherAgent()
        self.brave = BraveSearchService()

    async def identify(self, canonical_payload: dict) -> dict:
        """
        Identify a song's title, artist, and off-vocal/has-lyrics flags.

        Args:
            canonical_payload: Same canonical shape as OrchestratorAgent.enhance() —
                only source fields, title, _youtube_description, _youtube_duration,
                and _youtube_categories are read. language/genre/tags/lyrics are
                passed through unchanged; a later full Enhance is expected to fill
                those in.

        Returns:
            Payload in the same canonical shape, with title/artist/is_off_vocal/
            video_has_lyrics/is_likely_song/content_confidence/content_notice updated.
        """
        try:
            print("[IDENTIFIER] identify() started", file=sys.stderr, flush=True)
            logger.info("[IDENTIFIER] identify() started")

            youtube_title = canonical_payload.get("title", "")
            youtube_description = canonical_payload.get("_youtube_description", "")
            youtube_duration = canonical_payload.get("_youtube_duration")
            youtube_categories = canonical_payload.get("_youtube_categories")

            # ── Title Guess + Off-Vocal + Content Classifier + Identity Web Search (parallel) ──
            loop = asyncio.get_event_loop()
            tg_result, ov_result, cc_result, web_context = await asyncio.gather(
                loop.run_in_executor(None, self.title_guesser.extract, youtube_title, youtube_description),
                loop.run_in_executor(None, self.off_vocal_detector.detect, youtube_title, youtube_description),
                loop.run_in_executor(
                    None, self.content_classifier.classify, youtube_title, youtube_description,
                    youtube_duration, youtube_categories,
                ),
                self._run_identity_web_search(youtube_title),
            )

            resolved_title = tg_result.get("extracted_title") or canonical_payload.get("title", "")
            resolved_artist = tg_result.get("extracted_artist") or canonical_payload.get("artist")

            # ── Title + Artist verification against web context (parallel) ──
            tr_result, ar_result = await asyncio.gather(
                self._run_title_researcher(youtube_title, resolved_title, resolved_artist, web_context),
                self._run_artist_researcher(resolved_title, resolved_artist, youtube_title, web_context),
            )

            # Content classification is only trusted (i.e. allowed to flag) above threshold —
            # low-confidence guesses default to "assume it's a song" to avoid false positives.
            is_likely_song = (
                cc_result.get("is_likely_song", True)
                if cc_result.get("confidence", 0) >= CONTENT_CONFIDENCE_THRESHOLD
                else True
            )

            identified = {
                "source_url": canonical_payload.get("source_url", ""),
                "source_id": canonical_payload.get("source_id", ""),
                "source": canonical_payload.get("source", "youtube"),
                "source_thumbnail": canonical_payload.get("source_thumbnail", ""),
                "title": normalize_display_title(
                    tr_result.get("verified_title")
                    or tg_result.get("extracted_title")
                    or canonical_payload.get("title", "Unknown Song")
                ),
                "artist": ar_result.get("verified_artist")
                or tg_result.get("extracted_artist")
                or canonical_payload.get("artist", "Unknown Artist"),
                "language": canonical_payload.get("language"),
                "is_off_vocal": (
                    ov_result.get("is_off_vocal", False)
                    if ov_result.get("confidence", 0) > OFF_VOCAL_CONFIDENCE_THRESHOLD
                    else canonical_payload.get("is_off_vocal", False)
                ),
                "video_has_lyrics": (
                    ov_result.get("video_has_lyrics", False)
                    if ov_result.get("confidence", 0) > OFF_VOCAL_CONFIDENCE_THRESHOLD
                    else canonical_payload.get("video_has_lyrics", False)
                ),
                "genre": canonical_payload.get("genre"),
                "tags": canonical_payload.get("tags"),
                "lyrics": canonical_payload.get("lyrics"),
                "is_likely_song": is_likely_song,
                "content_confidence": cc_result.get("confidence", 0.0),
                "content_notice": cc_result.get("reason") if not is_likely_song else None,
            }
            print(
                f"[IDENTIFIER] identify() completed - title={identified['title']} artist={identified['artist']} "
                f"is_likely_song={identified['is_likely_song']}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[IDENTIFIER] identify() completed - title=%s artist=%s is_likely_song=%s",
                identified["title"],
                identified["artist"],
                identified["is_likely_song"],
            )
            return identified
        except Exception as e:
            print(f"[IDENTIFIER] identify() failed, returning original payload: {e}", file=sys.stderr, flush=True)
            logger.exception("[IDENTIFIER] identify() failed, returning original payload: %s", e)
            return canonical_payload

    async def _run_identity_web_search(self, youtube_title: str) -> list[str]:
        if not settings.enable_metadata_web_search:
            return []
        try:
            results = await self.brave.search(youtube_title, count=5)
            return [f"{r['title']}: {r['description']}" for r in results if r.get("description")]
        except Exception as e:
            print(f"[IDENTIFIER] identity web search failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[IDENTIFIER] identity web search failed: %s", e)
            return []

    async def _run_title_researcher(
        self, youtube_title: str, title_guess: str, artist_guess: Optional[str], web_context: list[str]
    ) -> dict:
        try:
            return await self.title_researcher.research(youtube_title, title_guess, artist_guess, web_context)
        except Exception as e:
            print(f"[IDENTIFIER] title_researcher failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[IDENTIFIER] title_researcher failed: %s", e)
            return {"verified_title": title_guess, "confidence": 0.1}

    async def _run_artist_researcher(
        self, title: str, artist: Optional[str], youtube_title: str, web_context: list[str]
    ) -> dict:
        try:
            return await self.artist_researcher.research(title, artist, youtube_title, web_context)
        except Exception as e:
            print(f"[IDENTIFIER] artist_researcher failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[IDENTIFIER] artist_researcher failed: %s", e)
            return {"verified_artist": artist, "confidence": 0.1}
