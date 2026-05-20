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
        import sys
        try:
            print("[ORCHESTRATOR] enhance() started", file=sys.stderr, flush=True)
            print(f"[ORCHESTRATOR] Input payload - title={canonical_payload.get('title')} artist={canonical_payload.get('artist')} language={canonical_payload.get('language')}", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] enhance() started")
            logger.info("[ORCHESTRATOR] Input payload - title=%s artist=%s language=%s", 
                       canonical_payload.get("title"), 
                       canonical_payload.get("artist"),
                       canonical_payload.get("language"))
            
            # Extract YouTube metadata (assuming these are passed in or we fetch them)
            youtube_title = canonical_payload.get("title", "")
            youtube_description = canonical_payload.get("_youtube_description", "")
            print(f"[ORCHESTRATOR] youtube_title={youtube_title[:80] if youtube_title else 'EMPTY'} youtube_description={youtube_description[:80] if youtube_description else 'EMPTY'}", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] youtube_title=%s youtube_description=%s", youtube_title[:80], youtube_description[:80] if youtube_description else "(empty)")

            # Step 1: Title Guesser (synchronous)
            print("[ORCHESTRATOR] === STEP 1: Running Title Guesser agent ===", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] === STEP 1: Running Title Guesser agent ===")
            title_guesser_result = self.title_guesser.extract(youtube_title, youtube_description)
            print(f"[ORCHESTRATOR] Title Guesser result: extracted_title={title_guesser_result.get('extracted_title')} extracted_artist={title_guesser_result.get('extracted_artist')} is_off_vocal={title_guesser_result.get('is_off_vocal')} video_has_lyrics={title_guesser_result.get('video_has_lyrics')} confidence={title_guesser_result.get('confidence', 0.0)}", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] Title Guesser result: extracted_title=%s extracted_artist=%s is_off_vocal=%s video_has_lyrics=%s confidence=%.2f",
                       title_guesser_result.get("extracted_title"),
                       title_guesser_result.get("extracted_artist"),
                       title_guesser_result.get("is_off_vocal"),
                       title_guesser_result.get("video_has_lyrics"),
                       title_guesser_result.get("confidence", 0.0))

            # Step 2: Run Web Researcher and Language Identifier in parallel
            print("[ORCHESTRATOR] === STEP 2: Running Web Researcher and Language Identifier agents in parallel ===", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] === STEP 2: Running Web Researcher and Language Identifier agents in parallel ===")
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
            
            print(f"[ORCHESTRATOR] Web Researcher result: verified_artist={web_research_result.get('verified_artist')} verified_year={web_research_result.get('verified_year')} genre={web_research_result.get('genre')} tags={web_research_result.get('tags')} confidence={web_research_result.get('research_confidence', 0.0)}", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] Web Researcher result: verified_artist=%s verified_year=%s genre=%s tags=%s confidence=%.2f",
                       web_research_result.get("verified_artist"),
                       web_research_result.get("verified_year"),
                       web_research_result.get("genre"),
                       web_research_result.get("tags"),
                       web_research_result.get("research_confidence", 0.0))
            
            print(f"[ORCHESTRATOR] Language Identifier result: language={language_result.get('language')} confidence={language_result.get('confidence', 0.0)}", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] Language Identifier result: language=%s confidence=%.2f",
                       language_result.get("language"),
                       language_result.get("confidence", 0.0))

            # Step 3: Consolidate results using the defined consolidation rules
            print("[ORCHESTRATOR] === STEP 3: Consolidating results ===", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] === STEP 3: Consolidating results ===")
            enhanced = self._consolidate_results(canonical_payload, title_guesser_result, web_research_result, language_result)
            print(f"[ORCHESTRATOR] Consolidated result: title={enhanced.get('title')} artist={enhanced.get('artist')} language={enhanced.get('language')} is_off_vocal={enhanced.get('is_off_vocal')} video_has_lyrics={enhanced.get('video_has_lyrics')}", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] Consolidated result: title=%s artist=%s language=%s is_off_vocal=%s video_has_lyrics=%s",
                       enhanced.get("title"),
                       enhanced.get("artist"),
                       enhanced.get("language"),
                       enhanced.get("is_off_vocal"),
                       enhanced.get("video_has_lyrics"))

            print("[ORCHESTRATOR] Enhancement completed successfully", file=sys.stderr, flush=True)
            logger.info("[ORCHESTRATOR] Enhancement completed successfully")
            return enhanced

        except Exception as e:
            print(f"[ORCHESTRATOR] enhance() failed, returning original payload: {e}", file=sys.stderr, flush=True)
            logger.exception("[ORCHESTRATOR] enhance() failed, returning original payload: %s", e)
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
            # Step 5: Karaoke detection from Title Guesser (with fallback to original if low confidence)
            # Only use Title Guesser's detection if confidence is reasonably high (>0.7)
            # Otherwise, preserve user's original input
            "is_off_vocal": (
                title_guesser.get("is_off_vocal", False)
                if title_guesser.get("confidence", 0) > 0.7
                else original.get("is_off_vocal", False)
            ),
            "video_has_lyrics": (
                title_guesser.get("video_has_lyrics", False)
                if title_guesser.get("confidence", 0) > 0.7
                else original.get("video_has_lyrics", False)
            ),
            # Step 6: Genre from Web Researcher, fallback to original
            "genre": web_research.get("genre") or original.get("genre"),
            # Step 7: Tags from Web Researcher, fallback to original
            "tags": web_research.get("tags") or original.get("tags"),
            # Step 8: Lyrics - always preserve
            "lyrics": original.get("lyrics"),
        }
