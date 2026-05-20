"""Orchestrator Agent - Coordinates enhancement agents and consolidates results."""
import asyncio
import logging
from typing import Optional

from .language_identifier import LanguageIdentifierAgent
from .title_guesser import TitleGuesserAgent
from .web_researcher import WebResearcherAgent

logger = logging.getLogger(__name__)


class OrchestratorAgent:
    """Orchestrates enhancement agents and consolidates their results."""

    def __init__(self):
        """Initialize the Orchestrator with all sub-agents."""
        self.title_guesser = TitleGuesserAgent()
        self.web_researcher = WebResearcherAgent()
        self.language_identifier = LanguageIdentifierAgent()

    async def enhance(self, canonical_payload: dict) -> dict:
        """
        Enhance a song suggestion payload with multiple agents.

        Args:
            canonical_payload: Original song metadata with keys:
                - source_url: str (immutable)
                - source_id: str (immutable)
                - source: str (immutable)
                - source_thumbnail: str (immutable)
                - title: str
                - artist: str
                - language: Optional[str]
                - is_off_vocal: bool
                - video_has_lyrics: bool
                - genre: Optional[str]
                - tags: Optional[list[str]]
                - lyrics: Optional[str] (unchanged)

        Returns:
            Enhanced payload in the same canonical shape
        """
        try:
            # Extract YouTube metadata (assuming these are passed in or we fetch them)
            youtube_title = canonical_payload.get("title", "")
            youtube_description = canonical_payload.get("_youtube_description", "")

            # Step 1: Title Guesser (synchronous)
            logger.info("Running Title Guesser agent")
            title_guesser_result = self.title_guesser.extract(youtube_title, youtube_description)

            # Step 2: Run Web Researcher and Language Identifier in parallel
            logger.info("Running Web Researcher and Language Identifier agents in parallel")
            web_research_result, language_result = await asyncio.gather(
                self.web_researcher.research(
                    title=title_guesser_result.get("extracted_title", canonical_payload.get("title", "")),
                    artist=title_guesser_result.get("extracted_artist", canonical_payload.get("artist", "")),
                    youtube_title=youtube_title,
                ),
                self.language_identifier.detect(
                    title=title_guesser_result.get("extracted_title", canonical_payload.get("title", "")),
                    artist=title_guesser_result.get("extracted_artist", canonical_payload.get("artist", "")),
                    youtube_title=youtube_title,
                ),
            )

            # Step 3: Consolidate results using the defined consolidation rules
            enhanced = self._consolidate_results(canonical_payload, title_guesser_result, web_research_result, language_result)

            logger.info("Enhancement completed successfully")
            return enhanced

        except Exception as e:
            logger.exception("Orchestrator.enhance failed, returning original payload: %s", e)
            # Graceful degradation: return original payload if something fails
            return canonical_payload

    def _consolidate_results(
        self,
        original: dict,
        title_guesser: dict,
        web_research: dict,
        language_result: dict,
    ) -> dict:
        """
        Consolidate results from all agents into a single enhanced payload.

        Consolidation rules:
        1. source_* fields → always preserved
        2. title → use Title Guesser result, fallback to original
        3. artist → use Web Researcher result, fallback to Title Guesser, fallback to original
        4. language → use Language Identifier result, fallback to original
        5. is_off_vocal, video_has_lyrics → use Title Guesser detection, fallback to false
        6. genre → use Web Researcher result, fallback to original
        7. tags → use Web Researcher result, fallback to original
        8. lyrics → preserve as-is (null or user input)
        """
        return {
            # Step 1: Always preserve source fields
            "source_url": original.get("source_url", ""),
            "source_id": original.get("source_id", ""),
            "source": original.get("source", "youtube"),
            "source_thumbnail": original.get("source_thumbnail", ""),
            # Step 2: Title from Title Guesser, fallback to original
            "title": title_guesser.get("extracted_title") or original.get("title", "Unknown Song"),
            # Step 3: Artist with cascading fallback
            "artist": web_research.get("verified_artist")
            or title_guesser.get("extracted_artist")
            or original.get("artist", "Unknown Artist"),
            # Step 4: Language with fallback
            "language": language_result.get("language")
            or original.get("language"),
            # Step 5: Karaoke detection from Title Guesser
            "is_off_vocal": title_guesser.get("is_off_vocal", False),
            "video_has_lyrics": title_guesser.get("video_has_lyrics", False),
            # Step 6: Genre from Web Researcher, fallback to original
            "genre": web_research.get("genre") or original.get("genre"),
            # Step 7: Tags from Web Researcher, fallback to original
            "tags": web_research.get("tags") or original.get("tags"),
            # Step 8: Lyrics - always preserve
            "lyrics": original.get("lyrics"),
        }
