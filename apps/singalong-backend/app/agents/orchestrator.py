"""Orchestrator Agent - Coordinates enhancement agents in waves and consolidates results."""
import asyncio
import logging
import sys
from typing import Optional

from app.config import settings

from .artist_researcher import ArtistResearcherAgent
from .genre_classifier import GenreClassifierAgent
from .language_identifier import LanguageIdentifierAgent
from .lyrics_researcher import LyricsResearcherAgent
from .off_vocal_detector import OffVocalDetectorAgent
from .tags_suggester import TagsSuggesterAgent
from .title_guesser import TitleGuesserAgent
from ..services.brave_search import BraveSearchService

logger = logging.getLogger(__name__)

OFF_VOCAL_CONFIDENCE_THRESHOLD = 0.6
LYRICS_CONFIDENCE_THRESHOLD = 0.7


class OrchestratorAgent:
    """Orchestrates enhancement agents in waves and consolidates their results."""

    def __init__(self):
        """Initialize the Orchestrator with all sub-agents."""
        self.title_guesser = TitleGuesserAgent()
        self.off_vocal_detector = OffVocalDetectorAgent()
        self.artist_researcher = ArtistResearcherAgent()
        self.genre_classifier = GenreClassifierAgent()
        self.tags_suggester = TagsSuggesterAgent()
        self.language_identifier = LanguageIdentifierAgent()
        self.lyrics_researcher = LyricsResearcherAgent()
        self.brave = BraveSearchService()

    async def enhance(
        self,
        canonical_payload: dict,
        existing_genres: list[str],
        existing_tags: list[str],
    ) -> dict:
        """
        Enhance a song suggestion payload with multiple agents, run in dependency-ordered waves.

        Args:
            canonical_payload: Original song metadata with keys:
                - source_url, source_id, source, source_thumbnail: str (immutable)
                - title, artist: str
                - language: Optional[str]
                - is_off_vocal, video_has_lyrics: bool
                - genre: Optional[str]
                - tags: Optional[list[str]]
                - lyrics: Optional[str]
            existing_genres: Distinct genres already used in the songbook (for GenreClassifier)
            existing_tags: Distinct tags already used in the songbook (for TagsSuggester)

        Returns:
            Enhanced payload in the same canonical shape
        """
        try:
            print("[ORCHESTRATOR] enhance() started", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] enhance() started")

            youtube_title = canonical_payload.get("title", "")
            youtube_description = canonical_payload.get("_youtube_description", "")

            # ── Wave 1: Title + Off-Vocal (parallel, both sync methods) ──
            print("[ORCHESTRATOR] === WAVE 1: Title Guesser + Off-Vocal Detector ===", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] === WAVE 1: Title Guesser + Off-Vocal Detector ===")
            loop = asyncio.get_event_loop()
            tg_result, ov_result = await asyncio.gather(
                loop.run_in_executor(None, self.title_guesser.extract, youtube_title, youtube_description),
                loop.run_in_executor(None, self.off_vocal_detector.detect, youtube_title, youtube_description),
            )

            resolved_title = tg_result.get("extracted_title") or canonical_payload.get("title", "")
            resolved_artist = tg_result.get("extracted_artist") or canonical_payload.get("artist")

            # ── Metadata web search (sequential, feeds Wave 2's Genre/Tags agents) ──
            web_context = await self._run_metadata_web_search(resolved_title, resolved_artist)

            # ── Wave 2: Artist + Genre + Tags + Language (parallel) ──
            print("[ORCHESTRATOR] === WAVE 2: Artist + Genre + Tags + Language ===", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] === WAVE 2: Artist + Genre + Tags + Language ===")
            ar_result, gc_result, ts_result, li_result = await asyncio.gather(
                self._run_artist_researcher(resolved_title, resolved_artist, youtube_title),
                self._run_genre_classifier(resolved_title, resolved_artist, existing_genres, web_context),
                self._run_tags_suggester(resolved_title, resolved_artist, existing_tags, web_context),
                self._run_language_identifier(resolved_title, resolved_artist, youtube_title),
            )

            partial = self._consolidate_waves_1_2(
                canonical_payload, tg_result, ov_result, ar_result, gc_result, ts_result, li_result
            )

            # ── Wave 3: Lyrics (sequential, needs final title + artist) ──
            print("[ORCHESTRATOR] === WAVE 3: Lyrics Researcher ===", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] === WAVE 3: Lyrics Researcher ===")
            lyrics_result = await self._run_lyrics_researcher(partial["title"], partial.get("artist"))

            enhanced = self._final_consolidation(partial, lyrics_result)
            print("[ORCHESTRATOR] Enhancement completed successfully", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] Enhancement completed successfully")
            return enhanced
        except Exception as e:
            print(f"[ORCHESTRATOR] enhance() failed, returning original payload: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] enhance() failed, returning original payload: %s", e)
            return canonical_payload

    async def _run_metadata_web_search(self, title: str, artist: Optional[str]) -> list[str]:
        if not settings.enable_metadata_web_search:
            return []
        try:
            query = f"{title} {artist}".strip() if artist else title
            results = await self.brave.search(query, count=5)
            return [f"{r['title']}: {r['description']}" for r in results if r.get("description")]
        except Exception as e:
            print(f"[ORCHESTRATOR] metadata web search failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] metadata web search failed: %s", e)
            return []

    async def _run_artist_researcher(self, title: str, artist: Optional[str], youtube_title: str) -> dict:
        try:
            return await self.artist_researcher.research(title, artist, youtube_title)
        except Exception as e:
            print(f"[ORCHESTRATOR] artist_researcher failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] artist_researcher failed: %s", e)
            return {"verified_artist": artist, "confidence": 0.1}

    async def _run_genre_classifier(
        self, title: str, artist: Optional[str], existing_genres: list[str], web_context: list[str]
    ) -> dict:
        try:
            return await self.genre_classifier.classify(title, artist, existing_genres, web_context)
        except Exception as e:
            print(f"[ORCHESTRATOR] genre_classifier failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] genre_classifier failed: %s", e)
            return {"matched_genre": None, "is_new_genre": False, "new_genre_suggestion": None, "confidence": 0.0}

    async def _run_tags_suggester(
        self, title: str, artist: Optional[str], existing_tags: list[str], web_context: list[str]
    ) -> dict:
        try:
            return await self.tags_suggester.suggest(title, artist, existing_tags, web_context)
        except Exception as e:
            print(f"[ORCHESTRATOR] tags_suggester failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] tags_suggester failed: %s", e)
            return {"matched_tags": [], "new_tags": [], "confidence": 0.0}

    async def _run_language_identifier(self, title: str, artist: Optional[str], youtube_title: str) -> dict:
        try:
            return await self.language_identifier.detect(title, artist, youtube_title)
        except Exception as e:
            print(f"[ORCHESTRATOR] language_identifier failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] language_identifier failed: %s", e)
            return {"language": "en", "confidence": 0.1}

    async def _run_lyrics_researcher(self, title: str, artist: Optional[str]) -> dict:
        try:
            return await self.lyrics_researcher.research(title, artist)
        except Exception as e:
            print(f"[ORCHESTRATOR] lyrics_researcher failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] lyrics_researcher failed: %s", e)
            return {"lyrics": None, "source_url": None, "confidence": 0.0}

    def _consolidate_waves_1_2(
        self,
        original: dict,
        title_guesser: dict,
        off_vocal: dict,
        artist_research: dict,
        genre_classification: dict,
        tags_suggestion: dict,
        language_result: dict,
    ) -> dict:
        """Consolidate Wave 1 + Wave 2 results into a partial payload (title/artist final, lyrics pending)."""
        matched_tags = tags_suggestion.get("matched_tags") or []
        new_tags = tags_suggestion.get("new_tags") or []
        combined_tags = list(dict.fromkeys([*matched_tags, *new_tags]))

        genre = genre_classification.get("matched_genre") or genre_classification.get("new_genre_suggestion")

        return {
            # Source fields: always preserved
            "source_url": original.get("source_url", ""),
            "source_id": original.get("source_id", ""),
            "source": original.get("source", "youtube"),
            "source_thumbnail": original.get("source_thumbnail", ""),
            # Title from Title Guesser, fallback to original
            "title": title_guesser.get("extracted_title") or original.get("title", "Unknown Song"),
            # Artist: Artist Researcher -> Title Guesser -> original
            "artist": artist_research.get("verified_artist")
            or title_guesser.get("extracted_artist")
            or original.get("artist", "Unknown Artist"),
            # Language from Language Identifier, fallback to original
            "language": language_result.get("language") or original.get("language"),
            # Off-vocal/lyrics flags from Off-Vocal Detector, only if confident
            "is_off_vocal": (
                off_vocal.get("is_off_vocal", False)
                if off_vocal.get("confidence", 0) > OFF_VOCAL_CONFIDENCE_THRESHOLD
                else original.get("is_off_vocal", False)
            ),
            "video_has_lyrics": (
                off_vocal.get("video_has_lyrics", False)
                if off_vocal.get("confidence", 0) > OFF_VOCAL_CONFIDENCE_THRESHOLD
                else original.get("video_has_lyrics", False)
            ),
            # Genre from Genre Classifier, fallback to original
            "genre": genre or original.get("genre"),
            # Tags from Tags Suggester, fallback to original
            "tags": combined_tags or original.get("tags"),
            # Lyrics: preserved through Wave 3
            "lyrics": original.get("lyrics"),
        }

    def _final_consolidation(self, partial: dict, lyrics_result: dict) -> dict:
        """Apply the Lyrics Researcher's result with its confidence gate."""
        lyrics = (
            lyrics_result.get("lyrics")
            if lyrics_result.get("confidence", 0) >= LYRICS_CONFIDENCE_THRESHOLD
            else None
        )
        return {**partial, "lyrics": lyrics or partial.get("lyrics")}
