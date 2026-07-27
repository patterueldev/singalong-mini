"""Lyrics Researcher Agent - Recall lyrics from LLM knowledge, falling back to Brave web search."""
import json
import logging
import sys
from typing import Optional

from app.config import settings
from app.services.brave_search import BraveSearchService
from app.services.llm_client import LLMClient, create_llm_client

logger = logging.getLogger(__name__)

EARLY_EXIT_CONFIDENCE_THRESHOLD = 0.7
MAX_PAGES_TO_FETCH = 3


class LyricsResearcherAgent:
    """Researches song lyrics — LLM knowledge first, Brave web search as a fallback."""

    def __init__(self, llm_client: LLMClient | None = None, brave_client: BraveSearchService | None = None):
        """Initialize the Lyrics Researcher agent."""
        self.llm = llm_client or create_llm_client("lyrics_researcher")
        self.brave = brave_client or BraveSearchService()

    async def research(self, title: str, artist: Optional[str] = None) -> dict:
        """
        Research lyrics for a song.

        Args:
            title: Consolidated song title
            artist: Consolidated song artist (optional)

        Returns:
            Dictionary with:
            - lyrics: Optional[str]
            - source_url: Optional[str]
            - confidence: float (0.0-1.0)
        """
        try:
            print(
                f"[LYRICS_RESEARCHER] research() called - title={title[:60] if title else ''} artist={artist}",
                file=sys.stderr,
                flush=True,
            )
            logger.info(
                "[LYRICS_RESEARCHER] research() called - title=%s artist=%s",
                title[:60] if title else "",
                artist,
            )

            phase_a_result = self._phase_a_llm_knowledge(title, artist)
            print(
                f"[LYRICS_RESEARCHER] Phase A result - confidence={phase_a_result['confidence']}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[LYRICS_RESEARCHER] Phase A result - confidence=%.2f", phase_a_result["confidence"])

            if not settings.enable_lyrics_web_search:
                print(
                    "[LYRICS_RESEARCHER] Web search disabled, returning Phase A (LLM recall) result",
                    file=sys.stderr,
                    flush=True,
                )
                logger.info("[LYRICS_RESEARCHER] Web search disabled, returning Phase A result")
                return phase_a_result

            # Phase A's self-reported confidence on exact lyrics recall isn't reliable — an
            # LLM can be confidently wrong reciting from memory. A Phase B match is grounded
            # in an actually-fetched page (and its own prompt refuses to fabricate), so it's
            # preferred over pure recall whenever it found anything, regardless of Phase A's
            # (unreliable) self-reported number.
            phase_b_result = await self._phase_b_web_search(title, artist)
            if phase_b_result and phase_b_result.get("lyrics"):
                print(
                    f"[LYRICS_RESEARCHER] Using Phase B result - confidence={phase_b_result['confidence']} source_url={phase_b_result['source_url']}",
                    file=sys.stderr,
                    flush=True,
                )
                logger.info(
                    "[LYRICS_RESEARCHER] Using Phase B result - confidence=%.2f source_url=%s",
                    phase_b_result["confidence"],
                    phase_b_result["source_url"],
                )
                return phase_b_result

            return phase_a_result
        except Exception as e:
            print(f"[LYRICS_RESEARCHER] research() failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[LYRICS_RESEARCHER] research() failed: %s", e)
            return {"lyrics": None, "source_url": None, "confidence": 0.0}

    def _phase_a_llm_knowledge(self, title: str, artist: Optional[str]) -> dict:
        try:
            if not self.llm:
                print("[LYRICS_RESEARCHER] No LLM client available for Phase A", file=sys.stderr, flush=True)
                logger.warning("[LYRICS_RESEARCHER] No LLM client available for Phase A")
                return {"lyrics": None, "source_url": None, "confidence": 0.0}

            prompt = f"""You know song lyrics from your training data. Given a song title and artist,
provide the lyrics if you know them. ONLY return lyrics if you are highly
confident they are correct. Do NOT make up lyrics for songs you don't know.

If the song is in Japanese, provide ROMANIZED (romaji) lyrics, not Japanese script
(hiragana/katakana/kanji) — this is a karaoke app and guests need to read/sing along.
For songs in other languages, keep the lyrics in their original written form.

Song: {title} by {artist or "Unknown"}

Return ONLY valid JSON:
{{
  "lyrics": "full lyrics as a single string with \\n line breaks, or null if uncertain",
  "source_url": null,
  "confidence": 0.0-1.0
}}"""

            print("[LYRICS_RESEARCHER] Calling LLM for Phase A (knowledge recall)...", file=sys.stderr, flush=True)
            logger.info("[LYRICS_RESEARCHER] Calling LLM for Phase A")

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=2000,
            )

            response_text = response.choices[0].message.content.strip()
            print(
                f"[LYRICS_RESEARCHER] Phase A LLM response - raw={response_text[:200]}",
                file=sys.stderr,
                flush=True,
            )
            logger.info("[LYRICS_RESEARCHER] Phase A LLM response - raw=%s", response_text[:200])

            result = json.loads(response_text)
            return {
                "lyrics": result.get("lyrics"),
                "source_url": None,
                "confidence": float(result.get("confidence", 0.0)),
            }
        except Exception as e:
            print(f"[LYRICS_RESEARCHER] Phase A failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[LYRICS_RESEARCHER] Phase A failed: %s", e)
            return {"lyrics": None, "source_url": None, "confidence": 0.0}

    async def _phase_b_web_search(self, title: str, artist: Optional[str]) -> Optional[dict]:
        try:
            query = f"{title} {artist} lyrics".strip() if artist else f"{title} lyrics"
            results = await self.brave.search(query, count=5)
            if not results and artist:
                results = await self.brave.search(f"{title} lyrics", count=5)
            if not results:
                print("[LYRICS_RESEARCHER] Phase B - no Brave search results", file=sys.stderr, flush=True)
                logger.info("[LYRICS_RESEARCHER] Phase B - no Brave search results")
                return None

            best: Optional[dict] = None
            for result in results[:MAX_PAGES_TO_FETCH]:
                page_text = await self.brave.fetch_page_text(result["url"])
                if not page_text:
                    continue

                extraction = self._extract_lyrics_from_page(page_text, title, artist)
                if not extraction.get("lyrics"):
                    continue

                candidate = {
                    "lyrics": extraction["lyrics"],
                    "source_url": result["url"],
                    "confidence": extraction["confidence"],
                }
                print(
                    f"[LYRICS_RESEARCHER] Phase B candidate - url={result['url']} confidence={candidate['confidence']}",
                    file=sys.stderr,
                    flush=True,
                )
                logger.info(
                    "[LYRICS_RESEARCHER] Phase B candidate - url=%s confidence=%.2f",
                    result["url"],
                    candidate["confidence"],
                )

                if best is None or candidate["confidence"] > best["confidence"]:
                    best = candidate
                if best["confidence"] >= EARLY_EXIT_CONFIDENCE_THRESHOLD:
                    break

            return best
        except Exception as e:
            print(f"[LYRICS_RESEARCHER] Phase B failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[LYRICS_RESEARCHER] Phase B failed: %s", e)
            return None

    def _extract_lyrics_from_page(self, page_text: str, title: str, artist: Optional[str]) -> dict:
        try:
            if not self.llm:
                return {"lyrics": None, "confidence": 0.0}

            prompt = f"""Below is text extracted from a web page. Extract the full lyrics for the song
"{title}" by {artist or "Unknown"} if they are present in this text. Do NOT make up lyrics —
if the page does not contain this song's lyrics, return null.

If the lyrics are in Japanese, output ROMANIZED (romaji) lyrics, not Japanese script
(hiragana/katakana/kanji), even if the source page shows native script — this is a
karaoke app and guests need to read/sing along. For songs in other languages, keep the
lyrics in their original written form.

Page text:
{page_text}

Return ONLY valid JSON:
{{
  "lyrics": "full lyrics as a single string with \\n line breaks, or null if not found",
  "confidence": 0.0-1.0
}}"""

            response = self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=2000,
            )

            response_text = response.choices[0].message.content.strip()
            result = json.loads(response_text)
            return {
                "lyrics": result.get("lyrics"),
                "confidence": float(result.get("confidence", 0.0)),
            }
        except Exception as e:
            print(f"[LYRICS_RESEARCHER] page extraction failed: {e}", file=sys.stderr, flush=True)
            logger.exception("[LYRICS_RESEARCHER] page extraction failed: %s", e)
            return {"lyrics": None, "confidence": 0.0}
